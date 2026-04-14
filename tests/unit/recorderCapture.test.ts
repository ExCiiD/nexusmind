import { describe, it, expect } from 'vitest'
import {
  LOL_WINDOW_TITLE,
  LOL_WINDOW_TITLE_ALT,
  LOL_WINDOW_TITLES_ORDERED,
  buildProbeGdigrabWindowArgs,
  buildGdigrabDesktopRecordingArgs,
  parseWindowBoundsFromStderr,
  assertNoDrawMouseInArgs,
} from '../../electron/main/recordingCaptureArgs'

describe('recordingCaptureArgs — window titles', () => {
  it('should list primary title then fallback', () => {
    expect(LOL_WINDOW_TITLES_ORDERED[0]).toBe(LOL_WINDOW_TITLE)
    expect(LOL_WINDOW_TITLES_ORDERED[1]).toBe(LOL_WINDOW_TITLE_ALT)
    expect(LOL_WINDOW_TITLES_ORDERED.length).toBe(3)
  })
})

describe('recordingCaptureArgs — probe args', () => {
  it('probe args must target a window title for bounds detection', () => {
    const probe = buildProbeGdigrabWindowArgs(LOL_WINDOW_TITLE_ALT)
    expect(probe.join(' ')).toContain(`title=${LOL_WINDOW_TITLE_ALT}`)
    expect(probe).not.toContain('desktop')
  })
})

describe('recordingCaptureArgs — desktop crop args', () => {
  it('desktop recording args use -i desktop with offsets and video_size', () => {
    const args = buildGdigrabDesktopRecordingArgs({
      offsetX: 0,
      offsetY: 0,
      videoWidth: 1920,
      videoHeight: 1080,
      recordFps: 30,
    })
    expect(args).toContain('-i')
    expect(args).toContain('desktop')
    expect(args).toContain('-offset_x')
    expect(args).toContain('-video_size')
    expect(args.join(' ')).toContain('1920x1080')
  })

  it('supports non-zero offsets for window-crop capture', () => {
    const args = buildGdigrabDesktopRecordingArgs({
      offsetX: 100,
      offsetY: 50,
      videoWidth: 2560,
      videoHeight: 1440,
      recordFps: 60,
    })
    const joined = args.join(' ')
    expect(joined).toContain('-offset_x 100')
    expect(joined).toContain('-offset_y 50')
    expect(joined).toContain('2560x1440')
  })
})

describe('recordingCaptureArgs — parseWindowBoundsFromStderr', () => {
  it('parses typical gdigrab output', () => {
    const stderr =
      '[gdigrab @ 0000020e6885bb00] Found window League of Legends (TM) Client, capturing 2560x1440x32 at (0,0)\n' +
      'Input #0, gdigrab, from ...'
    const b = parseWindowBoundsFromStderr(stderr)
    expect(b).toEqual({ width: 2560, height: 1440, x: 0, y: 0 })
  })

  it('parses negative offsets (secondary monitor)', () => {
    const stderr = '[gdigrab @ abc] Found window LoL, capturing 1920x1080x32 at (-1920,0)'
    const b = parseWindowBoundsFromStderr(stderr)
    expect(b).toEqual({ width: 1920, height: 1080, x: -1920, y: 0 })
  })

  it('returns null when no match', () => {
    expect(parseWindowBoundsFromStderr('some random output')).toBeNull()
  })
})

describe('recordingCaptureArgs — anti mouse flicker (-draw_mouse 0)', () => {
  it('probe and desktop args all disable mouse drawing', () => {
    expect(assertNoDrawMouseInArgs(buildProbeGdigrabWindowArgs('Test Window'))).toBe(true)
    expect(
      assertNoDrawMouseInArgs(
        buildGdigrabDesktopRecordingArgs({
          offsetX: 0,
          offsetY: 0,
          videoWidth: 100,
          videoHeight: 100,
          recordFps: 30,
        }),
      ),
    ).toBe(true)
  })
})
