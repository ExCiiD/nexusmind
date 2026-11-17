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
