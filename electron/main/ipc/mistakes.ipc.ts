/**
 * Mistake Library IPC — manual tagging + auto-detection + stats.
 *
 * Channels:
 *   mistake:list-tags         → MistakeTag[]
 *   mistake:create-tag        → MistakeTag (user-defined custom tag)
 *   mistake:archive-tag       → void (soft-delete: hides from picker, keeps history)
 *   mistake:list-by-game      → Array<Mistake with tag>
 *   mistake:create            → Mistake (with tag joined)
 *   mistake:update            → Mistake
 *   mistake:delete            → void
 *   mistake:auto-detect       → { created, skipped }
 *   mistake-stats:top-tags    → Array<{ tag, count, lastAt }>
 *   mistake-stats:trend       → Array<{ date, counts }> grouped per day
 *   mistake-stats:heatmap     → Array<{ date, tagId, count }>
 */

import { isPlausibleOffset } from '../mistakeBookmarks'
import { resolveMistakeGameTime } from '../mistakeWindowCore'
import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { CORRECTION_NOTE_MAX, CORRECTION_REASONS, removeMistake, retagMistake, undoMistakeCorrection, type CorrectionInput, type CorrectionReason } from '../mistakeCorrections'
import { resolveTag } from './microReview.ipc'
import { z } from 'zod'
import { validatedHandle, id } from './validate'
import { autoDetectMistakes } from '../mistakeAutoDetect'
import { nextTuning } from '../mistakeTuning'
import { ensureGameAnalysis } from './microReview.ipc'
import { isGarbageTime, winProbAt } from '../../../src/lib/microReview/winProbability'
import { mistakeSlug } from '../../../src/lib/mistakeSlug'

/** Games analysed per Mistake Lab load when their analysis is not cached yet (cached timelines only, no Riot call). */
const ANALYSIS_BACKFILL = 10

const TAG_CATEGORIES = new Set(['macro', 'micro', 'vision', 'economy', 'draft'])

/**
 * Case-insensitive champion filter. SQLite's default BINARY collation makes
 * Prisma `equals` case-sensitive (and `mode: 'insensitive'` is unsupported),
 * so a user typing "diana" never matched the stored "Diana". We filter in JS
 * instead — the in-window mistake set is tiny — and accept partial matches so
 * typing a prefix ("rene") works too.
 */
function championMatches(gameChampion: string | null | undefined, query: string): boolean {
  if (!query) return true
  return (gameChampion ?? '').toLowerCase().includes(query)
}

const correctionSchema = z.object({
  reason: z.enum(CORRECTION_REASONS).nullable().optional(),
  note: z.string().max(CORRECTION_NOTE_MAX).nullable().optional(),
}).strict()
/** The optional "why?" of a removal or retag, kept only when valid (it never blocks the action). */
function correctionInput(opts: { reason?: string | null; note?: string | null } | null | undefined): CorrectionInput {
  const reason = opts?.reason && (CORRECTION_REASONS as readonly string[]).includes(opts.reason) ? opts.reason as CorrectionReason : null
  return { reason, note: typeof opts?.note === 'string' ? opts.note.slice(0, CORRECTION_NOTE_MAX) : null }
}

/** "I tag my mistakes myself" (21/11/2026): the Lab reads only the player's own tags. */
async function manualOnly(): Promise<{ autoDetected?: false }> {
  const user = await getPrisma().user.findFirst({ where: { isActive: true }, select: { selfTagMistakes: true } })
  return user?.selfTagMistakes ? { autoDetected: false } : {}
}

export function registerMistakeHandlers() {
  ipcMain.handle('mistake:list-tags', async (_e, opts?: { includeArchived?: boolean }) => {
    const prisma = getPrisma()
    const tags = await prisma.mistakeTag.findMany({
      where: opts?.includeArchived ? undefined : { archivedAt: null },
      orderBy: [{ category: 'asc' }, { label: 'asc' }],
    })
    return tags
  })

  ipcMain.handle('mistake:create-tag', async (_e, args: { label: string; category: string; icon?: string; color?: string }) => {
    if (!args.label?.trim()) throw new Error('Label required')
    const label = args.label.trim().slice(0, 60)
    const category = TAG_CATEGORIES.has(args.category) ? args.category : 'micro'
    const prisma = getPrisma()
    // Naming a personal tag that already exists gives that tag back (as the
    // micro-review's "Autre cause" does): no "-1" twin for the same words. An
    // archived one comes back into the list instead of being duplicated.
    const existing = await prisma.mistakeTag.findFirst({ where: { label, isBuiltIn: false } })
    if (existing) {
      return existing.archivedAt
        ? prisma.mistakeTag.update({ where: { id: existing.id }, data: { archivedAt: null } })
        : existing
    }
    // Slug derived from the label (shared algorithm, see mistakeSlug); a
    // numeric suffix only when the slug is already taken, e.g. by a built-in.
    const base = mistakeSlug(label)
    let slug = base
    let i = 1
    while (await prisma.mistakeTag.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`
    }
    return prisma.mistakeTag.create({
      data: {
        slug,
        label,
        category,
        icon: args.icon ?? null,
        color: args.color ?? null,
        isBuiltIn: false,
      },
    })
  })


  // ── Review « Erreurs détectées » (21/11/2026) ──
  // The game's auto-detected mistakes, and the deletion of a wrong one: removed from the Lab and remembered, so the
  // detection does not create it again.
  validatedHandle('mistake:list-detected', z.tuple([id]), async (_e, gameId) => {
    const rows = await getPrisma().mistake.findMany({ where: { gameId, autoDetected: true }, include: { tag: true }, orderBy: { gameTimeSec: 'asc' } })
    return rows.map((m) => ({ id: m.id, tagSlug: m.tag.slug, tagLabel: m.tag.label, gameTimeSec: m.gameTimeSec, severity: m.severity, note: m.note }))
  })
  validatedHandle('mistake:dismiss-detected', z.tuple([id, correctionSchema.optional()]), async (_e, mistakeId, opts) => {
    const m = await getPrisma().mistake.findUnique({ where: { id: mistakeId }, select: { autoDetected: true } })
    if (!m?.autoDetected) throw new Error('NOT_FOUND')
    await removeMistake(mistakeId, correctionInput(opts))
    return { success: true }
  })
  // « Modifier l'erreur » (21/11/2026): another tag for ONE mistake, by id. The detection never recreates nor overwrites it.
  validatedHandle('mistake:retag', z.tuple([id, z.object({
    tagSlug: z.string().max(64).regex(/^[a-z0-9-]+$/).nullable().optional(),
    customLabel: z.string().max(60).nullable().optional(),
  }).strict(), correctionSchema.optional()]), async (_e, mistakeId, to, opts) => {
    const tag = await resolveTag(to.tagSlug, to.customLabel)
    if (!tag) throw new Error('UNKNOWN_TAG')
    return retagMistake(mistakeId, tag.id, tag.slug, correctionInput(opts))
  })
  // « Annuler » (21/11/2026): reverts the last removal or retag of this mistake while the app runs. NOT_UNDOABLE otherwise.
  validatedHandle('mistake:undo-correction', z.tuple([id]), async (_e, mistakeId) => undoMistakeCorrection(mistakeId))

  ipcMain.handle('mistake:list-by-game', async (_e, gameId: string) => {
    const prisma = getPrisma()
    return prisma.mistake.findMany({
      where: { gameId, ...(await manualOnly()) },
      include: { tag: true },
      orderBy: { gameTimeSec: 'asc' },
    })
  })

  // 21/11/2026: validated. The time the screen sends is kept (never a silent 0:00): an integer within the game, or
  // computed from the video time and a plausible recording offset when missing. BAD_GAME_TIME otherwise.
  validatedHandle('mistake:create', z.tuple([z.object({
    gameId: id,
    tagId: id,
    gameTimeSec: z.number().finite().nullable().optional(),
    videoTimeMs: z.number().finite().min(0).max(36_000_000).nullable().optional(),
    note: z.string().max(10_000).nullable().optional(),
    severity: z.number().int().min(1).max(3).nullable().optional(),
    recordingId: id.nullable().optional(),
    autoDetected: z.boolean().optional(),
  }).strip()]), async (_e, args) => {
    const prisma = getPrisma()
    const game = await prisma.game.findUnique({ where: { id: args.gameId }, select: { duration: true, recording: { select: { startOffsetSec: true } } } })
    if (!game) throw new Error('NOT_FOUND')
    const offset = game.recording?.startOffsetSec
    const gameTimeSec = resolveMistakeGameTime(args.gameTimeSec, args.videoTimeMs, isPlausibleOffset(offset) ? offset : null, game.duration)
    return prisma.mistake.create({
      data: {
        gameId: args.gameId,
        tagId: args.tagId,
        gameTimeSec,
        videoTimeMs: typeof args.videoTimeMs === 'number' ? Math.max(0, Math.floor(args.videoTimeMs)) : null,
        note: args.note?.slice(0, 1000) || null,
        severity: Math.min(3, Math.max(1, args.severity ?? 2)),
        recordingId: args.recordingId ?? null,
        autoDetected: !!args.autoDetected,
      },
      include: { tag: true },
    })
  })


  // One mistake at a time, by id (21/11/2026: never a whole game's). An auto-detected one is remembered (never recreated)
  // and logged as a correction, with the optional "why?" of the dialog.
  ipcMain.handle('mistake:delete', async (_e, id: string, opts?: { reason?: string | null; note?: string | null }) => {
    const prisma = getPrisma()
    const deleted = await removeMistake(id, correctionInput(opts))
    // MX3: deleting an auto-detected mistake counts toward lowering that
    // tag's default severity for this player. Manually-created ones never count.
    if (deleted.autoDetected) {
      const user = await prisma.user.findFirst({ where: { isActive: true } })
      if (user) {
        const existing = await prisma.mistakeTagTuning.findUnique({ where: { userId_tagId: { userId: user.id, tagId: deleted.tagId } } })
        const { deletedCount, severityDelta } = nextTuning(existing?.deletedCount ?? 0)
        await prisma.mistakeTagTuning.upsert({
          where: { userId_tagId: { userId: user.id, tagId: deleted.tagId } },
          create: { userId: user.id, tagId: deleted.tagId, deletedCount, severityDelta },
          update: { deletedCount, severityDelta },
        })
      }
    }
    return { success: true }
  })

  /**
   * The "Auto-detect" button. Same path as the post-game analysis (E11): the learned severity (MX3)
   * and the severity-3 bookmarks (MX5) apply here too. Never repeats a mistake the game already has.
   */
  ipcMain.handle('mistake:auto-detect', (_e, gameId: string) => autoDetectMistakes(gameId))

  // ── Stats handlers (consumed by MistakeStatsPage + Dashboard widget) ──

  ipcMain.handle('mistake-stats:top-tags', async (_e, opts?: { days?: number; role?: string | null; champion?: string | null }) => {
    const prisma = getPrisma()
    const days = Math.max(1, opts?.days ?? 30)
    const since = new Date(Date.now() - days * 86_400_000)
    const champ = (opts?.champion ?? '').trim().toLowerCase()

    const all = await prisma.mistake.findMany({
      where: {
        createdAt: { gte: since },
        ...(opts?.role ? { game: { role: opts.role } } : {}),
        ...(await manualOnly()),
      },
      include: { tag: true, game: { select: { champion: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const rows = all.filter((m) => championMatches(m.game?.champion, champ))

    const byTag = new Map<string, { tag: typeof rows[number]['tag']; count: number; lastAt: Date }>()
    for (const m of rows) {
      const entry = byTag.get(m.tagId)
      if (entry) {
        entry.count++
        if (m.createdAt > entry.lastAt) entry.lastAt = m.createdAt
      } else {
        byTag.set(m.tagId, { tag: m.tag, count: 1, lastAt: m.createdAt })
      }
    }
    return [...byTag.values()]
      .sort((a, b) => b.count - a.count)
      .map((e) => ({ tag: e.tag, count: e.count, lastAt: e.lastAt.toISOString() }))
  })

  /**
   * Mistake Lab: every tagged occurrence in the window with the context the
   * page needs to make it actionable — the game's result (win-rate cost),
   * when in the game it happened (early/mid/late) and the recording to jump
   * to. Same window/role/champion filters as the other stats handlers.
   * Read-only.
   */
  ipcMain.handle('mistake-stats:occurrences', async (_e, opts?: { days?: number; role?: string | null; champion?: string | null }) => {
    const prisma = getPrisma()
    const days = Math.max(1, opts?.days ?? 30)
    const since = new Date(Date.now() - days * 86_400_000)
    const champ = (opts?.champion ?? '').trim().toLowerCase()
    const all = await prisma.mistake.findMany({
      where: {
        createdAt: { gte: since },
        ...(opts?.role ? { game: { role: opts.role } } : {}),
        ...(await manualOnly()),
      },
      include: {
        tag: true,
        game: { select: { id: true, champion: true, opponentChampion: true, win: true, gameEndAt: true, duration: true, recording: { select: { id: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    })
    const rows = all.filter((m) => m.game && championMatches(m.game.champion, champ))
    // Garbage time (P(win) < 0.18 or > 0.85 before the mistake) stays out of
    // the with/without win-rate ratios — docs/PLAN_MICRO_REVIEW.md §A.
    const gameIds = [...new Set(rows.map((m) => m.gameId))]
    const curves = new Map<string, number[]>()
    for (const a of await prisma.gameAnalysis.findMany({ where: { gameId: { in: gameIds } } })) {
      try { curves.set(a.gameId, JSON.parse(a.payload).winProb ?? []) } catch { /* ignore */ }
    }
    for (const gid of gameIds.filter((g) => !curves.has(g)).slice(0, ANALYSIS_BACKFILL)) {
      const { analysis } = await ensureGameAnalysis(gid, false).catch(() => ({ analysis: null }))
      if (analysis) curves.set(gid, analysis.winProb)
    }
    // A mistake that comes from a micro-review answer already passed the detector's garbage-time gate, taken at
    // the action itself; its own timestamp is a few seconds earlier (VOD anchor) and must not be judged again.
    const reviewed = new Set((await prisma.microReviewAnswer.findMany({
      where: { gameId: { in: gameIds }, mistakeId: { not: null } }, select: { mistakeId: true },
    })).map((a) => a.mistakeId))
    return rows
      .map((m) => ({
        id: m.id,
        tag: { id: m.tag.id, slug: m.tag.slug, label: m.tag.label, category: m.tag.category, color: m.tag.color },
        severity: m.severity,
        gameTimeSec: m.gameTimeSec,
        autoDetected: m.autoDetected,
        note: m.note,
        recordingId: m.recordingId ?? m.game!.recording?.id ?? null,
        garbageTime: !reviewed.has(m.id) && isGarbageTime(winProbAt(curves.get(m.gameId) ?? [], m.gameTimeSec * 1000)),
        game: {
          id: m.game!.id,
          champion: m.game!.champion,
          opponentChampion: m.game!.opponentChampion,
          win: m.game!.win,
          gameEndAt: m.game!.gameEndAt.toISOString(),
          duration: m.game!.duration,
        },
      }))
  })


}
