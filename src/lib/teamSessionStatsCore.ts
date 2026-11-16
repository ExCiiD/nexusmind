import { normalizeRole } from './teamIdentity'
import type { SynergyPlayerStats } from './ipc'

/**
 * Per-game stats & duel comparison (Phase 4, Planning rework —
 * docs/PLAN_GESTION_EQUIPE.md §9). Pure, shared desktop/web — the raw Riot
 * match-v5 payload is fetched and cached by a platform-specific call
 * (`window.api.teamSessionFetchMatch`, since desktop's riotClient.ts and
 * web's riotWeb.ts each have their own fetch plumbing); everything from
 * there on (which side is "ours", per-player stats, duel pairing) is one
 * shared computation so the two platforms can never disagree on the
 * numbers they show.
 */

export interface RiotMatchParticipant {
  puuid: string
  teamId: number
  teamPosition?: string
  individualPosition?: string
  championName?: string
  kills: number
  deaths: number
  assists: number
  win: boolean
  totalMinionsKilled?: number
  neutralMinionsKilled?: number
  totalDamageDealtToChampions?: number
  totalDamageTaken?: number
  timeCCingOthers?: number
  totalTimeCCDealt?: number
  visionScore?: number
  wardsPlaced?: number
  wardsKilled?: number
  detectorWardsPurchased?: number
  visionWardsBoughtInGame?: number
  goldEarned?: number
  champExperience?: number
  riotIdGameName?: string
  riotIdTagline?: string
  summonerName?: string
}

export interface RiotMatch {
  info: {
    gameDuration: number
    participants: RiotMatchParticipant[]
  }
}

export function participantName(p: RiotMatchParticipant): string {
  return p.riotIdGameName || p.summonerName || 'Unknown'
}
const normName = (s: string) => s.trim().toLowerCase()

export interface RiotIdMember { userId: string; riotId: string | null; displayName: string | null }

/** Matches one match participant to a group member by Riot ID game-name
 *  (case-insensitive, tag ignored) — the same identity group members carry
 *  in Supabase (`group_members.riot_id`, no cached puuid). */
export function matchParticipantToMember(p: RiotMatchParticipant, members: RiotIdMember[]): RiotIdMember | undefined {
  const name = normName(participantName(p))
  return members.find((m) => m.riotId && normName(m.riotId.split('#')[0]) === name)
}

/**
 * Which of the two Riot `teamId`s (100/200) is "ours", based on how many
 * participants' in-game names match one of the group's stored Riot IDs
 * (the `GameName` part, before the `#tag` — group members have no cached
 * puuid, unlike the local roster `aggregateMatchLike` matches in
 * team.ipc.ts). Returns null when neither side has any match — e.g. the
 * group's Riot IDs aren't filled in yet — so the caller can fall back to
 * showing both sides unlabeled rather than guessing.
 */
export function resolveOurTeamId(participants: RiotMatchParticipant[], memberRiotIds: string[]): 100 | 200 | null {
  const names = new Set(memberRiotIds.filter(Boolean).map((id) => normName(id.split('#')[0])))
  const score: Record<100 | 200, number> = { 100: 0, 200: 0 }
  for (const p of participants) {
    if (p.teamId !== 100 && p.teamId !== 200) continue
    if (names.has(normName(participantName(p)))) score[p.teamId as 100 | 200]++
  }
  if (score[100] === 0 && score[200] === 0) return null
  return score[100] >= score[200] ? 100 : 200
}

/**
 * One match's participants on one side → the same `SynergyPlayerStats[]`
 * shape team.ipc.ts's multi-match aggregator produces (gamesPlayed is
 * always 1 here), so the shared `StatsTable` component renders a single
 * game identically to a multi-game average. `nameFor` resolves a stable
 * id/label per participant — a roster member for "our" side, the raw
 * in-game name for the enemy side (no roster to match against there).
 */
export function buildSideStats(
  participants: RiotMatchParticipant[],
  durationSec: number,
  nameFor: (p: RiotMatchParticipant) => { id: string; displayName: string; role?: string },
): SynergyPlayerStats[] {
  if (participants.length === 0 || durationSec <= 0) return []
  const durationMin = durationSec / 60
  const totals = {
    dmg: participants.reduce((s, p) => s + (p.totalDamageDealtToChampions ?? 0), 0),
    gold: participants.reduce((s, p) => s + (p.goldEarned ?? 0), 0),
    vision: participants.reduce((s, p) => s + (p.visionScore ?? 0), 0),
    dmgTaken: participants.reduce((s, p) => s + (p.totalDamageTaken ?? 0), 0),
    cc: participants.reduce((s, p) => s + (p.timeCCingOthers ?? p.totalTimeCCDealt ?? 0), 0),
    kills: participants.reduce((s, p) => s + (p.kills ?? 0), 0),
  }

  return participants.map((p): SynergyPlayerStats => {
    const { id, displayName, role } = nameFor(p)
    const cs = (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0)
    const cc = p.timeCCingOthers ?? p.totalTimeCCDealt ?? 0
    const gold = p.goldEarned ?? 0
    const dmg = p.totalDamageDealtToChampions ?? 0
    const vision = p.visionScore ?? 0
    const dmgTaken = p.totalDamageTaken ?? 0
    const champKey = p.championName ?? 'Unknown'
    return {
      memberId: id,
      displayName,
      role: role ?? normalizeRole(p.teamPosition || p.individualPosition),
      gamesPlayed: 1,
      wins: p.win ? 1 : 0,
      winRate: p.win ? 100 : 0,
      averages: {
        kda: p.deaths > 0 ? (p.kills + p.assists) / p.deaths : p.kills + p.assists,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        cs,
        csPerMin: cs / durationMin,
        damage: dmg,
        damagePerMin: dmg / durationMin,
        damageTaken: dmgTaken,
        ccTime: cc,
        visionScore: vision,
        wardsPlaced: p.wardsPlaced ?? 0,
        wardsKilled: p.wardsKilled ?? 0,
        controlWards: p.detectorWardsPurchased ?? p.visionWardsBoughtInGame ?? 0,
        gold,
        goldPerMin: gold / durationMin,
        xpPerMin: (p.champExperience ?? 0) / durationMin,
        damagePerGold: gold > 0 ? dmg / gold : 0,
      },
      shares: {
        damagePct: totals.dmg > 0 ? (dmg / totals.dmg) * 100 : 0,
        goldPct: totals.gold > 0 ? (gold / totals.gold) * 100 : 0,
        visionPct: totals.vision > 0 ? (vision / totals.vision) * 100 : 0,
        damageTakenPct: totals.dmgTaken > 0 ? (dmgTaken / totals.dmgTaken) * 100 : 0,
        ccPct: totals.cc > 0 ? (cc / totals.cc) * 100 : 0,
        kpPct: totals.kills > 0 ? ((p.kills + p.assists) / totals.kills) * 100 : 0,
      },
      byChampion: [{ championKey: champKey, games: 1, wins: p.win ? 1 : 0, winRate: p.win ? 100 : 0 }],
    }
  })
}

export interface MatchHeaderSummary {
  ourWin: boolean
  durationSec: number
  our: { kills: number; deaths: number; assists: number; gold: number; vision: number; damage: number }
  enemy: { kills: number; deaths: number; assists: number; gold: number; vision: number; damage: number }
}

/** KDA/Gold/Vision/duration side-by-side for the match header strip. */
export function buildHeaderSummary(ourSide: SynergyPlayerStats[], enemySide: SynergyPlayerStats[], durationSec: number, ourWin: boolean): MatchHeaderSummary {
  const sum = (side: SynergyPlayerStats[]) => ({
    kills: side.reduce((s, p) => s + p.averages.kills, 0),
    deaths: side.reduce((s, p) => s + p.averages.deaths, 0),
    assists: side.reduce((s, p) => s + p.averages.assists, 0),
    gold: side.reduce((s, p) => s + p.averages.gold, 0),
    vision: side.reduce((s, p) => s + p.averages.visionScore, 0),
    damage: side.reduce((s, p) => s + p.averages.damage, 0),
  })
  return { ourWin, durationSec, our: sum(ourSide), enemy: sum(enemySide) }
}

export interface DuelRow {
  role: string
  our: SynergyPlayerStats | null
  enemy: SynergyPlayerStats | null
}

/** Canonical lane order, same convention as teamIdentity.ts's normalizeRole. */
export const DUEL_ROLE_ORDER = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const

/**
 * Pairs both sides by normalized lane for a table-based duel comparison —
 * not a radar chart (the user's final, authoritative request dropped
 * "graphique" in favor of "un tableau identique"; see the Phase 3-5 plan's
 * Context section for that call).
 */
export function buildDuelRows(ourSide: SynergyPlayerStats[], enemySide: SynergyPlayerStats[]): DuelRow[] {
  return DUEL_ROLE_ORDER.map((role) => ({
    role,
    our: ourSide.find((p) => p.role === role) ?? null,
    enemy: enemySide.find((p) => p.role === role) ?? null,
  }))
}
