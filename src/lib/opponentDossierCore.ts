/**
 * #40 § 12 (docs/DESIGN_STATE.md): the opponent dossier. Pure, shared by the desktop and the web: the page assembled
 * from the group's scouting (roster and pools, threatCore), the stored dossier, our drafts against that team and the
 * Riot snapshot of the last refresh; the duos, recent form and pool changes computed from ranked games; the text
 * copied for Discord. Storage and Riot reads are in analystCore.ts.
 */
import { buildMemberThreatMap, type ChampionStat } from './threatCore'
import type { SharedScoutingEntry, TeamRole } from './team'
import type {
  DossierDuo, DossierPlayerCard, DossierSnapshot, DossierThreat, DraftLogEntry, OpponentDossier, OpponentDossierView,
  TeamObjectivesSummary,
} from './analyst'
import { opponentKeyOf } from './analyst'

export const DOSSIER_SNAPSHOT_VERSION = 1
/** Ranked games read per player: 20 with a personal Riot key (§ 12 "reduced mode"), 50 with the production key. */
export const DOSSIER_GAMES_PERSONAL_KEY = 20
export const DOSSIER_GAMES_PRODUCTION_KEY = 50
/** A duo needs this many ranked games together among the games read. */
export const DUO_MIN_GAMES = 3
/** Pool change: a champion with this many games in the last POOL_CHANGE_DAYS, and none in the games before. */
export const POOL_CHANGE_MIN_GAMES = 5
export const POOL_CHANGE_DAYS = 7

const ROLE_ORDER: TeamRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']

/** The scouted team matching an opponent key, if any. */
export function scoutingFor(scouting: SharedScoutingEntry[], opponentKey: string): SharedScoutingEntry | null {
  return scouting.find((s) => opponentKeyOf(s.name) === opponentKey) ?? null
}

/** Draft Sim threat level → the dossier's badge: red = Dominant, orange = Threat, a main or comfort pick = Comfort. */
function badgeOf(level: string | null | undefined, tier: string | null): DossierThreat {
  if (level === 'red') return 'dominant'
  if (level === 'orange') return 'threat'
  if (tier === 'main' || tier === 'comfort') return 'comfort'
  return null
}

/** The 5 player cards: starters top → support, their 3 most played champions with tier, winrate and badge. */
export function playerCards(scouted: SharedScoutingEntry | null, snapshot: DossierSnapshot | null): DossierPlayerCard[] {
  const roster = (scouted?.roster ?? []).filter((m) => m.status === 'starter' || !m.status)
  return roster
    .slice()
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
    .map((m) => {
      const stats: ChampionStat[] = m.pool.map((p) => ({
        championKey: p.championKey, role: p.role, games: p.playRate ?? 0, winRate: p.winRate, masteryPoints: p.masteryPoints, kda: p.kda, tier: p.tier,
      }))
      const threats = buildMemberThreatMap({ displayName: m.displayName, role: m.role, champPool: stats })
      const riotId = m.ign ? `${m.ign}${m.tagLine ? `#${m.tagLine}` : ''}` : null
      const snap = snapshot?.players.find((p) => (riotId && p.riotId === riotId) || (!riotId && p.displayName === m.displayName))
      return {
        role: m.role,
        displayName: m.displayName,
        riotId,
        status: snap?.status ?? 'not_refreshed',
        rank: snap?.rank ?? null,
        topChampions: m.pool
          .slice()
          .sort((a, b) => (b.playRate ?? 0) - (a.playRate ?? 0) || (b.masteryPoints ?? 0) - (a.masteryPoints ?? 0))
          .slice(0, 3)
          .map((p) => ({
            champion: p.championKey, tier: p.tier ?? null, games: p.playRate ?? 0, winRate: p.winRate,
            threat: badgeOf(threats.get(p.championKey)?.level, p.tier ?? null),
          })),
        recentForm: snap?.recentForm ?? [],
        poolChange: snap?.poolChange ?? null,
      }
    })
}

/** The page: what the group knows about the opponent, the stored dossier, and what happened against us. */
export function assembleDossierView(input: {
  opponentKey: string
  scouting: SharedScoutingEntry[]
  dossier: OpponentDossier | null
  /** The group's whole draft log (filtered here by opponent). */
  drafts: DraftLogEntry[]
  objectivesVsUs: TeamObjectivesSummary | null
  reducedMode: boolean
}): OpponentDossierView {
  const scouted = scoutingFor(input.scouting, input.opponentKey)
  const vs = input.drafts.filter((d) => d.opponentKey === input.opponentKey)
  const snapshot = input.dossier?.snapshot ?? null
  return {
    opponentKey: input.opponentKey,
    opponentName: input.dossier?.opponentName ?? scouted?.name ?? input.opponentKey,
    opponentTag: scouted?.tag ?? null,
    scoutNotes: scouted?.scoutNotes ?? null,
    dossier: input.dossier,
    players: playerCards(scouted, snapshot),
    vsUs: vs.length > 0 || input.objectivesVsUs
      ? { wins: vs.filter((d) => d.win === true).length, losses: vs.filter((d) => d.win === false).length, drafts: vs, objectives: input.objectivesVsUs }
      : null,
    duos: snapshot?.duos ?? [],
    reducedMode: input.reducedMode,
  }
}

/** A ranked game of one player, as the refresh reads it. */
export interface PlayerRankedGame { matchId: string; win: boolean; champion: string; at: number }

/** Last ranked results, most recent first (at most 10). */
export function recentFormOf(games: PlayerRankedGame[]): Array<'W' | 'L'> {
  return games.slice().sort((a, b) => b.at - a.at).slice(0, 10).map((g) => (g.win ? 'W' : 'L'))
}

/** A champion played at least POOL_CHANGE_MIN_GAMES times in the last POOL_CHANGE_DAYS, and never in the older games read. */
export function poolChangeOf(games: PlayerRankedGame[], now: number): { champion: string; games: number; days: number } | null {
  const since = now - POOL_CHANGE_DAYS * 86_400_000
  const recent = new Map<string, number>()
  const older = new Set<string>()
  for (const g of games) {
    if (g.at >= since) recent.set(g.champion, (recent.get(g.champion) ?? 0) + 1)
    else older.add(g.champion)
  }
  const best = [...recent.entries()].filter(([c, n]) => n >= POOL_CHANGE_MIN_GAMES && !older.has(c)).sort((a, b) => b[1] - a[1])[0]
  return best ? { champion: best[0], games: best[1], days: POOL_CHANGE_DAYS } : null
}

/** Pairs of players with DUO_MIN_GAMES ranked games or more together (same match id), most games first. */
export function duosOf(players: Array<{ displayName: string; games: PlayerRankedGame[] }>): DossierDuo[] {
  const out: DossierDuo[] = []
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const byId = new Map(players[i].games.map((g) => [g.matchId, g]))
      const together = players[j].games.filter((g) => byId.has(g.matchId))
      if (together.length < DUO_MIN_GAMES) continue
      const wins = together.filter((g) => g.win).length
      out.push({ a: players[i].displayName, b: players[j].displayName, games: together.length, winRate: wins / together.length })
    }
  }
  return out.sort((x, y) => y.games - x.games || (y.winRate ?? 0) - (x.winRate ?? 0))
}

/** The text "Copy for Discord" puts on the clipboard: summary, suggested bans, each player's top 3. */
export function dossierToDiscordText(view: OpponentDossierView): string {
  const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r)} %`)
  const lines = [`**${view.opponentName}${view.opponentTag ? ` [${view.opponentTag}]` : ''}**`]
  const d = view.dossier
  if (d?.howTheyPlay) lines.push(d.howTheyPlay)
  if (d && d.suggestedBans.length > 0) lines.push(`Bans: ${d.suggestedBans.join(', ')}`)
  if (d?.gamePlan) lines.push(`Plan: ${d.gamePlan}`)
  for (const p of view.players) {
    const champs = p.topChampions.map((c) => `${c.champion} (${c.games}g, ${pct(c.winRate)})`).join(', ')
    lines.push(`${p.role} ${p.displayName}${p.rank ? ` · ${p.rank}` : ''}: ${champs || '—'}`)
  }
  return lines.join('\n')
}
