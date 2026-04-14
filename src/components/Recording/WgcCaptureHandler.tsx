import { useEffect, useRef, useCallback } from 'react'

/**
 * Quality → capture resolution and bitrate.
 * Lower resolution / bitrate significantly reduces GPU encoding pressure,
 * resulting in fewer in-game FPS drops during recording.
 */
const QUALITY_PRESETS: Record<string, { maxW: number; maxH: number; bitrate: number }> = {
  '720p':   { maxW: 1280, maxH: 720,  bitrate: 3_000_000 },
  '1080p':  { maxW: 1920, maxH: 1080, bitrate: 4_500_000 },
  '1440p':  { maxW: 2560, maxH: 1440, bitrate: 6_000_000 },
  'source': { maxW: 3840, maxH: 2160, bitrate: 8_000_000 },
}
const DEFAULT_PRESET = QUALITY_PRESETS['1080p']

/**
 * Hidden component that listens for WGC capture commands from the main process.
 * Uses getUserMedia (backed by Windows Graphics Capture on Win 10 1903+)
 * + MediaRecorder to capture a specific window's DirectX/Vulkan/OpenGL content.
 *
 * Streams WebM/MP4 chunks back to main via IPC; main writes them to disk.
 */
export function WgcCaptureHandler() {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopCapture = useCallback(() => {
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
    } catch { /* ignore */ }
  }, [])

  const startCapture = useCallback(async (
    sourceId: string,
    quality?: string,
    fps?: number,
  ) => {
    try {
      const preset = QUALITY_PRESETS[quality ?? ''] ?? DEFAULT_PRESET
      const targetFps = fps ?? 30

      const stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 640,
            maxWidth: preset.maxW,
            minHeight: 360,
            maxHeight: preset.maxH,
            minFrameRate: targetFps,
            maxFrameRate: targetFps,
          },
        },
      })
      streamRef.current = stream

      const mimeType = pickMimeType()
      console.log(`[WGC] Using MIME: ${mimeType} — quality: ${quality ?? '1080p'} — fps: ${targetFps} — bitrate: ${preset.bitrate}`)

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: preset.bitrate,
      })
      recorderRef.current = recorder

      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          const buf = await e.data.arrayBuffer()
          window.api.wgcChunk(buf)
        }
      }

      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        recorderRef.current = null
        window.api.wgcDone({ mimeType })
      }

      recorder.onerror = (ev) => {
        const msg = (ev as any).error?.message ?? 'Unknown MediaRecorder error'
        console.error('[WGC] MediaRecorder error:', msg)
        window.api.wgcError(msg)
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        recorderRef.current = null
      }

      // Timeslice of 2s reduces encoding interrupts and IPC frequency
      recorder.start(2000)
      console.log('[WGC] Recording started — source:', sourceId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[WGC] Failed to start capture:', msg)
      window.api.wgcError(msg)
    }
  }, [])

  useEffect(() => {
    const offStart = window.api.onWgcCaptureStart((data) => {
      startCapture(data.sourceId, data.quality, data.fps)
    })
    const offStop = window.api.onWgcCaptureStop(() => {
      stopCapture()
    })
    return () => { offStart(); offStop() }
  }, [startCapture, stopCapture])

  return null
}

/**
 * H264 is preferred: hardware-accelerated and the stream can be copied straight into MP4.
 * VP8/VP9 WebM would require re-encoding to H264 for MP4 (slow) so we avoid them.
 */
function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return 'video/webm'
}
