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

  it('emits champion kills NOT involving the player with isPlayer=false (for filter modes)', () => {
    const tl = frames([
      { type: 'CHAMPION_KILL', timestamp: 10_000, killerId: 2, victimId: 6 }, // blue jg kills red top
      { type: 'CHAMPION_KILL', timestamp: 20_000, killerId: 7, victimId: 2 }, // red jg kills blue jg
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toHaveLength(2)
    expect(res.every((e) => e.isPlayer === false)).toBe(true)
    expect(res[0].label).toContain('Vi')
    expect(res[0].label).toContain('Olaf')
  })

  it('emits ALL elite monsters with isPlayer reflecting involvement (filter is renderer-side)', () => {
    const tl = frames([
      { type: 'ELITE_MONSTER_KILL', timestamp: 1_500_000, monsterType: 'BARON_NASHOR', killerId: 1 },
      { type: 'ELITE_MONSTER_KILL', timestamp: 300_000, monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON', killerId: 2, assistingParticipantIds: [1] },
      { type: 'ELITE_MONSTER_KILL', timestamp: 2_400_000, monsterType: 'ATAKHAN', killerId: 1 },
      // Teammate took these — emitted but isPlayer=false
      { type: 'ELITE_MONSTER_KILL', timestamp: 480_000, monsterType: 'RIFTHERALD', killerId: 2 },
      { type: 'ELITE_MONSTER_KILL', timestamp: 360_000, monsterType: 'HORDE', killerId: 2 },
      // Unknown monster: skipped (no type mapping)
      { type: 'ELITE_MONSTER_KILL', timestamp: 9_999, monsterType: 'UNKNOWN_BOSS', killerId: 1 },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res.map((e) => e.type).sort()).toEqual(['atakhan', 'baron', 'dragon', 'herald', 'voidgrub'])
    const baron = res.find((e) => e.type === 'baron')!
    expect(baron.isPlayer).toBe(true)
    const dragon = res.find((e) => e.type === 'dragon')!
    expect(dragon.label).toContain('Infernal')
    expect(dragon.isPlayer).toBe(true)
    const herald = res.find((e) => e.type === 'herald')!
    expect(herald.isPlayer).toBe(false)
    const voidgrub = res.find((e) => e.type === 'voidgrub')!
    expect(voidgrub.isPlayer).toBe(false)
  })

  it('also accepts elite monsters with `participantId` instead of `killerId`', () => {
    const tl = frames([
      { type: 'ELITE_MONSTER_KILL', timestamp: 300_000, monsterType: 'DRAGON', monsterSubType: 'WATER_DRAGON', participantId: 1 },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toHaveLength(1)
    expect(res[0].type).toBe('dragon')
  })

  it('emits all turret kills with isPlayer flag (renderer filters)', () => {
    const tl = frames([
      { type: 'BUILDING_KILL', timestamp: 600_000, buildingType: 'TOWER_BUILDING', towerType: 'OUTER_TURRET', laneType: 'TOP_LANE', killerId: 1 },
      { type: 'BUILDING_KILL', timestamp: 700_000, buildingType: 'TOWER_BUILDING', killerId: 0 }, // minion-killed
      { type: 'BUILDING_KILL', timestamp: 800_000, buildingType: 'TOWER_BUILDING', killerId: 2 }, // teammate
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toHaveLength(3)
    expect(res.every((e) => e.type === 'turret')).toBe(true)
    expect(res[0].isPlayer).toBe(true)
    expect(res[1].isPlayer).toBe(false)
    expect(res[2].isPlayer).toBe(false)
  })

  it('emits all inhibitor kills with isPlayer flag', () => {
    const tl = frames([
      { type: 'BUILDING_KILL', timestamp: 1_800_000, buildingType: 'INHIBITOR_BUILDING', laneType: 'MID_LANE', killerId: 1 },
      { type: 'BUILDING_KILL', timestamp: 1_900_000, buildingType: 'INHIBITOR_BUILDING', killerId: 2 },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toHaveLength(2)
    expect(res[0].isPlayer).toBe(true)
    expect(res[1].isPlayer).toBe(false)
  })

  it('emits all plates with isPlayer flag', () => {
    const tl = frames([
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 500_000, killerId: 1 },
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 510_000, killerId: 2 }, // teammate, not player
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 520_000, killerId: 6, assistingParticipantIds: [1] },
    ])
    const res = extractGameEvents(tl, baseMatch, PLAYER_PUUID)
    expect(res).toHaveLength(3)
    expect(res.map((e) => e.isPlayer)).toEqual([true, false, true])
  })

  it('sorts events by gameTimeMs ascending', () => {
    const tl = frames([
      { type: 'CHAMPION_KILL', timestamp: 60_000, killerId: 1, victimId: 6 },
      { type: 'CHAMPION_KILL', timestamp: 30_000, killerId: 6, victimId: 1 },
      { type: 'ELITE_MONSTER_KILL', timestamp: 45_000, monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON', killerId: 2, assistingParticipantIds: [1] },
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

  // ── PlayerSelector fallback (champion match for unlinked accounts) ────────
  describe('PlayerSelector', () => {
    it('still works when given a single puuid string (legacy API)', () => {
      const tl = frames([{ type: 'CHAMPION_KILL', timestamp: 1000, killerId: 1, victimId: 6 }])
      expect(extractGameEvents(tl, baseMatch, PLAYER_PUUID)).toHaveLength(1)
    })

    it('matches via championName when no puuid is provided (unlinked account)', () => {
      const tl = frames([{ type: 'CHAMPION_KILL', timestamp: 1000, killerId: 1, victimId: 6 }])
      const res = extractGameEvents(tl, baseMatch, { championName: 'Renekton' })
      expect(res).toHaveLength(1)
      expect(res[0].type).toBe('kill')
    })

    it('matches via championName when puuids list misses (e.g. smurf not linked)', () => {
      const tl = frames([{ type: 'CHAMPION_KILL', timestamp: 1000, killerId: 1, victimId: 6 }])
      const res = extractGameEvents(tl, baseMatch, {
        puuids: ['some-other-puuid'],
        championName: 'Renekton',
      })
      expect(res).toHaveLength(1)
    })

    it('prefers puuid over champion when both match', () => {
      // Two participants with the same champ to make sure puuid wins.
      const mirrorMatch = {
        info: {
          participants: [
            { participantId: 1, puuid: PLAYER_PUUID, championName: 'Renekton', teamId: 100 },
            { participantId: 6, puuid: 'puuid-mirror', championName: 'Renekton', teamId: 200 },
          ],
        },
      }
      const tl = frames([{ type: 'CHAMPION_KILL', timestamp: 1000, killerId: 6, victimId: 1 }])
      const res = extractGameEvents(tl, mirrorMatch, {
        puuids: [PLAYER_PUUID],
        championName: 'Renekton',
      })
      expect(res).toHaveLength(1)
      expect(res[0].type).toBe('death')
    })

    it('disambiguates mirror picks by win flag', () => {
      const mirrorMatch = {
        info: {
          participants: [
            { participantId: 1, puuid: 'puuid-a', championName: 'Renekton', teamId: 100 },
            { participantId: 6, puuid: 'puuid-b', championName: 'Renekton', teamId: 200 },
          ],
          teams: [
            { teamId: 100, win: true },
            { teamId: 200, win: false },
          ],
        },
      }
      const tl = frames([{ type: 'CHAMPION_KILL', timestamp: 1000, killerId: 1, victimId: 6 }])
      const wonRes = extractGameEvents(tl, mirrorMatch, { championName: 'Renekton', win: true })
      expect(wonRes[0]?.type).toBe('kill')
      const lostRes = extractGameEvents(tl, mirrorMatch, { championName: 'Renekton', win: false })
      expect(lostRes[0]?.type).toBe('death')
    })

    it('returns [] when no strategy resolves the player', () => {
      const tl = frames([{ type: 'CHAMPION_KILL', timestamp: 1000, killerId: 1, victimId: 6 }])
      expect(extractGameEvents(tl, baseMatch, { championName: 'NonExistent' })).toEqual([])
      expect(extractGameEvents(tl, baseMatch, {})).toEqual([])
    })

    it('champion match is case-insensitive', () => {
      const tl = frames([{ type: 'CHAMPION_KILL', timestamp: 1000, killerId: 1, victimId: 6 }])
      expect(extractGameEvents(tl, baseMatch, { championName: 'reNEkTon' })).toHaveLength(1)
    })
  })
})
