import { describe, it, expect } from 'vitest'
import { buildFundamentalsRadar, overallRadarScore, radarPolygonPoints, RADAR_AXES } from '../../src/lib/fundamentalsRadarCore'

function stats(overrides: Partial<{ kills: number; deaths: number; assists: number; csPerMin: number; goldPerMin: number; damagePerMin: number; kp: number; fb: number; cs15: number; xp15: number; gold15: number }>) {
  const o = { kills: 6, deaths: 4, assists: 8, csPerMin: 6, goldPerMin: 400, damagePerMin: 600, kp: 60, fb: 20, cs15: 100, xp15: 6500, gold15: 5000, ...overrides }
  return {
    meta: { avgKills: o.kills, avgDeaths: o.deaths, avgAssists: o.assists },
    economy: { csPerMin: o.csPerMin, goldPerMin: o.goldPerMin },
    combat: { damagePerMin: o.damagePerMin, killParticipation: o.kp },
    laning: { firstBloodRate: o.fb, cs15: o.cs15, xp15: o.xp15, gold15: o.gold15 },
  }
}

describe('buildFundamentalsRadar', () => {
  it('maps all 9 axes in the documented order', () => {
    const points = buildFundamentalsRadar(stats({}), stats({}))
    expect(points.map((p) => p.key)).toEqual(['kda', 'csm', 'goldm', 'dmgm', 'kp', 'fb', 'cs15', 'xp15', 'gold15'])
    expect(RADAR_AXES).toHaveLength(9)
  })

  it('computes KDA as (kills+assists)/deaths, and falls back to kills+assists on a perfect (0-death) average', () => {
    const [kda] = buildFundamentalsRadar(stats({ kills: 6, deaths: 4, assists: 8 }), null)
    expect(kda.recentRaw).toBeCloseTo((6 + 8) / 4)

    const [perfect] = buildFundamentalsRadar(stats({ kills: 6, deaths: 0, assists: 8 }), null)
    expect(perfect.recentRaw).toBe(14)
  })

  it('normalizes within [0, 100] and clamps out-of-range values', () => {
    const points = buildFundamentalsRadar(stats({ csPerMin: 20 }), stats({ csPerMin: -5 }))
    const csm = points.find((p) => p.key === 'csm')!
    expect(csm.recentScore).toBe(100) // 20 CS/m is far above the 9 max
    expect(csm.snapshotScore).toBe(0) // negative is below the 3 min
  })

  it('leaves an axis null when the source average is null, without crashing', () => {
    const points = buildFundamentalsRadar(null, stats({}))
    for (const p of points) {
      expect(p.recentRaw).toBeNull()
      expect(p.recentScore).toBeNull()
      expect(p.snapshotRaw).not.toBeNull()
    }
  })
})

describe('overallRadarScore', () => {
  it('averages only the axes that have a recent score', () => {
    const points = buildFundamentalsRadar(stats({}), null)
    const score = overallRadarScore(points)
    expect(score).not.toBeNull()
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('returns null when every axis is missing', () => {
    expect(overallRadarScore(buildFundamentalsRadar(null, null))).toBeNull()
  })
})

describe('radarPolygonPoints', () => {
  it('produces one "x,y" pair per axis', () => {
    const points = buildFundamentalsRadar(stats({}), stats({}))
    const svg = radarPolygonPoints(points, 'recentScore', 90, 64)
    expect(svg.split(' ')).toHaveLength(points.length)
    for (const pair of svg.split(' ')) expect(pair).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
  })

  it('treats a null score as 0 (center) rather than throwing', () => {
    const points = buildFundamentalsRadar(null, null)
    expect(() => radarPolygonPoints(points, 'recentScore', 90, 64)).not.toThrow()
  })
})

describe('support radar', () => {
  it('uses support axes for UTILITY and laner axes otherwise', async () => {
    const { radarAxesForRole, SUPPORT_RADAR_AXES, RADAR_AXES } = await import('../../src/lib/fundamentalsRadarCore')
    expect(radarAxesForRole('UTILITY')).toBe(SUPPORT_RADAR_AXES)
    expect(radarAxesForRole('JUNGLE')).toBe(RADAR_AXES)
    expect(radarAxesForRole(null)).toBe(RADAR_AXES)
    expect(SUPPORT_RADAR_AXES).toHaveLength(9)
  })

  it('scores fewer deaths higher (inverted axis)', async () => {
    const { buildFundamentalsRadar, SUPPORT_RADAR_AXES } = await import('../../src/lib/fundamentalsRadarCore')
    const avg = (deaths: number) => ({ meta: { avgKills: 1, avgDeaths: deaths, avgAssists: 12 }, combat: { killParticipation: 60, healShieldPerMin: 250, damagePerMin: 300, damageMitigatedPerMin: 400, ccPerMin: 1.5 }, vision: { visionScorePerMin: 2, visionScoreAdvantage: 10, controlWardsPurchased: 4, wardsDestroyed: 3 } })
    const pts = buildFundamentalsRadar(avg(3), avg(7), SUPPORT_RADAR_AXES)
    const d = pts.find((p) => p.key === 'deaths')!
    expect(d.recentScore!).toBeGreaterThan(d.snapshotScore!)
  })
})

/**
 * "Fight impact" replaces the heal+shield axis, which only an enchanter could
 * fill. The three profiles below are the measured per-minute averages of the
 * support champions of each style in 3,015 cached ranked games (Nov. 2026):
 * heals+shields, damage to champions, damage absorbed (self-mitigated).
 */
describe('support fight impact', () => {
  const support = (healShieldPerMin: number | null, damagePerMin: number | null, damageMitigatedPerMin: number | null, extra: Record<string, unknown> = {}) => ({
    meta: { avgKills: 1, avgDeaths: 5, avgAssists: 12 },
    combat: { killParticipation: 60, ccPerMin: 1.5, healShieldPerMin, damagePerMin, damageMitigatedPerMin, ...extra },
    vision: { visionScorePerMin: 2, visionScoreAdvantage: 10, controlWardsPurchased: 4, wardsDestroyed: 3 },
  })
  const ENCHANTER = support(417, 330, 369)
  const POKE = support(37, 654, 392)
  const ENGAGE = support(61, 394, 990)

  it('takes the place of the heal+shield axis, same position, nine axes', async () => {
    const { SUPPORT_RADAR_AXES } = await import('../../src/lib/fundamentalsRadarCore')
    expect(SUPPORT_RADAR_AXES.map((a) => a.key)).toEqual(['kda', 'kp', 'deaths', 'vspm', 'vsdiff', 'pinks', 'wardkill', 'impact', 'cc'])
  })

  it('adds heals+shields, damage dealt and 40% of the damage absorbed, per minute', async () => {
    const { fightImpactPerMin, FIGHT_IMPACT_ABSORBED_WEIGHT } = await import('../../src/lib/fundamentalsRadarCore')
    expect(FIGHT_IMPACT_ABSORBED_WEIGHT).toBe(0.4)
    expect(fightImpactPerMin(support(310, 280, 420))).toBe(310 + 280 + 168)
  })

  it('reads on the 400-1300 scale: the median support game (837) sits mid-chart', async () => {
    const { buildFundamentalsRadar, SUPPORT_RADAR_AXES } = await import('../../src/lib/fundamentalsRadarCore')
    const impact = (s: unknown) => buildFundamentalsRadar(s, null, SUPPORT_RADAR_AXES).find((p) => p.key === 'impact')!
    expect(impact(support(310, 280, 420)).recentRaw).toBe(758)
    expect(impact(support(310, 280, 420)).recentScore).toBe(40)
    expect(impact(support(300, 337, 500)).recentScore).toBe(49) // 837 = median
    expect(impact(support(0, 100, 200)).recentScore).toBe(0) // below the floor
    expect(impact(support(700, 600, 800)).recentScore).toBe(100) // above the ceiling
  })

  it('rates an enchanter, a poke mage and an engage support alike', async () => {
    const { buildFundamentalsRadar, SUPPORT_RADAR_AXES } = await import('../../src/lib/fundamentalsRadarCore')
    const score = (s: unknown) => buildFundamentalsRadar(s, null, SUPPORT_RADAR_AXES).find((p) => p.key === 'impact')!.recentScore!
    const scores = [score(ENCHANTER), score(POKE), score(ENGAGE)]
    expect(scores).toEqual([55, 50, 50])
    // The axis it replaces gave them 83, 7 and 12 out of 100.
    expect(Math.max(...scores) - Math.min(...scores)).toBeLessThanOrEqual(6)
  })

  it('exposes its three parts, so an enchanter still sees the heals and a tank what it absorbed', async () => {
    const { buildFundamentalsRadar, SUPPORT_RADAR_AXES } = await import('../../src/lib/fundamentalsRadarCore')
    const pts = buildFundamentalsRadar(support(310, 280, 420), support(285, 262, 400), SUPPORT_RADAR_AXES)
    const impact = pts.find((p) => p.key === 'impact')!
    expect(impact.recentParts).toEqual([
      { key: 'healShield', value: 310, weight: 1 },
      { key: 'damage', value: 280, weight: 1 },
      { key: 'absorbed', value: 420, weight: 0.4 },
    ])
    expect(impact.snapshotParts!.map((p) => p.value)).toEqual([285, 262, 400])
    // Every other axis is a single number: no parts.
    expect(pts.find((p) => p.key === 'cc')!.recentParts).toBeUndefined()
  })

  it('derives the absorbed part from the totals when the per-minute average is missing', async () => {
    const { fightImpactPerMin } = await import('../../src/lib/fundamentalsRadarCore')
    // 12,600 absorbed over a 30-minute average game = 420 per minute.
    const older = { ...support(310, 280, null, { damageMitigated: 12600 }), meta: { avgKills: 1, avgDeaths: 5, avgAssists: 12, avgDuration: 1800 } }
    expect(fightImpactPerMin(older)).toBe(758)
  })

  it('stays empty rather than guessing when a part is unknown', async () => {
    const { buildFundamentalsRadar, fightImpactPerMin, SUPPORT_RADAR_AXES } = await import('../../src/lib/fundamentalsRadarCore')
    expect(fightImpactPerMin(support(null, 280, 420))).toBeNull()
    expect(fightImpactPerMin(support(310, null, 420))).toBeNull()
    expect(fightImpactPerMin(support(310, 280, null))).toBeNull()
    expect(fightImpactPerMin(null)).toBeNull()
    const impact = buildFundamentalsRadar(support(310, null, 420), null, SUPPORT_RADAR_AXES).find((p) => p.key === 'impact')!
    expect(impact.recentScore).toBeNull()
    expect(impact.recentParts).toBeNull()
  })
})
