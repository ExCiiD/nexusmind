import { ipcMain } from 'electron'
import { existsSync as fsExistsSync, statSync as fsStatSync } from 'fs'
import { getPrisma } from '../database'
import {
  getMatch,
  getMatchTimeline,
  getAccountByRiotId,
  extractPlayerStats,
  extractDetailedStats,
} from '../riotClient'
import { getMatchIdsCached } from '../matchIdsCache'
import { extractGameEvents, type GameEvent } from '../eventExtractor'
import { analyzeLanePhase, type LanePhaseResult } from '../lanePhaseAnalyzer'
import { autoDetectMistakesSilently, type ParsedMatch } from '../mistakeAutoDetect'
import { getMemoDetailedStats, setMemoDetailedStats } from '../detailedStatsMemo'
import { readMatch, readSummaries, readTimeline, saveMatch, saveTimeline, timelineFromRow, writeSummaries } from '../matchStore'
import { pickStored, readStoredDetailedStats, storeDetailedStats } from '../detailedStatsStore'
import { withRiotPriority, type RiotPriority } from '../riotPriority'
import { platformOfMatchId } from '../gameCatchUpCore'
import { buildPrefilledNotes } from '../reviewNotes'

let autoSnapshotRunning = false

/**
 * Fetch match IDs from the main user + all linked accounts, merged and deduplicated.
 * Match IDs are NOT reliably sortable across regions (numeric portion is per-shard),
 * so callers must sort by gameEndAt after resolving match data.
 */
async function getAggregatedMatchIds(
  user: { puuid: string; region: string; queueFilter?: string | null },
  accounts: Array<{ puuid: string; region: string }>,
  count: number,
): Promise<{ matchIds: string[]; allPuuids: string[] }> {
  const queueFilter = (user.queueFilter ?? 'both') as 'soloq' | 'flex' | 'both'
  const allAccounts = [
    { puuid: user.puuid, region: user.region },
    ...accounts,
  ]
  const allPuuids = allAccounts.map((a) => a.puuid)

  const perAccountIds = await Promise.all(
    allAccounts.map(({ puuid, region }) =>
      getMatchIdsCached(puuid, region, count, 0, queueFilter).catch(() => [] as string[]),
    ),
  )

  const merged = [...new Set(perAccountIds.flat())]

  return { matchIds: merged, allPuuids }
}

/** Find which puuid from the list is present in a match. */
function resolvePuuid(matchData: any, puuids: string[]): string | null {
  const participants: any[] = matchData.info?.participants ?? []
  for (const puuid of puuids) {
    if (participants.some((p: any) => p.puuid === puuid)) return puuid
  }
  return null
}

/** The role a player had in a match, read from the match body (same rule as extractDetailedStats' meta.role). */
export function roleInMatch(matchData: any, puuid: string): string | null {
  const p = (matchData?.info?.participants ?? []).find((x: any) => x.puuid === puuid)
  return p ? (p.teamPosition || p.individualPosition || 'UNKNOWN') : null
}

/** Matches read at once by the detailed-stats loop (AUDIT_PERF_2 gain 2). */
export const DETAILED_STATS_CONCURRENCY = 4

/**
 * The detailed stats of one match for whichever of `puuids` played it, or null (unreadable, nobody of ours in it,
 * or another role than `mainRole`). AUDIT_PERF_2 gains 1, 2 and 6:
 * - the RAM memo, then the stored one (`stored`, read in one query by the caller), before any MatchCache read;
 * - the match body only, then the role checked BEFORE the timeline is read or downloaded;
 * - the match id names its server: Riot is asked there, not on the main account's region;
 * - timelines through matchStore (compressed).
 */
async function detailedStatsForMatch(
  prisma: ReturnType<typeof getPrisma>,
  matchId: string,
  puuids: string[],
  region: string,
  mainRole: string | null,
  stored: Map<string, any>,
): Promise<any | null> {
  const memoised = getMemoDetailedStats(matchId, puuids)
  const kept = memoised ? { stats: memoised } : pickStored(stored, matchId, puuids)
  if (kept) {
    if (!memoised && 'puuid' in kept) setMemoDetailedStats(matchId, kept.puuid, kept.stats)
    return mainRole && kept.stats.meta.role !== mainRole ? null : kept.stats
  }

  const platform = platformOfMatchId(matchId) || region
  let matchData = await readMatch(prisma, matchId)
  if (!matchData) {
    try {
      matchData = await getMatch(matchId, platform)
      await saveMatch(prisma, matchId, matchData, { overwrite: false })
    } catch { return null }
  }
  const resolvedPuuid = resolvePuuid(matchData, puuids)
  if (!resolvedPuuid) return null
  // Another role: skipped before its timeline (400-700 KB) is read or downloaded.
  if (mainRole && roleInMatch(matchData, resolvedPuuid) !== mainRole) return null

  let timelineData = await readTimeline(prisma, matchId)
  if (!timelineData) {
    try { timelineData = await getMatchTimeline(matchId, platform) } catch { /* optional */ }
    if (timelineData) await saveTimeline(prisma, matchId, timelineData).catch(() => {})
  }

  const detailed = extractDetailedStats(matchData, timelineData, resolvedPuuid)
  if (!detailed) return null
  if (timelineData) {
    setMemoDetailedStats(matchId, resolvedPuuid, detailed)
    await storeDetailedStats(prisma, matchId, resolvedPuuid, detailed)
  }
  return mainRole && detailed.meta.role !== mainRole ? null : detailed
}

/**
 * Shared match-fetch-and-extract loop used by the fundamentals radar for
 * both the logged-in user's own games and a followed player's games, the
 * averages and autoSnapshot. Stops once `limit` stats are collected, in the
 * order of `matchIds`. AUDIT_PERF_2 gain 2: 4 matches at a time (it was one
 * by one), under `priority` (the proxy keeps its reserve for interactive
 * calls).
 */
export async function fetchDetailedStatsForMatches(
  prisma: ReturnType<typeof getPrisma>,
  matchIds: string[],
  puuids: string[],
  region: string,
  mainRole: string | null,
  limit: number,
  priority: RiotPriority = 'interactive',
): Promise<any[]> {
  return withRiotPriority(priority, async () => {
    const stored = await readStoredDetailedStats(prisma, matchIds, puuids)
    const allStats: any[] = []
    for (let i = 0; i < matchIds.length && allStats.length < limit; i += DETAILED_STATS_CONCURRENCY) {
      const chunk = matchIds.slice(i, i + DETAILED_STATS_CONCURRENCY)
      const results = await Promise.all(chunk.map((id) => detailedStatsForMatch(prisma, id, puuids, region, mainRole, stored).catch(() => null)))
      for (const r of results) {
        if (!r) continue
        allStats.push(r)
        if (allStats.length >= limit) break
      }
    }
    return allStats
  })
}

/** Resolve display name + profile icon for an account by puuid. */
function resolveAccountName(puuid: string, user: any, accounts: any[]): string {
  if (puuid === user.puuid) return user.displayName || user.summonerName
  const account = accounts.find((a: any) => a.puuid === puuid)
  return account?.gameName ?? (user.displayName || user.summonerName)
}

function resolveAccountIconId(puuid: string, user: any, accounts: any[]): number {
  if (puuid === user.puuid) return user.profileIconId ?? 0
  const account = accounts.find((a: any) => a.puuid === puuid)
  return account?.profileIconId ?? 0
}

/** Snapshot schema plus the expanded opponent field with its @15 timeline data. */
function hasCurrentDetailedStatsSchema(parsed: any): boolean {
  return hasCurrentSnapshotSchema(parsed) &&
    Object.prototype.hasOwnProperty.call(parsed, 'opponent') &&
    (parsed.opponent === null ||
      Object.prototype.hasOwnProperty.call(parsed.opponent, 'gold15'))
}

function hasCurrentSnapshotSchema(parsed: any): boolean {
  return Boolean(
    parsed &&
    parsed.laning &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'xpPerMin15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'damage15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'damagePerMin15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'damageDiff15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'turretPlates15') &&
    parsed.economy &&
    Object.prototype.hasOwnProperty.call(parsed.economy, 'xp') &&
    Object.prototype.hasOwnProperty.call(parsed.economy, 'xpPerMin') &&
    parsed.objectives &&
    Object.prototype.hasOwnProperty.call(parsed.objectives, 'teamEpicMonsterDmgPercent') &&
    Object.prototype.hasOwnProperty.call(parsed.objectives, 'turretPlates'),
  )
}

/**
 * Reason buckets shared by both `loadGameEvents` and `loadLanePhase` —
 * gives the renderer a stable taxonomy to map to user-facing messages.
 */
type CacheLoadReason =
  | 'ok'
  | 'no-game'
  | 'no-match-id'
  | 'no-user'
  | 'timeline-fetch-failed'
  | 'match-fetch-failed'
  | 'empty-timeline'

interface MatchCacheLoadOk {
  ok: true
  matchJson: string
  timelineJson: string
  game: { id: string; matchId: string; champion: string; win: boolean }
  user: { puuid: string; region: string }
  userPuuids: string[]
}

interface MatchCacheLoadErr {
  ok: false
  reason: CacheLoadReason
  message?: string
  matchId?: string
}

/**
 * Make sure both match + timeline blobs are present in MatchCache for the
 * given game. Lazily fetches from Riot if needed, and (when `forceRefetch`
 * is true) wipes the cached copy first so the next call hits the network.
 *
 * Extracted from `loadGameEvents` so multiple consumers (lane phase
 * analyzer, mistake detector, future analyzers) can share the same
 * lazy-fetch-and-cache pipeline without duplicating the Riot calls.
 */
export async function ensureMatchCache(gameId: string, forceRefetch: boolean, logPrefix = 'cache'): Promise<MatchCacheLoadOk | MatchCacheLoadErr> {
  const prisma = getPrisma()
  const game = await prisma.game.findUnique({ where: { id: gameId } })
  if (!game) return { ok: false, reason: 'no-game', message: 'Game record not found.' }
  if (!game.matchId) return { ok: false, reason: 'no-match-id', message: 'This game has no matchId yet — try "Try to link" first.' }

  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) return { ok: false, reason: 'no-user', message: 'No active user.', matchId: game.matchId }

  const accounts = await prisma.account.findMany({ where: { userId: user.id } })
  const userPuuids = [user.puuid, ...accounts.map((a) => a.puuid)].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  )

  if (forceRefetch) {
    await prisma.matchCache
      .update({ where: { matchId: game.matchId }, data: { matchJson: '', timelineJson: null } })
      .catch(() => { /* no row yet — fine */ })
  }

  // AUDIT_PERF_2 gains 2 and 6: the match id names its server, and the timeline comes back decompressed.
  const platform = platformOfMatchId(game.matchId) || user.region
  const row = await prisma.matchCache.findUnique({ where: { matchId: game.matchId } })
  let cached: { matchJson: string; timelineJson: string | null } | null = row
    ? { matchJson: row.matchJson, timelineJson: timelineFromRow(prisma, game.matchId, row.timelineJson) }
    : null

  if (!cached?.matchJson) {
    try {
      const matchData = await getMatch(game.matchId, platform)
      await saveMatch(prisma, game.matchId, matchData)
      cached = { matchJson: JSON.stringify(matchData), timelineJson: cached?.timelineJson ?? null }
      console.log(`[${logPrefix}] Cached match for ${game.matchId}`)
    } catch (err) {
      console.warn(`[${logPrefix}] Match fetch failed:`, (err as Error)?.message ?? err)
      return { ok: false, reason: 'match-fetch-failed', message: (err as Error)?.message ?? 'Match fetch failed', matchId: game.matchId }
    }
  }

  if (!cached?.timelineJson) {
    try {
      const timelineData = await getMatchTimeline(game.matchId, platform)
      await saveTimeline(prisma, game.matchId, timelineData)
      cached = { matchJson: cached!.matchJson, timelineJson: JSON.stringify(timelineData) }
      const fc = timelineData?.info?.frames?.length ?? 0
      console.log(`[${logPrefix}] Cached timeline for ${game.matchId} (${fc} frames)`)
    } catch (err) {
      console.warn(`[${logPrefix}] Timeline fetch failed:`, (err as Error)?.message ?? err)
      return { ok: false, reason: 'timeline-fetch-failed', message: (err as Error)?.message ?? 'Timeline fetch failed', matchId: game.matchId }
    }
  }

  if (!cached?.timelineJson || !cached.matchJson) {
    return { ok: false, reason: 'empty-timeline', message: 'Cache is missing match or timeline JSON.', matchId: game.matchId }
  }

  return {
    ok: true,
    matchJson: cached.matchJson,
    timelineJson: cached.timelineJson,
    game: { id: game.id, matchId: game.matchId, champion: game.champion, win: game.win },
    user: { puuid: user.puuid, region: user.region },
    userPuuids,
  }
}

/**
 * Shared implementation for `stats:get-game-events` and
 * `stats:refresh-game-events`. `forceRefetch` blows away the cached
 * timeline + match blobs so the next call hits Riot fresh — used by the
 * "Refresh events" button in the player when extraction came back empty.
 *
 * Returns events PLUS a small diagnostic block so the renderer can
 * surface "timeline fetched OK, 0 events for Varus" vs "timeline fetch
 * failed — Riot rate limit" rather than a silent empty array.
 */
type GameEventsResult = {
  events: GameEvent[]
  diag: {
    reason: CacheLoadReason | 'player-not-resolved'
    message?: string
    matchId?: string
    frameCount?: number
    playerResolvedVia?: 'puuid' | 'champion' | 'none'
  }
}

async function loadGameEvents(gameId: string, forceRefetch: boolean): Promise<GameEventsResult> {
  return (await loadGameEventsParsed(gameId, forceRefetch)).result
}

const tryParse = (json: string): any => { try { return JSON.parse(json) } catch { return null } }

/**
 * loadGameEvents, plus the match and timeline it parsed (null when either did not parse), so the post-game
 * analysis hands them to the mistake detector instead of parsing 0.5-2 MB again (audit E09). The parsed
 * objects never go to the renderer.
 */
async function loadGameEventsParsed(gameId: string, forceRefetch: boolean): Promise<{ result: GameEventsResult; parsed: ParsedMatch | null }> {
  const failed = (result: GameEventsResult) => ({ result, parsed: null })
  const loaded = await ensureMatchCache(gameId, forceRefetch, 'events')
  if (!loaded.ok) return failed({ events: [], diag: { reason: loaded.reason, message: loaded.message, matchId: loaded.matchId } })
  const { matchJson, timelineJson, game, userPuuids } = loaded
  const prisma = getPrisma()
  // Each blob parsed once (E09): the diagnostics, the extractor and the mistake detector share them.
  const match = tryParse(matchJson)
  const timeline = tryParse(timelineJson)

  // When forcing a refresh (= "the player has bad markers, retry from
  // scratch"), recompute the recording's startOffsetSec too: the
  // original backfill may have used the DB createdAt rather than the
  // file birthtime, which sends every marker off-screen. Re-deriving it
  // from the file on disk + the freshly cached match data fixes that
  // for existing linked recordings, not just future backfills.
  if (forceRefetch) {
    try {
      const rec = await prisma.recording.findUnique({ where: { gameId } })
      if (rec?.filePath && fsExistsSync(rec.filePath)) {
        const gameEndMs: number = match?.info?.gameEndTimestamp
        const durationSec: number = match?.info?.gameDuration
        if (gameEndMs && durationSec) {
          const stat = fsStatSync(rec.filePath)
          const recordingStartMs = stat.birthtimeMs || stat.mtimeMs
          if (recordingStartMs) {
            const gameStartMs = gameEndMs - durationSec * 1000
            const candidate = (recordingStartMs - gameStartMs) / 1000
            if (Math.abs(candidate) <= 600) {
              await prisma.recording.update({
                where: { id: rec.id },
                data: { startOffsetSec: candidate },
              })
              console.log(`[events] Recomputed startOffsetSec=${candidate.toFixed(1)}s for recording ${rec.id}`)
            } else {
              console.warn(`[events] Implausible startOffsetSec=${candidate.toFixed(1)}s — leaving stored value alone.`)
            }
          }
        }
      }
    } catch (err) {
      console.warn('[events] startOffsetSec recompute failed:', (err as Error)?.message ?? err)
    }
  }

  try {
    // Resolution diagnostic — figure out how the player was matched so
    // the UI can flag "player not found" cases (e.g. wrong champion
    // stored on the Game row).
    let resolvedVia: 'puuid' | 'champion' | 'none' = 'none'
    const parts: any[] = match?.info?.participants ?? []
    if (userPuuids.some((p) => parts.some((pp) => pp.puuid === p))) resolvedVia = 'puuid'
    else if (parts.some((pp) => pp.championName?.toLowerCase() === game.champion?.toLowerCase())) resolvedVia = 'champion'

    // A blob that did not parse goes to the extractor as text, which reports it the way it always did.
    const events = extractGameEvents(timeline ?? timelineJson, match ?? matchJson, {
      puuids: userPuuids,
      championName: game.champion,
      win: game.win,
    })

    const frameCount = timeline?.info?.frames?.length ?? 0
    const parsed = match && timeline ? { match, timeline } : null

    console.log(`[events] ${events.length} event(s) for game ${gameId} (matchId=${game.matchId}, resolvedVia=${resolvedVia}, frames=${frameCount})`)

    if (resolvedVia === 'none' && events.length === 0) {
      return failed({
        events: [],
        diag: {
          reason: 'player-not-resolved',
          message: `Could not find player "${game.champion}" in match participants. The champion stored on this game might be wrong.`,
          matchId: game.matchId,
          frameCount,
          playerResolvedVia: 'none',
        },
      })
    }

    return {
      result: {
        events,
        diag: {
          reason: 'ok',
          matchId: game.matchId,
          frameCount,
          playerResolvedVia: resolvedVia,
        },
      },
      parsed,
    }
  } catch (err) {
    console.warn('[events] Extraction failed:', (err as Error)?.message ?? err)
    return failed({ events: [], diag: { reason: 'empty-timeline', message: (err as Error)?.message ?? 'Extraction failed', matchId: game.matchId } })
  }
}

/**
 * Post-game analysis in the background: fetches + caches the timeline and,
 * through the same path, runs the Mistake Library rules (and, for severity-3
 * mistakes with a linked recording, auto-bookmarks them — MX5) — so mistakes
 * are already there when the player opens the review (AUDIT_REGLES_METIER MX2).
 */
export async function prefetchGameAnalysis(gameId: string): Promise<void> {
  const { result, parsed } = await loadGameEventsParsed(gameId, false)
  if (result.diag.reason === 'ok') await autoDetectMistakesSilently(gameId, parsed)
  // 20/11/2026: the lane phase report too, from the timeline just cached, so its page opens at once.
  if (result.diag.reason === 'ok') await loadLanePhase(gameId, false, parsed).catch(() => {})
}

/**
 * Start-up backfill: the latest games with no lane phase report get one, so opening an older game is instant
 * too. Games whose timeline is cached first (no Riot read), then at most `riotBudget` that need one, one at a time.
 */
export async function backfillLanePhaseReports(limit = 20, riotBudget = 5): Promise<number> {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } })
  if (!user) return 0
  const games = await prisma.game.findMany({
    // No lane in ARAM / Arena: those never get a report, and would be retried at every start.
    where: { lanePhaseReport: null, session: { userId: user.id }, queueType: { notIn: ['aram', 'arena'] }, duration: { gte: 300 } },
    orderBy: { gameEndAt: 'desc' },
    take: limit,
    select: { id: true, matchId: true },
  })
  if (games.length === 0) return 0
  const withTimeline = new Set((await prisma.matchCache.findMany({
    where: { matchId: { in: games.map((g) => g.matchId) }, timelineJson: { not: null } },
    select: { matchId: true },
  })).map((c) => c.matchId))
  let done = 0
  let riotLeft = riotBudget
  for (const g of [...games].sort((a, b) => Number(withTimeline.has(b.matchId)) - Number(withTimeline.has(a.matchId)))) {
    if (!withTimeline.has(g.matchId)) {
      if (riotLeft <= 0) break
      riotLeft--
    }
    const r = await loadLanePhase(g.id, false).catch(() => null)
    if (r?.report) done++
  }
  return done
}

/**
 * Lazy-compute (and cache) a Lane Phase Comparator report.
 *
 * Stored as JSON on `Game.lanePhaseReport` so subsequent opens are
 * instant — the only re-computation happens when the user explicitly
 * hits "Refresh" (or the cache version mismatches in a future schema
 * bump).
 *
 * Returns `{ report, diag }` so the renderer can display the same
 * "player not resolved" / "no opponent" diagnostics surfaced by the
 * game-events pipeline.
 */
export async function loadLanePhase(gameId: string, forceRefetch: boolean, parsed?: ParsedMatch | null): Promise<{
  report: LanePhaseResult['report']
  diag: {
    reason: CacheLoadReason | 'no-player' | 'no-opponent' | 'no-frames' | 'bad-data'
    message?: string
    matchId?: string
    frameCount?: number
    playerResolvedVia?: 'puuid' | 'champion' | 'none'
    cached?: boolean
  }
}> {
  const prisma = getPrisma()

  if (!forceRefetch) {
    const game = await prisma.game.findUnique({ where: { id: gameId } })
    if (game?.lanePhaseReport) {
      try {
        const parsed = JSON.parse(game.lanePhaseReport)
        if (parsed?.schemaVersion === 2) {
          return {
            report: parsed,
            diag: { reason: 'ok', matchId: game.matchId, cached: true },
          }
        }
        // Schema mismatch — fall through to recompute and overwrite.
      } catch { /* corrupted JSON — recompute */ }
    }
  }

  const loaded = await ensureMatchCache(gameId, forceRefetch, 'lane-phase')
  if (!loaded.ok) return { report: null, diag: { reason: loaded.reason, message: loaded.message, matchId: loaded.matchId } }
  const { matchJson, timelineJson, game, userPuuids } = loaded

  // Already parsed by the post-game analysis: not parsed again (E09).
  const result = analyzeLanePhase({
    matchJson: parsed?.match ?? matchJson,
    timelineJson: parsed?.timeline ?? timelineJson,
    selector: { puuids: userPuuids, championName: game.champion, win: game.win },
  })

  // Persist when we have a report, otherwise leave the previous one alone.
  if (result.report) {
    await prisma.game
      .update({ where: { id: gameId }, data: { lanePhaseReport: JSON.stringify(result.report) } })
      .catch((err) => console.warn('[lane-phase] Failed to cache report:', err))
    console.log(`[lane-phase] Computed report for game ${gameId} — grade ${result.report.grade} (frames=${result.diag.frameCount})`)
  } else {
    console.warn(`[lane-phase] No report for game ${gameId} — reason=${result.diag.reason}`)
  }

  return {
    report: result.report,
    diag: {
      reason: result.diag.reason,
      message: result.diag.message,
      matchId: game.matchId,
      frameCount: result.diag.frameCount,
      playerResolvedVia: result.diag.playerResolvedVia,
      cached: false,
    },
  }
}

export function registerStatsHandlers() {
  // Returns a compact list of game events for the video player timeline.
  // Lazy-fetches + caches the Riot Match-Timeline-V5 blob if not already cached.
  // Returns [] when timeline is unavailable (e.g. region temp outage) rather
  // than throwing — the UI treats events as best-effort. Backwards-compatible:
  // returns just the events array, without the diagnostics.
  ipcMain.handle('stats:get-game-events', async (_event, gameId: string): Promise<GameEvent[]> => {
    const { events } = await loadGameEvents(gameId, false)
    return events
  })

  /**
   * R1 — draft, timestamped notes built from this game's own events and
   * severity-3 mistakes. The renderer only uses this when the review form
   * is otherwise empty (no saved review, no draft) and never overwrites
   * anything the player typed.
   */
  ipcMain.handle('review:prefilled-notes', async (_event, gameId: string) => {
    const { events, diag } = await loadGameEvents(gameId, false)
    if (diag.reason !== 'ok') return []
    const prisma = getPrisma()
    const mistakes = await prisma.mistake.findMany({ where: { gameId }, select: { gameTimeSec: true, severity: true, tag: { select: { slug: true, label: true } } } })
    return buildPrefilledNotes(
      events,
      mistakes.map((m) => ({ tagSlug: m.tag.slug, tagLabel: m.tag.label, gameTimeSec: m.gameTimeSec, severity: m.severity })),
    )
  })

  // Diagnostic variant — UI uses this for the "Refresh events" button and
  // to display "X events loaded" / "no player found" badges. `forceRefetch`
  // drops the cache, useful when Riot was down on the first attempt.
  // Also triggers a fire-and-forget mistake auto-detect run so newly
  // refreshed timelines populate the side list without an extra click.
  ipcMain.handle('stats:refresh-game-events', async (_event, gameId: string, forceRefetch = true) => {
    const { result, parsed } = await loadGameEventsParsed(gameId, forceRefetch)
    if (result.diag.reason === 'ok') autoDetectMistakesSilently(gameId, parsed)
    return result
  })

  // Read-through cache: returns the persisted report when present, computes
  // it on the fly otherwise. Cheap to call from the UI on mount.
  ipcMain.handle('stats:get-lane-phase', async (_event, gameId: string) => loadLanePhase(gameId, false))
  // Force-refresh — bypasses every cache and re-extracts from Riot.
  ipcMain.handle('stats:refresh-lane-phase', async (_event, gameId: string) => loadLanePhase(gameId, true))

  ipcMain.handle(
    'stats:match-history',
    async (_event, count = 20) => {
      const prisma = getPrisma()
      const user = await prisma.user.findFirst({ where: { isActive: true } })
      if (!user) throw new Error('No user found')

      const accounts = await prisma.account.findMany({ where: { userId: user.id } })
      const { matchIds, allPuuids } = await getAggregatedMatchIds(user, accounts, Math.min(count, 50))
      if (matchIds.length === 0) return []

      // AUDIT_PERF_2 gain 7: the stored summaries first (one query), a match body is parsed only when its summary
      // is missing, and it is stored then. The local games and their reviews: one query too.
      const summaries = await readSummaries(prisma, matchIds, allPuuids)
      const dbGames = new Map((await prisma.game.findMany({
        where: { matchId: { in: matchIds } },
        include: { review: { select: { id: true } } },
      })).map((g) => [g.matchId, g]))

      const results = await Promise.allSettled(
        matchIds.map(async (id: string) => {
          let hit = summaries.get(id)
          if (!hit) {
            let matchData = await readMatch(prisma, id)
            if (!matchData) {
              // The match id names its server (AUDIT_PERF_2 gain 2), not the main account's region.
              matchData = await getMatch(id, platformOfMatchId(id) || user.region)
              await saveMatch(prisma, id, matchData, { overwrite: false })
            }
            const puuid = resolvePuuid(matchData, allPuuids)
            if (!puuid) return null
            const fresh = await writeSummaries(prisma, id, matchData, [puuid]).catch(() => new Map())
            const stats = fresh.get(puuid) ?? extractPlayerStats(matchData, puuid)
            if (!stats) return null
            hit = { puuid, stats }
          }
          const { puuid, stats } = hit
          const dbGame = dbGames.get(id)

          return {
            gameId: dbGame?.id ?? null,
            ...stats,
            imported: !!dbGame,
            reviewed: !!dbGame?.review,
            reviewStatus: dbGame?.reviewStatus ?? (dbGame?.review ? 'reviewed' : 'pending'),
            accountName: resolveAccountName(puuid, user, accounts),
            accountProfileIconId: resolveAccountIconId(puuid, user, accounts),
          }
        }),
      )

      return results
        .filter((r) => r.status === 'fulfilled' && r.value !== null)
        .map((r) => (r as PromiseFulfilledResult<any>).value)
        .filter((g: any) => (g.duration ?? 0) >= 300)
        .sort((a: any, b: any) => new Date(b.gameEndAt).getTime() - new Date(a.gameEndAt).getTime())
        .slice(0, count)
    },
  )

  ipcMain.handle(
    'stats:get-detailed',
    async (_event, matchId: string) => {
      const prisma = getPrisma()
      const user = await prisma.user.findFirst({ where: { isActive: true } })
      if (!user) throw new Error('No user found')

      const accounts = await prisma.account.findMany({ where: { userId: user.id } })
      const allPuuids = [user.puuid, ...accounts.map((a) => a.puuid)]

      const dbGame = await prisma.game.findUnique({
        where: { matchId },
        include: { detailedStats: true },
      })

      let resolvedPuuid: string | null = null

      if (dbGame?.detailedStats) {
        const parsed = JSON.parse(dbGame.detailedStats.stats)
        if (hasCurrentDetailedStatsSchema(parsed)) {
          // Try to find the account name from the match cache
          const cached = await prisma.matchCache.findUnique({ where: { matchId }, select: { matchJson: true } })
          if (cached) {
            const matchData = JSON.parse(cached.matchJson)
            resolvedPuuid = resolvePuuid(matchData, allPuuids)
          }
          return {
            ...parsed,
            meta: {
              ...parsed.meta,
              accountName: resolvedPuuid
                ? resolveAccountName(resolvedPuuid, user, accounts)
                : (user.displayName || user.summonerName),
            },
          }
        }
        await prisma.gameDetailedStats.delete({ where: { gameId: dbGame.id } }).catch(() => {})
      }

      const platform = platformOfMatchId(matchId) || user.region
      let matchData: any = await readMatch(prisma, matchId)
      let timelineData: any = matchData ? await readTimeline(prisma, matchId) : null
      const hadTimeline = !!timelineData
      if (!matchData) {
        matchData = await getMatch(matchId, platform)
        await saveMatch(prisma, matchId, matchData, { overwrite: false })
      }

      if (!timelineData) {
        try {
          timelineData = await getMatchTimeline(matchId, platform)
        } catch (err) {
          console.warn(`[stats] Timeline fetch failed for ${matchId}:`, err)
        }
      }
      if (timelineData && !hadTimeline) await saveTimeline(prisma, matchId, timelineData).catch(() => {})

      const puuid = resolvePuuid(matchData, allPuuids) ?? user.puuid
      const detailed = extractDetailedStats(matchData, timelineData, puuid)
      if (!detailed) {
        if (dbGame) {
          await prisma.gameDetailedStats.deleteMany({ where: { gameId: dbGame.id } })
        }
        throw new Error('Could not extract stats for this player')
      }

      if (dbGame) {
        await prisma.gameDetailedStats.upsert({
          where: { gameId: dbGame.id },
          create: { gameId: dbGame.id, stats: JSON.stringify(detailed) },
          update: { stats: JSON.stringify(detailed) },
        })
      }

      return {
        ...detailed,
        meta: {
          ...detailed.meta,
          accountName: resolveAccountName(puuid, user, accounts),
          accountProfileIconId: resolveAccountIconId(puuid, user, accounts),
        },
      }
    },
  )


  /**
   * Compute live averages for a specific account (or all accounts when puuid is null).
   * This does NOT create a new snapshot — it's a read-only on-demand calculation.
   * Used by the account filter in the Detailed Stats page.
   */
  ipcMain.handle('stats:get-account-averages', async (_event, puuid: string | null) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return null

    const accounts = await prisma.account.findMany({ where: { userId: user.id } })
    const mainRole = user.mainRole

    // Determine which account(s) to pull games from
    const targetAccounts: Array<{ puuid: string; region: string }> =
      puuid === null
        ? [{ puuid: user.puuid, region: user.region }, ...accounts.map((a) => ({ puuid: a.puuid, region: a.region }))]
        : puuid === user.puuid
          ? [{ puuid: user.puuid, region: user.region }]
          : (() => {
              const acc = accounts.find((a) => a.puuid === puuid)
              return acc ? [{ puuid: acc.puuid, region: acc.region }] : [{ puuid: user.puuid, region: user.region }]
            })()

    // Fetch match IDs only for the target account(s)
    const queueFilter = (user.queueFilter ?? 'both') as 'soloq' | 'flex' | 'both'
    const perAccountIds = await Promise.all(
      targetAccounts.map(({ puuid: p, region }) =>
        getMatchIdsCached(p, region, 40, 0, queueFilter).catch(() => [] as string[]),
      ),
    )
    const matchIds = [...new Set(perAccountIds.flat())]
    if (matchIds.length === 0) return null

    const allPuuids = targetAccounts.map((a) => a.puuid)
    const allStats = await fetchDetailedStatsForMatches(prisma, matchIds, allPuuids, user.region, mainRole, 20)

    if (allStats.length === 0) return null

    return {
      averages: computeAverages(allStats),
      gameCount: allStats.length,
      firstGameAt: new Date(Math.min(...allStats.map((s) => s.meta.gameEndAt))).toISOString(),
      lastGameAt: new Date(Math.max(...allStats.map((s) => s.meta.gameEndAt))).toISOString(),
    }
  })

  /**
   * "Empreinte des fondamentaux" radar (Dashboard): default comparison is
   * the user's own recent form (avg of the last 15 games) against their
   * own longer-window snapshot (avg of the last 40 games) — a narrower
   * window than `stats:compute-averages`'s persisted `StatsSnapshot` (capped
   * at 20 games), so computed fresh here rather than reusing that table.
   *
   * `followedPlayerId`, when provided, swaps the snapshot side only: instead
   * of the user's own 40-game average, it's the chosen followed player's
   * last 40 solo/duo (queue 420) games. `recent` always stays the logged-in
   * user's own current form — the point is comparing yourself against
   * someone else's level, not replacing your own data.
   */
  ipcMain.handle('stats:get-fundamentals-radar', async (_e, followedPlayerId?: string) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return null

    const accounts = await prisma.account.findMany({ where: { userId: user.id } })
    const mainRole = user.mainRole
    const { matchIds, allPuuids } = await getAggregatedMatchIds(user, accounts, 40)
    if (matchIds.length === 0) return null

    const allStats = await fetchDetailedStatsForMatches(prisma, matchIds, allPuuids, user.region, mainRole, 40)
    if (allStats.length === 0) return null

    const recentStats = allStats.slice(0, 15)

    let snapshot = computeAverages(allStats)
    let snapshotGameCount = allStats.length
    let snapshotLabel: string | null = null

    if (followedPlayerId) {
      const followed = await prisma.followedPlayer.findFirst({ where: { id: followedPlayerId, userId: user.id } })
      if (followed) {
        const theirIds = await getMatchIdsCached(followed.puuid, followed.region, 40, 0, 'soloq').catch(() => [] as string[])
        const theirStats = theirIds.length > 0
          ? await fetchDetailedStatsForMatches(prisma, theirIds, [followed.puuid], followed.region, mainRole, 40)
          : []
        if (theirStats.length > 0) {
          snapshot = computeAverages(theirStats)
          snapshotGameCount = theirStats.length
          snapshotLabel = `${followed.gameName}#${followed.tagLine}`
          await prisma.followedPlayer.update({ where: { id: followed.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
        }
      }
    }

    return {
      recent: recentStats.length > 0 ? computeAverages(recentStats) : null,
      recentGameCount: recentStats.length,
      snapshot,
      snapshotGameCount,
      snapshotLabel,
    }
  })

  /** List players this user has previously added for radar comparison, most recently used first. */
  ipcMain.handle('stats:list-followed-players', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return []
    return prisma.followedPlayer.findMany({ where: { userId: user.id }, orderBy: { lastUsedAt: 'desc' } })
  })

  /**
   * Resolves a Riot ID to a puuid and remembers it under that user for future
   * radar comparisons. The puuid is what's stored and reused afterwards — a
   * later name change by the tracked player never breaks the comparison,
   * since lookups never happen by name again after this one.
   */
  ipcMain.handle('stats:add-followed-player', async (_e, gameName: string, tagLine: string, region: string) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No active user')

    const account = await getAccountByRiotId(gameName.trim(), tagLine.trim(), region)
    if (!account?.puuid) throw new Error('Could not resolve that Riot ID')

    const existing = await prisma.followedPlayer.findFirst({ where: { userId: user.id, puuid: account.puuid } })
    if (existing) {
      return prisma.followedPlayer.update({
        where: { id: existing.id },
        data: { gameName: account.gameName, tagLine: account.tagLine, region, lastUsedAt: new Date() },
      })
    }
    return prisma.followedPlayer.create({
      data: { userId: user.id, gameName: account.gameName, tagLine: account.tagLine, region, puuid: account.puuid },
    })
  })

  ipcMain.handle('stats:remove-followed-player', async (_e, id: string) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return
    await prisma.followedPlayer.deleteMany({ where: { id, userId: user.id } })
  })

  ipcMain.handle('stats:get-snapshots', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return []

    const mainRole = user.mainRole

    // Deduplicate: keep only the earliest-created snapshot per firstGameAt (batch identity)
    const allForRole = await prisma.statsSnapshot.findMany({
      where: { userId: user.id, mainRole: mainRole ?? null },
      orderBy: { createdAt: 'asc' },
    })
    const seen = new Map<string, string>() // firstGameAt ISO → id to keep (first created wins)
    for (const s of allForRole) {
      const key = s.firstGameAt.toISOString()
      if (seen.has(key)) {
        // Duplicate batch — delete the later one
        await prisma.statsSnapshot.delete({ where: { id: s.id } }).catch(() => {})
      } else {
        seen.set(key, s.id)
      }
    }

    const snapshots = await prisma.statsSnapshot.findMany({
      where: {
        userId: user.id,
        mainRole: mainRole ?? null,
      },
      orderBy: { createdAt: 'asc' },
    })

    const validSnapshots: Array<{
      id: string
      stats: any
      gameCount: number
      firstGameAt: string
      lastGameAt: string
      createdAt: string
    }> = []

    for (const s of snapshots) {
      const parsed = JSON.parse(s.stats)
      if (!hasCurrentSnapshotSchema(parsed)) {
        await prisma.statsSnapshot.delete({ where: { id: s.id } }).catch(() => {})
        continue
      }
      validSnapshots.push({
        id: s.id,
        stats: parsed,
        gameCount: s.gameCount,
        firstGameAt: s.firstGameAt.toISOString(),
        lastGameAt: s.lastGameAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })
    }

    return validSnapshots
  })

  /** Auto-create snapshots for every new batch of 20 games since the last snapshot. */
  ipcMain.handle('stats:clear-snapshots', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return { deleted: 0 }
    const result = await prisma.statsSnapshot.deleteMany({ where: { userId: user.id } })
    return { deleted: result.count }
  })

  ipcMain.handle('stats:auto-snapshot', async () => {
    if (autoSnapshotRunning) return { created: 0 }
    autoSnapshotRunning = true
    try {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return { created: 0 }

    const accounts = await prisma.account.findMany({ where: { userId: user.id } })
    const { matchIds, allPuuids } = await getAggregatedMatchIds(user, accounts, 100)
    if (matchIds.length === 0) return { created: 0 }

    const mainRole = user.mainRole

    // Find the last snapshot for this specific role configuration to avoid duplicates
    const lastSnapshot = await prisma.statsSnapshot.findFirst({
      where: { userId: user.id, mainRole: mainRole ?? null },
      orderBy: { lastGameAt: 'desc' },
    })
    const lastGameAtMs = lastSnapshot?.lastGameAt.getTime() ?? 0

    // The number in a match id is a game counter, not a date: read as one (1970), it filtered out every game once a
    // first snapshot existed, so no snapshot was ever added after it (Audit, 20/11/2026). The real end date is
    // checked below, on the stats (memoised, so the older games cost a lookup, not a parse).
    const orderedIds = [...matchIds].reverse()

    // AUDIT_PERF_2 gains 1 and 2: the shared loop (memo, 4 at a time, role before timeline), in the background.
    const gamesWithStats: { stats: any; ts: number }[] = (await fetchDetailedStatsForMatches(
      prisma, orderedIds, allPuuids, user.region, mainRole ?? null, Number.POSITIVE_INFINITY, 'background',
    ))
      .filter((detailed) => detailed.meta.gameEndAt > lastGameAtMs)
      .map((detailed) => ({ stats: detailed, ts: detailed.meta.gameEndAt }))

    // Sort oldest first
    gamesWithStats.sort((a, b) => a.ts - b.ts)

    let created = 0
    let startIdx = 0
    while (gamesWithStats.length - startIdx >= 20) {
      const batch = gamesWithStats.slice(startIdx, startIdx + 20)
      const allStats = batch.map((g) => g.stats)
      const avg = computeAverages(allStats)
      const firstGameAt = new Date(Math.min(...allStats.map((s) => s.meta.gameEndAt)))
      const lastGameAtNew = new Date(Math.max(...allStats.map((s) => s.meta.gameEndAt)))

      // Skip if a snapshot already covers this batch (keyed by firstGameAt — unique per batch)
      const existing = await prisma.statsSnapshot.findFirst({
        where: { userId: user.id, mainRole: mainRole ?? null, firstGameAt },
      })
      if (!existing) {
        await prisma.statsSnapshot.create({
          data: {
            userId: user.id,
            mainRole: mainRole ?? null,
            stats: JSON.stringify(avg),
            gameCount: allStats.length,
            firstGameAt,
            lastGameAt: lastGameAtNew,
          },
        })
        created++
      }
      startIdx += 20
    }

    return { created }
    } finally {
      autoSnapshotRunning = false
    }
  })
}

function computeAverages(statsArray: any[]) {
  const n = statsArray.length
  const sum = (fn: (s: any) => number | null) => {
    let total = 0
    let count = 0
    for (const s of statsArray) {
      const v = fn(s)
      if (v !== null && v !== undefined) { total += v; count++ }
    }
    return count > 0 ? Number((total / count).toFixed(1)) : null
  }

  const boolRate = (fn: (s: any) => boolean) => {
    const trueCount = statsArray.filter((s) => fn(s)).length
    return Number(((trueCount / n) * 100).toFixed(1))
  }

  return {
    laning: {
      gold15: sum((s) => s.laning.gold15),
      xp15: sum((s) => s.laning.xp15),
      xpPerMin15: sum((s) => s.laning.xpPerMin15),
      cs15: sum((s) => s.laning.cs15),
      damage15: sum((s) => s.laning.damage15),
      damagePerMin15: sum((s) => s.laning.damagePerMin15),
      goldDiff15: sum((s) => s.laning.goldDiff15),
      xpDiff15: sum((s) => s.laning.xpDiff15),
      csDiff15: sum((s) => s.laning.csDiff15),
      damageDiff15: sum((s) => s.laning.damageDiff15),
      turretPlates15: sum((s) => s.laning.turretPlates15),
      firstBloodRate: boolRate((s) => s.laning.firstBloodParticipation),
    },
    economy: {
      xp: sum((s) => s.economy.xp),
      xpPerMin: sum((s) => s.economy.xpPerMin),
      goldPerMin: sum((s) => s.economy.goldPerMin),
      csPerMin: sum((s) => parseFloat(s.economy.csPerMin)),
      teamGoldPercent: sum((s) => s.economy.teamGoldPercent),
      laneCS: sum((s) => s.economy.laneCS),
      jungleCS: sum((s) => s.economy.jungleCS),
      maxCsAdvantage: (() => {
        const value = sum((s) => s.economy.maxCsAdvantage)
        return value !== null ? Math.round(value) : null
      })(),
    },
    combat: {
      killParticipation: sum((s) => s.combat.killParticipation),
      damagePerMin: sum((s) => s.combat.damagePerMin),
      teamDamagePercent: sum((s) => s.combat.teamDamagePercent),
      damagePerGold: sum((s) => s.combat.damagePerGold),
      soloKills: sum((s) => s.combat.soloKills),
      damageTaken: sum((s) => s.combat.damageTaken),
      damageMitigated: sum((s) => s.combat.damageMitigated),
      damageTakenPercent: sum((s) => s.combat.damageTakenPercent),
      healShieldPerMin: sum((s) => s.combat.healShieldPerMin ?? null),
      damageMitigatedPerMin: sum((s) => s.combat.damageMitigatedPerMin ?? null),
      ccPerMin: sum((s) => s.combat.ccPerMin ?? null),
    },
    objectives: {
      damageToEpicMonsters: sum((s) => s.objectives.damageToEpicMonsters),
      teamEpicMonsterDmgPercent: sum((s) => s.objectives.teamEpicMonsterDmgPercent),
      damageToBuildings: sum((s) => s.objectives.damageToBuildings),
      objectivesStolen: sum((s) => s.objectives.objectivesStolen),
      firstTowerRate: boolRate((s) => s.objectives.firstTowerParticipation),
      turretPlates: sum((s) => s.objectives.turretPlates),
      inhibitorTakedowns: sum((s) => s.objectives.inhibitorTakedowns),
      teamBuildingDamagePercent: sum((s) => s.objectives.teamBuildingDamagePercent),
    },
    vision: {
      visionScorePerMin: sum((s) => s.vision.visionScorePerMin),
      controlWardsPurchased: sum((s) => s.vision.controlWardsPurchased),
      wardsPlaced: sum((s) => s.vision.wardsPlaced),
      wardsDestroyed: sum((s) => s.vision.wardsDestroyed),
      stealthWardsPlaced: sum((s) => s.vision.stealthWardsPlaced),
      visionScoreAdvantage: sum((s) => s.vision.visionScoreAdvantage),
    },
    behavioral: {
      skillshotsDodged: sum((s) => s.behavioral.skillshotsDodged),
      killsNearEnemyTurret: sum((s) => s.behavioral.killsNearEnemyTurret),
      outnumberedKills: sum((s) => s.behavioral.outnumberedKills),
      takedownsInEnemyJungle: sum((s) => s.behavioral.takedownsInEnemyJungle),
    },
    meta: {
      winRate: boolRate((s) => s.meta.win),
      avgKills: sum((s) => s.meta.kills),
      avgDeaths: sum((s) => s.meta.deaths),
      avgAssists: sum((s) => s.meta.assists),
      avgCS: sum((s) => s.meta.cs),
      avgVisionScore: sum((s) => s.meta.visionScore),
      avgDuration: sum((s) => s.meta.duration),
      gameCount: n,
    },
  }
}

