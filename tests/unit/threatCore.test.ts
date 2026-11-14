import { describe, it, expect } from 'vitest'
import {
  assessMemberChampionThreat,
  buildMemberThreatMap,
  buildTeamThreatMap,
  buildPrioPickMap,
  withPrioPicks,
  computeAutoTier,
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

describe('computeAutoTier', () => {
  it('assigns main for a top-5-in-role champion regardless of other stats', () => {
    expect(computeAutoTier({ games: 4, masteryPoints: 0, winRate: null, isTop5InRole: true })).toBe('main')
  })

  it('assigns main for high mastery alone', () => {
    expect(computeAutoTier({ games: 0, masteryPoints: 320_000, winRate: null, isTop5InRole: false })).toBe('main')
  })

  it('assigns main for a strong winrate once the sample is large enough', () => {
    expect(computeAutoTier({ games: 22, masteryPoints: 0, winRate: 68, isTop5InRole: false })).toBe('main')
  })

  it('does not let a tiny winrate sample fake "main"', () => {
    expect(computeAutoTier({ games: 3, masteryPoints: 0, winRate: 100, isTop5InRole: false })).not.toBe('main')
  })

  it('assigns comfort for 50+ games with no other signal', () => {
    expect(computeAutoTier({ games: 55, masteryPoints: 0, winRate: 48, isTop5InRole: false })).toBe('comfort')
  })

  it('assigns learning for a low-mastery, zero-game mastery-only entry', () => {
    expect(computeAutoTier({ games: 0, masteryPoints: 15_000, winRate: null, isTop5InRole: false })).toBe('learning')
  })

  it('falls back to flex for everything else', () => {
    expect(computeAutoTier({ games: 4, masteryPoints: 1000, winRate: 40, isTop5InRole: false })).toBe('flex')
  })
})
