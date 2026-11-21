import { describe, it, expect } from 'vitest'
import { clipFromGameWindow, clipLengthLabel, defaultClipRange, dragClipHandle, loopTarget, setClipIn, setClipOut } from '../../src/lib/clipEdit'

const D = 1_800_000 // a 30 min video

// DECISIONS 21/11 « Mode clip, nouvelle interface »: handles Début / Fin above the timeline.
describe('clip mode', () => {
  it('starts at current − 10 s → + 20 s, inside the video', () => {
    expect(defaultClipRange(542_000, D)).toEqual({ startMs: 532_000, endMs: 562_000 })
    expect(defaultClipRange(3_000, D)).toEqual({ startMs: 0, endMs: 23_000 })
    expect(defaultClipRange(D - 1_000, D)).toEqual({ startMs: D - 11_000, endMs: D })
  })

  it('a dragged handle keeps the clip at least 1 s long, inside the video, the other handle still (no 2-min limit)', () => {
    const r = { startMs: 100_000, endMs: 130_000 }
    expect(dragClipHandle(r, 'start', 90_000, D)).toEqual({ startMs: 90_000, endMs: 130_000 })
    expect(dragClipHandle(r, 'start', 129_800, D)).toEqual({ startMs: 129_000, endMs: 130_000 })
    expect(dragClipHandle(r, 'start', 0, D)).toEqual({ startMs: 0, endMs: 130_000 })
    expect(dragClipHandle(r, 'end', 400_000, D)).toEqual({ startMs: 100_000, endMs: 400_000 })
    expect(dragClipHandle({ startMs: 0, endMs: 30_000 }, 'end', D, D)).toEqual({ startMs: 0, endMs: D })
    expect(dragClipHandle(r, 'end', 50_000, D)).toEqual({ startMs: 100_000, endMs: 101_000 })
    expect(dragClipHandle({ startMs: D - 20_000, endMs: D - 10_000 }, 'end', D + 5_000, D)).toEqual({ startMs: D - 20_000, endMs: D })
    expect(dragClipHandle({ startMs: 5_000, endMs: 30_000 }, 'start', -3_000, D)).toEqual({ startMs: 0, endMs: 30_000 })
  })

  it('labels the bracket with the duration', () => {
    expect(clipLengthLabel({ startMs: 100_000, endMs: 130_000 })).toBe('0:30')
    expect(clipLengthLabel({ startMs: 0, endMs: 65_400 })).toBe('1:05')
  })

  it('I and O set a bound at the current time, never an empty clip', () => {
    const r = { startMs: 100_000, endMs: 130_000 }
    expect(setClipIn(r, 110_000, D)).toEqual({ startMs: 110_000, endMs: 130_000 })
    expect(setClipIn(r, 140_000, D)).toEqual({ startMs: 140_000, endMs: 141_000 })
    expect(setClipOut(r, 120_000, D)).toEqual({ startMs: 100_000, endMs: 120_000 })
    expect(setClipOut(r, 90_000, D)).toEqual({ startMs: 89_000, endMs: 90_000 })
  })

  it('« Clipper ce moment »: the micro-review window, in video time', () => {
    expect(clipFromGameWindow({ startSec: 925, endSec: 1030 }, 15, D)).toEqual({ startMs: 910_000, endMs: 1_015_000 })
  })

  it('as long as the window asks (beta.23: no 2-minute limit), inside the video', () => {
    expect(clipFromGameWindow({ startSec: 100, endSec: 400 }, 0, D)).toEqual({ startMs: 100_000, endMs: 400_000 })
    expect(clipFromGameWindow({ startSec: 0, endSec: 4000 }, 0, D)).toEqual({ startMs: 0, endMs: D })
  })

  it('the preview loops on the selection', () => {
    const r = { startMs: 100_000, endMs: 130_000 }
    expect(loopTarget(110_000, r)).toBeNull()
    expect(loopTarget(130_000, r)).toBe(100_000)
    expect(loopTarget(50_000, r)).toBe(100_000)
  })
})
