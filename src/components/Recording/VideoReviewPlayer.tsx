import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Bookmark, Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  Check, X, RotateCcw, RotateCw, PanelRight, PanelLeft, PanelRightClose,
  ZoomIn, ZoomOut, StepBack, StepForward,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TimelineNote } from '@/components/ReviewForm/TimelineNoteInput'

function fmt(seconds: number): string {
  if (!isFinite(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
const ZOOM_LEVELS = [1, 2, 5, 10] as const
type ZoomLevel = (typeof ZOOM_LEVELS)[number]
type SidebarPosition = 'right' | 'left' | 'hidden'

interface VideoReviewPlayerProps {
  src: string
  notes: TimelineNote[]
  onAddNote?: (note: TimelineNote) => void
  onFileNotFound?: () => void
  readonly?: boolean
  /** When true, renders clip trim handles on the timeline */
  clipping?: boolean
  /** Current clip range in ms */
  clipRange?: { startMs: number; endMs: number }
  /** Called when either clip handle is dragged */
  onClipRangeChange?: (range: { startMs: number; endMs: number }) => void
  /** Override the max-height of the video element (default: 480px) */
  videoMaxHeight?: string
}

export function VideoReviewPlayer({
  src, notes, onAddNote, onFileNotFound, readonly,
  clipping, clipRange, onClipRangeChange,
  videoMaxHeight = 'max-h-[480px]',
}: VideoReviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const volumeRef = useRef<HTMLInputElement>(null)
  const markInputRef = useRef<HTMLInputElement>(null)

  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState(0)
  const [marking, setMarking] = useState(false)
  const [pendingNote, setPendingNote] = useState('')
  const [markedAt, setMarkedAt] = useState(0)
  const [flashIcon, setFlashIcon] = useState<'play' | 'pause' | null>(null)
  const [videoError, setVideoError] = useState(false)
  const [sidebarPosition, setSidebarPosition] = useState<SidebarPosition>('right')
  // Drag-scrub state
  const isDraggingRef = useRef(false)
  // Clip handle drag: 'start' | 'end' | 'body' | null
  const draggingHandleRef = useRef<'start' | 'end' | 'body' | null>(null)
  // Flash-icon timeout — stored to cancel on unmount
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** How far (ms) from clip start the user grabbed when dragging the body */
  const dragOffsetMsRef = useRef(0)
  // Zoom level for timeline precision
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(1)

  const videoNotes = notes
    .filter((n) => n.videoTime !== undefined)
    .sort((a, b) => (a.videoTime ?? 0) - (b.videoTime ?? 0))

  const cycleSidebar = useCallback(() => {
    setSidebarPosition((pos) => {
      if (pos === 'right') return 'left'
      if (pos === 'left') return 'hidden'
      return 'right'
    })
  }, [])

  // ── Playback helpers ────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play()
      setFlashIcon('play')
    } else {
      v.pause()
      setFlashIcon('pause')
    }
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashIcon(null), 500)
  }, [])

  // Clean up flash timer on unmount
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current) }, [])

  const skip = useCallback((delta: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
  }, [])

  const seekBy = useCallback((deltaMs: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + deltaMs / 1000))
  }, [])

  const changeSpeed = useCallback((s: number) => {
    setSpeed(s)
    if (videoRef.current) videoRef.current.playbackRate = s
  }, [])

  const seekTo = useCallback((time: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = time
    videoRef.current.play().catch(() => {})
  }, [])

  // ── Progress bar interaction (drag scrub + zoom) ─────────────────────────────

  /**
   * Converts a mouse X position to a video time, taking zoom into account.
   * When zoomed, the timeline window is [windowStart, windowEnd] centered on currentTime.
   */
  const getTimeFromClientX = useCallback((clientX: number): number => {
    const v = videoRef.current
    if (!progressRef.current || !v) return 0
    const d = isFinite(v.duration) ? v.duration : duration
    if (d === 0) return 0
    const rect = progressRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))

    if (zoomLevel === 1) {
      return ratio * d
    }
    const windowDur = d / zoomLevel
    const ct = v.currentTime
    const windowStart = Math.max(0, Math.min(d - windowDur, ct - windowDur / 2))
    return Math.max(0, Math.min(d, windowStart + ratio * windowDur))
  }, [duration, zoomLevel])

  const handleProgressMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const v = videoRef.current
    if (!v) return
    isDraggingRef.current = true
    const t = getTimeFromClientX(e.clientX)
    v.currentTime = t
    setCurrentTime(t)
  }, [getTimeFromClientX])

  const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current) return
    const rect = progressRef.current.getBoundingClientRect()
    setHoverX(e.clientX - rect.left)
    setHoverTime(getTimeFromClientX(e.clientX))
  }

  // Global mouse move/up for drag scrub and clip handle drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const v = videoRef.current
        if (!progressRef.current || !v) return
        const d = isFinite(v.duration) ? v.duration : 0
        if (d === 0) return
        const rect = progressRef.current.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        let t: number
        if (zoomLevel === 1) {
          t = ratio * d
        } else {
          const windowDur = d / zoomLevel
          const windowStart = Math.max(0, Math.min(d - windowDur, v.currentTime - windowDur / 2))
          t = Math.max(0, Math.min(d, windowStart + ratio * windowDur))
        }
        v.currentTime = t
        setCurrentTime(t)
      }

      if (draggingHandleRef.current && clipRange && onClipRangeChange) {
        const v = videoRef.current
        if (!progressRef.current || !v) return
        const d = isFinite(v.duration) ? v.duration : 0
        if (d === 0) return
        const dMs = d * 1000
        const rect = progressRef.current.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const tMs = ratio * dMs

        if (draggingHandleRef.current === 'start') {
          onClipRangeChange({ startMs: Math.min(tMs, clipRange.endMs - 500), endMs: clipRange.endMs })
        } else if (draggingHandleRef.current === 'end') {
          onClipRangeChange({ startMs: clipRange.startMs, endMs: Math.max(tMs, clipRange.startMs + 500) })
        } else if (draggingHandleRef.current === 'body') {
          // Translate entire clip, keeping duration fixed
          const dur = clipRange.endMs - clipRange.startMs
          const newStart = Math.max(0, Math.min(dMs - dur, tMs - dragOffsetMsRef.current))
          onClipRangeChange({ startMs: newStart, endMs: newStart + dur })
        }
      }
    }
    const onUp = () => {
      isDraggingRef.current = false
      draggingHandleRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [zoomLevel, clipRange, onClipRangeChange])

  // ── Volume ───────────────────────────────────────────────────────────────────

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (videoRef.current) {
      videoRef.current.volume = v
      videoRef.current.muted = v === 0
      setMuted(v === 0)
    }
  }

  const toggleMute = () => {
    if (!videoRef.current) return
    const next = !muted
    videoRef.current.muted = next
    setMuted(next)
  }

  // ── Fullscreen ───────────────────────────────────────────────────────────────

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break
        case 'ArrowLeft': e.preventDefault(); skip(-5); break
        case 'ArrowRight': e.preventDefault(); skip(5); break
        case 'j': skip(-10); break
        case 'l': skip(10); break
        case 'k': togglePlay(); break
        case 'm': toggleMute(); break
        case 'f': toggleFullscreen(); break
        case 'n': if (isFullscreen) cycleSidebar(); break
        case '[': seekBy(-1000); break
        case ']': seekBy(1000); break
        case ',': changeSpeed(Math.max(SPEEDS[0], SPEEDS[SPEEDS.indexOf(speed) - 1] ?? speed)); break
        case '.': changeSpeed(Math.min(SPEEDS[SPEEDS.length - 1], SPEEDS[SPEEDS.indexOf(speed) + 1] ?? speed)); break
        case '+': case '=': setZoomLevel((z) => {
          const i = ZOOM_LEVELS.indexOf(z)
          return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, i + 1)] ?? z
        }); break
        case '-': setZoomLevel((z) => {
          const i = ZOOM_LEVELS.indexOf(z)
          return ZOOM_LEVELS[Math.max(0, i - 1)] ?? z
        }); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, skip, seekBy, speed, changeSpeed, isFullscreen, cycleSidebar])

  // ── Mark moment ──────────────────────────────────────────────────────────────

  const handleMarkMoment = () => {
    if (!videoRef.current) return
    videoRef.current.pause()
    setMarkedAt(videoRef.current.currentTime)
    setMarking(true)
    setPendingNote('')
    // In fullscreen, focus the sidebar input after state update
    setTimeout(() => markInputRef.current?.focus(), 50)
  }

  const confirmMark = () => {
    if (!pendingNote.trim()) return
    onAddNote?.({
      time: fmt(markedAt),
      note: pendingNote.trim(),
      videoTime: markedAt,
    })
    setMarking(false)
    setPendingNote('')
  }

  // When zoomed, compute a window of [windowStart, windowEnd] centered on currentTime
  const windowDur = duration > 0 ? duration / zoomLevel : 0
  const windowStart = duration > 0
    ? Math.max(0, Math.min(duration - windowDur, currentTime - windowDur / 2))
    : 0
  const windowEnd = windowStart + windowDur

  /** Converts a video time to a progress-bar percentage (0-100), respecting zoom. */
  const timeToPercent = (t: number): number => {
    if (duration === 0) return 0
    if (zoomLevel === 1) return (t / duration) * 100
    if (windowDur === 0) return 0
    return Math.max(0, Math.min(100, ((t - windowStart) / windowDur) * 100))
  }

  const progress = timeToPercent(currentTime)

  if (videoError) {
    return (
      <div className="rounded-xl bg-[#050A10] border border-white/10 flex flex-col items-center justify-center py-10 gap-3 text-center px-4">
        <div className="rounded-full bg-white/5 p-4">
          <X className="h-8 w-8 text-white/30" />
        </div>
        <p className="text-sm font-medium text-white/60">Recording file not found</p>
        <p className="text-xs text-white/30 max-w-xs">
          The video file has been moved or deleted. You can re-link a new file or remove this recording entry.
        </p>
      </div>
    )
  }

  // ── Shared sub-elements ──────────────────────────────────────────────────────

  const progressBar = (
    <div className="px-3 pt-3 pb-1">
      {/* Zoom label */}
      {zoomLevel > 1 && (
        <div className="flex items-center justify-between mb-1 text-[9px] font-mono text-white/30">
          <span>{fmt(windowStart)}</span>
          <span className="text-hextech-gold/60">{zoomLevel}× zoom</span>
          <span>{fmt(windowEnd)}</span>
        </div>
      )}
      {/*
        * Fixed-height hit zone (h-5 = 20px).
        * The visual track grows inside it via absolute positioning so the
        * surrounding layout never shifts when the user hovers.
        */}
      <div
        ref={progressRef}
        className="relative h-5 cursor-pointer group"
        onMouseDown={handleProgressMouseDown}
        onMouseMove={handleProgressHover}
        onMouseLeave={() => setHoverTime(null)}
      >
        {/* Background track — grows from centre on hover */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 group-hover:h-3 bg-white/10 rounded-full transition-[height] duration-100 pointer-events-none" />

        {/* Progress fill — same grow behaviour */}
        <div
          className="absolute top-1/2 -translate-y-1/2 left-0 h-1.5 group-hover:h-3 bg-hextech-gold rounded-full transition-[height] duration-100 pointer-events-none"
          style={{ width: `${progress}%` }}
        />
        {/* Playhead dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-hextech-gold shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30"
          style={{ left: `${progress}%` }}
        />

        {/* Clip range */}
        {clipping && clipRange && duration > 0 && (
          <>
            {/* Draggable clip body — grab to move entire range */}
            <div
              className="absolute top-1/2 -translate-y-1/2 h-3 group-hover:h-5 bg-hextech-teal/25 border-y border-hextech-teal/50 cursor-grab active:cursor-grabbing z-10 group/clip transition-[height] duration-100"
              style={{
                left: `${timeToPercent(clipRange.startMs / 1000)}%`,
                width: `${Math.max(0, timeToPercent(clipRange.endMs / 1000) - timeToPercent(clipRange.startMs / 1000))}%`,
              }}
              onMouseDown={(e) => {
                e.stopPropagation()
                const v = videoRef.current
                if (!progressRef.current || !v) return
                const d = isFinite(v.duration) ? v.duration : 0
                if (d === 0) return
                const rect = progressRef.current.getBoundingClientRect()
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                // Record cursor offset relative to clip start so the clip doesn't jump
                dragOffsetMsRef.current = ratio * d * 1000 - clipRange.startMs
                draggingHandleRef.current = 'body'
              }}
            >
              {/* Subtle centre grip indicator */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover/clip:opacity-100 transition-opacity">
                <div className="flex gap-0.5">
                  <div className="w-0.5 h-3 rounded bg-white/40" />
                  <div className="w-0.5 h-3 rounded bg-white/40" />
                  <div className="w-0.5 h-3 rounded bg-white/40" />
                </div>
              </div>
            </div>

            {/* Start handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-6 rounded bg-hextech-teal cursor-ew-resize z-20 flex items-center justify-center shadow-md"
              style={{ left: `${timeToPercent(clipRange.startMs / 1000)}%` }}
              onMouseDown={(e) => { e.stopPropagation(); draggingHandleRef.current = 'start' }}
            >
              <div className="w-0.5 h-3.5 bg-white/70 rounded" />
            </div>

            {/* End handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-6 rounded bg-hextech-teal cursor-ew-resize z-20 flex items-center justify-center shadow-md"
              style={{ left: `${timeToPercent(clipRange.endMs / 1000)}%` }}
              onMouseDown={(e) => { e.stopPropagation(); draggingHandleRef.current = 'end' }}
            >
              <div className="w-0.5 h-3.5 bg-white/70 rounded" />
            </div>
          </>
        )}

        {/* Note markers */}
        {duration > 0 && videoNotes.map((note, i) => {
          const pct = timeToPercent(note.videoTime ?? 0)
          if (pct < 0 || pct > 100) return null
          return (
            <button
              key={i}
              title={`${fmt(note.videoTime!)} — ${note.note}`}
              onClick={(e) => { e.stopPropagation(); seekTo(note.videoTime!) }}
              style={{ left: `${pct}%` }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#00C8C8] border-2 border-[#050A10] hover:scale-150 transition-transform z-10"
            />
          )
        })}

        {/* Hover tooltip */}
        {hoverTime !== null && duration > 0 && (
          <div
            className="absolute -top-7 -translate-x-1/2 rounded px-1.5 py-0.5 bg-black/90 text-white text-[10px] font-mono pointer-events-none whitespace-nowrap z-20"
            style={{ left: hoverX }}
          >
            {fmt(hoverTime)}
          </div>
        )}
      </div>
      <div className="flex justify-between mt-1 text-[10px] font-mono text-white/40 px-0.5">
        <span>{fmt(currentTime)}</span>
        <span>{fmt(duration)}</span>
      </div>
    </div>
  )

  const controls = (
    <div className="px-3 pb-3 flex items-center gap-1.5 flex-wrap">
      {/* -1s frame step */}
      <button
        onClick={() => seekBy(-1000)}
        title="Back 1s ([)"
        className="text-white/50 hover:text-white transition-colors"
      >
        <StepBack className="h-3.5 w-3.5" />
      </button>

      <button
        onClick={() => skip(-10)}
        title="Back 10s (J)"
        className="flex items-center gap-0.5 rounded px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors text-xs"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        <span>10</span>
      </button>

      <button
        onClick={togglePlay}
        title="Play / Pause (Space)"
        className="rounded-full w-9 h-9 flex items-center justify-center bg-hextech-gold hover:bg-hextech-gold-bright text-black transition-colors shrink-0"
      >
        {playing
          ? <Pause className="h-4 w-4 fill-black" />
          : <Play className="h-4 w-4 fill-black ml-0.5" />}
      </button>

      <button
        onClick={() => skip(10)}
        title="Forward 10s (L)"
        className="flex items-center gap-0.5 rounded px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors text-xs"
      >
        <span>10</span>
        <RotateCw className="h-3.5 w-3.5" />
      </button>

      {/* +1s frame step */}
      <button
        onClick={() => seekBy(1000)}
        title="Forward 1s (])"
        className="text-white/50 hover:text-white transition-colors"
      >
        <StepForward className="h-3.5 w-3.5" />
      </button>

      <button onClick={toggleMute} title="Mute (M)" className="text-white/60 hover:text-white transition-colors ml-1">
        {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <input
        ref={volumeRef}
        type="range"
        min={0} max={1} step={0.05}
        value={muted ? 0 : volume}
        onChange={handleVolumeChange}
        className="w-16 accent-hextech-gold cursor-pointer"
      />

      <div className="flex-1" />

      {/* Timeline zoom */}
      <div className="flex items-center gap-0.5 rounded-md bg-white/5 border border-white/10 p-0.5 mr-1">
        <button
          onClick={() => setZoomLevel((z) => ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(z) - 1)] ?? z)}
          title="Zoom out (-)"
          className="text-white/40 hover:text-white transition-colors px-1"
          disabled={zoomLevel === 1}
        >
          <ZoomOut className="h-3 w-3" />
        </button>
        <span className="text-[10px] font-mono text-white/50 px-1">{zoomLevel}×</span>
        <button
          onClick={() => setZoomLevel((z) => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + 1)] ?? z)}
          title="Zoom in (+)"
          className="text-white/40 hover:text-white transition-colors px-1"
          disabled={zoomLevel === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
        >
          <ZoomIn className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-0.5 rounded-md bg-white/5 border border-white/10 p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => changeSpeed(s)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors',
              s === speed
                ? 'bg-hextech-gold text-black font-bold'
                : 'text-white/50 hover:text-white hover:bg-white/10',
            )}
          >
            {s === 1 ? '1×' : `${s}×`}
          </button>
        ))}
      </div>

      {!readonly && (
        <button
          onClick={handleMarkMoment}
          title="Mark this moment"
          className="flex items-center gap-1 rounded px-2 py-1 text-[#00C8C8] hover:text-white hover:bg-[#00C8C8]/20 transition-colors text-xs font-medium ml-1"
        >
          <Bookmark className="h-3.5 w-3.5" />
          Mark
        </button>
      )}

      {/* Sidebar toggle — only visible in fullscreen */}
      {isFullscreen && (
        <button
          onClick={cycleSidebar}
          title={`Sidebar: ${sidebarPosition} (N)`}
          className="text-white/50 hover:text-white transition-colors ml-1"
        >
          {sidebarPosition === 'right' && <PanelRight className="h-4 w-4" />}
          {sidebarPosition === 'left' && <PanelLeft className="h-4 w-4" />}
          {sidebarPosition === 'hidden' && <PanelRightClose className="h-4 w-4" />}
        </button>
      )}

      <button
        onClick={toggleFullscreen}
        title="Fullscreen (F)"
        className="text-white/50 hover:text-white transition-colors ml-1"
      >
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  )

  // ── Mark input (used both inline and in sidebar) ─────────────────────────────

  const markInput = marking && (
    <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-[#00C8C8]/40 bg-[#00C8C8]/5 p-2.5">
      <Bookmark className="h-3.5 w-3.5 text-[#00C8C8] shrink-0" />
      <span className="text-xs font-mono text-[#00C8C8] shrink-0 bg-[#00C8C8]/10 rounded px-1.5 py-0.5">
        {fmt(markedAt)}
      </span>
      <input
        ref={markInputRef}
        autoFocus
        type="text"
        value={pendingNote}
        onChange={(e) => setPendingNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirmMark()
          if (e.key === 'Escape') { setMarking(false); setPendingNote('') }
        }}
        placeholder="Describe this moment…"
        className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
      />
      <button
        onClick={confirmMark}
        disabled={!pendingNote.trim()}
        className="text-green-400 hover:opacity-80 disabled:opacity-30 transition-opacity"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        onClick={() => { setMarking(false); setPendingNote('') }}
        className="text-white/40 hover:text-red-400 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )

  // ── Notes list (shared) ───────────────────────────────────────────────────────

  const notesList = videoNotes.length > 0 && (
    <div className={cn('px-3 py-2 space-y-1', !isFullscreen && 'border-t border-white/5')}>
      <p className="text-[9px] text-white/30 uppercase tracking-widest font-semibold mb-1.5">Video moments</p>
      {videoNotes.map((note, i) => (
        <div key={i} className="flex items-start gap-2 text-sm group/note">
          <button
            onClick={() => seekTo(note.videoTime!)}
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-[#00C8C8] bg-[#00C8C8]/10 hover:bg-[#00C8C8]/20 transition-colors"
          >
            ▶ {fmt(note.videoTime!)}
          </button>
          <span className="text-white/70 leading-tight pt-0.5 text-xs">{note.note}</span>
        </div>
      ))}
    </div>
  )

  // ── Fullscreen layout: video left/right, sidebar ─────────────────────────────

  if (isFullscreen) {
    const sidebar = sidebarPosition !== 'hidden' && (
      <div
        className={cn(
          'w-72 flex flex-col bg-[#050A10] shrink-0',
          sidebarPosition === 'left'
            ? 'border-r border-white/10 order-first'
            : 'border-l border-white/10',
        )}
      >
        <div className="px-3 pt-3 pb-2 border-b border-white/5">
          <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">Notes</p>
        </div>

        {/* Mark input pinned at top when active */}
        {marking && (
          <div className="px-3 pt-2">
            <div className="flex items-center gap-2 rounded-lg border border-[#00C8C8]/40 bg-[#00C8C8]/5 p-2.5">
              <Bookmark className="h-3.5 w-3.5 text-[#00C8C8] shrink-0" />
              <span className="text-xs font-mono text-[#00C8C8] shrink-0 bg-[#00C8C8]/10 rounded px-1.5 py-0.5">
                {fmt(markedAt)}
              </span>
              <input
                ref={markInputRef}
                autoFocus
                type="text"
                value={pendingNote}
                onChange={(e) => setPendingNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmMark()
                  if (e.key === 'Escape') { setMarking(false); setPendingNote('') }
                }}
                placeholder="Describe this moment…"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none min-w-0"
              />
              <button
                onClick={confirmMark}
                disabled={!pendingNote.trim()}
                className="text-green-400 hover:opacity-80 disabled:opacity-30 transition-opacity shrink-0"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => { setMarking(false); setPendingNote('') }}
                className="text-white/40 hover:text-red-400 transition-colors shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Scrollable notes */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {videoNotes.length === 0 ? (
            <p className="text-xs text-white/25 text-center pt-6">
              No moments marked yet.
              {!readonly && <><br />Press <kbd className="px-1 rounded bg-white/10 font-mono">Mark</kbd> to add one.</>}
            </p>
          ) : (
            videoNotes.map((note, i) => (
              <div key={i} className="flex items-start gap-2 group/note">
                <button
                  onClick={() => seekTo(note.videoTime!)}
                  className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-[#00C8C8] bg-[#00C8C8]/10 hover:bg-[#00C8C8]/20 transition-colors"
                >
                  ▶ {fmt(note.videoTime!)}
                </button>
                <span className="text-white/70 leading-tight pt-0.5 text-xs">{note.note}</span>
              </div>
            ))
          )}
        </div>
      </div>
    )

    return (
      <div ref={containerRef} className="flex h-full w-full bg-[#050A10] select-none overflow-hidden">
        {/* Video panel */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="relative bg-black flex-1 min-h-0 cursor-pointer" onClick={togglePlay}>
            <video
              ref={videoRef}
              src={src}
              className="w-full h-full object-contain block"
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
              onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => {
                setVideoError(true)
                onFileNotFound?.()
              }}
            />
            {flashIcon && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="rounded-full bg-black/50 p-4 animate-ping-once">
                  {flashIcon === 'play'
                    ? <Play className="h-10 w-10 text-white fill-white" />
                    : <Pause className="h-10 w-10 text-white fill-white" />}
                </div>
              </div>
            )}
            {!playing && currentTime === 0 && duration === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="rounded-full bg-black/60 p-5">
                  <Play className="h-12 w-12 text-hextech-gold fill-hextech-gold" />
                </div>
              </div>
            )}
          </div>
          {progressBar}
          {controls}
        </div>

        {sidebar}
      </div>
    )
  }

  // ── Normal (inline) layout: stacked ──────────────────────────────────────────

  return (
    <div ref={containerRef} className="rounded-xl overflow-hidden bg-[#050A10] border border-white/10 select-none">
      <div className="relative bg-black cursor-pointer" onClick={togglePlay}>
        <video
          ref={videoRef}
          src={src}
          className={cn('w-full object-contain block', videoMaxHeight)}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
          onDurationChange={() => setDuration(videoRef.current?.duration ?? 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => {
            setVideoError(true)
            onFileNotFound?.()
          }}
        />
        {flashIcon && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="rounded-full bg-black/50 p-4 animate-ping-once">
              {flashIcon === 'play'
                ? <Play className="h-10 w-10 text-white fill-white" />
                : <Pause className="h-10 w-10 text-white fill-white" />}
            </div>
          </div>
        )}
        {!playing && currentTime === 0 && duration === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="rounded-full bg-black/60 p-5">
              <Play className="h-12 w-12 text-hextech-gold fill-hextech-gold" />
            </div>
          </div>
        )}
      </div>

      {progressBar}
      {controls}
      {markInput}
      {notesList}
    </div>
  )
}
