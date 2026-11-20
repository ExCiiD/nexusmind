/**
 * The one way the main process reads and writes MatchCache (AUDIT_PERF_2 gains 6 and 7, 20/11/2026).
 *
 * - **Timelines** are stored gzip-compressed (matchStoreCore.ts). Every reader gets the decompressed JSON string
 *   back, and a timeline still stored plain is rewritten compressed the first time it is read.
 * - **Match summaries**: when a match body is written, the History and Dashboard line of each of the player's
 *   accounts in it (extractPlayerStats) is stored in MatchSummary, so those screens do not parse 50 bodies of
 *   ~75 KB each time.
 * - Reads select only the column they need: a timeline is never read to get a match body.
 */
import { getPrisma } from './database'
import { extractPlayerStats } from './riotClient'
import { decodeTimeline, encodeTimeline, isCompressedTimeline } from './matchStoreCore'

type Prisma = ReturnType<typeof getPrisma>

/** Version of the summary's formula (extractPlayerStats). A summary of another version is computed again. */
export const SUMMARY_VERSION = 1

// ── Timelines ───────────────────────────────────────────────────────────────

/** The stored timeline as JSON; a plain one is rewritten compressed in the background (lazy migration). */
export function timelineFromRow(prisma: Prisma, matchId: string, stored: string | null | undefined): string | null {
  const json = decodeTimeline(stored)
  if (json && !isCompressedTimeline(stored)) {
    void prisma.matchCache.updateMany({ where: { matchId, timelineJson: stored as string }, data: { timelineJson: encodeTimeline(json) } }).catch(() => {})
  }
  return json
}

export async function readTimelineJson(prisma: Prisma, matchId: string): Promise<string | null> {
  const row = await prisma.matchCache.findUnique({ where: { matchId }, select: { timelineJson: true } }).catch(() => null)
  return timelineFromRow(prisma, matchId, row?.timelineJson)
}

export async function readTimeline(prisma: Prisma, matchId: string): Promise<any | null> {
  const json = await readTimelineJson(prisma, matchId)
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

/** Stores a timeline (object or JSON string), compressed. Creates the row only when `matchJson` is given. */
export async function saveTimeline(prisma: Prisma, matchId: string, timeline: unknown, matchJson?: string): Promise<void> {
  const timelineJson = encodeTimeline(timeline)
  if (matchJson !== undefined) {
    await prisma.matchCache.upsert({ where: { matchId }, create: { matchId, matchJson, timelineJson }, update: { timelineJson } })
  } else {
    await prisma.matchCache.update({ where: { matchId }, data: { timelineJson } })
  }
}

// ── Match bodies ────────────────────────────────────────────────────────────

export async function readMatchJson(prisma: Prisma, matchId: string): Promise<string | null> {
  const row = await prisma.matchCache.findUnique({ where: { matchId }, select: { matchJson: true } }).catch(() => null)
  return row?.matchJson || null
}

export async function readMatch(prisma: Prisma, matchId: string): Promise<any | null> {
  const json = await readMatchJson(prisma, matchId)
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

let ownCache: { at: number; puuids: string[] } | null = null
/** Every puuid of this PC's profiles and linked accounts (cached a minute). */
export async function ownPuuids(prisma: Prisma): Promise<string[]> {
  if (ownCache && Date.now() - ownCache.at < 60_000) return ownCache.puuids
  const [users, accounts] = await Promise.all([
    prisma.user.findMany({ select: { puuid: true } }),
    prisma.account.findMany({ select: { puuid: true } }),
  ])
  const puuids = [...new Set([...users, ...accounts].map((r) => r.puuid).filter(Boolean))]
  ownCache = { at: Date.now(), puuids }
  return puuids
}

/**
 * Stores a match body, and the summary of each of the player's accounts in it. `overwrite: false` keeps an
 * existing body (the usual "cache if absent").
 */
export async function saveMatch(prisma: Prisma, matchId: string, matchData: unknown, opts: { overwrite?: boolean } = {}): Promise<void> {
  const matchJson = JSON.stringify(matchData)
  await prisma.matchCache.upsert({
    where: { matchId },
    create: { matchId, matchJson },
    update: opts.overwrite === false ? {} : { matchJson },
  })
  await writeSummaries(prisma, matchId, matchData).catch(() => { /* a summary is only a shortcut */ })
}

// ── Summaries (gain 7) ──────────────────────────────────────────────────────

export type MatchSummaryStats = NonNullable<ReturnType<typeof extractPlayerStats>>

export async function writeSummaries(prisma: Prisma, matchId: string, matchData: any, puuids?: string[]): Promise<Map<string, MatchSummaryStats>> {
  const out = new Map<string, MatchSummaryStats>()
  const participants: any[] = matchData?.info?.participants ?? []
  for (const puuid of puuids ?? await ownPuuids(prisma)) {
    if (!participants.some((p) => p.puuid === puuid)) continue
    const stats = extractPlayerStats(matchData, puuid)
    if (!stats) continue
    out.set(puuid, stats)
    const gameEndAt = stats.gameEndAt ? new Date(stats.gameEndAt) : null
    const statsJson = JSON.stringify(stats)
    await prisma.matchSummary.upsert({
      where: { matchId_puuid: { matchId, puuid } },
      create: { matchId, puuid, version: SUMMARY_VERSION, gameEndAt, statsJson },
      update: { version: SUMMARY_VERSION, gameEndAt, statsJson },
    })
  }
  return out
}

/** The stored summaries of these matches for these puuids (current version only): matchId → { puuid, stats }. */
export async function readSummaries(prisma: Prisma, matchIds: string[], puuids: string[]): Promise<Map<string, { puuid: string; stats: MatchSummaryStats }>> {
  const out = new Map<string, { puuid: string; stats: MatchSummaryStats }>()
  if (matchIds.length === 0 || puuids.length === 0) return out
  const rows = await prisma.matchSummary.findMany({
    where: { matchId: { in: matchIds }, puuid: { in: puuids }, version: SUMMARY_VERSION },
  }).catch(() => [])
  // The first of `puuids` wins when two own accounts are in one match (never in practice).
  const rank = new Map(puuids.map((p, i) => [p, i]))
  for (const r of rows.sort((a, b) => (rank.get(a.puuid) ?? 0) - (rank.get(b.puuid) ?? 0))) {
    if (out.has(r.matchId)) continue
    try {
      const stats = JSON.parse(r.statsJson) as MatchSummaryStats
      if (stats.gameEndAt) (stats as any).gameEndAt = new Date(stats.gameEndAt as any)
      out.set(r.matchId, { puuid: r.puuid, stats })
    } catch { /* computed again */ }
  }
  return out
}
