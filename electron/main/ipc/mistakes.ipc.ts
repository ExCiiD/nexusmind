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

import { ipcMain } from 'electron'
import { getPrisma } from '../database'
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


  ipcMain.handle('mistake:list-by-game', async (_e, gameId: string) => {
    const prisma = getPrisma()
    return prisma.mistake.findMany({
      where: { gameId },
      include: { tag: true },
      orderBy: { gameTimeSec: 'asc' },
    })
  })

  ipcMain.handle('mistake:create', async (_e, args: {
    gameId: string
    tagId: string
    gameTimeSec: number
    videoTimeMs?: number
    note?: string
    severity?: number
    recordingId?: string
    autoDetected?: boolean
  }) => {
    if (!args.gameId || !args.tagId) throw new Error('gameId + tagId required')
    const prisma = getPrisma()
    return prisma.mistake.create({
      data: {
        gameId: args.gameId,
        tagId: args.tagId,
        gameTimeSec: Math.max(0, Math.floor(args.gameTimeSec ?? 0)),
        videoTimeMs: typeof args.videoTimeMs === 'number' ? Math.max(0, Math.floor(args.videoTimeMs)) : null,
        note: args.note?.slice(0, 1000) || null,
        severity: Math.min(3, Math.max(1, args.severity ?? 2)),
        recordingId: args.recordingId ?? null,
        autoDetected: !!args.autoDetected,
      },
      include: { tag: true },
    })
  })


  ipcMain.handle('mistake:delete', async (_e, id: string) => {
    const prisma = getPrisma()
    const deleted = await prisma.mistake.delete({ where: { id } })
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
