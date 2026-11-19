/**
 * Ranked standing of a player, from Riot's league-v4 entries: tier,
 * division, LP, wins and losses per queue, a label, an order, and one
 * "ladder score" that puts every rank on a single LP scale, so the LP won
 * over a week is the difference of two scores (the weekly Grinder award).
 *
 * Pure: shared by the main process (team:member-ranks reads the entries of
 * the roster's players) and the renderer (looking-for-team announcements).
 */

export const TIERS = [
  'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER',
] as const
export type Tier = (typeof TIERS)[number]

/** Lowest to highest, as Riot writes them. */
export const DIVISIONS = ['IV', 'III', 'II', 'I'] as const
export type Division = (typeof DIVISIONS)[number]

/** One ladder without divisions: Grandmaster and Challenger are LP cut-offs
 *  of the Master ladder. */
export const APEX_TIERS: ReadonlySet<Tier> = new Set<Tier>(['MASTER', 'GRANDMASTER', 'CHALLENGER'])

export type RankedQueue = 'solo' | 'flex'
/** Riot's `queueType` for each queue we read. */
export const QUEUE_TYPES: Record<RankedQueue, string> = {
  solo: 'RANKED_SOLO_5x5',
  flex: 'RANKED_FLEX_SR',
}

export interface QueueRank {
  queue: RankedQueue
  tier: Tier
  /** Null from Master up. */
  division: Division | null
  lp: number
  wins: number
  losses: number
}

export interface PlayerRanks {
  solo: QueueRank | null
  flex: QueueRank | null
}

/** Rank of one roster member (IPC team:member-ranks). */
export type MemberRankResult =
  | { memberId: string; status: 'ok'; ranks: PlayerRanks; fetchedAt: number }
  /** No full Riot ID (name and tag) or no region on the roster. */
  | { memberId: string; status: 'no-riot-id' }
  | {
      memberId: string
      status: 'error'
      /** login: signed out of Ascend (builds read Riot through the Ascend
       *  proxy); not-found: the Riot ID doesn't exist in that region. */
      code: 'login' | 'not-configured' | 'not-found' | 'unknown'
      message: string
    }

/** The fields of a league-v4 entry we read (`entries/by-puuid`). */
export interface LeagueEntryDto {
  queueType?: unknown
  tier?: unknown
  rank?: unknown
  leaguePoints?: unknown
  wins?: unknown
  losses?: unknown
}

export const LP_PER_DIVISION = 100
export const LP_PER_TIER = LP_PER_DIVISION * DIVISIONS.length
/** Ladder score of Master 0 LP: the top of Diamond I. */
export const APEX_BASE = TIERS.indexOf('MASTER') * LP_PER_TIER

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

function asTier(v: unknown): Tier | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return (TIERS as readonly string[]).includes(s) ? (s as Tier) : null
}

function asDivision(v: unknown): Division | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return (DIVISIONS as readonly string[]).includes(s) ? (s as Division) : null
}

/** One entry as a QueueRank; null for another queue (TFT, Arena…) or an
 *  entry that doesn't read as a rank. */
export function parseLeagueEntry(entry: LeagueEntryDto | null | undefined): QueueRank | null {
  if (!entry || typeof entry !== 'object') return null
  const queue = (Object.keys(QUEUE_TYPES) as RankedQueue[]).find((q) => QUEUE_TYPES[q] === entry.queueType)
  const tier = asTier(entry.tier)
  if (!queue || !tier) return null
  const apex = APEX_TIERS.has(tier)
  const division = apex ? null : asDivision(entry.rank)
  if (!apex && !division) return null
  return { queue, tier, division, lp: count(entry.leaguePoints), wins: count(entry.wins), losses: count(entry.losses) }
}

/** Solo/Duo and Flex ranks from the entries Riot returns (an empty list for
 *  a player unranked in both). Anything that isn't a list reads as unranked. */
export function parseLeagueEntries(entries: unknown): PlayerRanks {
  const out: PlayerRanks = { solo: null, flex: null }
  if (!Array.isArray(entries)) return out
  for (const e of entries) {
    const r = parseLeagueEntry(e as LeagueEntryDto)
    if (r && !out[r.queue]) out[r.queue] = r
  }
  return out
}

/**
 * Every rank on one LP scale: 100 per division, 400 per tier, Iron IV 0 LP
 * = 0, Diamond I 99 LP = 2799, Master 0 LP = 2800; from Master up the LP
 * just keeps counting (Grandmaster and Challenger are LP cut-offs).
 */
export function ladderScore(rank: Pick<QueueRank, 'tier' | 'division' | 'lp'>): number {
  if (APEX_TIERS.has(rank.tier)) return APEX_BASE + rank.lp
  const division = rank.division ? DIVISIONS.indexOf(rank.division) : 0
  return TIERS.indexOf(rank.tier) * LP_PER_TIER + Math.max(0, division) * LP_PER_DIVISION + rank.lp
}

/** LP won (negative: lost) between two readings of the same queue; null
 *  when either is missing (unranked, or placements not done). */
export function lpDelta(before: QueueRank | null | undefined, after: QueueRank | null | undefined): number | null {
  if (!before || !after) return null
  return ladderScore(after) - ladderScore(before)
}

/** Best first; unranked last. Equal ladder scores: the higher tier first
 *  (a Grandmaster above a Master on the same LP). */
export function compareRanks(a: QueueRank | null | undefined, b: QueueRank | null | undefined): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1)
  return ladderScore(b) - ladderScore(a) || TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier)
}

/** The rank to show for a player: Solo/Duo when ranked there, else Flex. */
export function displayRank(ranks: PlayerRanks | null | undefined): QueueRank | null {
  return ranks?.solo ?? ranks?.flex ?? null
}

export function gamesOf(rank: Pick<QueueRank, 'wins' | 'losses'>): number {
  return rank.wins + rank.losses
}

/** Rounded win rate in %, null without games. */
export function rankWinRate(rank: Pick<QueueRank, 'wins' | 'losses'>): number | null {
  const games = gamesOf(rank)
  return games > 0 ? Math.round((rank.wins / games) * 100) : null
}

export const TIER_NAMES_EN: Record<Tier, string> = {
  IRON: 'Iron',
  BRONZE: 'Bronze',
  SILVER: 'Silver',
  GOLD: 'Gold',
  PLATINUM: 'Platinum',
  EMERALD: 'Emerald',
  DIAMOND: 'Diamond',
  MASTER: 'Master',
  GRANDMASTER: 'Grandmaster',
  CHALLENGER: 'Challenger',
}

/**
 * "Diamond II", "Master" — with `lp`, "Diamond II · 45 LP". `tierName`
 * gives the translated tier (English by default); unranked gives
 * `unranked` ("Unranked" by default).
 */
export function rankLabel(
  rank: QueueRank | null | undefined,
  opts: { tierName?: (tier: Tier) => string; lp?: boolean; unranked?: string } = {},
): string {
  if (!rank) return opts.unranked ?? 'Unranked'
  const name = (opts.tierName ?? ((t: Tier) => TIER_NAMES_EN[t]))(rank.tier)
  const head = rank.division ? `${name} ${rank.division}` : name
  return opts.lp ? `${head} · ${rank.lp} LP` : head
}

/** Riot's emblem of the tier, as the client shows it (Community Dragon).
 *  The emblem sits in the middle of a transparent 16:9 picture. */
export function rankEmblemUrl(tier: Tier): string {
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${tier.toLowerCase()}.png`
}
