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
  const killer = e.killerId ? participants.find((p) => p.participantId === e.killerId) : undefined
  const teamId = killer?.teamId ?? (e.killerTeamId === 100 || e.killerTeamId === 200 ? (e.killerTeamId as 100 | 200) : undefined)
  const isPlayer = e.killerId === playerPid

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
  const isPlayer = e.killerId === playerPid || (e.assistingParticipantIds ?? []).includes(playerPid)

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
  // Only include plate events where the PLAYER is involved (otherwise we'd
  // double the marker count for nothing actionable from a review POV).
  if (!involved.includes(playerPid)) return null
  const killer = participants.find((p) => p.participantId === e.killerId)
  const lane = e.laneType ? e.laneType.replace(/_LANE$/, '').toLowerCase() : ''
  return {
    type: 'plate',
    gameTimeMs: ts,
    label: `Plate${lane ? ` (${lane})` : ''}`,
    teamId: killer?.teamId,
    isPlayer: true,
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
  // Only keep CHAMPION_KILL where the player is involved — otherwise we'd
  // emit 30+ kill markers per game for no actionable purpose.
  if (!isKiller && !isVictim && !isAssist) return null

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
  return {
    type: 'assist',
    gameTimeMs: ts,
    label: victim ? `Assist on ${victim.championName}` : 'Assist',
    teamId: killer?.teamId,
    isPlayer: true,
  }
}

/**
 * Main extractor. Returns events sorted by gameTimeMs.
 *
 * Inputs are accepted as JSON strings (so the caller doesn't have to parse
 * the cached blob) or already-parsed objects. Returns [] on missing data
 * rather than throwing — callers usually treat events as best-effort.
 */
export function extractGameEvents(
  timelineJson: string | object,
  matchJson: string | object,
  playerPuuid: string,
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

  const player = participants.find((p) => p.puuid === playerPuuid)
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
