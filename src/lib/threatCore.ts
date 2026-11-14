/**
 * Shared, pure champion-pool tiering + opponent-threat detection (E12).
 *
 * Used by both the auto-fill/scout IPC handlers (electron/main/ipc/team.ipc.ts)
 * and the Draft Sim UI (src/pages/Team/DraftTab.tsx) so the "why is this
 * champion highlighted" logic lives in exactly one place. No Electron/React
 * imports here — keep it portable for the future web port (E14).
 */

export type Tier = 'main' | 'comfort' | 'flex' | 'learning'
export type ThreatLevel = 'prioPick' | 'red' | 'orange' | 'yellow' | 'played'

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

export const TIER_MASTERY_MAIN = 300_000
export const TIER_MASTERY_COMFORT = 200_000
export const TIER_GAMES_COMFORT = 50

export interface MemberThreatContext {
  /** True when this entry is the member's #1 most-played champion in this role. */
  isDominant: boolean
  /** Share (0-1) of the member's role games this champion accounts for. */
  roleShare: number
}

export interface MemberThreatAssessment {
  level: 'red' | 'orange' | 'played' | null
  reason: string
}

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
 * champion qualifies for several levels: red > orange > yellow > played.
 */
export function buildTeamThreatMap(team: ThreatTeam | null | undefined): Map<string, ChampionThreat> {
  const out = new Map<string, ChampionThreat>()
  if (!team?.members) return out

  // championKey -> members who individually clear red/orange, with their level
  const qualifying = new Map<string, { displayName: string; level: 'red' | 'orange' }[]>()
  // championKey -> members who've at least "played" it (any signal at all)
  const played = new Map<string, Set<string>>()

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

export interface AutoTierInput {
  games: number
  masteryPoints: number | null
  winRate: number | null
  /** True when this champion is one of the member's top-5 most-played in role. */
  isTop5InRole: boolean
}

/**
 * Combined-signal auto-tier for a member's OWN champion pool (main/comfort/
 * flex/learning) — replaces the games-or-mastery-only thresholds that made
 * tiering feel "random": now a strong recent winrate on a moderate sample
 * can also earn "main"/"comfort", and a 0-game mastery-only entry below the
 * comfort mastery bar is tagged "learning" instead of silently defaulting
 * to "flex".
 */
export function computeAutoTier(stat: AutoTierInput): Tier {
  const mastery = stat.masteryPoints ?? 0
  const hasRateSignal = stat.games >= MIN_GAMES_FOR_RATE_SIGNAL
  const strongRate = hasRateSignal && (stat.winRate ?? 0) >= WINRATE_THREAT_PCT

  if (stat.isTop5InRole || mastery >= TIER_MASTERY_MAIN || strongRate) return 'main'

  const decentRate = hasRateSignal && (stat.winRate ?? 0) >= 55
  if (mastery >= TIER_MASTERY_COMFORT || stat.games >= TIER_GAMES_COMFORT || decentRate) return 'comfort'

  if (stat.games === 0 && mastery < TIER_MASTERY_COMFORT) return 'learning'

  return 'flex'
}
