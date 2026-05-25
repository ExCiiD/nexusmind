import { describe, it, expect } from 'vitest'
import { extractGameEvents } from '../../electron/main/eventExtractor'

const PLAYER_PUUID = 'puuid-player'

const baseMatch = {
  info: {
    participants: [
      { participantId: 1, puuid: PLAYER_PUUID, championName: 'Renekton', teamId: 100 },
      { participantId: 2, puuid: 'puuid-blue-jg', championName: 'Vi', teamId: 100 },
      { participantId: 6, puuid: 'puuid-red-top', championName: 'Olaf', teamId: 200 },
      { participantId: 7, puuid: 'puuid-red-jg', championName: 'Khazix', teamId: 200 },
    ],
  },
}

function frames(events: any[]) {
  return { info: { frames: [{ events }] } }
}

describe('extractGameEvents', () => {
  it('returns [] when timeline data is missing', () => {
    expect(extractGameEvents('not-json', JSON.stringify(baseMatch), PLAYER_PUUID)).toEqual([])
    expect(extractGameEvents({}, {}, PLAYER_PUUID)).toEqual([])
  })

  it('returns [] when player puuid not in match', () => {
    const tl = frames([{ type: 'CHAMPION_KILL', timestamp: 1000, killerId: 1, victimId: 6 }])
    const res = extractGameEvents(tl, baseMatch, 'unknown-puuid')
    expect(res).toEqual([])
  })

  it('extracts player kills with victim name', () => {
    const tl = frames([
      { type: 'CHAMPION_KILL', timestamp: 60_000, killerId: 1, victimId: 6 },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toHaveLength(1)
    expect(res[0].type).toBe('kill')
    expect(res[0].label).toContain('Olaf')
    expect(res[0].gameTimeMs).toBe(60_000)
    expect(res[0].isPlayer).toBe(true)
  })

  it('extracts player deaths', () => {
    const tl = frames([
      { type: 'CHAMPION_KILL', timestamp: 30_000, killerId: 6, victimId: 1 },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toHaveLength(1)
    expect(res[0].type).toBe('death')
    expect(res[0].label).toContain('Olaf')
  })

  it('extracts player assists', () => {
    const tl = frames([
      { type: 'CHAMPION_KILL', timestamp: 45_000, killerId: 2, victimId: 6, assistingParticipantIds: [1] },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toHaveLength(1)
    expect(res[0].type).toBe('assist')
  })

  it('drops champion kills where the player is not involved', () => {
    const tl = frames([
      { type: 'CHAMPION_KILL', timestamp: 10_000, killerId: 2, victimId: 6 }, // blue jg kills red top
      { type: 'CHAMPION_KILL', timestamp: 20_000, killerId: 7, victimId: 2 }, // red jg kills blue jg
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toEqual([])
  })

  it('extracts elite monsters (dragon, baron, herald, voidgrubs, atakhan)', () => {
    const tl = frames([
      { type: 'ELITE_MONSTER_KILL', timestamp: 300_000, monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON', killerId: 2 },
      { type: 'ELITE_MONSTER_KILL', timestamp: 1_500_000, monsterType: 'BARON_NASHOR', killerId: 1 },
      { type: 'ELITE_MONSTER_KILL', timestamp: 480_000, monsterType: 'RIFTHERALD', killerId: 2 },
      { type: 'ELITE_MONSTER_KILL', timestamp: 360_000, monsterType: 'HORDE', killerId: 2 },
      { type: 'ELITE_MONSTER_KILL', timestamp: 2_400_000, monsterType: 'ATAKHAN', killerId: 1 },
      { type: 'ELITE_MONSTER_KILL', timestamp: 9_999, monsterType: 'UNKNOWN_BOSS', killerId: 1 }, // ignored
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res.map((e) => e.type).sort()).toEqual(['atakhan', 'baron', 'dragon', 'herald', 'voidgrub'])
    const dragon = res.find((e) => e.type === 'dragon')
    expect(dragon?.label).toContain('Infernal')
  })

  it('extracts turret kills (TOWER_BUILDING)', () => {
    const tl = frames([
      { type: 'BUILDING_KILL', timestamp: 600_000, buildingType: 'TOWER_BUILDING', towerType: 'OUTER_TURRET', laneType: 'TOP_LANE', killerId: 1 },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toHaveLength(1)
    expect(res[0].type).toBe('turret')
    expect(res[0].isPlayer).toBe(true)
  })

  it('extracts inhibitor kills', () => {
    const tl = frames([
      { type: 'BUILDING_KILL', timestamp: 1_800_000, buildingType: 'INHIBITOR_BUILDING', laneType: 'MID_LANE', killerId: 1 },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res[0].type).toBe('inhibitor')
  })

  it('only includes plates involving the player', () => {
    const tl = frames([
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 500_000, killerId: 1 },
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 510_000, killerId: 2 }, // teammate, no player
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 520_000, killerId: 6, assistingParticipantIds: [1] },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toHaveLength(2)
    expect(res[0].type).toBe('plate')
    expect(res[1].type).toBe('plate')
  })

  it('sorts events by gameTimeMs ascending', () => {
    const tl = frames([
      { type: 'CHAMPION_KILL', timestamp: 60_000, killerId: 1, victimId: 6 },
      { type: 'CHAMPION_KILL', timestamp: 30_000, killerId: 6, victimId: 1 },
      { type: 'ELITE_MONSTER_KILL', timestamp: 45_000, monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON', killerId: 2 },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res.map((e) => e.gameTimeMs)).toEqual([30_000, 45_000, 60_000])
  })

  it('accepts JSON strings and already-parsed objects interchangeably', () => {
    const tl = frames([{ type: 'CHAMPION_KILL', timestamp: 1000, killerId: 1, victimId: 6 }])
    const a = extractGameEvents(JSON.stringify(tl), JSON.stringify(baseMatch), PLAYER_PUUID)
    const b = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(a).toEqual(b)
  })
})
