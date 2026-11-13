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
import { detectMistakes, type MistakeCandidate } from '../mistakeDetector'
import { nextTuning } from '../mistakeTuning'

const TAG_CATEGORIES = new Set(['macro', 'micro', 'vision', 'economy', 'draft'])

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

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
    const category = TAG_CATEGORIES.has(args.category) ? args.category : 'micro'
    // Derive a slug from the label so manual creates don't collide with
    // built-ins. Suffix with a short random tail if a slug already exists.
    const prisma = getPrisma()
    const base = args.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'custom'
    let slug = base
    let i = 1
    while (await prisma.mistakeTag.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`
    }
    return prisma.mistakeTag.create({
      data: {
        slug,
        label: args.label.trim(),
        category,
        icon: args.icon ?? null,
        color: args.color ?? null,
        isBuiltIn: false,
      },
    })
  })

  ipcMain.handle('mistake:archive-tag', async (_e, tagId: string) => {
    const prisma = getPrisma()
    await prisma.mistakeTag.update({ where: { id: tagId }, data: { archivedAt: new Date() } })
    return { success: true }
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

  ipcMain.handle('mistake:update', async (_e, args: { id: string; note?: string | null; severity?: number; tagId?: string }) => {
    const prisma = getPrisma()
    const data: any = {}
    if (args.note !== undefined) data.note = args.note?.slice(0, 1000) || null
    if (typeof args.severity === 'number') data.severity = Math.min(3, Math.max(1, args.severity))
    if (args.tagId) data.tagId = args.tagId
    return prisma.mistake.update({ where: { id: args.id }, data, include: { tag: true } })
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
   * Run the heuristic detector for a given game. Skips candidates that
   * already have a near-duplicate (same gameId + slug ± 3s) — lets us call
   * it multiple times without spamming the timeline.
   */
  ipcMain.handle('mistake:auto-detect', async (_e, gameId: string) => {
    const prisma = getPrisma()
    const game = await prisma.game.findUnique({ where: { id: gameId } })
    if (!game?.matchId) return { created: 0, skipped: 0, reason: 'no-game' }

    const cache = await prisma.matchCache.findUnique({ where: { matchId: game.matchId } })
    if (!cache?.matchJson || !cache.timelineJson) return { created: 0, skipped: 0, reason: 'no-cache' }

    const user = await prisma.user.findFirst({ where: { isActive: true } })
    const accounts = user ? await prisma.account.findMany({ where: { userId: user.id } }) : []
    const userPuuids = user ? [user.puuid, ...accounts.map((a) => a.puuid)].filter((p) => !!p) : []

    let candidates: MistakeCandidate[] = []
    try {
      candidates = detectMistakes(cache.timelineJson, cache.matchJson, {
        puuids: userPuuids,
        championName: game.champion,
        win: game.win,
      })
    } catch (err) {
      console.warn('[mistake] auto-detect failed:', (err as Error)?.message ?? err)
      return { created: 0, skipped: 0, reason: 'detector-error' }
    }

    // Map slug → tagId for the candidates we know about. Skip silently if
    // a tag was archived or the slug doesn't exist (custom-only deploy).
    const slugs = [...new Set(candidates.map((c) => c.tagSlug))]
    const tags = await prisma.mistakeTag.findMany({ where: { slug: { in: slugs }, archivedAt: null } })
    const slugToTagId = new Map(tags.map((t) => [t.slug, t.id]))

    // Pre-load existing auto-detected mistakes for this game to deduplicate.
    const existing = await prisma.mistake.findMany({
      where: { gameId, autoDetected: true },
      select: { tagId: true, gameTimeSec: true },
    })
    const existingBuckets = new Map<string, number[]>()
    for (const e of existing) {
      const list = existingBuckets.get(e.tagId) ?? []
      list.push(e.gameTimeSec)
      existingBuckets.set(e.tagId, list)
    }

    let created = 0
    let skipped = 0
    for (const c of candidates) {
      const tagId = slugToTagId.get(c.tagSlug)
      if (!tagId) { skipped++; continue }
      const nearby = existingBuckets.get(tagId) ?? []
      if (nearby.some((t) => Math.abs(t - c.gameTimeSec) <= 3)) { skipped++; continue }
      await prisma.mistake.create({
        data: {
          gameId,
          tagId,
          gameTimeSec: Math.max(0, Math.floor(c.gameTimeSec)),
          note: c.note ?? null,
          severity: Math.min(3, Math.max(1, c.severity ?? 2)),
          autoDetected: true,
        },
      })
      created++
      nearby.push(c.gameTimeSec)
      existingBuckets.set(tagId, nearby)
    }

    console.log(`[mistake] auto-detect game=${gameId}: created=${created}, skipped=${skipped}`)
    return { created, skipped, reason: 'ok' }
  })

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

  ipcMain.handle('mistake-stats:trend', async (_e, opts: { tagSlugs?: string[]; days?: number; role?: string | null; champion?: string | null }) => {
    const prisma = getPrisma()
    const days = Math.max(1, opts?.days ?? 30)
    const since = new Date(Date.now() - days * 86_400_000)
    const champ = (opts?.champion ?? '').trim().toLowerCase()

    const all = await prisma.mistake.findMany({
      where: {
        createdAt: { gte: since },
        ...(opts.tagSlugs?.length ? { tag: { slug: { in: opts.tagSlugs } } } : {}),
        ...(opts?.role ? { game: { role: opts.role } } : {}),
      },
      include: { tag: true, game: { select: { champion: true } } },
    })
    const rows = all.filter((m) => championMatches(m.game?.champion, champ))

    // Build a date matrix — every day in the window, even when empty,
    // so the line chart renders without gaps.
    const out: Record<string, Record<string, number>> = {}
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 86_400_000)
      out[isoDay(d)] = {}
    }
    for (const m of rows) {
      const day = isoDay(m.createdAt)
      const slug = m.tag.slug
      out[day] = out[day] ?? {}
      out[day][slug] = (out[day][slug] ?? 0) + 1
    }
    return Object.entries(out)
      .map(([date, counts]) => ({ date, counts }))
      .sort((a, b) => a.date.localeCompare(b.date))
  })

  ipcMain.handle('mistake-stats:heatmap', async (_e, opts: { days?: number; role?: string | null; champion?: string | null }) => {
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
    })
    const rows = all.filter((m) => championMatches(m.game?.champion, champ))
    const out: Record<string, Record<string, number>> = {} // day → tagId → count
    for (const m of rows) {
      const day = isoDay(m.createdAt)
      out[day] = out[day] ?? {}
      out[day][m.tagId] = (out[day][m.tagId] ?? 0) + 1
    }
    const flat: Array<{ date: string; tagId: string; count: number; tagSlug: string; tagLabel: string }> = []
    for (const [date, perTag] of Object.entries(out)) {
      for (const [tagId, count] of Object.entries(perTag)) {
        const tag = rows.find((r) => r.tagId === tagId)?.tag
        flat.push({ date, tagId, count, tagSlug: tag?.slug ?? '', tagLabel: tag?.label ?? '' })
      }
    }
    return flat
  })
}
