/**
 * Hidden-window capture renderer for NexusMind recording.
 *
 * Pipeline (Phase 2 — video + audio via WGC/Chromium APIs):
 *  1. Receive `wgc:start` IPC from the main process with capture settings.
 *  2. Open a video MediaStream with `chromeMediaSource: 'desktop'` targeting
 *     the League of Legends window HWND. WGC is presentation-mode agnostic.
 *  3. Open a *desktop-loopback* audio MediaStream by doing a second
 *     `getUserMedia` with `chromeMediaSource: 'desktop'` on a screen source.
 *     Chromium requires a matching video track in that call, so we request a
 *     minimal 1-fps screen track and discard it immediately. Only the audio
 *     track is kept.
 *  4. Open a microphone MediaStream via plain `getUserMedia({ audio: true })`.
 *  5. Mix desktop loopback + mic through a WebAudio graph into a single
 *     MediaStreamDestination (MediaRecorder can only encode one audio track).
 *  6. Wrap the combined stream with a MediaRecorder (H.264+Opus WebM
 *     preferred) and emit chunks every second.
 *  7. Ship each chunk to the main process via `wgc:chunk`. Disk IO stays in
 *     main.
 *  8. On `wgc:stop`, flush final chunks, stop all tracks, close the audio
 *     context, and signal `wgc:stopped`.
 *
 * This renderer never touches the filesystem directly — disk IO lives in
 * main. It also never holds references to business data.
 */

export {}

type StartPayload = {
  recordFps: number
  targetHeight: number
  bitrateKbps: number
  sourceId: string
  mainWindowId: number
}

type WgcAPI = {
  listScreenSources: () => Promise<Array<{ id: string; name: string; display_id?: string }>>
  onStart: (cb: (payload: StartPayload) => void) => () => void
  onStop: (cb: () => void) => () => void
  sendStarted: (info: {
    mimeType: string
    width: number
    height: number
    audioTracks: number
    audioDesktop: boolean
    audioMic: boolean
  }) => void
  sendStopped: () => void
  sendError: (message: string) => void
  sendChunk: (chunk: ArrayBuffer, isLast: boolean) => void
}

declare global {
  interface Window {
    wgcAPI: WgcAPI
  }
}

const statusEl = document.getElementById('status') as HTMLDivElement

function setStatus(text: string) {
  if (statusEl) statusEl.textContent = text
  console.log('[wgc-capture]', text)
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const mt of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mt)) {
      return mt
    }
  }
  return 'video/webm'
}

// ─── Individual capture helpers ──────────────────────────────────────────────

async function openVideoStream(payload: StartPayload): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: payload.sourceId,
        maxFrameRate: payload.recordFps,
        ...(payload.targetHeight > 0
          ? { maxHeight: payload.targetHeight, maxWidth: Math.round((payload.targetHeight * 16) / 9) }
          : {}),
      },
    } as unknown as MediaTrackConstraints,
  }
  return navigator.mediaDevices.getUserMedia(constraints)
}

/**
 * Opens a desktop-audio-only track. Chromium's `chromeMediaSource: 'desktop'`
 * audio only works when paired with a matching desktop video track, so we
 * grab a throw-away 1-fps screen video and stop it as soon as the audio
 * track is available.
 */
async function openDesktopAudioStream(): Promise<MediaStream | null> {
  let screenId: string | undefined
  try {
    const screens = await window.wgcAPI.listScreenSources()
    screenId = screens[0]?.id
  } catch (err) {
    console.warn('[wgc-capture] listScreenSources failed:', (err as Error).message)
    return null
  }
  if (!screenId) {
    console.warn('[wgc-capture] no screen source available for desktop audio loopback')
    return null
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenId,
        },
      } as unknown as MediaTrackConstraints,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenId,
          maxFrameRate: 1,
          maxWidth: 64,
          maxHeight: 64,
        },
      } as unknown as MediaTrackConstraints,
    })
    // Stop and remove the throw-away video track — only audio is needed.
    stream.getVideoTracks().forEach((t) => {
      t.stop()
      stream.removeTrack(t)
    })
    if (stream.getAudioTracks().length === 0) {
      console.warn('[wgc-capture] desktop audio stream has no audio tracks')
      return null
    }
    return stream
  } catch (err) {
    console.warn('[wgc-capture] desktop audio capture failed:', (err as Error).message)
    return null
  }
}

async function openMicStream(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  } catch (err) {
    console.warn('[wgc-capture] mic capture failed:', (err as Error).message)
    return null
  }
}

// ─── Audio mixing ────────────────────────────────────────────────────────────

type AudioMix = {
  track: MediaStreamTrack
  context: AudioContext
  sources: MediaStream[]
} | null

function mixAudioTracks(streams: MediaStream[]): AudioMix {
  const nonEmpty = streams.filter((s) => s.getAudioTracks().length > 0)
  if (nonEmpty.length === 0) return null

  const context = new AudioContext()
  const destination = context.createMediaStreamDestination()
  for (const stream of nonEmpty) {
    const audioOnly = new MediaStream(stream.getAudioTracks())
    context.createMediaStreamSource(audioOnly).connect(destination)
  }
  const track = destination.stream.getAudioTracks()[0]
  if (!track) {
    try { context.close() } catch { /* ignore */ }
    return null
  }
  return { track, context, sources: nonEmpty }
}

// ─── Lifecycle state ─────────────────────────────────────────────────────────

let videoStream: MediaStream | null = null
let desktopAudioStream: MediaStream | null = null
let micStream: MediaStream | null = null
let audioMix: AudioMix = null
let combinedStream: MediaStream | null = null
let recorder: MediaRecorder | null = null

function releaseAll() {
  try { recorder = null } catch { /* ignore */ }
  try {
    if (audioMix) {
      audioMix.context.close().catch(() => { /* ignore */ })
      audioMix = null
    }
  } catch { /* ignore */ }
  for (const s of [videoStream, desktopAudioStream, micStream, combinedStream]) {
    if (!s) continue
    try { s.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
  }
  videoStream = null
  desktopAudioStream = null
  micStream = null
  combinedStream = null
}

// ─── Main flow ───────────────────────────────────────────────────────────────

async function startCapture(payload: StartPayload) {
  try {
    setStatus(`Starting WGC capture — source=${payload.sourceId} fps=${payload.recordFps}`)

    videoStream = await openVideoStream(payload)
    const videoTrack = videoStream.getVideoTracks()[0]
    const settings = videoTrack?.getSettings() ?? {}
    const width = Number(settings.width ?? 0)
    const height = Number(settings.height ?? 0)
    setStatus(`Video track opened — ${width}x${height}`)

    // Audio is best-effort: if loopback or mic fails the capture still runs.
    ;[desktopAudioStream, micStream] = await Promise.all([
      openDesktopAudioStream(),
      openMicStream(),
    ])

    const audioInputs: MediaStream[] = []
    if (desktopAudioStream) audioInputs.push(desktopAudioStream)
    if (micStream) audioInputs.push(micStream)
    audioMix = mixAudioTracks(audioInputs)

    const combined = new MediaStream([videoTrack])
    if (audioMix) combined.addTrack(audioMix.track)
    combinedStream = combined

    const audioDescriptor = `desktop=${Boolean(desktopAudioStream)} mic=${Boolean(micStream)}`
    setStatus(`Combined stream ready — video=1 audio=${combined.getAudioTracks().length} (${audioDescriptor})`)

    const mimeType = pickMimeType()
    const mr = new MediaRecorder(combined, {
      mimeType,
      videoBitsPerSecond: payload.bitrateKbps * 1000,
      audioBitsPerSecond: 128_000,
    })
    recorder = mr

    mr.addEventListener('dataavailable', async (event) => {
      if (!event.data || event.data.size === 0) return
      try {
        const buf = await event.data.arrayBuffer()
        const isLast = mr.state === 'inactive'
        window.wgcAPI.sendChunk(buf, isLast)
      } catch (err) {
        window.wgcAPI.sendError(`dataavailable read error: ${(err as Error).message}`)
      }
    })

    mr.addEventListener('error', (event) => {
      const err = (event as unknown as { error?: Error }).error
      window.wgcAPI.sendError(`MediaRecorder error: ${err?.message ?? 'unknown'}`)
    })

    mr.addEventListener('stop', () => {
      setStatus('MediaRecorder stopped')
      window.wgcAPI.sendStopped()
    })

    mr.start(1000)
    window.wgcAPI.sendStarted({
      mimeType,
      width,
      height,
      audioTracks: combined.getAudioTracks().length,
      audioDesktop: Boolean(desktopAudioStream),
      audioMic: Boolean(micStream),
    })
    setStatus(`Recording → mimeType=${mimeType} bitrate=${payload.bitrateKbps}kbps audio=${audioDescriptor}`)
  } catch (err) {
    const message = (err as Error).message
    setStatus(`startCapture failed: ${message}`)
    releaseAll()
    window.wgcAPI.sendError(`startCapture failed: ${message}`)
  }
}

function stopCapture() {
  try {
    if (recorder && recorder.state !== 'inactive') {
      // Triggers a final `dataavailable` with any buffered bytes before `stop`.
      recorder.stop()
    }
  } catch (err) {
    window.wgcAPI.sendError(`stopCapture error: ${(err as Error).message}`)
  }
  releaseAll()
}

window.wgcAPI.onStart((payload) => {
  void startCapture(payload)
})
window.wgcAPI.onStop(() => {
  stopCapture()
})

setStatus('WGC capture renderer ready, waiting for start signal')
