/**
 * #40 § 10 (docs/DESIGN_STATE.md): a team game's objectives and gold curve, read from its match-v5 timeline, and the
 * averages of the Objectives tab. Pure, shared by the desktop and the web (the platform fetches the match and the
 * timeline, this does the rest), so both show the same numbers. Also meant for features 4, 7 and 8 of
 * docs/PROPOSITION_ANALYSTE.md.
 *
 * Unlike electron/main/eventExtractor.ts (one player's events), everything here is per TEAM: an objective is ours when
 * the killer's team is our side (killerTeamId, else the killer's participant team).
 */
import type {
  ObjectiveKind, TeamGameSource, TeamGameTimeline, TeamObjectivesFilters, TeamObjectivesSummary, TeamSide, TeamTimelineEvent,
} from './analyst'

/** Bump when the extraction changes: summaries cached with an older version are extracted again. */
export const TEAM_TIMELINE_VERSION = 1
/** Minutes of the gold curve (0..30). */
export const GOLD_CURVE_MINUTES = 30
/** Under this many games the tiles are shown dimmed (§ 10). */
export const LOW_SAMPLE_GAMES = 5

export interface ExtractMeta {
  gameId: string
  matchId: string
  source: TeamGameSource
  /** Our side: 100 = blue, 200 = red. */
  ourTeamId: 100 | 200
  opponentName: string | null
}

const DRAGON_SUBTYPES: Record<string, string> = {
  FIRE_DRAGON: 'FIRE', WATER_DRAGON: 'WATER', EARTH_DRAGON: 'EARTH', AIR_DRAGON: 'AIR', HEXTECH_DRAGON: 'HEXTECH', CHEMTECH_DRAGON: 'CHEMTECH',
}

const sideOf = (teamId: 100 | 200): TeamSide => (teamId === 100 ? 'blue' : 'red')

/** "16.22" from "16.22.734.1234"; '' when unknown. */
export function patchOf(gameVersion: unknown): string {
  const parts = String(gameVersion ?? '').split('.')
  return parts.length >= 2 && parts[0] && parts[1] ? `${parts[0]}.${parts[1]}` : ''
}

/**
 * Void Grubs a game offers: one camp of 3 at 8:00, without a respawn (docs/DONNEES_JEU_2026.md). On the cached games:
 * 2.93 taken per game.
 */
export const GRUBS_PER_GAME = 3

/**
 * A game reduced to the Objectives tab's needs. `timeline` is the match-v5 timeline (frames of one minute), `match`
 * the match itself. Returns null when the timeline has no frames.
 */
export function extractTeamTimeline(match: any, timeline: any, meta: ExtractMeta): TeamGameTimeline | null {
  const frames: any[] = timeline?.info?.frames ?? []
  if (frames.length === 0) return null
  const info = match?.info ?? {}
  const participants: any[] = info.participants ?? []
  const teamOfParticipant = new Map<number, number>()
  for (const p of participants) if (typeof p.participantId === 'number') teamOfParticipant.set(p.participantId, p.teamId)
  // Timelines list participants too; fall back to 1-5 blue, 6-10 red.
  const teamOf = (pid: number | undefined): number | null => {
    if (!pid) return null
    return teamOfParticipant.get(pid) ?? (pid >= 1 && pid <= 5 ? 100 : pid >= 6 && pid <= 10 ? 200 : null)
  }
  const us = meta.ourTeamId

  const events: TeamTimelineEvent[] = []
  let firstBloodSeen = false
  for (const frame of frames) {
    for (const e of frame.events ?? []) {
      const atSec = Math.round((e.timestamp ?? 0) / 1000)
      if (e.type === 'ELITE_MONSTER_KILL') {
        const team = e.killerTeamId ?? teamOf(e.killerId)
        if (team !== 100 && team !== 200) continue
        const ours = team === us
        switch (e.monsterType) {
          case 'DRAGON':
            if (e.monsterSubType === 'ELDER_DRAGON') events.push({ kind: 'elder', atSec, ours })
            else events.push({ kind: 'dragon', atSec, ours, subType: DRAGON_SUBTYPES[e.monsterSubType] ?? e.monsterSubType })
            break
          case 'BARON_NASHOR': events.push({ kind: 'baron', atSec, ours }); break
          case 'RIFTHERALD': events.push({ kind: 'herald', atSec, ours }); break
          case 'HORDE': {
            // One event per grub: kills of the same team within 30 s are one take of the camp.
            const last = [...events].reverse().find((x) => x.kind === 'grubs')
            if (last && last.ours === ours && atSec - last.atSec <= 30) last.count = (last.count ?? 1) + 1
            else events.push({ kind: 'grubs', atSec, ours, count: 1 })
            break
          }
        }
      } else if (e.type === 'BUILDING_KILL' && e.buildingType === 'TOWER_BUILDING') {
        // teamId is the team that LOST the tower.
        if (e.teamId !== 100 && e.teamId !== 200) continue
        const lane = String(e.laneType ?? '').replace(/_LANE$/, '') as 'TOP' | 'MID' | 'BOT'
        events.push({
          kind: 'tower', atSec, ours: e.teamId !== us,
          subType: String(e.towerType ?? '').replace(/_TURRET$/, '') || undefined,
          ...(lane === 'TOP' || lane === 'MID' || lane === 'BOT' ? { lane } : {}),
        })
      } else if (e.type === 'CHAMPION_KILL' && !firstBloodSeen) {
        const victimTeam = teamOf(e.victimId)
        if (victimTeam !== 100 && victimTeam !== 200) continue
        firstBloodSeen = true
        // An execution (killerId 0) still gives first blood to the victim's enemies.
        events.push({ kind: 'firstBlood', atSec, ours: victimTeam !== us })
      }
    }
  }
  events.sort((a, b) => a.atSec - b.atSec)

  const goldDiffByMinute = frames.map((frame) => {
    let ours = 0
    let theirs = 0
    for (const [pid, pf] of Object.entries<any>(frame.participantFrames ?? {})) {
      const team = teamOf(Number(pid))
      if (team === us) ours += pf?.totalGold ?? 0
      else if (team) theirs += pf?.totalGold ?? 0
    }
    return ours - theirs
  })

  const ourTeam = (info.teams ?? []).find((t: any) => t.teamId === us)
  const start = info.gameStartTimestamp ?? info.gameCreation
  return {
    version: TEAM_TIMELINE_VERSION,
    gameId: meta.gameId,
    matchId: meta.matchId,
    playedAt: typeof start === 'number' ? new Date(start).toISOString() : new Date(0).toISOString(),
    durationSec: Number(info.gameDuration ?? 0),
    source: meta.source,
    side: sideOf(us),
    win: !!(ourTeam?.win ?? participants.find((p) => p.teamId === us)?.win),
    opponentName: meta.opponentName,
    patch: patchOf(info.gameVersion),
    grubsAvailable: GRUBS_PER_GAME,
    events,
    goldDiffByMinute,
  }
}

/** A cached summary still valid for this code (else it is extracted again). */
export function isCurrentTimeline(v: unknown): v is TeamGameTimeline {
  return !!v && typeof v === 'object' && (v as TeamGameTimeline).version === TEAM_TIMELINE_VERSION
    && Array.isArray((v as TeamGameTimeline).events) && Array.isArray((v as TeamGameTimeline).goldDiffByMinute)
}

/** The games the filters keep (dates inclusive, by day). */
export function filterTeamTimelines(games: TeamGameTimeline[], f: TeamObjectivesFilters): TeamGameTimeline[] {
  const from = f.from ? Date.parse(f.from.slice(0, 10)) : -Infinity
  const to = f.to ? Date.parse(f.to.slice(0, 10)) + 86_400_000 - 1 : Infinity
  return games.filter((g) => {
    const t = Date.parse(g.playedAt)
    return t >= from && t <= to && f.sources.includes(g.source) && (f.side === 'both' || g.side === f.side)
  })
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const share = (hits: number, total: number): number | null => (total ? hits / total : null)
const firstOf = (g: TeamGameTimeline, kind: ObjectiveKind) => g.events.find((e) => e.kind === kind)

/** Everything the Objectives tab shows, for the games the filters keep. */
export function summarizeTeamObjectives(all: TeamGameTimeline[], filters: TeamObjectivesFilters): TeamObjectivesSummary {
  const games = filterTeamTimelines(all, filters).sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt))
  const n = games.length

  const patches = new Map<string, number>()
  for (const g of games) if (g.patch) patches.set(g.patch, (patches.get(g.patch) ?? 0) + 1)
  const patch = [...patches.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null

  // Dragons (elemental only), soul = 4 elemental dragons for one team.
  let dragonsOurs = 0, dragonsAll = 0, firstDragonOurs = 0, firstDragonGames = 0, soulsOurs = 0, soulGames = 0
  // Grubs
  const grubsTaken: number[] = []
  let firstCampOurs = 0, firstCampGames = 0, grubsAvailable = 0
  // Herald, Baron, first blood, first tower
  let heraldOurs = 0, heraldGames = 0
  const heraldTimes: number[] = []
  let baronOurs = 0, baronGames = 0, baronWins = 0, baronOursGames = 0
  let fbOurs = 0, fbGames = 0
  const fbTimes: number[] = []
  let ftOurs = 0, ftGames = 0
  const ftTimes: number[] = []
  const ftLanes = new Map<string, number>()

  for (const g of games) {
    const dragons = g.events.filter((e) => e.kind === 'dragon')
    dragonsAll += dragons.length
    dragonsOurs += dragons.filter((e) => e.ours).length
    if (dragons[0]) { firstDragonGames++; if (dragons[0].ours) firstDragonOurs++ }
    const ours = dragons.filter((e) => e.ours).length
    const theirs = dragons.length - ours
    if (ours >= 4 || theirs >= 4) { soulGames++; if (ours >= 4) soulsOurs++ }

    const grubs = g.events.filter((e) => e.kind === 'grubs')
    grubsTaken.push(grubs.filter((e) => e.ours).reduce((s, e) => s + (e.count ?? 1), 0))
    grubsAvailable = Math.max(grubsAvailable, g.grubsAvailable)
    if (grubs[0]) { firstCampGames++; if (grubs[0].ours) firstCampOurs++ }

    const herald = firstOf(g, 'herald')
    if (herald) { heraldGames++; if (herald.ours) { heraldOurs++; heraldTimes.push(herald.atSec) } }

    const barons = g.events.filter((e) => e.kind === 'baron')
    if (barons.length) {
      baronGames++
      if (barons.some((e) => e.ours)) { baronOurs++; baronOursGames++; if (g.win) baronWins++ }
    }

    const fb = firstOf(g, 'firstBlood')
    if (fb) { fbGames++; if (fb.ours) { fbOurs++; fbTimes.push(fb.atSec) } }

    const ft = firstOf(g, 'tower')
    if (ft) {
      ftGames++
      if (ft.ours) { ftOurs++; ftTimes.push(ft.atSec); if (ft.lane) ftLanes.set(ft.lane, (ftLanes.get(ft.lane) ?? 0) + 1) }
    }
  }

  const curve = (subset: TeamGameTimeline[]) =>
    Array.from({ length: GOLD_CURVE_MINUTES + 1 }, (_, m) => avg(subset.filter((g) => g.goldDiffByMinute.length > m).map((g) => g.goldDiffByMinute[m])))

  const KINDS: ObjectiveKind[] = ['firstBlood', 'tower', 'dragon', 'grubs', 'herald', 'baron', 'elder']
  const avgTimings = KINDS.map((kind) => {
    const firsts = games.map((g) => firstOf(g, kind)).filter((e): e is TeamTimelineEvent => !!e)
    return {
      kind,
      oursSec: avg(firsts.filter((e) => e.ours).map((e) => e.atSec)),
      theirsSec: avg(firsts.filter((e) => !e.ours).map((e) => e.atSec)),
    }
  }).filter((t) => t.oursSec !== null || t.theirsSec !== null)

  const mostLane = ([...ftLanes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) as 'TOP' | 'MID' | 'BOT' | null

  return {
    games: n,
    patch,
    lowSample: n < LOW_SAMPLE_GAMES,
    tiles: {
      dragons: { share: share(dragonsOurs, dragonsAll), firstDragonShare: share(firstDragonOurs, firstDragonGames), soulsOurs, soulGames },
      grubs: { avgTaken: avg(grubsTaken), available: grubsAvailable || GRUBS_PER_GAME, firstCampShare: share(firstCampOurs, firstCampGames) },
      herald: { share: share(heraldOurs, heraldGames), avgAtSec: avg(heraldTimes) },
      baron: { share: share(baronOurs, baronGames), baronToWinShare: share(baronWins, baronOursGames) },
      firstBlood: { share: share(fbOurs, fbGames), avgAtSec: avg(fbTimes) },
      firstTower: { share: share(ftOurs, ftGames), avgAtSec: avg(ftTimes), mostLane },
    },
    goldCurve: { all: curve(games), blue: curve(games.filter((g) => g.side === 'blue')), red: curve(games.filter((g) => g.side === 'red')) },
    timeline: games,
    avgTimings,
  }
}
