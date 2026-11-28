import { describe, expect, it } from 'vitest'
import fixture from './fixtures/dove-tower-real-game.json'
import { detectMistakes } from '../../electron/main/mistakeDetector'
import { staleAutoRows } from '../../electron/main/detectedMistakesCore'
import { standingTurrets, turretFalls } from '../../src/lib/microReview/geometry'

// SG2_186199789 (anonymised): player 10 (red) dies at 27:34 next to the blue bot inner turret, which fell at 26:04.
const match = (fixture as any).match
const timeline = (fixture as any).timeline
const doves = (tl: unknown, pid: number) => detectMistakes(tl as object, match, { puuids: [`P${pid}`] }).filter((c) => c.tagSlug === 'dove-tower').map((c) => c.gameTimeSec)
const near = (xs: number[], t: number) => xs.some((x) => Math.abs(x - t) <= 1)
const withoutTowerKills = () => ({ info: { frames: timeline.info.frames.map((f: any) => ({ ...f, events: f.events.filter((e: any) => e.type !== 'BUILDING_KILL') })) } })

describe('dove-tower counts standing turrets only (28/11/2026)', () => {
  it('a death at a turret that already fell is not a dive', () => {
    expect(near(doves(timeline, 10), 1654)).toBe(false)
    expect(near(doves(timeline, 7), 2002)).toBe(false)
    expect(near(doves(timeline, 6), 2039)).toBe(false)
  })
  it('the same deaths with the turret still standing (its destruction removed) are dives', () => {
    expect(near(doves(withoutTowerKills(), 10), 1654)).toBe(true)
    expect(near(doves(withoutTowerKills(), 7), 2002)).toBe(true)
    expect(near(doves(withoutTowerKills(), 6), 2039)).toBe(true)
  })
  it('reads when each turret fell, nexus turrets included', () => {
    const events = timeline.info.frames.flatMap((f: any) => f.events)
    const fell = turretFalls(events)
    expect(fell.size).toBeGreaterThan(3)
    const late = Math.max(...fell.values())
    expect(standingTurrets(fell, 100, 0)).toHaveLength(11)
    expect(standingTurrets(fell, 100, late + 1).length + standingTurrets(fell, 200, late + 1).length).toBeLessThan(22)
  })
})

describe('re-check of stored auto rows', () => {
  it('keeps the rows the detector still finds (3 s) and drops the others', () => {
    const rows = [{ id: 'a', gameTimeSec: 1654 }, { id: 'b', gameTimeSec: 900 }, { id: 'c', gameTimeSec: 1000 }]
    expect(staleAutoRows(rows, [900, 1001]).map((r) => r.id)).toEqual(['a'])
    expect(staleAutoRows(rows, []).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})
