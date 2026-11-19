/**
 * Shared, pure champion-pool tiering + opponent-threat detection (E12).
 *
 * Used by both the auto-fill/scout IPC handlers (electron/main/ipc/team.ipc.ts)
 * and the Draft Sim UI (src/pages/Team/DraftTab.tsx) so the "why is this
 * champion highlighted" logic lives in exactly one place. No Electron/React
 * imports here — keep it portable for the future web port (E14).
 */

export type Tier = 'main' | 'new' | 'comfort' | 'flex' | 'learning'
/** Display order, strongest first. "new" sits right after "main": it is
 *  what the player is grinding right now. */
export const TIERS: readonly Tier[] = ['main', 'new', 'comfort', 'flex', 'learning']
/** Weight of each tier where several entries compete (Draft Sim role attribution). */
export const TIER_RANK: Record<Tier, number> = { main: 5, new: 4, comfort: 3, flex: 2, learning: 1 }
export const isTier = (v: unknown): v is Tier => typeof v === 'string' && (TIERS as readonly string[]).includes(v)

export type ThreatLevel = 'prioPick' | 'red' | 'orange' | 'yellow' | 'new' | 'played'

/** Per-(championKey, role) aggregate stats a tier/threat decision is made from. */
export interface ChampionStat {
  championKey: string
  role: string
  /** Recent games played (current season scope), 0 for mastery-only entries. */
  games: number
  /** Win rate in percent (0-100), or null when unknown/no games. */
  winRate: number | null
  /** Lifetime Riot champion-mastery points, or null when unknown. */
  masteryPoints: number | null
  /** Average (kills+assists)/max(1,deaths) across `games`, or null when
   *  unknown/no games — see ChampionPoolEntry.kda. */
  kda: number | null
  /** The entry's tier, when known: a "new" one is a recent pickup the
   *  Draft Sim points out. */
  tier?: string | null
  /** First analysed game on this champion in this role (ms since epoch). */
  firstPlayedAt?: number | null
}

// ── Thresholds ──────────────────────────────────────────────────────────────
// A rate signal (winRate/kda) is only trusted once a champion has been
// played enough that it's not just a 2-game hot streak.
export const MIN_GAMES_FOR_RATE_SIGNAL = 20
export const WINRATE_THREAT_PCT = 65
export const KDA_THREAT = 4
export const MASTERY_THREAT = 300_000
export const GAMES_RED_ABSOLUTE = 100
export const DOMINANT_SHARE_THRESHOLD = 0.25
export const MIN_DOMINANT_GAMES = 10
// Below this, a champion has "been played" but isn't a real threat yet —
// it can still appear in the draft, it's just not worth banning over.
export const PLAYED_MIN_GAMES = 1

export interface MemberThreatContext {
  /** True when this entry is the member's #1 most-played champion in this role. */
  isDominant: boolean
  /** Share (0-1) of the member's role games this champion accounts for. */
  roleShare: number
}

export interface MemberThreatAssessment {
  level: 'red' | 'orange' | 'new' | 'played' | null
  reason: string
}

const DAY_MS = 86_400_000

/**
 * Per-member threat level for a single champion+role, combining games,
 * mastery and (gated) winrate/KDA — replaces the old games/mastery-only
 * "100g+most-played OR 300k mastery" rule with the user-specified combined
 * signal, while keeping the dominant-pick relative check for small samples.
 */
export function assessMemberChampionThreat(stat: ChampionStat, ctx: MemberThreatContext): MemberThreatAssessment {
  const isRedAbsolute = stat.games >= GAMES_RED_ABSOLUTE
  const isRedDominant = ctx.isDominant && stat.games >= MIN_DOMINANT_GAMES && ctx.roleShare >= DOMINANT_SHARE_THRESHOLD
  const hasRateSignal = stat.games >= MIN_GAMES_FOR_RATE_SIGNAL
  const isRedRate = hasRateSignal && ((stat.winRate ?? 0) >= WINRATE_THREAT_PCT || (stat.kda ?? 0) >= KDA_THREAT)

  if (isRedAbsolute || isRedDominant || isRedRate) {
    const reasons: string[] = []
    if (isRedAbsolute) reasons.push(`${stat.games}g`)
    else if (isRedDominant) reasons.push(`${stat.games}g (${Math.round(ctx.roleShare * 100)}% of ${stat.role}) · most-played`)
    if (isRedRate) {
      if ((stat.winRate ?? 0) >= WINRATE_THREAT_PCT) reasons.push(`${stat.winRate}% WR`)
      if ((stat.kda ?? 0) >= KDA_THREAT) reasons.push(`${stat.kda?.toFixed(1)} KDA`)
    }
    return { level: 'red', reason: reasons.join(' · ') || `${stat.games}g` }
  }

  if ((stat.masteryPoints ?? 0) >= MASTERY_THREAT) {
    return { level: 'orange', reason: `${Math.round((stat.masteryPoints ?? 0) / 1000)}k mastery` }
  }

  // A recent pickup (tier "new", see isNewPick): not a proven threat, but
  // what the player has been practising lately — worth knowing in draft.
  if (stat.tier === 'new') {
    const days = stat.firstPlayedAt ? Math.max(1, Math.round((Date.now() - stat.firstPlayedAt) / DAY_MS)) : null
    return { level: 'new', reason: days ? `${stat.games}g in ${days}d` : `${stat.games}g` }
  }

  if (stat.games >= PLAYED_MIN_GAMES) {
    return { level: 'played', reason: `${stat.games}g — seen, not yet a threat` }
  }

  return { level: null, reason: '' }
}

/** A team member's champion pool, scoped to the fields `buildMemberThreatMap`
 *  needs — kept narrow so callers (desktop IPC types, web port) don't need
 *  to depend on the full TeamMember/ChampionPoolEntry shape. */
export interface ThreatPoolMember {
  displayName: string
  role: string
  champPool: ChampionStat[]
}

/**
 * Per-member threat lookup, keyed by championKey. Only considers entries
 * in the member's OWN assigned role — a TOP main's stale mastery from a
 * season they played ADC should never flag a champion as a threat for
 * their current (different) lane. This is the role-swap fix: the previous
 * implementation walked the member's entire pool regardless of role.
 */
export function buildMemberThreatMap(member: ThreatPoolMember): Map<string, MemberThreatAssessment> {
  const out = new Map<string, MemberThreatAssessment>()
  const memberRole = (member.role || '').toUpperCase()
  const inRole = member.champPool.filter((e) => e.role.toUpperCase() === memberRole)
  if (inRole.length === 0) return out

  const topMostPlayed = inRole.reduce<ChampionStat | null>((best, e) => (!best || e.games > best.games ? e : best), null)
  const totalRoleGames = inRole.reduce((sum, e) => sum + e.games, 0)

  for (const e of inRole) {
    const isDominant = !!topMostPlayed && topMostPlayed.championKey === e.championKey && e.games > 0
    const roleShare = totalRoleGames > 0 ? e.games / totalRoleGames : 0
    const assessment = assessMemberChampionThreat(e, { isDominant, roleShare })
    if (assessment.level) out.set(e.championKey, assessment)
  }
  return out
}

export interface ChampionThreat {
  level: ThreatLevel
  reason: string
  members: string[]
}

export interface ThreatTeam {
  members: ThreatPoolMember[]
}

/**
 * Team-wide threat lookup. Yellow ("flex threat") now requires at least two
 * DIFFERENT members to each individually clear the red/orange threat bar on
 * the same champion — not just "both have it somewhere in their pool",
 * which used to fire on two players with 2 games each. Priority when a
 * champion qualifies for several levels: red > orange > yellow > new > played
 * ("new": a champion a player picked up in the last two weeks, see isNewPick).
 */
export function buildTeamThreatMap(team: ThreatTeam | null | undefined): Map<string, ChampionThreat> {
  const out = new Map<string, ChampionThreat>()
  if (!team?.members) return out

  // championKey -> members who individually clear red/orange, with their level
  const qualifying = new Map<string, { displayName: string; level: 'red' | 'orange' }[]>()
  // championKey -> members who've at least "played" it (any signal at all)
  const played = new Map<string, Set<string>>()
  // championKey -> members who picked it up recently (tier "new"), with why
  const recent = new Map<string, { displayName: string; reason: string }[]>()

  for (const m of team.members) {
    const memberMap = buildMemberThreatMap(m)
    for (const [key, assessment] of memberMap) {
      const set = played.get(key) ?? new Set<string>()
      set.add(m.displayName)
      played.set(key, set)
      if (assessment.level === 'red' || assessment.level === 'orange') {
        const list = qualifying.get(key) ?? []
        list.push({ displayName: m.displayName, level: assessment.level })
        qualifying.set(key, list)
      } else if (assessment.level === 'new') {
        const list = recent.get(key) ?? []
        list.push({ displayName: m.displayName, reason: assessment.reason })
        recent.set(key, list)
      }
    }
  }

  for (const [key, list] of qualifying) {
    const strongest = list.some((l) => l.level === 'red') ? 'red' : 'orange'
    const members = list.map((l) => l.displayName)
    if (list.length >= 2) {
      out.set(key, {
        level: 'yellow',
        reason: `flex threat — ${list.length} players individually clear the threat bar`,
        members,
      })
    } else {
      const only = list[0]
      out.set(key, { level: strongest, reason: `${only.displayName}'s pick`, members })
    }
  }

  for (const [key, list] of recent) {
    if (out.has(key)) continue
    const reason = list.length === 1 ? `${list[0].displayName}: ${list[0].reason}` : `new pick for ${list.length} players`
    out.set(key, { level: 'new', reason, members: list.map((l) => l.displayName) })
  }

  for (const [key, set] of played) {
    if (out.has(key)) continue
    out.set(key, { level: 'played', reason: 'seen in pool, not yet a threat', members: Array.from(set) })
  }

  return out
}

/**
 * Cross-team "priority pick/ban" detection: a champion that independently
 * clears the red/orange threat bar on BOTH sides is high-value no matter who
 * gets it — whoever doesn't pick it should probably ban it.
 */
export function buildPrioPickMap(
  teamAThreats: Map<string, ChampionThreat>,
  teamBThreats: Map<string, ChampionThreat>,
): Map<string, ChampionThreat> {
  const out = new Map<string, ChampionThreat>()
  const isThreatening = (t: ChampionThreat | undefined) => t && (t.level === 'red' || t.level === 'orange' || t.level === 'yellow')
  for (const [key, a] of teamAThreats) {
    const b = teamBThreats.get(key)
    if (isThreatening(a) && isThreatening(b)) {
      out.set(key, {
        level: 'prioPick',
        reason: 'high-value pick for both teams',
        members: Array.from(new Set([...a.members, ...(b as ChampionThreat).members])),
      })
    }
  }
  return out
}

/**
 * Merges the cross-team prio-pick map over a single-team threat map (prio
 * pick always wins — it's the strongest signal in the draft grid).
 */
export function withPrioPicks(
  base: Map<string, ChampionThreat>,
  prioPicks: Map<string, ChampionThreat>,
): Map<string, ChampionThreat> {
  if (prioPicks.size === 0) return base
  const out = new Map(base)
  for (const [key, threat] of prioPicks) out.set(key, threat)
  return out
}

// ── Auto-tiering (v2, 18 November 2026) ─────────────────────────────────────
// v1 let lifetime mastery alone make a "main" (a champion mained three
// seasons ago, 7 games this season) and made the 5 most-played champions
// "main" whatever their sample. v2 reads the current play first: volume and
// rank in the role, a win rate pulled toward 50 % on small samples, recency,
// and mastery only as a hint of experience. It adds "new": a champion
// picked up in the last 2 weeks and already played 10 times or more.

/** "new": first analysed game less than this many days ago… */
export const NEW_PICK_DAYS = 14
/** …and at least this many games since. */
export const NEW_PICK_MIN_GAMES = 10
/** The first game must come this long after the start of the analysed
 *  history; otherwise the player may have played it before the data begins. */
export const NEW_PICK_HISTORY_MARGIN_DAYS = 2
/** Lifetime mastery a new pick may carry: a base, plus what its games earn at
 *  most. More than that and the champion has a past: it's a comeback. */
export const NEW_PICK_MASTERY_BASE = 20_000
export const NEW_PICK_MASTERY_PER_GAME = 3_000

/** "main": the core of the role — 12+ games and top 3 (or 15 % of the role's games)… */
export const MAIN_MIN_GAMES = 12
export const MAIN_TOP_RANK = 3
export const MAIN_MIN_SHARE = 0.15
/** …or a quarter of a small history (6+ games)… */
export const MAIN_SMALL_POOL_GAMES = 6
export const MAIN_SMALL_POOL_SHARE = 0.25
/** …or a crushing adjusted win rate on 20+ games. */
export const MAIN_ADJUSTED_WR = 60
/** "comfort": 8+ games at an adjusted 50 %, or 25+ games, or deep mastery. */
export const COMFORT_MIN_GAMES = 8
export const COMFORT_ADJUSTED_WR = 50
export const COMFORT_VOLUME_GAMES = 25
export const TIER_MASTERY_COMFORT = 200_000
/** "flex": 5+ games, or real mastery. Below: "learning". */
export const FLEX_MIN_GAMES = 5
export const TIER_MASTERY_FLEX = 100_000
/** A main or comfort not played for this long, while the player kept
 *  playing, drops one tier. */
export const STALE_DAYS = 30

/** Win rate pulled toward 50 % by 10 imaginary games (5 won, 5 lost): 3/3
 *  reads 61 %, 30/50 reads 58 %. Null without games or win rate. */
export function adjustedWinRate(games: number, winRate: number | null): number | null {
  if (winRate == null || games <= 0) return null
  const wins = (winRate / 100) * games
  return ((wins + 5) / (games + 10)) * 100
}

export interface AutoTierInput {
  /** Games on this champion in this role, in the analysed history. */
  games: number
  winRate: number | null
  masteryPoints: number | null
  /** 1 = the member's most-played champion in this role; null without games. */
  rankInRole?: number | null
  /** Share (0-1) of the member's analysed games in this role. */
  roleShare?: number | null
  /** @deprecated v1 signal; read as "top 3" when no rank is given. */
  isTop5InRole?: boolean
  /** First and last analysed game on this champion in this role (ms since epoch). */
  firstPlayedAt?: number | null
  lastPlayedAt?: number | null
  /** Oldest and most recent analysed game of the member, any champion (ms). */
  historyFrom?: number | null
  historyTo?: number | null
  /** False skips the "new" rule (cloud snapshots, which have no such tier yet). */
  allowNew?: boolean
  now?: number
}

/** A champion picked up in the last NEW_PICK_DAYS days and already played
 *  NEW_PICK_MIN_GAMES times, with nothing in the data or the mastery to say
 *  the player knew it before. */
export function isNewPick(s: AutoTierInput, now = s.now ?? Date.now()): boolean {
  if (s.games < NEW_PICK_MIN_GAMES || !s.firstPlayedAt) return false
  if (now - s.firstPlayedAt > NEW_PICK_DAYS * DAY_MS) return false
  if (s.historyFrom != null && s.firstPlayedAt - s.historyFrom < NEW_PICK_HISTORY_MARGIN_DAYS * DAY_MS) return false
  if (s.masteryPoints != null && s.masteryPoints > NEW_PICK_MASTERY_BASE + NEW_PICK_MASTERY_PER_GAME * s.games) return false
  return true
}

/**
 * The tier of one champion in a member's pool, rules checked in order:
 *   new      — isNewPick
 *   main     — 12+ games and top 3 of the role (or 15 % of its games);
 *              or 25 % of a small history (6+ games);
 *              or an adjusted win rate of 60 %+ on 20+ games
 *   comfort  — 8+ games at an adjusted 50 %+; or 25+ games; or 200k+ mastery
 *   flex     — 5+ games, or 100k+ mastery
 *   learning — the rest
 * A main or comfort not played for STALE_DAYS while the player kept playing
 * drops one tier. Use tierPool to get the rank and share right.
 */
export function computeAutoTier(s: AutoTierInput): Tier {
  const now = s.now ?? Date.now()
  if (s.allowNew !== false && isNewPick(s, now)) return 'new'

  const games = Math.max(0, s.games)
  const mastery = s.masteryPoints ?? 0
  const adjusted = adjustedWinRate(games, s.winRate)
  const rank = s.rankInRole ?? (s.isTop5InRole ? MAIN_TOP_RANK : null)
  const share = s.roleShare ?? 0

  let tier: Tier
  const core = games >= MAIN_MIN_GAMES && ((rank != null && rank <= MAIN_TOP_RANK) || share >= MAIN_MIN_SHARE)
  const dominant = games >= MAIN_SMALL_POOL_GAMES && share >= MAIN_SMALL_POOL_SHARE
  const crushing = games >= MIN_GAMES_FOR_RATE_SIGNAL && adjusted != null && adjusted >= MAIN_ADJUSTED_WR
  if (core || dominant || crushing) tier = 'main'
  else if ((games >= COMFORT_MIN_GAMES && adjusted != null && adjusted >= COMFORT_ADJUSTED_WR) || games >= COMFORT_VOLUME_GAMES || mastery >= TIER_MASTERY_COMFORT) tier = 'comfort'
  else if (games >= FLEX_MIN_GAMES || mastery >= TIER_MASTERY_FLEX) tier = 'flex'
  else tier = 'learning'

  const stale = s.lastPlayedAt != null && s.historyTo != null && s.historyTo - s.lastPlayedAt >= STALE_DAYS * DAY_MS
  if (stale && tier === 'main') tier = 'comfort'
  else if (stale && tier === 'comfort' && games > 0) tier = 'flex'
  return tier
}

export interface PoolTierEntry {
  championKey: string
  role: string
  games: number
  winRate: number | null
  masteryPoints: number | null
  firstPlayedAt?: number | null
  lastPlayedAt?: number | null
}

/**
 * Tiers a member's whole pool at once, which computeAutoTier alone can't:
 * the rank and share of each champion are computed per role, and the
 * history bounds default to the entries' own dates. Returns one tier per
 * entry, in the order given.
 */
export function tierPool(
  entries: PoolTierEntry[],
  opts: { historyFrom?: number | null; historyTo?: number | null; now?: number; allowNew?: boolean } = {},
): Tier[] {
  const byRole = new Map<string, PoolTierEntry[]>()
  for (const e of entries) {
    const role = e.role.toUpperCase()
    const list = byRole.get(role)
    if (list) list.push(e)
    else byRole.set(role, [e])
  }
  const rank = new Map<PoolTierEntry, number>()
  const share = new Map<PoolTierEntry, number>()
  for (const list of byRole.values()) {
    const total = list.reduce((sum, e) => sum + Math.max(0, e.games), 0)
    list
      .filter((e) => e.games > 0)
      .sort((a, b) => b.games - a.games || (b.winRate ?? 0) - (a.winRate ?? 0))
      .forEach((e, i) => rank.set(e, i + 1))
    for (const e of list) share.set(e, total > 0 ? Math.max(0, e.games) / total : 0)
  }
  const firsts = entries.map((e) => e.firstPlayedAt).filter((d): d is number => typeof d === 'number')
  const lasts = entries.map((e) => e.lastPlayedAt).filter((d): d is number => typeof d === 'number')
  const historyFrom = opts.historyFrom ?? (firsts.length ? Math.min(...firsts) : null)
  const historyTo = opts.historyTo ?? (lasts.length ? Math.max(...lasts) : null)
  return entries.map((e) => computeAutoTier({
    ...e,
    rankInRole: rank.get(e) ?? null,
    roleShare: share.get(e) ?? 0,
    historyFrom,
    historyTo,
    now: opts.now,
    allowNew: opts.allowNew,
  }))
}
