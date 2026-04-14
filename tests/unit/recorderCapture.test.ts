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

describe('recordingCaptureArgs — window vs desktop', () => {
  it('should list primary title then fallback', () => {
    expect(LOL_WINDOW_TITLES_ORDERED[0]).toBe(LOL_WINDOW_TITLE)
    expect(LOL_WINDOW_TITLES_ORDERED[1]).toBe(LOL_WINDOW_TITLE_ALT)
    expect(LOL_WINDOW_TITLES_ORDERED.length).toBe(2)
  })

  it('window recording args must use title= and NOT desktop', () => {
    const args = buildGdigrabWindowRecordingArgs(LOL_WINDOW_TITLE, 60)
    expect(isWindowCaptureInputArgs(args)).toBe(true)
    expect(args.join(' ')).toContain(`title=${LOL_WINDOW_TITLE}`)
    expect(args).not.toContain('desktop')
  })

  it('desktop fallback args must use -i desktop and offsets', () => {
    const args = buildGdigrabDesktopRecordingArgs({
      offsetX: 0,
      offsetY: 0,
      videoWidth: 1920,
      videoHeight: 1080,
      recordFps: 30,
    })
    expect(isWindowCaptureInputArgs(args)).toBe(false)
    expect(args).toContain('-i')
    expect(args).toContain('desktop')
    expect(args).toContain('-offset_x')
    expect(args).toContain('-video_size')
    expect(args.join(' ')).toContain('1920x1080')
  })

  it('probe args must target a window title, not full screen', () => {
    const probe = buildProbeGdigrabWindowArgs(LOL_WINDOW_TITLE_ALT)
    expect(probe.join(' ')).toContain(`title=${LOL_WINDOW_TITLE_ALT}`)
    expect(probe).not.toContain('desktop')
  })
})

describe('recordingCaptureArgs — anti mouse flicker (-draw_mouse 0)', () => {
  it('probe, window record, and desktop record all disable mouse drawing', () => {
    expect(assertNoDrawMouseInArgs(buildProbeGdigrabWindowArgs('Test Window'))).toBe(true)
    expect(assertNoDrawMouseInArgs(buildGdigrabWindowRecordingArgs('LoL', 30))).toBe(true)
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
