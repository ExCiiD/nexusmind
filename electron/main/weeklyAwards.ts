/**
 * Weekly MVP / Grinder awards of the user's teams: the IO around
 * src/lib/weeklyAwardsCore.ts (rules, scores, rankings, holders).
 *
 *  - Rank readings (RankSnapshot): Solo/Duo and Flex rank of every member of
 *    a team that isn't an opponent, two minutes after start, then every 4
 *    hours, and whenever the app reads ranks (recordRankSnapshots, also called
 *    by team:member-ranks). One row per change of reading.
 *  - Game scores (PlayerGameScore): each member's Solo/Duo and Flex games of
 *    the weeks still needed, scored once. Match bodies come from MatchCache
 *    first, from Riot else (and are cached).
 *  - History (TeamWeeklyAward): each completed week's result, stored once the
 *    week is FINALIZE_GRACE_MS behind and every member's games were read: the
 *    last BACKFILL_WEEKS weeks on the first run (the MVP from match history,
 *    the Grinder only once readings exist).
 *  - team:weekly-awards answers from the database; when the team's data is
 *    over FRESH_MS old it first reads Riot, waiting at most READ_WAIT_MS (the
 *    read goes on in the background after that).
 * Riot calls are sequential within a team, teams one after the other in the
 * background; the shared rate limiter (riotClient.ts) paces them.
 */

import { getPrisma } from './database'
import { getAccountByRiotId, getLeagueEntriesByPuuid, getMatch, getMatchIdsInRange } from './riotClient'
import { RiotAuthError } from './riotTransport'
import { withRiotPriority } from './riotPriority'
import { ladderScore, parseLeagueEntries, type PlayerRanks, type RankedQueue } from '../../src/lib/rankCore'
import {
  AWARD_KINDS,
  BASELINE_MAX_AGE_MS,
  HOUR_MS,
  MVP_SCORE_VERSION,
  buildWeeklyAwards,
  grinderRace,
  grinderWeek,
  mvpRace,
  pendingWeeks,
  scoreGame,
  shiftWeekKey,
  weekKeyOf,
  weekRange,
  weekResultOf,
  type AwardKind,
  type AwardRaceEntry,
  type RankPoint,
  type RosterRef,
  type WeekResult,
  type WeeklyAwards,
} from '../../src/lib/weeklyAwardsCore'

const START_DELAY_MS = 2 * 60_000
const SYNC_INTERVAL_MS = 4 * HOUR_MS
/** team:weekly-awards reads Riot again when the team's data is older. */
const FRESH_MS = 30 * 60_000
/** A failed read (signed out, Riot down) is tried again after this. */
const RETRY_MS = 5 * 60_000
/** How long team:weekly-awards waits for that read before answering. */
const READ_WAIT_MS = 10_000
/** A player whose rank was read this recently isn't read again by a sync. */
const SNAPSHOT_MIN_GAP_MS = 20 * 60_000
/** Listing again from the last listing minus this catches the games that
 *  were being played during it. */
const LIST_OVERLAP_MS = 3 * HOUR_MS
/** 100 ids per page: up to 300 games per queue over the backfill window. */
const LIST_MAX_PAGES = 3
/** Queues listed on Riot: weeklyAwardsCore.AWARD_QUEUE_IDS. */
const LIST_QUEUES = [420, 440] as const

interface Member extends RosterRef {
  puuid: string
  region: string
}

/** teamId → end of the last complete read. */
const lastSync = new Map<string, number>()
const lastAttempt = new Map<string, number>()
const syncing = new Map<string, Promise<void>>()
/** puuid → window [from, until] whose games were listed in this run of the app. */
const coverage = new Map<string, { from: number; until: number }>()

const isNotFound = (err: unknown) => /\b404\b/.test((err as Error)?.message ?? '')
const errorText = (err: unknown) => (err as Error)?.message ?? String(err)

// ── Rank readings ──────────────────────────────────────────────────────────

export interface RankReading {
  puuid: string
  ranks: PlayerRanks
  /** When the ranks were read (ms); now by default. */
  at?: number
  memberId?: string
}

let snapshotQueue: Promise<void> = Promise.resolve()

/**
 * Stores rank readings (unranked queues are skipped): a new row when the
 * reading changed, else the last row's seenAt moves forward; a reading older
 * than the last one is dropped. Writes run one at a time. Never throws.
 */
export function recordRankSnapshots(rows: RankReading[]): Promise<void> {
  const run = snapshotQueue
    .then(() => writeSnapshots(rows))
    .catch((err) => console.warn('[awards] rank snapshot failed:', errorText(err)))
  snapshotQueue = run
  return run
}

async function writeSnapshots(rows: RankReading[]): Promise<void> {
  const prisma = getPrisma()
  for (const row of rows) {
    if (!row?.puuid) continue
    const at = new Date(row.at ?? Date.now())
    for (const queue of ['solo', 'flex'] as RankedQueue[]) {
      const rank = row.ranks?.[queue]
      if (!rank) continue
      const last = await prisma.rankSnapshot.findFirst({ where: { puuid: row.puuid, queue }, orderBy: { takenAt: 'desc' } })
      const same = last && last.tier === rank.tier && last.division === rank.division && last.lp === rank.lp
        && last.wins === rank.wins && last.losses === rank.losses
      if (last && same) {
        if (at > last.seenAt) await prisma.rankSnapshot.update({ where: { id: last.id }, data: { seenAt: at } })
        continue
      }
      if (last && at <= last.seenAt) continue
      await prisma.rankSnapshot.create({
        data: {
          puuid: row.puuid, queue, tier: rank.tier, division: rank.division, lp: rank.lp,
          wins: rank.wins, losses: rank.losses, ladder: ladderScore(rank), takenAt: at, seenAt: at,
        },
      })
    }
  }
}

async function readRanks(members: Member[]): Promise<void> {
  const prisma = getPrisma()
  for (const m of members) {
    const last = await prisma.rankSnapshot.findFirst({ where: { puuid: m.puuid }, orderBy: { seenAt: 'desc' }, select: { seenAt: true } })
    if (last && Date.now() - last.seenAt.getTime() < SNAPSHOT_MIN_GAP_MS) continue
    try {
      const ranks = parseLeagueEntries(await getLeagueEntriesByPuuid(m.puuid, m.region))
      await recordRankSnapshots([{ puuid: m.puuid, ranks, at: Date.now(), memberId: m.id }])
    } catch (err) {
      if (err instanceof RiotAuthError) throw err
      console.warn('[awards] rank read failed for member', m.id, errorText(err))
    }
  }
}

// ── Games ──────────────────────────────────────────────────────────────────

type MemberRow = { id: string; ign: string | null; tagLine: string | null; region: string | null; puuid: string | null }

/**
 * Members with a PUUID and a region. A missing PUUID is looked up from the
 * Riot ID and kept, as auto-fill and scouting do. `failed`: a lookup that may
 * work later (anything but "not found"), so the weeks can't be stored yet.
 */
async function resolveMembers(rows: MemberRow[]): Promise<{ members: Member[]; failed: boolean }> {
  const members: Member[] = []
  let failed = false
  for (const m of rows) {
    if (!m.region) continue
    let puuid = m.puuid
    if (!puuid) {
      const ign = m.ign?.trim()
      const tag = m.tagLine?.trim()
      if (!ign || !tag) continue
      try {
        const account = await getAccountByRiotId(ign, tag, m.region)
        if (!account?.puuid) continue
        puuid = account.puuid
        await getPrisma().teamMember.update({ where: { id: m.id }, data: { puuid } })
      } catch (err) {
        if (err instanceof RiotAuthError) throw err
        if (!isNotFound(err)) failed = true
        console.warn('[awards] Riot ID lookup failed for member', m.id, errorText(err))
        continue
      }
    }
    members.push({ id: m.id, puuid, region: m.region })
  }
  return { members, failed }
}

/** A match body from the cache, else from Riot (then cached). Null when
 *  Riot no longer has it; other errors are thrown. */
async function cachedMatch(matchId: string, region: string): Promise<unknown | null> {
  const prisma = getPrisma()
  const cached = await prisma.matchCache.findUnique({ where: { matchId } }).catch(() => null)
  if (cached?.matchJson) {
    try { return JSON.parse(cached.matchJson) } catch { /* fetched again below */ }
  }
  let data: unknown
  try {
    data = await getMatch(matchId, region)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  if (!data) return null
  const matchJson = JSON.stringify(data)
  await prisma.matchCache.upsert({ where: { matchId }, create: { matchId, matchJson }, update: { matchJson } }).catch(() => {})
  return data
}

/** Lists the member's Solo/Duo and Flex games since `from` (less what this
 *  run already listed) and scores the new ones. Throws when Riot fails. */
async function readGames(m: Member, from: number, now: number): Promise<void> {
  const prisma = getPrisma()
  const covered = coverage.get(m.puuid)
  const incremental = !!covered && covered.from <= from
  const since = incremental ? Math.max(from, covered!.until - LIST_OVERLAP_MS) : from
  const ids = new Set<string>()
  for (const queue of LIST_QUEUES) {
    const page = await getMatchIdsInRange(m.puuid, m.region, queue, Math.floor(since / 1000), incremental ? 1 : LIST_MAX_PAGES)
    for (const id of page) ids.add(id)
  }
  if (ids.size > 0) {
    const known = new Set((await prisma.playerGameScore.findMany({
      where: { puuid: m.puuid, matchId: { in: [...ids] }, version: MVP_SCORE_VERSION },
      select: { matchId: true },
    })).map((r) => r.matchId))
    for (const matchId of ids) {
      if (known.has(matchId)) continue
      const body = await cachedMatch(matchId, m.region)
      const s = body ? scoreGame(body, m.puuid) : null
      if (!s) continue
      const data = {
        queueId: s.queueId, playedAt: new Date(s.playedAt), durationSec: s.durationSec,
        role: s.role, win: s.win, score: s.score, version: MVP_SCORE_VERSION,
      }
      // Two teams sharing a player can score the same game at once.
      await prisma.playerGameScore.upsert({
        where: { puuid_matchId: { puuid: m.puuid, matchId } },
        create: { puuid: m.puuid, matchId, ...data },
        update: data,
      }).catch(() => {})
    }
  }
  coverage.set(m.puuid, { from: incremental ? covered!.from : from, until: now })
}

// ── Weeks ──────────────────────────────────────────────────────────────────

/** A week's MVP and Grinder rankings from the stored scores and readings. */
async function weekRaces(members: Member[] | Array<{ id: string; puuid: string }>, start: number, end: number): Promise<Record<AwardKind, AwardRaceEntry[]>> {
  const puuids = [...new Set(members.map((m) => m.puuid))]
  if (puuids.length === 0) return { mvp: [], grinder: [] }
  const prisma = getPrisma()
  const games = await prisma.playerGameScore.findMany({
    where: { puuid: { in: puuids }, playedAt: { gte: new Date(start), lt: new Date(end) }, score: { not: null } },
    select: { puuid: true, score: true },
  })
  const mvp = mvpRace(members.flatMap((m) => games.filter((g) => g.puuid === m.puuid).map((g) => ({ memberId: m.id, score: g.score }))))

  const readings = await prisma.rankSnapshot.findMany({
    where: { puuid: { in: puuids }, queue: 'solo', takenAt: { lt: new Date(end) }, seenAt: { gte: new Date(start - BASELINE_MAX_AGE_MS) } },
    select: { puuid: true, ladder: true, wins: true, losses: true, takenAt: true, seenAt: true },
  })
  const grinder = grinderRace(members.flatMap((m) => {
    // Each row stands for its reading from takenAt to seenAt.
    const points: RankPoint[] = readings.filter((r) => r.puuid === m.puuid).flatMap((r) => {
      const games = r.wins + r.losses
      const first = { at: r.takenAt.getTime(), ladder: r.ladder, games }
      return r.seenAt.getTime() > first.at ? [first, { at: r.seenAt.getTime(), ladder: r.ladder, games }] : [first]
    })
    const week = grinderWeek(points, start, end)
    return week ? [{ memberId: m.id, lp: week.lp, games: week.games }] : []
  }))
  return { mvp, grinder }
}

/** Weeks whose two results are stored. */
async function storedWeeks(teamId: string): Promise<Set<string>> {
  const rows = await getPrisma().teamWeeklyAward.findMany({ where: { teamId }, select: { kind: true, weekKey: true } })
  const kinds = new Map<string, Set<string>>()
  for (const r of rows) kinds.set(r.weekKey, (kinds.get(r.weekKey) ?? new Set()).add(r.kind))
  return new Set([...kinds].filter(([, k]) => AWARD_KINDS.every((kind) => k.has(kind))).map(([key]) => key))
}

async function storeWeeks(teamId: string, members: Member[], keys: string[]): Promise<void> {
  const prisma = getPrisma()
  for (const key of keys) {
    const { start, end } = weekRange(key)
    const races = await weekRaces(members, start, end)
    for (const kind of AWARD_KINDS) {
      const r = weekResultOf(kind, key, races[kind], members)
      await prisma.teamWeeklyAward.upsert({
        where: { teamId_kind_weekKey: { teamId, kind, weekKey: key } },
        create: {
          teamId, kind, weekKey: key, weekStart: new Date(start), memberId: r.memberId, puuid: r.puuid,
          value: r.value, games: r.games, raceJson: JSON.stringify(races[kind]),
        },
        update: {},
      })
    }
  }
}

// ── Sync ───────────────────────────────────────────────────────────────────

/** Reads a team's games and ranks from Riot and stores its completed weeks.
 *  One read per team at a time; never throws. */
export function syncTeam(teamId: string): Promise<void> {
  const running = syncing.get(teamId)
  if (running) return running
  lastAttempt.set(teamId, Date.now())
  // P1-3: the weekly awards are background work.
  const job = withRiotPriority('background', () => runSync(teamId))
    .catch((err) => console.warn('[awards] read failed for team', teamId, errorText(err)))
    .finally(() => syncing.delete(teamId))
  syncing.set(teamId, job)
  return job
}

async function runSync(teamId: string): Promise<void> {
  const prisma = getPrisma()
  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { members: true } })
  if (!team || team.isOpponent) return
  const started = Date.now()
  const pending = pendingWeeks(started, await storedWeeks(teamId))
  // Games of the oldest week still needed, else of the current week.
  const from = weekRange(pending[0]?.key ?? weekKeyOf(started)).start
  const { members, failed } = await resolveMembers(team.members)
  let complete = !failed
  for (const m of members) {
    try {
      await readGames(m, from, started)
    } catch (err) {
      if (err instanceof RiotAuthError) throw err
      complete = false
      console.warn('[awards] game list failed for member', m.id, errorText(err))
    }
  }
  await readRanks(members)
  if (complete) await storeWeeks(teamId, members, pending.filter((w) => w.finalizable).map((w) => w.key))
  lastSync.set(teamId, Date.now())
}

async function syncAllTeams(): Promise<void> {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) return
  const teams = await prisma.team.findMany({ where: { userId: user.id, isOpponent: false }, select: { id: true } })
  for (const t of teams) await syncTeam(t.id)
}

let scheduled = false

/** Background reads: two minutes after start, then every 4 hours (index.ts). */
export function startWeeklyAwards(): void {
  if (scheduled) return
  scheduled = true
  const run = () => { syncAllTeams().catch((err) => console.warn('[awards] background read failed:', errorText(err))) }
  setTimeout(run, START_DELAY_MS)
  setInterval(run, SYNC_INTERVAL_MS)
}

// ── team:weekly-awards ─────────────────────────────────────────────────────

/** What the roster cards show for a team (see weeklyAwardsCore.ts). */
export async function getWeeklyAwards(teamId: string): Promise<WeeklyAwards> {
  const prisma = getPrisma()
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { isOpponent: true } })
  if (!team) throw new Error('Team not found')
  const now = Date.now()
  const stale = now - (lastSync.get(teamId) ?? 0) > FRESH_MS
  if (!team.isOpponent && (syncing.has(teamId) || (stale && now - (lastAttempt.get(teamId) ?? 0) > RETRY_MS))) {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([syncTeam(teamId), new Promise<void>((resolve) => { timer = setTimeout(resolve, READ_WAIT_MS) })])
    clearTimeout(timer)
  }
  return computeAwards(teamId)
}

async function computeAwards(teamId: string): Promise<WeeklyAwards> {
  const prisma = getPrisma()
  const now = Date.now()
  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { members: true } })
  if (!team) throw new Error('Team not found')
  const roster: RosterRef[] = team.members.map((m) => ({ id: m.id, puuid: m.puuid }))
  if (team.isOpponent) return buildWeeklyAwards({ now, roster, history: [], race: { mvp: [], grinder: [] } })
  const players = roster.filter((m): m is { id: string; puuid: string } => !!m.puuid)

  const rows = await prisma.teamWeeklyAward.findMany({ where: { teamId } })
  const history: WeekResult[] = rows
    .filter((r) => (AWARD_KINDS as readonly string[]).includes(r.kind))
    .map((r) => ({ kind: r.kind as AwardKind, weekKey: r.weekKey, memberId: r.memberId, puuid: r.puuid, value: r.value, games: r.games }))

  // Last week, until its result is stored (grace period, Riot not read yet):
  // computed from what is in the database.
  const currentKey = weekKeyOf(now)
  const lastKey = shiftWeekKey(currentKey, -1)
  const missing = AWARD_KINDS.filter((kind) => !history.some((r) => r.kind === kind && r.weekKey === lastKey))
  if (missing.length > 0) {
    const last = weekRange(lastKey)
    const races = await weekRaces(players, last.start, last.end)
    for (const kind of missing) history.push(weekResultOf(kind, lastKey, races[kind], roster))
  }
  const current = weekRange(currentKey)
  return buildWeeklyAwards({ now, roster, history, race: await weekRaces(players, current.start, current.end) })
}
