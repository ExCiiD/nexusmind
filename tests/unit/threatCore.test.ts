import { describe, it, expect } from 'vitest'
import {
  assessMemberChampionThreat,
  buildMemberThreatMap,
  buildTeamThreatMap,
  buildPrioPickMap,
  withPrioPicks,
  computeAutoTier,
  tierPool,
  adjustedWinRate,
  type ChampionStat,
  type ThreatPoolMember,
} from '../../src/lib/threatCore'

function stat(partial: Partial<ChampionStat> & { championKey: string; role: string }): ChampionStat {
  return { games: 0, winRate: null, masteryPoints: null, kda: null, ...partial }
}

describe('assessMemberChampionThreat', () => {
  it('flags red on 100+ absolute games', () => {
    const r = assessMemberChampionThreat(stat({ championKey: 'Renekton', role: 'TOP', games: 120 }), { isDominant: false, roleShare: 0.1 })
    expect(r.level).toBe('red')
  })

  it('flags red on a dominant pick with a smaller sample', () => {
    const r = assessMemberChampionThreat(
      stat({ championKey: 'Renekton', role: 'TOP', games: 15 }),
      { isDominant: true, roleShare: 0.4 },
    )
    expect(r.level).toBe('red')
  })

  it('does NOT flag red/orange on a 2-game 100% winrate sample (rate signal gated by min games)', () => {
    const r = assessMemberChampionThreat(
      stat({ championKey: 'Renekton', role: 'TOP', games: 2, winRate: 100 }),
      { isDominant: false, roleShare: 0.1 },
    )
    expect(r.level).toBe('played')
  })

  it('flags red on a high winrate once the 20-game minimum is met', () => {
    const r = assessMemberChampionThreat(
      stat({ championKey: 'Renekton', role: 'TOP', games: 22, winRate: 70 }),
      { isDominant: false, roleShare: 0.1 },
    )
    expect(r.level).toBe('red')
  })

  it('flags red on a high KDA once the 20-game minimum is met', () => {
    const r = assessMemberChampionThreat(
      stat({ championKey: 'Renekton', role: 'TOP', games: 25, kda: 5.2 }),
      { isDominant: false, roleShare: 0.1 },
    )
    expect(r.level).toBe('red')
  })

  it('flags orange on mastery alone, independent of games', () => {
    const r = assessMemberChampionThreat(
      stat({ championKey: 'Renekton', role: 'TOP', games: 0, masteryPoints: 350_000 }),
      { isDominant: false, roleShare: 0 },
    )
    expect(r.level).toBe('orange')
  })

  it('flags "played" for a low-signal champion instead of nothing', () => {
    const r = assessMemberChampionThreat(
      stat({ championKey: 'Renekton', role: 'TOP', games: 3, winRate: 33 }),
      { isDominant: false, roleShare: 0.05 },
    )
    expect(r.level).toBe('played')
  })

  it('reports no threat at all for a champion with zero signal', () => {
    const r = assessMemberChampionThreat(
      stat({ championKey: 'Renekton', role: 'TOP', games: 0 }),
      { isDominant: false, roleShare: 0 },
    )
    expect(r.level).toBeNull()
  })
})

describe('buildMemberThreatMap (role-swap guard)', () => {
  it('ignores pool entries outside the member\'s current role', () => {
    const member: ThreatPoolMember = {
      displayName: 'Faker',
      role: 'SUPPORT',
      champPool: [
        // Stale TOP mastery from before a role swap — must NOT threat-flag.
        stat({ championKey: 'Renekton', role: 'TOP', games: 150, masteryPoints: 400_000 }),
        stat({ championKey: 'Thresh', role: 'SUPPORT', games: 110 }),
      ],
    }
    const map = buildMemberThreatMap(member)
    expect(map.has('Renekton')).toBe(false)
    expect(map.get('Thresh')?.level).toBe('red')
  })
})

describe('buildTeamThreatMap (per-person yellow gate)', () => {
  it('does NOT flag yellow when only one of two players individually clears the bar', () => {
    const team = {
      members: [
        { displayName: 'A', role: 'ADC', champPool: [stat({ championKey: 'Kalista', role: 'ADC', games: 2 })] },
        { displayName: 'B', role: 'ADC', champPool: [stat({ championKey: 'Kalista', role: 'ADC', games: 3 })] },
      ],
    }
    const map = buildTeamThreatMap(team)
    expect(map.get('Kalista')?.level).toBe('played')
  })

  it('flags yellow when 2+ players EACH individually clear the threat bar', () => {
    const team = {
      members: [
        { displayName: 'A', role: 'ADC', champPool: [stat({ championKey: 'Kalista', role: 'ADC', games: 120 })] },
        { displayName: 'B', role: 'ADC', champPool: [stat({ championKey: 'Kalista', role: 'ADC', games: 0, masteryPoints: 310_000 })] },
      ],
    }
    const map = buildTeamThreatMap(team)
    expect(map.get('Kalista')?.level).toBe('yellow')
    expect(map.get('Kalista')?.members).toHaveLength(2)
  })

  it('returns a single red/orange threat (not yellow) for a champion only one player clears', () => {
    const team = {
      members: [
        { displayName: 'A', role: 'ADC', champPool: [stat({ championKey: 'Kalista', role: 'ADC', games: 150 })] },
      ],
    }
    const map = buildTeamThreatMap(team)
    expect(map.get('Kalista')?.level).toBe('red')
  })
})

describe('buildPrioPickMap / withPrioPicks', () => {
  it('flags a champion as prioPick only when it threatens BOTH sides', () => {
    const myTeam = buildTeamThreatMap({
      members: [{ displayName: 'Me', role: 'MID', champPool: [stat({ championKey: 'Azir', role: 'MID', games: 110 })] }],
    })
    const oppTeam = buildTeamThreatMap({
      members: [{ displayName: 'Opp', role: 'MID', champPool: [stat({ championKey: 'Azir', role: 'MID', games: 0, masteryPoints: 400_000 })] }],
    })
    const prio = buildPrioPickMap(myTeam, oppTeam)
    expect(prio.get('Azir')?.level).toBe('prioPick')

    const merged = withPrioPicks(oppTeam, prio)
    expect(merged.get('Azir')?.level).toBe('prioPick')
  })

  it('does not flag prioPick when only one side threatens it', () => {
    const myTeam = buildTeamThreatMap({
      members: [{ displayName: 'Me', role: 'MID', champPool: [stat({ championKey: 'Azir', role: 'MID', games: 2 })] }],
    })
    const oppTeam = buildTeamThreatMap({
      members: [{ displayName: 'Opp', role: 'MID', champPool: [stat({ championKey: 'Azir', role: 'MID', games: 110 })] }],
    })
    const prio = buildPrioPickMap(myTeam, oppTeam)
    expect(prio.size).toBe(0)
  })
})

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 18, 12)

describe('adjustedWinRate', () => {
  it('pulls small samples toward 50 %', () => {
    expect(adjustedWinRate(3, 100)).toBeCloseTo(61.5, 1)
    expect(adjustedWinRate(50, 60)).toBeCloseTo(58.3, 1)
    expect(adjustedWinRate(0, 50)).toBeNull()
    expect(adjustedWinRate(10, null)).toBeNull()
  })
})

describe('computeAutoTier (v2)', () => {
  const base = { games: 0, winRate: null as number | null, masteryPoints: null as number | null, now: NOW }

  describe('new', () => {
    const pick = {
      ...base, games: 12, winRate: 58,
      firstPlayedAt: NOW - 9 * DAY, lastPlayedAt: NOW - DAY, historyFrom: NOW - 40 * DAY, historyTo: NOW - DAY,
    }
    it('makes a champion picked up 9 days ago and played 12 times "new"', () => {
      expect(computeAutoTier(pick)).toBe('new')
    })
    it('needs 10 games', () => {
      expect(computeAutoTier({ ...pick, games: 9 })).not.toBe('new')
    })
    it('stops after 14 days', () => {
      expect(computeAutoTier({ ...pick, firstPlayedAt: NOW - 15 * DAY })).not.toBe('new')
    })
    it('is not new when the first game sits at the very start of the analysed history', () => {
      expect(computeAutoTier({ ...pick, historyFrom: NOW - 10 * DAY })).not.toBe('new')
    })
    it('is not new when lifetime mastery tells an older story (a comeback)', () => {
      expect(computeAutoTier({ ...pick, masteryPoints: 250_000 })).not.toBe('new')
    })
    it('accepts the mastery those games can explain', () => {
      expect(computeAutoTier({ ...pick, masteryPoints: 40_000 })).toBe('new')
    })
    it('can be switched off (shared cloud tables have no "new" tier)', () => {
      expect(computeAutoTier({ ...pick, allowNew: false })).not.toBe('new')
    })
  })

  describe('main', () => {
    it('takes 12+ games in the top 3 of the role', () => {
      expect(computeAutoTier({ ...base, games: 30, winRate: 50, rankInRole: 2, roleShare: 0.12 })).toBe('main')
    })
    it('takes 12+ games making 15 % of the role, outside the top 3', () => {
      expect(computeAutoTier({ ...base, games: 14, winRate: 50, rankInRole: 4, roleShare: 0.16 })).toBe('main')
    })
    it('takes a quarter of a short history (6+ games)', () => {
      expect(computeAutoTier({ ...base, games: 7, winRate: 57, rankInRole: 1, roleShare: 0.35 })).toBe('main')
    })
    it('takes a crushing adjusted win rate over 20+ games', () => {
      expect(computeAutoTier({ ...base, games: 22, winRate: 77, rankInRole: 6, roleShare: 0.05 })).toBe('main')
    })
    it('no longer makes the most-played champion a main on 4 games', () => {
      expect(computeAutoTier({ ...base, games: 4, winRate: 75, rankInRole: 1, roleShare: 0.2 })).not.toBe('main')
    })
    it('no longer makes a main out of lifetime mastery alone (7 games, 43 %, 450k)', () => {
      expect(computeAutoTier({ ...base, games: 7, winRate: 43, masteryPoints: 450_000, rankInRole: 6, roleShare: 0.03 })).toBe('comfort')
    })
    it('keeps the v1 top-5 flag readable as "top 3" for old callers', () => {
      expect(computeAutoTier({ ...base, games: 15, winRate: 50, isTop5InRole: true })).toBe('main')
    })
  })

  describe('comfort', () => {
    it('takes 8+ games at an adjusted 50 %', () => {
      expect(computeAutoTier({ ...base, games: 9, winRate: 56, rankInRole: 5, roleShare: 0.06 })).toBe('comfort')
    })
    it('takes 25+ games even with a poor win rate', () => {
      expect(computeAutoTier({ ...base, games: 27, winRate: 41, rankInRole: 4, roleShare: 0.1 })).toBe('comfort')
    })
    it('caps a mastery-only champion at comfort', () => {
      expect(computeAutoTier({ ...base, games: 0, masteryPoints: 320_000 })).toBe('comfort')
    })
  })

  describe('flex and learning', () => {
    it('makes a losing 8-game record flex, not comfort', () => {
      expect(computeAutoTier({ ...base, games: 8, winRate: 25, rankInRole: 5, roleShare: 0.05 })).toBe('flex')
    })
    it('makes 5 games flex', () => {
      expect(computeAutoTier({ ...base, games: 5, winRate: 20 })).toBe('flex')
    })
    it('makes 100k+ mastery flex', () => {
      expect(computeAutoTier({ ...base, games: 0, masteryPoints: 120_000 })).toBe('flex')
    })
    it('keeps a 3-game 100 % sample in learning', () => {
      expect(computeAutoTier({ ...base, games: 3, winRate: 100, masteryPoints: 20_000 })).toBe('learning')
    })
  })

  describe('recency', () => {
    const main = { ...base, games: 40, winRate: 55, rankInRole: 1, roleShare: 0.3 }
    it('drops a main left aside for 30+ days while the player kept playing', () => {
      expect(computeAutoTier({ ...main, lastPlayedAt: NOW - 45 * DAY, historyTo: NOW - DAY })).toBe('comfort')
    })
    it('keeps the main when the player was away from the game too', () => {
      expect(computeAutoTier({ ...main, lastPlayedAt: NOW - 45 * DAY, historyTo: NOW - 40 * DAY })).toBe('main')
    })
    it('drops a stale comfort to flex', () => {
      expect(computeAutoTier({ ...base, games: 27, winRate: 50, rankInRole: 4, roleShare: 0.1, lastPlayedAt: NOW - 60 * DAY, historyTo: NOW })).toBe('flex')
    })
  })
})

describe('tierPool', () => {
  it('ranks and shares champions per role', () => {
    const pool = [
      { championKey: 'Orianna', role: 'MID', games: 40, winRate: 55, masteryPoints: null },
      { championKey: 'Azir', role: 'MID', games: 25, winRate: 52, masteryPoints: null },
      { championKey: 'Ahri', role: 'MID', games: 14, winRate: 50, masteryPoints: null },
      { championKey: 'Syndra', role: 'MID', games: 13, winRate: 54, masteryPoints: null },
      { championKey: 'Taliyah', role: 'MID', games: 8, winRate: 50, masteryPoints: null },
      { championKey: 'Gnar', role: 'TOP', games: 13, winRate: 46, masteryPoints: null },
    ]
    expect(tierPool(pool, { now: NOW })).toEqual(['main', 'main', 'main', 'comfort', 'comfort', 'main'])
  })

  it('finds a new pick from the entries’ own dates', () => {
    const pool = [
      { championKey: 'Viego', role: 'JUNGLE', games: 30, winRate: 55, masteryPoints: null, firstPlayedAt: NOW - 60 * DAY, lastPlayedAt: NOW - DAY },
      { championKey: 'Ambessa', role: 'JUNGLE', games: 11, winRate: 64, masteryPoints: null, firstPlayedAt: NOW - 5 * DAY, lastPlayedAt: NOW - DAY },
    ]
    expect(tierPool(pool, { now: NOW })).toEqual(['main', 'new'])
    expect(tierPool(pool, { now: NOW, allowNew: false })[1]).not.toBe('new')
  })
})

describe('new picks in the Draft Sim', () => {
  const newStat = (games = 11) => stat({ championKey: 'Hwei', role: 'MID', games, tier: 'new', firstPlayedAt: Date.now() - 6 * DAY })

  it('assesses a recent pickup as "new"', () => {
    const r = assessMemberChampionThreat(newStat(), { isDominant: false, roleShare: 0.1 })
    expect(r.level).toBe('new')
    expect(r.reason).toBe('11g in 6d')
  })

  it('keeps red above new', () => {
    const r = assessMemberChampionThreat(newStat(120), { isDominant: false, roleShare: 0.1 })
    expect(r.level).toBe('red')
  })

  it('shows new in the team map, below the real threats, and never as a priority pick', () => {
    // Sael's real main keeps Hwei from being the dominant pick (that alone would be red).
    const opp = buildTeamThreatMap({ members: [{ displayName: 'Sael', role: 'MID', champPool: [stat({ championKey: 'Syndra', role: 'MID', games: 80 }), newStat()] }] })
    expect(opp.get('Hwei')?.level).toBe('new')
    expect(opp.get('Hwei')?.members).toEqual(['Sael'])
    const mine = buildTeamThreatMap({ members: [{ displayName: 'Nyra', role: 'MID', champPool: [stat({ championKey: 'Hwei', role: 'MID', games: 120 })] }] })
    expect(buildPrioPickMap(mine, opp).size).toBe(0)
  })
})
