import { describe, it, expect } from 'vitest'
import { clipFromGameWindow, clipZoomWindow, defaultClipRange, loopTarget, presetClipRange, setClipIn, setClipOut } from '../../src/lib/clipEdit'

const D = 1_800_000 // a 30 min video

// DECISIONS 21/11 « interface clip user friendly », spec § 19 « Mode clip ».
describe('clip mode', () => {
  it('starts at current − 10 s → + 20 s, inside the video', () => {
    expect(defaultClipRange(542_000, D)).toEqual({ startMs: 532_000, endMs: 562_000 })
    expect(defaultClipRange(3_000, D)).toEqual({ startMs: 0, endMs: 23_000 })
    expect(defaultClipRange(D - 1_000, D)).toEqual({ startMs: D - 11_000, endMs: D })
  })

  it('DURÉE presets are centred on the current time and stay inside the video', () => {
    expect(presetClipRange(600_000, 30, D)).toEqual({ startMs: 585_000, endMs: 615_000 })
    expect(presetClipRange(20_000, 120, D)).toEqual({ startMs: 0, endMs: 120_000 })
    expect(presetClipRange(D - 5_000, 60, D)).toEqual({ startMs: D - 60_000, endMs: D })
  })

  it('I and O set a bound at the current time, never an empty clip', () => {
    const r = { startMs: 100_000, endMs: 130_000 }
    expect(setClipIn(r, 110_000, D)).toEqual({ startMs: 110_000, endMs: 130_000 })
    expect(setClipIn(r, 140_000, D)).toEqual({ startMs: 140_000, endMs: 141_000 })
    expect(setClipOut(r, 120_000, D)).toEqual({ startMs: 100_000, endMs: 120_000 })
    expect(setClipOut(r, 90_000, D)).toEqual({ startMs: 89_000, endMs: 90_000 })
  })

  it('zooms the timeline about ± 2 min around the clip', () => {
    expect(clipZoomWindow({ startMs: 600_000, endMs: 630_000 }, D)).toEqual({ fromMs: 480_000, toMs: 750_000 })
    expect(clipZoomWindow({ startMs: 30_000, endMs: 60_000 }, D)).toEqual({ fromMs: 0, toMs: 180_000 })
  })

  it('« Clipper ce moment »: the micro-review window, in video time', () => {
    expect(clipFromGameWindow({ startSec: 925, endSec: 1030 }, 15, D)).toEqual({ startMs: 910_000, endMs: 1_015_000 })
  })

  it('never longer than 2 min (Back-end refuses it)', () => {
    expect(clipFromGameWindow({ startSec: 100, endSec: 400 }, 0, D)).toEqual({ startMs: 100_000, endMs: 220_000 })
  })

  it('the preview loops on the selection', () => {
    const r = { startMs: 100_000, endMs: 130_000 }
    expect(loopTarget(110_000, r)).toBeNull()
    expect(loopTarget(130_000, r)).toBe(100_000)
    expect(loopTarget(50_000, r)).toBe(100_000)
  })
})
