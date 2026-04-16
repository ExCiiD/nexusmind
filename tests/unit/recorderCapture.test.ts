import { describe, it, expect } from 'vitest'
import {
  LOL_WINDOW_TITLE,
  LOL_WINDOW_TITLE_ALT,
  LOL_WINDOW_TITLES_ORDERED,
  buildProbeGdigrabWindowArgs,
  buildGdigrabWindowRecordingArgs,
  buildGdigrabDesktopRecordingArgs,
  isWindowCaptureInputArgs,
  assertNoDrawMouseInArgs,
} from '../../electron/main/recordingCaptureArgs'

describe('recordingCaptureArgs — window titles', () => {
  it('should list primary title then fallback', () => {
    expect(LOL_WINDOW_TITLES_ORDERED[0]).toBe(LOL_WINDOW_TITLE)
    expect(LOL_WINDOW_TITLES_ORDERED[1]).toBe(LOL_WINDOW_TITLE_ALT)
    expect(LOL_WINDOW_TITLES_ORDERED.length).toBe(2)
  })
})

describe('recordingCaptureArgs — probe args', () => {
  it('probe args must target a window title', () => {
    const probe = buildProbeGdigrabWindowArgs(LOL_WINDOW_TITLE_ALT)
    expect(probe.join(' ')).toContain(`title=${LOL_WINDOW_TITLE_ALT}`)
    expect(probe).not.toContain('desktop')
  })
})

describe('recordingCaptureArgs — window recording args', () => {
  it('window recording args use title= input', () => {
    const args = buildGdigrabWindowRecordingArgs(LOL_WINDOW_TITLE, 30)
    const joined = args.join(' ')
    expect(joined).toContain(`title=${LOL_WINDOW_TITLE}`)
    expect(joined).not.toContain('desktop')
    expect(joined).toContain('-framerate 30')
  })

  it('isWindowCaptureInputArgs returns true for window args', () => {
    const args = buildGdigrabWindowRecordingArgs(LOL_WINDOW_TITLE, 60)
    expect(isWindowCaptureInputArgs(args)).toBe(true)
  })
})

describe('recordingCaptureArgs — desktop recording args', () => {
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

  it('isWindowCaptureInputArgs returns false for desktop args', () => {
    const args = buildGdigrabDesktopRecordingArgs({
      offsetX: 0, offsetY: 0, videoWidth: 100, videoHeight: 100, recordFps: 30,
    })
    expect(isWindowCaptureInputArgs(args)).toBe(false)
  })
})

describe('recordingCaptureArgs — anti mouse flicker (-draw_mouse 0)', () => {
  it('probe, window, and desktop args all disable mouse drawing', () => {
    expect(assertNoDrawMouseInArgs(buildProbeGdigrabWindowArgs('Test Window'))).toBe(true)
    expect(assertNoDrawMouseInArgs(buildGdigrabWindowRecordingArgs('Test Window', 30))).toBe(true)
    expect(
      assertNoDrawMouseInArgs(
        buildGdigrabDesktopRecordingArgs({
          offsetX: 0, offsetY: 0, videoWidth: 100, videoHeight: 100, recordFps: 30,
        }),
      ),
    ).toBe(true)
  })
})
