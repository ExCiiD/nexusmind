/**
 * Game event extraction from Riot Match-Timeline-V5 data.
 *
 * Extracts a compact list of "interesting" events for video player markers:
 *   - All ELITE_MONSTER_KILL (dragon, baron, herald, voidgrubs, atakhan)
 *   - All BUILDING_KILL involving the player (turrets, inhibitors)
 *   - TURRET_PLATE_DESTROYED involving the player
 *   - CHAMPION_KILL where the player is killer / victim / assistant
 *
 * Target size: ~30-80 events per game (vs 150-400 raw). Designed to be sent
 * over IPC and rendered as ~80 DOM nodes max on the timeline — perf-friendly.
 *
 * Pure function, no IO. Designed for unit testing with fixture JSON.
 */

export type GameEventType =
  | 'kill'
  | 'death'
  | 'assist'
  | 'dragon'
  | 'baron'
  | 'voidgrub'
  | 'herald'
  | 'atakhan'
  | 'turret'
  | 'inhibitor'
  | 'plate'

export interface GameEvent {
  type: GameEventType
  /** Optional sub-type, e.g. 'INFERNAL' for a dragon, 'OUTER' for a turret. */
  subType?: string
  /** Time since game start, in milliseconds (matches timeline `timestamp`). */
  gameTimeMs: number
  /** Human-readable label, ex: "Drake (Infernal)", "Kill Renekton". */
  label: string
  teamId?: 100 | 200
  /** True if the player was directly involved (kill/death/assist/last hit). */
  isPlayer: boolean
}

interface RawTimelineEvent {
  type?: string
  timestamp?: number
  killerId?: number
  victimId?: number
  assistingParticipantIds?: number[]
  /** Set by Riot on some objective kills (elite monsters in particular). */
  participantId?: number
  monsterType?: string
  monsterSubType?: string
  buildingType?: string
  towerType?: string
  laneType?: string
  killerTeamId?: number
}

interface ParticipantInfo {
  participantId: number
  puuid: string
  championName: string
  teamId: 100 | 200
}

const DRAGON_LABELS: Record<string, string> = {
  AIR_DRAGON: 'Cloud',
  EARTH_DRAGON: 'Mountain',
  FIRE_DRAGON: 'Infernal',
  WATER_DRAGON: 'Ocean',
  HEXTECH_DRAGON: 'Hextech',
  CHEMTECH_DRAGON: 'Chemtech',
  ELDER_DRAGON: 'Elder',
}

function dragonLabel(subType?: string): string {
  if (!subType) return 'Dragon'
  return `Dragon (${DRAGON_LABELS[subType] ?? subType.replace(/_DRAGON$/, '').toLowerCase()})`
}

function eliteMonsterEvent(e: RawTimelineEvent, participants: ParticipantInfo[], playerPid: number): GameEvent | null {
  const ts = e.timestamp ?? 0
  // Riot inconsistently exposes the killer: most events use `killerId`,
  // but some objective events use `participantId` instead. Check both.
  const killerId = e.killerId ?? e.participantId
  const killer = killerId ? participants.find((p) => p.participantId === killerId) : undefined
  const teamId = killer?.teamId ?? (e.killerTeamId === 100 || e.killerTeamId === 200 ? (e.killerTeamId as 100 | 200) : undefined)

  // Compute `isPlayer` but DON'T filter — the renderer needs every elite
  // monster so the user can toggle between "Mine only" / "All" /
  // "Objectives" views without re-fetching.
  const involved = [killerId, ...(e.assistingParticipantIds ?? [])].filter((v): v is number => typeof v === 'number')
  const isPlayer = involved.includes(playerPid)

  switch (e.monsterType) {
    case 'DRAGON':
      return {
        type: 'dragon',
        subType: e.monsterSubType,
        gameTimeMs: ts,
        label: dragonLabel(e.monsterSubType),
        teamId,
        isPlayer,
      }
    case 'BARON_NASHOR':
      return { type: 'baron', gameTimeMs: ts, label: 'Baron Nashor', teamId, isPlayer }
    case 'RIFTHERALD':
      return { type: 'herald', gameTimeMs: ts, label: 'Rift Herald', teamId, isPlayer }
    case 'HORDE':
      // Riot's name for voidgrubs (added in 2024).
      return { type: 'voidgrub', gameTimeMs: ts, label: 'Voidgrub', teamId, isPlayer }
    case 'ATAKHAN':
      return { type: 'atakhan', gameTimeMs: ts, label: 'Atakhan', teamId, isPlayer }
    default:
      // Unknown monster type — skip rather than render a confusing marker.
      return null
  }
}

function buildingEvent(e: RawTimelineEvent, participants: ParticipantInfo[], playerPid: number): GameEvent | null {
  const ts = e.timestamp ?? 0
  const killer = e.killerId ? participants.find((p) => p.participantId === e.killerId) : undefined
  const teamId = killer?.teamId
  // Compute involvement flag but don't filter — needed for filter modes.
  // Minion-killed towers (killerId === 0) keep isPlayer=false naturally.
  const involved = [e.killerId, ...(e.assistingParticipantIds ?? [])].filter((v): v is number => typeof v === 'number')
  const isPlayer = involved.includes(playerPid)

  if (e.buildingType === 'TOWER_BUILDING') {
    const lane = e.laneType ? e.laneType.replace(/_LANE$/, '').toLowerCase() : ''
    const tier = e.towerType ? e.towerType.replace(/_TURRET$/, '').toLowerCase() : ''
    return {
      type: 'turret',
      subType: e.towerType,
      gameTimeMs: ts,
      label: `Turret${tier ? ` (${tier}${lane ? ` ${lane}` : ''})` : ''}`,
      teamId,
      isPlayer,
    }
  }
  if (e.buildingType === 'INHIBITOR_BUILDING') {
    const lane = e.laneType ? e.laneType.replace(/_LANE$/, '').toLowerCase() : ''
    return {
      type: 'inhibitor',
      gameTimeMs: ts,
      label: `Inhibitor${lane ? ` (${lane})` : ''}`,
      teamId,
      isPlayer,
    }
  }
  return null
}

function plateEvent(e: RawTimelineEvent, participants: ParticipantInfo[], playerPid: number): GameEvent | null {
  const ts = e.timestamp ?? 0
  const involved = [e.killerId, ...(e.assistingParticipantIds ?? [])].filter((v): v is number => typeof v === 'number')
  const isPlayer = involved.includes(playerPid)
  const killer = participants.find((p) => p.participantId === e.killerId)
  const lane = e.laneType ? e.laneType.replace(/_LANE$/, '').toLowerCase() : ''
  return {
    type: 'plate',
    gameTimeMs: ts,
    label: `Plate${lane ? ` (${lane})` : ''}`,
    teamId: killer?.teamId,
    isPlayer,
  }
}

function championKillEvent(e: RawTimelineEvent, participants: ParticipantInfo[], playerPid: number): GameEvent | null {
  const ts = e.timestamp ?? 0
  const killer = e.killerId ? participants.find((p) => p.participantId === e.killerId) : undefined
  const victim = e.victimId ? participants.find((p) => p.participantId === e.victimId) : undefined
  const assists = e.assistingParticipantIds ?? []

  const isKiller = e.killerId === playerPid
  const isVictim = e.victimId === playerPid
  const isAssist = assists.includes(playerPid)
  const isPlayer = isKiller || isVictim || isAssist

  // Player-involved → classify as kill/death/assist with their POV.
  if (isVictim) {
    return {
      type: 'death',
      gameTimeMs: ts,
      label: killer ? `Death — killed by ${killer.championName}` : 'Death',
      teamId: victim?.teamId,
      isPlayer: true,
    }
  }
  if (isKiller) {
    return {
      type: 'kill',
      gameTimeMs: ts,
      label: victim ? `Kill — ${victim.championName}` : 'Kill',
      teamId: killer?.teamId,
      isPlayer: true,
    }
  }
  if (isAssist) {
    return {
      type: 'assist',
      gameTimeMs: ts,
      label: victim ? `Assist on ${victim.championName}` : 'Assist',
      teamId: killer?.teamId,
      isPlayer: true,
    }
  }
  // Not involved at all — emit it as a generic 'kill' (from the killer's
  // POV) so the "All events" filter can show team-fight context. The
  // renderer hides these unless the filter mode is "All".
  return {
    type: 'kill',
    gameTimeMs: ts,
    label: killer && victim ? `${killer.championName} → ${victim.championName}` : 'Kill',
    teamId: killer?.teamId,
    isPlayer: false,
  }
}

/**
 * Player selector — describes the participant we want to extract events for.
 *
 * Selection priority:
 *   1. `puuids` — explicit puuid match (works when the LoL account is linked
 *      to Ascend, or when we previously cached the puuid on the Game row).
 *   2. `championName` (+ optional `win`) — fallback for replays from accounts
 *      that aren't linked to Ascend. The local Live Client API gives us
 *      the champion the user played, which uniquely identifies the
 *      participant in 99% of cases (a champion can't be picked twice in a
 *      draft). `win` disambiguates the rare mirror-pick case (e.g. one-for-all
 *      or a custom game with mirrored champs across teams).
 *
 * This is exactly the strategy Insight Capture / Outplayed use: they don't
 * require an account login because they trust the local client to tell them
 * which player you are.
 */
export interface PlayerSelector {
  /** Preferred — list of puuids that COULD match the player (user + linked accounts). */
  puuids?: string[]
  /** Fallback — champion name (Riot format, e.g. "Aatrox") played by the user. */
  championName?: string
  /** Tiebreaker for the rare mirror-pick case. */
  win?: boolean
}

/**
 * Resolve the player's participantId from the match's participants list,
 * trying each strategy in PlayerSelector. Returns null if nothing matches.
 */
function resolvePlayer(
  participants: ParticipantInfo[],
  match: any,
  selector: PlayerSelector,
): ParticipantInfo | null {
  // 1) puuid match (best)
  if (selector.puuids?.length) {
    const set = new Set(selector.puuids)
    const hit = participants.find((p) => p.puuid && set.has(p.puuid))
    if (hit) return hit
  }
  // 2) champion match — handles unlinked-account replays
  if (selector.championName) {
    const champ = selector.championName.toLowerCase()
    const sameChamp = participants.filter((p) => p.championName?.toLowerCase() === champ)
    if (sameChamp.length === 1) return sameChamp[0]
    // Mirror picks: disambiguate by win/loss when we know it.
    if (sameChamp.length > 1 && typeof selector.win === 'boolean') {
      const teams = match?.info?.teams ?? []
      const winningTeamId = teams.find((t: any) => t.win === true)?.teamId
      if (winningTeamId) {
        const playerTeamId = selector.win ? winningTeamId : winningTeamId === 100 ? 200 : 100
        const onWinSide = sameChamp.find((p) => p.teamId === playerTeamId)
        if (onWinSide) return onWinSide
      }
      // Last resort: return the first one — better than no markers at all.
      return sameChamp[0]
    }
  }
  return null
}

/**
 * Main extractor. Returns events sorted by gameTimeMs.
 *
 * Inputs are accepted as JSON strings (so the caller doesn't have to parse
 * the cached blob) or already-parsed objects. Returns [] on missing data
 * rather than throwing — callers usually treat events as best-effort.
 *
 * Backwards-compatible overload: passing a plain string is treated as a
 * single puuid (the legacy behavior). Prefer passing a {@link PlayerSelector}.
 */
export function extractGameEvents(
  timelineJson: string | object,
  matchJson: string | object,
  selector: string | PlayerSelector,
): GameEvent[] {
  let timeline: any
  let match: any
  try {
    timeline = typeof timelineJson === 'string' ? JSON.parse(timelineJson) : timelineJson
    match = typeof matchJson === 'string' ? JSON.parse(matchJson) : matchJson
  } catch {
    return []
  }

  if (!timeline?.info?.frames || !match?.info?.participants) return []

  const participants: ParticipantInfo[] = match.info.participants.map((p: any) => ({
    participantId: p.participantId,
    puuid: p.puuid,
    championName: p.championName,
    teamId: p.teamId,
  }))

  const normalizedSelector: PlayerSelector =
    typeof selector === 'string' ? { puuids: [selector] } : selector
  const player = resolvePlayer(participants, match, normalizedSelector)
  if (!player) return []
  const playerPid = player.participantId

  const events: GameEvent[] = []
  for (const frame of timeline.info.frames) {
    for (const ev of (frame.events ?? []) as RawTimelineEvent[]) {
      let out: GameEvent | null = null
      switch (ev.type) {
        case 'ELITE_MONSTER_KILL':
          out = eliteMonsterEvent(ev, participants, playerPid)
          break
        case 'BUILDING_KILL':
          out = buildingEvent(ev, participants, playerPid)
          break
        case 'TURRET_PLATE_DESTROYED':
          out = plateEvent(ev, participants, playerPid)
          break
        case 'CHAMPION_KILL':
          out = championKillEvent(ev, participants, playerPid)
          break
      }
      if (out) events.push(out)
    }
  }

  events.sort((a, b) => a.gameTimeMs - b.gameTimeMs)
  return events
}
