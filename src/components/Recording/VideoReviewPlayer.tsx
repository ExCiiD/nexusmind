import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { gameTimeToVideoTime } from '@/lib/eventSync'
import {
  Bookmark, Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  Check, X, RotateCcw, RotateCw, PanelRight, PanelLeft, PanelRightClose,
  ZoomIn, ZoomOut, StepBack, StepForward, Trash2, Loader2,
  Sword, Skull, Handshake, Flame, Crown, Eye, Bug, Sparkles, RadioTower, ShieldOff, Shield,
  User, Users, Target, AlertTriangle, MessageSquare, EyeOff,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TimelineNote } from '@/components/ReviewForm/TimelineNoteInput'
import type { GameEvent, GameEventType, Mistake, MistakeTag, Bookmark as BookmarkData } from '@/lib/ipc'

// Visual styling per event category. Saturated colors for the most
// important events (player K/D/A, objectives), muted for buildings so
// 50+ markers stay readable.
const EVENT_COLORS: Record<GameEventType, string> = {
  kill:      'bg-emerald-500 text-black',
  death:     'bg-red-500 text-white',
  assist:    'bg-yellow-400 text-black',
  dragon:    'bg-orange-500 text-black',
  baron:     'bg-purple-600 text-white',
  voidgrub:  'bg-emerald-700 text-white',
  herald:    'bg-blue-500 text-white',
  atakhan:   'bg-amber-500 text-black',
  turret:    'bg-zinc-300 text-black',
  inhibitor: 'bg-pink-500 text-white',
  plate:     'bg-zinc-500 text-white',
}

const EVENT_ICONS: Record<GameEventType, LucideIcon> = {
  kill: Sword,
  death: Skull,
  assist: Handshake,
  dragon: Flame,
  baron: Crown,
  voidgrub: Bug,
  herald: Eye,
  atakhan: Sparkles,
  // Watchtower silhouette (thin column on a base) — reads as "tower"
  // instead of the previous Castle icon which looked like a fortress.
  turret: RadioTower,
  inhibitor: ShieldOff,
  plate: Shield,
}

const EVENT_LABELS: Record<GameEventType, string> = {
  kill: 'Kill',
  death: 'Death',
  assist: 'Assist',
  dragon: 'Drake',
  baron: 'Nashor',
  voidgrub: 'Voidgrub',
  herald: 'Herald',
  atakhan: 'Atakhan',
  turret: 'Tower',
  inhibitor: 'Inhib',
  plate: 'Plate',
}

// Order used by the legend / filter chips — most important categories first.
const EVENT_ORDER: GameEventType[] = [
  'kill', 'death', 'assist',
  'dragon', 'baron', 'herald', 'voidgrub', 'atakhan',
  'turret', 'inhibitor', 'plate',
]

// Y-offset (in px from bar center) per lane. Markers all sit ABOVE the bar
// (negative Y), close to each other, à la Insight Capture / Outplayed. The
// three lanes give a vertical hierarchy: K/D/A closest to the bar (most
// important), objectives middle, buildings furthest (least critical).
const EVENT_LANE: Record<GameEventType, number> = {
  kill: -16, death: -16, assist: -16,
  dragon: -32, baron: -32, herald: -32, voidgrub: -32, atakhan: -32,
  turret: -48, inhibitor: -48, plate: -48,
}

/**
 * Time window (in seconds of video time) inside which adjacent same-type
 * markers get collapsed into a single badge with a count. 25s comfortably
 * covers an entire teamfight + its immediate cleanup (chases, follow-up
 * picks) so the user sees ONE marker per fight per category instead of a
 * dense cluster they have to mentally collapse.
 */
const CLUSTER_WINDOW_SEC = 25

/**
 * Horizontal distance (in seconds of video time) below which two markers
 * are considered "stacked" at the same scrubber position. When the
 * collision-avoidance pass detects this, the second marker gets bumped
 * vertically so both stay readable.
 */
const COLLISION_WINDOW_SEC = 6
/** Vertical bump per collision tier, in pixels. */
const COLLISION_BUMP_PX = 22

/**
 * Filter modes for the timeline markers. Stored in localStorage so the
 * user's choice sticks across recordings.
 *  - mine: only events the user participated in (default)
 *  - all: every event the extractor returned, including team-fight context
 *  - objectives: dragons / baron / herald / voidgrub / atakhan / turrets /
 *    inhibitors regardless of player involvement (drops K/D/A and plates)
 */
type EventFilterMode = 'mine' | 'all' | 'objectives'
const OBJECTIVE_TYPES = new Set<GameEventType>([
  'dragon', 'baron', 'herald', 'voidgrub', 'atakhan', 'turret', 'inhibitor',
])

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
type SidebarSection = 'notes' | 'mistakes' | 'bookmarks'

/** Payload for `onAddMistake` — see Mistake Library plan. */
export interface NewMistakePayload {
  tagId: string
  gameTimeSec: number
  videoTimeMs?: number
  note?: string
  severity?: number
}

interface VideoReviewPlayerProps {
  src: string
  notes: TimelineNote[]
  onAddNote?: (note: TimelineNote) => void
  onEditNote?: (index: number, newText: string) => void
  onDeleteNote?: (index: number) => void
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
  /** Optional list of in-game events (kills, dragons, towers…) for timeline markers */
  gameEvents?: GameEvent[]
  /** Required if `gameEvents` is provided — used to map game time → video time */
  gameMeta?: {
    gameEndAt: Date | string
    gameDurationSec: number
    recordingCreatedAt: Date | string
    /** Pre-computed offset from DB, preferred over deriving from birthtime */
    startOffsetSec?: number | null
  }
  /** When set (game-time seconds), the player seeks to that moment once
   *  metadata is ready and starts playing. Used by deep-links like the Lane
   *  Phase Comparator ("click the 12-min dip → jump to 12 min in the replay").
   *  Re-applied whenever the value changes. */
  seekToGameTimeSec?: number | null
  // ── Mistake Library integration ────────────────────────────────────
  /** Mistakes attached to this recording's game. Rendered as a separate
   *  marker lane above game events and as a collapsible side list. */
  mistakes?: Mistake[]
  /** All available tags (built-in + user-defined) — used by the add dialog. */
  mistakeTags?: MistakeTag[]
  /** Called when the user confirms the add-mistake dialog (hotkey `x`). */
  onAddMistake?: (payload: NewMistakePayload) => Promise<void> | void
  onDeleteMistake?: (id: string) => Promise<void> | void

  // ── Bookmarks integration ──────────────────────────────────────────
  /** Recording-anchored free markers (no game-time mapping). */
  bookmarks?: BookmarkData[]
  /** Triggered by hotkey `b` or the inline bookmark button. */
  onAddBookmark?: (payload: { videoTimeMs: number; label?: string }) => Promise<void> | void
  onDeleteBookmark?: (id: string) => Promise<void> | void
}

export function VideoReviewPlayer({
  src, notes, onAddNote, onEditNote, onDeleteNote, onFileNotFound, readonly,
  clipping, clipRange, onClipRangeChange,
  videoMaxHeight = 'max-h-[480px]',
  gameEvents, gameMeta, seekToGameTimeSec,
  mistakes, mistakeTags, onAddMistake, onDeleteMistake,
  bookmarks, onAddBookmark, onDeleteBookmark,
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
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState(0)
  const [marking, setMarking] = useState(false)
  const [pendingNote, setPendingNote] = useState('')
  const [markedAt, setMarkedAt] = useState(0)
  const [flashIcon, setFlashIcon] = useState<'play' | 'pause' | null>(null)
  const [videoError, setVideoError] = useState(false)
  // True when we've waited >3s and the <video> still has no metadata
  // (duration=0). Usually means the file is still being finalized by ffmpeg.
  const [awaitingMetadata, setAwaitingMetadata] = useState(false)
  // Track how many auto-retries we've fired so we don't loop infinitely.
  const retryCountRef = useRef(0)
  const [sidebarPosition, setSidebarPosition] = useState<SidebarPosition>('right')
  // Which sidebar sections are visible. The sidebar exists in BOTH windowed
  // and fullscreen modes, and shows several sections AT ONCE (notes +
  // mistakes + bookmarks) — the chips just filter what's listed. Persisted so
  // the choice sticks across recordings.
  const [visibleSections, setVisibleSections] = useState<Set<SidebarSection>>(() => {
    try {
      const raw = localStorage.getItem('nm.player.sidebarSections')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const valid = (parsed as string[]).filter(
            (s): s is SidebarSection => s === 'notes' || s === 'mistakes' || s === 'bookmarks',
          )
          if (valid.length > 0) return new Set<SidebarSection>(valid)
        }
      }
    } catch { /* ignore */ }
    return new Set<SidebarSection>(['notes', 'mistakes', 'bookmarks'])
  })
  useEffect(() => {
    try { localStorage.setItem('nm.player.sidebarSections', JSON.stringify([...visibleSections])) } catch { /* ignore */ }
  }, [visibleSections])
  // Show/hide the game-event markers (kills/dragons/etc) layer.
  const [showEvents, setShowEvents] = useState(true)
  // Per-category filter. null = all visible. A Set of types means show ONLY
  // those types. Persisted to localStorage so the user's last chip
  // selection auto-applies when they open the next recording — no need to
  // re-click "Deaths only" every time.
  const [eventFilter, setEventFilter] = useState<Set<GameEventType> | null>(() => {
    try {
      const raw = localStorage.getItem('nm.player.eventFilter')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed) || parsed.length === 0) return null
      const valid = new Set(EVENT_ORDER)
      const filtered = (parsed as string[]).filter((t): t is GameEventType => valid.has(t as GameEventType))
      return filtered.length > 0 ? new Set<GameEventType>(filtered) : null
    } catch { return null }
  })
  useEffect(() => {
    try {
      if (eventFilter === null) localStorage.removeItem('nm.player.eventFilter')
      else localStorage.setItem('nm.player.eventFilter', JSON.stringify([...eventFilter]))
    } catch { /* ignore */ }
  }, [eventFilter])
  // High-level filter mode — switches which events the renderer considers
  // before applying per-category chips. Persisted to localStorage so
  // jumping between recordings keeps the same view.
  const [filterMode, setFilterMode] = useState<EventFilterMode>(() => {
    try {
      const v = localStorage.getItem('nm.player.eventFilterMode')
      if (v === 'mine' || v === 'all' || v === 'objectives') return v
    } catch { /* ignore */ }
    return 'mine'
  })
  useEffect(() => {
    try { localStorage.setItem('nm.player.eventFilterMode', filterMode) } catch { /* ignore */ }
  }, [filterMode])
  // Custom "section-bounded fullscreen": uses position:fixed within the
  // app's content area (left:16rem matches the sidebar width) so the
  // sidebar stays visible — replaces the native Fullscreen API which
  // covered the whole window and broke the user's navigation.
  const [isFullscreen, setIsFullscreen] = useState(false)
  // True while the mouse has been idle long enough in fullscreen — used to
  // auto-hide the floating controls overlay (YouTube-style).
  const [controlsHidden, setControlsHidden] = useState(false)
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Inline note edit state — works in both fullscreen sidebar and inline notes list
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
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

  // ── Mistake Library state ─────────────────────────────────────────────
  // Toggle to hide/show heuristic-detected mistakes (off-by-default until
  // the user has decided the auto-detector is trustworthy). Persisted to
  // localStorage so the choice sticks across recordings.
  const [showAutoDetected, setShowAutoDetected] = useState<boolean>(() => {
    try { return localStorage.getItem('nm.player.showAutoDetected') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('nm.player.showAutoDetected', showAutoDetected ? '1' : '0') } catch { /* ignore */ }
  }, [showAutoDetected])
  // Open state + draft fields for the add-mistake dialog (opens via the
  // `x` hotkey or the inline "+ Mistake" button).
  const [mistakeDialogOpen, setMistakeDialogOpen] = useState(false)
  const [mistakeAtSec, setMistakeAtSec] = useState(0)
  const [mistakeTagId, setMistakeTagId] = useState<string>('')
  const [mistakeNote, setMistakeNote] = useState('')
  const [mistakeSeverity, setMistakeSeverity] = useState<1 | 2 | 3>(2)
  const [mistakeTagQuery, setMistakeTagQuery] = useState('')
  const [savingMistake, setSavingMistake] = useState(false)

  // Bookmark inline-add dialog: triggered by `b`. Single-line label.
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false)
  const [bookmarkAtMs, setBookmarkAtMs] = useState(0)
  const [bookmarkLabel, setBookmarkLabel] = useState('')

  // Keep a stable reference to the original index for edit/delete callbacks,
  // since `videoNotes` is filtered+sorted (its index ≠ index in `notes`).
  const videoNotes = notes
    .map((n, originalIndex) => ({ note: n, originalIndex }))
    .filter(({ note }) => note.videoTime !== undefined)
    .sort((a, b) => (a.note.videoTime ?? 0) - (b.note.videoTime ?? 0))

  // Map game events to video times once per (events, duration, meta) change.
  // Returns [] if metadata is missing, the video isn't loaded yet, or the
  // events were never provided — caller treats them as best-effort.
  //
  // Filter mode is applied here so it ripples through clustering / lanes
  // automatically; recomputing from scratch on toggle is fine because the
  // input list is tiny (<200 events) and computation is microseconds.
  const mappedEvents = useMemo(() => {
    if (!gameEvents || gameEvents.length === 0 || !gameMeta || duration <= 0) return []
    const gameEndAt = typeof gameMeta.gameEndAt === 'string' ? new Date(gameMeta.gameEndAt) : gameMeta.gameEndAt
    const recordingCreatedAt = typeof gameMeta.recordingCreatedAt === 'string'
      ? new Date(gameMeta.recordingCreatedAt)
      : gameMeta.recordingCreatedAt
    const out: Array<GameEvent & { videoTime: number }> = []
    for (const ev of gameEvents) {
      // Filter mode gate. "mine" only takes isPlayer=true events.
      // "objectives" only takes OBJECTIVE_TYPES (regardless of isPlayer).
      // "all" lets everything through.
      if (filterMode === 'mine' && !ev.isPlayer) continue
      if (filterMode === 'objectives' && !OBJECTIVE_TYPES.has(ev.type)) continue
      const t = gameTimeToVideoTime({
        eventGameTimeMs: ev.gameTimeMs,
        gameEndAt,
        gameDurationSec: gameMeta.gameDurationSec,
        recordingCreatedAt,
        videoDurationSec: duration,
        startOffsetSec: gameMeta.startOffsetSec,
      })
      if (t !== null) out.push({ ...ev, videoTime: t })
    }
    return out
  }, [gameEvents, gameMeta, duration, filterMode])

  /**
   * Cluster same-type adjacent events into a single marker with a count
   * badge — keeps the scrubber readable when (e.g.) a teamfight kills the
   * whole team in 5 seconds. A cluster's videoTime is the time of its FIRST
   * event so clicking the marker seeks to the start of the action.
   */
  const clusteredEvents = useMemo(() => {
    if (mappedEvents.length === 0) return [] as Array<{
      type: GameEventType
      videoTime: number
      gameTimeMs: number
      label: string
      count: number
      events: Array<GameEvent & { videoTime: number }>
    }>
    // Stable order: video time, then type so same-type clusters meet.
    const sorted = [...mappedEvents].sort((a, b) => a.videoTime - b.videoTime || a.type.localeCompare(b.type))
    const clusters: Array<{
      type: GameEventType
      videoTime: number
      gameTimeMs: number
      label: string
      count: number
      events: Array<GameEvent & { videoTime: number }>
    }> = []
    for (const ev of sorted) {
      // Same-type clustering: scan back through ALL same-type clusters
      // (not just the immediate previous one) so e.g. an objective taken
      // 20s after a kill cluster still merges with another nearby kill
      // cluster instead of starting a new one.
      const sameTypeBack = clusters
        .slice()
        .reverse()
        .find((c) => c.type === ev.type && Math.abs(ev.videoTime - c.events[c.events.length - 1].videoTime) <= CLUSTER_WINDOW_SEC)
      if (sameTypeBack) {
        sameTypeBack.count += 1
        sameTypeBack.events.push(ev)
        sameTypeBack.label = `${sameTypeBack.count}× ${EVENT_LABELS[ev.type]}`
      } else {
        clusters.push({
          type: ev.type,
          videoTime: ev.videoTime,
          gameTimeMs: ev.gameTimeMs,
          label: ev.label,
          count: 1,
          events: [ev],
        })
      }
    }
    return clusters
  }, [mappedEvents])

  /**
   * Collision-avoidance pass: when two clusters (of any type) end up at
   * roughly the same X position on the scrubber, bump the later one up by
   * a row so both icons stay visible. Without this, e.g. a "kill" and a
   * "death" both at game time 12:30 would render on top of each other
   * since they share lane Y=-16. Computes a per-cluster `stackOffset` in
   * px (always non-positive — markers stack upward).
   */
  const positionedClusters = useMemo(() => {
    if (clusteredEvents.length === 0) return [] as Array<typeof clusteredEvents[number] & { stackOffset: number }>
    const sorted = [...clusteredEvents].sort((a, b) => a.videoTime - b.videoTime)
    const placed: Array<typeof clusteredEvents[number] & { stackOffset: number }> = []
    for (const c of sorted) {
      // All previously-placed clusters within the collision window are
      // potential physical collisions, regardless of type — the icons take
      // up the same screen space even when they're conceptually in
      // different lanes (lanes are 16px apart, icons are 20px wide).
      const nearby = placed.filter((p) => Math.abs(p.videoTime - c.videoTime) <= COLLISION_WINDOW_SEC)
      const usedTiers = new Set(nearby.map((p) => Math.round(-p.stackOffset / COLLISION_BUMP_PX)))
      let tier = 0
      while (usedTiers.has(tier)) tier++
      placed.push({ ...c, stackOffset: -tier * COLLISION_BUMP_PX })
    }
    return placed
  }, [clusteredEvents])

  /**
   * Convert mistakes (game-time seconds) into the same video-time space as
   * the game-event markers. Mistakes without `videoTimeMs` are converted
   * via the same offset pipeline as gameEvents.
   */
  const mappedMistakes = useMemo(() => {
    if (!mistakes || mistakes.length === 0 || duration <= 0) return []
    const out: Array<Mistake & { videoTime: number }> = []
    for (const m of mistakes) {
      if (!showAutoDetected && m.autoDetected) continue
      // Prefer the stored videoTimeMs (saved at marker creation). Fall back
      // to recomputing through the gameMeta pipeline when missing.
      let videoTime: number | null = null
      if (typeof m.videoTimeMs === 'number' && m.videoTimeMs >= 0) {
        videoTime = m.videoTimeMs / 1000
      } else if (gameMeta) {
        const gameEndAt = typeof gameMeta.gameEndAt === 'string' ? new Date(gameMeta.gameEndAt) : gameMeta.gameEndAt
        const recordingCreatedAt = typeof gameMeta.recordingCreatedAt === 'string'
          ? new Date(gameMeta.recordingCreatedAt)
          : gameMeta.recordingCreatedAt
        videoTime = gameTimeToVideoTime({
          eventGameTimeMs: m.gameTimeSec * 1000,
          gameEndAt,
          gameDurationSec: gameMeta.gameDurationSec,
          recordingCreatedAt,
          videoDurationSec: duration,
          startOffsetSec: gameMeta.startOffsetSec,
        })
      }
      if (videoTime !== null && videoTime >= 0 && videoTime <= duration) {
        out.push({ ...m, videoTime })
      }
    }
    return out
  }, [mistakes, showAutoDetected, gameMeta, duration])

  const cycleSidebar = useCallback(() => {
    setSidebarPosition((pos) => {
      if (pos === 'right') return 'left'
      if (pos === 'left') return 'hidden'
      return 'right'
    })
  }, [])

  // Bring the sidebar back (if hidden) and make sure a section is enabled —
  // used when the user triggers an action (mark / mistake / bookmark) so the
  // relevant section is immediately visible instead of staying filtered out.
  const revealSidebar = useCallback((section: SidebarSection) => {
    setVisibleSections((prev) => (prev.has(section) ? prev : new Set(prev).add(section)))
    setSidebarPosition((pos) => (pos === 'hidden' ? 'right' : pos))
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

  // Deep-link seek: when a parent passes `seekToGameTimeSec` (e.g. the Lane
  // Phase Comparator jumping to the 12-min dip), map it to video time via the
  // same offset pipeline the event markers use, then seek + play. Applied
  // once per distinct value, and only after metadata is ready (duration>0).
  const appliedSeekRef = useRef<number | null>(null)
  useEffect(() => {
    if (seekToGameTimeSec == null || !gameMeta || duration <= 0) return
    if (appliedSeekRef.current === seekToGameTimeSec) return
    const gameEndAt = typeof gameMeta.gameEndAt === 'string' ? new Date(gameMeta.gameEndAt) : gameMeta.gameEndAt
    const recordingCreatedAt = typeof gameMeta.recordingCreatedAt === 'string' ? new Date(gameMeta.recordingCreatedAt) : gameMeta.recordingCreatedAt
    let vt = gameTimeToVideoTime({
      eventGameTimeMs: seekToGameTimeSec * 1000,
      gameEndAt,
      gameDurationSec: gameMeta.gameDurationSec,
      recordingCreatedAt,
      videoDurationSec: duration,
      startOffsetSec: gameMeta.startOffsetSec,
    })
    if (vt === null) {
      // Fallback: video time = game time + offset (mirror of openMistakeDialog).
      let offsetSec = typeof gameMeta.startOffsetSec === 'number' && Number.isFinite(gameMeta.startOffsetSec)
        ? gameMeta.startOffsetSec
        : (recordingCreatedAt.getTime() - (gameEndAt.getTime() - gameMeta.gameDurationSec * 1000)) / 1000
      if (!Number.isFinite(offsetSec)) offsetSec = 0
      vt = seekToGameTimeSec + offsetSec
    }
    const clamped = Math.max(0, Math.min(duration, vt))
    if (videoRef.current) {
      videoRef.current.currentTime = clamped
      videoRef.current.play().catch(() => {})
    }
    setCurrentTime(clamped)
    appliedSeekRef.current = seekToGameTimeSec
  }, [seekToGameTimeSec, duration, gameMeta])

  // ── Progress bar interaction (drag scrub + zoom) ─────────────────────────────

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
  // SECTION-BOUNDED fullscreen: the player goes position:fixed within
  // the content area (left:16rem matches the sidebar) instead of using
  // the native Fullscreen API which covered the whole window and hid the
  // sidebar / drag region. ESC still exits.
  //
  // We DO NOT swap the JSX subtree, so the same <video> stays mounted
  // (no playback reset on toggle).

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev)
  }

  // Retry loading when duration stays at 0 — usually means the file was loaded
  // before ffmpeg/remux finished writing the moov atom. We retry once at 3s,
  // and again at 8s; after that we show a clear "still finalizing" message
  // (the parent panel also subscribes to recording:ready and will reload us).
  useEffect(() => {
    retryCountRef.current = 0
    setAwaitingMetadata(false)
  }, [src])

  useEffect(() => {
    if (duration > 0) {
      setAwaitingMetadata(false)
      return
    }
    if (videoError) return
    const timer = setTimeout(() => {
      const v = videoRef.current
      if (!v || v.duration > 0) return
      if (retryCountRef.current < 3) {
        retryCountRef.current++
        try { v.load() } catch { /* ignore */ }
      }
      // After the first retry (3s), surface the "still loading" state.
      setAwaitingMetadata(true)
    }, retryCountRef.current === 0 ? 3000 : 4000)
    return () => clearTimeout(timer)
  }, [duration, videoError, src])

  // ESC exits our custom section-fullscreen mode (mirrors the native API
  // UX so the user's muscle memory still works).
  useEffect(() => {
    if (!isFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isFullscreen])

  // Auto-hide controls in fullscreen after 2.5s of mouse idle. Any mouse
  // move re-shows them and resets the timer. Hover over the controls bar
  // itself also keeps them visible (handled via onMouseEnter on the bar).
  const showControlsTemporarily = useCallback(() => {
    setControlsHidden(false)
    if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current)
    if (!isFullscreen) return
    controlsHideTimerRef.current = setTimeout(() => setControlsHidden(true), 2500)
  }, [isFullscreen])

  useEffect(() => {
    if (!isFullscreen) {
      // Leaving fullscreen — always show controls again.
      setControlsHidden(false)
      if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current)
      return
    }
    // Entering fullscreen — start the hide timer.
    showControlsTemporarily()
    return () => {
      if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current)
    }
  }, [isFullscreen, showControlsTemporarily])

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
        case 'n': cycleSidebar(); break
        case 'h':
          // Shortcut to directly TOGGLE the sidebar visibility (hide ↔ show on right).
          // Different from N (cycle right→left→hidden→right) — H is the one-shot
          // "give me back screen space NOW" key. Works in both windowed and
          // fullscreen now that the sidebar exists in both.
          setSidebarPosition((pos) => pos === 'hidden' ? 'right' : 'hidden')
          break
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
        case 'x':
          // Mistake tag at current video time — opens the inline dialog.
          // 'x' chosen because 'm' is mute and 'b' will be Bookmark.
          if (onAddMistake && gameMeta) {
            e.preventDefault()
            openMistakeDialog()
          }
          break
        case 'b':
          // Free bookmark at current video time. Works on any recording,
          // even orphans (no Game / gameMeta needed).
          if (onAddBookmark) {
            e.preventDefault()
            openBookmarkDialog()
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, skip, seekBy, speed, changeSpeed, isFullscreen, cycleSidebar, onAddMistake, gameMeta, onAddBookmark])

  // ── Mark moment ──────────────────────────────────────────────────────────────

  const handleMarkMoment = () => {
    if (!videoRef.current) return
    videoRef.current.pause()
    setMarkedAt(videoRef.current.currentTime)
    setMarking(true)
    setPendingNote('')
    revealSidebar('notes')
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

  // ── Mistake dialog handlers ────────────────────────────────────────────

  /**
   * Open the inline "+ Mistake" dialog anchored at the current video time.
   * Computes the in-game seconds from the recording offset so the saved
   * mistake is anchored to game time (re-aligns even if the user re-records
   * the same game later).
   */
  function openMistakeDialog() {
    const v = videoRef.current
    if (!v || !gameMeta) return
    v.pause()
    const vt = v.currentTime
    // Reverse-map videoTime → game time by subtracting the same offset
    // gameTimeToVideoTime would have added. Falls back to 0 if metadata is missing.
    const gameEndAt = typeof gameMeta.gameEndAt === 'string' ? new Date(gameMeta.gameEndAt) : gameMeta.gameEndAt
    const recordingCreatedAt = typeof gameMeta.recordingCreatedAt === 'string' ? new Date(gameMeta.recordingCreatedAt) : gameMeta.recordingCreatedAt
    let offsetSec = typeof gameMeta.startOffsetSec === 'number' && Number.isFinite(gameMeta.startOffsetSec)
      ? gameMeta.startOffsetSec
      : (recordingCreatedAt.getTime() - (gameEndAt.getTime() - gameMeta.gameDurationSec * 1000)) / 1000
    if (!Number.isFinite(offsetSec)) offsetSec = 0
    const gameSec = Math.max(0, Math.floor(vt - offsetSec))
    setMistakeAtSec(gameSec)
    setMistakeTagId('')
    setMistakeTagQuery('')
    setMistakeNote('')
    setMistakeSeverity(2)
    setMistakeDialogOpen(true)
    revealSidebar('mistakes')
  }

  async function saveMistake() {
    if (!onAddMistake || !mistakeTagId) return
    setSavingMistake(true)
    try {
      const v = videoRef.current
      const videoMs = v ? Math.floor(v.currentTime * 1000) : undefined
      await onAddMistake({
        tagId: mistakeTagId,
        gameTimeSec: mistakeAtSec,
        videoTimeMs: videoMs,
        note: mistakeNote.trim() || undefined,
        severity: mistakeSeverity,
      })
      setMistakeDialogOpen(false)
    } finally {
      setSavingMistake(false)
    }
  }

  function openBookmarkDialog() {
    const v = videoRef.current
    if (!v) return
    v.pause()
    setBookmarkAtMs(Math.floor(v.currentTime * 1000))
    setBookmarkLabel('')
    setBookmarkDialogOpen(true)
    revealSidebar('bookmarks')
  }

  async function saveBookmark() {
    if (!onAddBookmark) return
    await onAddBookmark({ videoTimeMs: bookmarkAtMs, label: bookmarkLabel.trim() || undefined })
    setBookmarkDialogOpen(false)
  }

  // ── Note edit / delete ───────────────────────────────────────────────────────

  const startEditNote = (index: number, currentText: string) => {
    setEditingNoteIndex(index)
    setEditingNoteText(currentText)
  }
  const commitEditNote = () => {
    if (editingNoteIndex !== null && editingNoteText.trim()) {
      onEditNote?.(editingNoteIndex, editingNoteText.trim())
    }
    setEditingNoteIndex(null)
    setEditingNoteText('')
  }
  const cancelEditNote = () => {
    setEditingNoteIndex(null)
    setEditingNoteText('')
  }
  const handleDeleteNote = (index: number) => {
    onDeleteNote?.(index)
    if (editingNoteIndex === index) cancelEditNote()
  }

  // When zoomed, compute a window of [windowStart, windowEnd] centered on currentTime
  const windowDur = duration > 0 ? duration / zoomLevel : 0
  const windowStart = duration > 0
    ? Math.max(0, Math.min(duration - windowDur, currentTime - windowDur / 2))
    : 0
  const windowEnd = windowStart + windowDur

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

  // ── Reusable note row (edit / delete inline) ────────────────────────────────

  // Note row UX:
  //   - Click the timestamp pill → seek to that moment in the video.
  //   - Click anywhere on the note TEXT itself → enters inline edit mode.
  //     (commits on Enter / blur, cancels on Escape — no extra buttons needed)
  //   - A trash icon appears on hover to delete the note.
  // This mirrors the inline (non-fullscreen) editing UX — the user just clicks
  // the text and types, no tiny pencil button to aim at.
  const renderNoteRow = (note: TimelineNote, originalIndex: number) => {
    const isEditing = editingNoteIndex === originalIndex
    const canEdit = !readonly && !!onEditNote
    const canDelete = !readonly && !!onDeleteNote
    return (
      <div key={originalIndex} className="flex items-start gap-2 group/note">
        <button
          onClick={() => seekTo(note.videoTime!)}
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-[#00C8C8] bg-[#00C8C8]/10 hover:bg-[#00C8C8]/20 transition-colors"
        >
          ▶ {fmt(note.videoTime!)}
        </button>
        {isEditing ? (
          <input
            autoFocus
            type="text"
            value={editingNoteText}
            onChange={(e) => setEditingNoteText(e.target.value)}
            onBlur={commitEditNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitEditNote() }
              if (e.key === 'Escape') { e.preventDefault(); cancelEditNote() }
            }}
            className="flex-1 min-w-0 bg-transparent border-b border-[#00C8C8]/40 text-xs text-white focus:outline-none focus:border-[#00C8C8] py-0.5"
          />
        ) : (
          <>
            {canEdit ? (
              <button
                type="button"
                onClick={() => startEditNote(originalIndex, note.note)}
                title="Click to edit"
                className="text-white/70 leading-tight pt-0.5 text-xs flex-1 break-words text-left hover:text-white transition-colors cursor-text"
              >
                {note.note}
              </button>
            ) : (
              <span className="text-white/70 leading-tight pt-0.5 text-xs flex-1 break-words">{note.note}</span>
            )}
            {canDelete && (
              <button
                onClick={() => handleDeleteNote(originalIndex)}
                title="Delete note"
                className="opacity-0 group-hover/note:opacity-100 transition-opacity shrink-0 text-white/40 hover:text-[#E24C3A] p-0.5"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Mark input (used both inline and in sidebar) ─────────────────────────────

  const markInputBlock = marking && (
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
  )

  // ── Reusable dialog blocks (rendered inside the sidebar in both modes) ──

  const bookmarkDialogBlock = bookmarkDialogOpen && (
    <div className="rounded-lg border border-hextech-cyan/40 bg-hextech-cyan/5 p-2.5 flex items-center gap-2">
      <Bookmark className="h-3.5 w-3.5 text-hextech-cyan shrink-0" />
      <span className="text-xs font-mono text-hextech-cyan shrink-0 bg-hextech-cyan/10 rounded px-1.5 py-0.5">
        {fmt(bookmarkAtMs / 1000)}
      </span>
      <input
        autoFocus
        type="text"
        value={bookmarkLabel}
        onChange={(e) => setBookmarkLabel(e.target.value)}
        placeholder="Label (optional)…"
        onKeyDown={(e) => {
          if (e.key === 'Enter') saveBookmark()
          if (e.key === 'Escape') setBookmarkDialogOpen(false)
        }}
        className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none min-w-0"
      />
      <button onClick={saveBookmark} className="text-green-400 hover:opacity-80 shrink-0">
        <Check className="h-4 w-4" />
      </button>
      <button onClick={() => setBookmarkDialogOpen(false)} className="text-white/40 hover:text-white shrink-0">
        <X className="h-4 w-4" />
      </button>
    </div>
  )

  const mistakeDialogBlock = mistakeDialogOpen && (
    <div className="rounded-lg border border-amber-400/40 bg-amber-500/5 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-300" />
        <span className="text-xs text-amber-200">
          Tag a mistake at game time{' '}
          <span className="font-mono bg-amber-500/15 rounded px-1.5">{fmt(mistakeAtSec)}</span>
        </span>
        <div className="flex-1" />
        <button onClick={() => setMistakeDialogOpen(false)} className="text-white/40 hover:text-white" title="Close (Esc)">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tag picker — simple search filter over a chip cloud. */}
      <input
        autoFocus
        type="text"
        value={mistakeTagQuery}
        onChange={(e) => setMistakeTagQuery(e.target.value)}
        placeholder="Filter tags…"
        className="w-full bg-transparent border-b border-white/10 text-xs text-white py-1 focus:outline-none focus:border-amber-400/60"
      />
      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
        {(mistakeTags ?? [])
          .filter((t) => !mistakeTagQuery || t.label.toLowerCase().includes(mistakeTagQuery.toLowerCase()) || t.slug.includes(mistakeTagQuery.toLowerCase()))
          .map((t) => {
            const active = mistakeTagId === t.id
            return (
              <button
                key={t.id}
                onClick={() => setMistakeTagId(t.id)}
                style={active ? { borderColor: t.color ?? '#FFB454', backgroundColor: `${t.color ?? '#FFB454'}25` } : undefined}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                  active ? 'text-white' : 'border-white/15 text-white/50 hover:text-white hover:border-white/30',
                )}
              >
                {t.label}
                <span className="ml-1 opacity-50 capitalize">· {t.category}</span>
              </button>
            )
          })}
        {(mistakeTags?.length ?? 0) === 0 && (
          <span className="text-[10px] text-white/40">No tags available — restart the app to seed them.</span>
        )}
      </div>

      <textarea
        value={mistakeNote}
        onChange={(e) => setMistakeNote(e.target.value)}
        placeholder="Note (optional)…"
        rows={2}
        className="w-full rounded bg-black/30 border border-white/10 text-xs text-white p-2 resize-none focus:outline-none focus:border-amber-400/40"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-white/40 uppercase tracking-wider">Severity:</span>
        {([1, 2, 3] as const).map((s) => (
          <button
            key={s}
            onClick={() => setMistakeSeverity(s)}
            className={cn(
              'rounded px-2 py-0.5 text-[10px] font-semibold uppercase transition-colors',
              mistakeSeverity === s
                ? s === 1 ? 'bg-emerald-500/30 text-emerald-200'
                  : s === 2 ? 'bg-amber-500/30 text-amber-200'
                  : 'bg-[#E24C3A]/30 text-red-200'
                : 'bg-white/5 text-white/40 hover:bg-white/10',
            )}
          >
            {s === 1 ? 'Minor' : s === 2 ? 'Standard' : 'Critical'}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={saveMistake}
          disabled={!mistakeTagId || savingMistake}
          className="rounded bg-amber-500 text-black px-3 py-1 text-xs font-semibold hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {savingMistake ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
        </button>
      </div>
    </div>
  )

  // ── Unified filterable sidebar (Notes + Mistakes + Bookmarks together) ──
  // Rendered in BOTH windowed and fullscreen modes so the user can watch the
  // replay and review their annotations at the same time. Unlike exclusive
  // tabs, ALL enabled sections are shown stacked at once; the chips just
  // filter which sections are listed (e.g. "mistakes only", or notes +
  // mistakes together). Sections only exist when the host page wired up the
  // corresponding feature.
  const showMistakesSection = !!onAddMistake || (mistakes?.length ?? 0) > 0
  const showBookmarksSection = !!onAddBookmark || (bookmarks?.length ?? 0) > 0
  const availableSections: Array<{ id: SidebarSection; label: string; count: number; Icon: LucideIcon }> = [
    { id: 'notes', label: 'Notes', count: videoNotes.length, Icon: MessageSquare },
    ...(showMistakesSection ? [{ id: 'mistakes' as const, label: 'Mistakes', count: mappedMistakes.length, Icon: AlertTriangle }] : []),
    ...(showBookmarksSection ? [{ id: 'bookmarks' as const, label: 'Marks', count: bookmarks?.length ?? 0, Icon: Bookmark }] : []),
  ]
  const sidebarHasAnyContent = videoNotes.length > 0 || mappedMistakes.length > 0 || (bookmarks?.length ?? 0) > 0 || !!onAddNote || showMistakesSection || showBookmarksSection
  // A section is rendered when it's available AND enabled in the filter.
  // If the user turned every chip off we still show nothing (their choice).
  const sectionVisible = (id: SidebarSection) => visibleSections.has(id)

  const notesSection = (
    <section className="space-y-1.5">
      <p className="text-[9px] text-white/30 uppercase tracking-widest font-semibold flex items-center gap-1.5">
        <MessageSquare className="h-3 w-3" /> Notes
      </p>
      {marking && markInputBlock}
      {videoNotes.length === 0 && !marking ? (
        <p className="text-[11px] text-white/25">
          No moments marked yet.
          {!readonly && onAddNote && <> Press <kbd className="px-1 rounded bg-white/10 font-mono">Mark</kbd>.</>}
        </p>
      ) : (
        videoNotes.map(({ note, originalIndex }) => renderNoteRow(note, originalIndex))
      )}
    </section>
  )

  const mistakesSection = (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] text-amber-200/60 uppercase tracking-widest font-semibold flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> Mistakes
        </p>
        {(mistakes?.some((m) => m.autoDetected) ?? false) && (
          <button
            onClick={() => setShowAutoDetected((v) => !v)}
            title={showAutoDetected ? 'Hide auto-detected mistakes' : 'Show auto-detected mistakes'}
            className={cn(
              'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors',
              showAutoDetected ? 'bg-amber-500/30 text-amber-200' : 'bg-white/5 text-white/40 hover:bg-white/10',
            )}
          >
            Auto {showAutoDetected ? 'on' : 'off'}
          </button>
        )}
      </div>
      {mistakeDialogBlock}
      {mappedMistakes.length === 0 && !mistakeDialogOpen ? (
        <p className="text-[11px] text-white/25">
          No mistakes tagged yet.
          {onAddMistake && <> Press <kbd className="px-1 rounded bg-white/10 font-mono">X</kbd>.</>}
        </p>
      ) : (
        mappedMistakes.map((m) => (
          <div key={m.id} className="flex items-start gap-2 group/mistake">
            <button
              onClick={() => seekTo(m.videoTime)}
              className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
            >
              ▶ {fmt(m.videoTime)}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/80 leading-tight">
                {m.tag.label}
                {m.autoDetected && <span className="ml-1.5 text-[9px] text-white/40 uppercase tracking-wider">auto</span>}
              </p>
              {m.note && <p className="text-[10px] text-white/40 break-words">{m.note}</p>}
            </div>
            {onDeleteMistake && (
              <button
                onClick={() => onDeleteMistake(m.id)}
                title="Delete mistake"
                className="opacity-0 group-hover/mistake:opacity-100 transition-opacity shrink-0 text-white/40 hover:text-[#E24C3A] p-0.5"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))
      )}
    </section>
  )

  const bookmarksSection = (
    <section className="space-y-1.5">
      <p className="text-[9px] text-hextech-cyan/60 uppercase tracking-widest font-semibold flex items-center gap-1.5">
        <Bookmark className="h-3 w-3" /> Bookmarks
      </p>
      {bookmarkDialogBlock}
      {(bookmarks?.length ?? 0) === 0 && !bookmarkDialogOpen ? (
        <p className="text-[11px] text-white/25">
          No bookmarks yet.
          {onAddBookmark && <> Press <kbd className="px-1 rounded bg-white/10 font-mono">B</kbd>.</>}
        </p>
      ) : (
        bookmarks?.map((b) => (
          <div key={b.id} className="flex items-start gap-2 group/bookmark">
            <button
              onClick={() => seekTo(b.videoTimeMs / 1000)}
              className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-hextech-cyan bg-hextech-cyan/10 hover:bg-hextech-cyan/20 transition-colors"
            >
              ▶ {fmt(b.videoTimeMs / 1000)}
            </button>
            <span className="text-xs text-white/80 leading-tight flex-1 break-words">
              {b.label || <span className="text-white/30 italic">Unlabeled</span>}
            </span>
            {onDeleteBookmark && (
              <button
                onClick={() => onDeleteBookmark(b.id)}
                title="Delete bookmark"
                className="opacity-0 group-hover/bookmark:opacity-100 transition-opacity shrink-0 text-white/40 hover:text-[#E24C3A] p-0.5"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))
      )}
    </section>
  )

  const sidebarPanel = (
    <div
      className={cn(
        'w-72 max-w-[40vw] flex flex-col bg-[#050A10] shrink-0 self-stretch',
        sidebarPosition === 'left'
          ? 'border-r border-white/10 order-first'
          : 'border-l border-white/10',
      )}
    >
      {/* Filter chips (one per available section) + collapse button. Each
          chip independently toggles its section, so notes + mistakes can be
          shown together, or filtered down to just one. */}
      <div className="flex items-stretch border-b border-white/5">
        <div className="flex flex-1 min-w-0 items-center gap-1 px-2 py-1.5 flex-wrap">
          {availableSections.map(({ id, label, count, Icon }) => {
            const on = sectionVisible(id)
            return (
              <button
                key={id}
                onClick={() => setVisibleSections((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })}
                title={on ? `Hide ${label}` : `Show ${label}`}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                  on
                    ? id === 'mistakes'
                      ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                      : id === 'bookmarks'
                        ? 'border-hextech-cyan/40 bg-hextech-cyan/15 text-hextech-cyan'
                        : 'border-hextech-gold/40 bg-hextech-gold/15 text-hextech-gold'
                    : 'border-white/10 text-white/35 hover:text-white/70 hover:bg-white/5',
                )}
              >
                <Icon className="h-2.5 w-2.5 shrink-0" />
                <span>{label}</span>
                {count > 0 && <span className="opacity-60">{count}</span>}
              </button>
            )
          })}
        </div>
        <button
          onClick={() => setSidebarPosition('hidden')}
          title="Hide sidebar (H)"
          className="px-2 text-white/40 hover:text-white border-l border-white/5 shrink-0"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Stacked sections — all enabled sections shown at once, separated by
          dividers. This lets the user read mistakes AND notes together. */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 divide-y divide-white/5 [&>section]:py-2.5 [&>section:first-child]:pt-0">
        {sectionVisible('notes') && notesSection}
        {showMistakesSection && sectionVisible('mistakes') && mistakesSection}
        {showBookmarksSection && sectionVisible('bookmarks') && bookmarksSection}
        {availableSections.every((s) => !sectionVisible(s.id)) && (
          <p className="text-[11px] text-white/25 text-center pt-6">All sections hidden — tap a chip above to show one.</p>
        )}
      </div>
    </div>
  )

  // Re-open handle shown on the right edge whenever the sidebar is hidden
  // (works in windowed and fullscreen). Prevents the "I hid the panel and
  // can't get it back" trap.
  const sidebarReopenHandle = sidebarHasAnyContent && (
    <button
      type="button"
      onClick={() => setSidebarPosition('right')}
      title="Show panel (H)"
      className="absolute right-0 top-1/2 -translate-y-1/2 z-40 inline-flex items-center gap-1 rounded-l-md bg-hextech-gold/80 hover:bg-hextech-gold text-black px-1.5 py-3 text-[10px] font-semibold uppercase tracking-wider shadow-lg"
      style={{ writingMode: 'vertical-rl' }}
    >
      <PanelRight className="h-3 w-3 rotate-180" />
      <span>Panel</span>
    </button>
  )

  // ── Single layout — same DOM in/out of fullscreen so <video> stays mounted ──

  // Whether to render the video as a full-cover layer (controls overlay
  // on top, sidebar absent). True only when in fullscreen AND no sidebar.
  // Otherwise the sidebar would get covered by the absolute inset-0 layer.
  const videoCoversScreen = isFullscreen && sidebarPosition === 'hidden'
  const sidebarVisible = sidebarPosition !== 'hidden' && sidebarHasAnyContent

  return (
    <div
      ref={containerRef}
      onMouseMove={isFullscreen ? showControlsTemporarily : undefined}
      // Section-bounded fullscreen: `fixed` with left:16rem (sidebar
      // width) and top:36px (the app's drag region). Keeps the nav
      // visible — replaces the native Fullscreen API which used to cover
      // the entire window and broke the user's navigation.
      style={
        isFullscreen
          ? { position: 'fixed', left: '16rem', top: '36px', right: 0, bottom: 0, zIndex: 40 }
          : undefined
      }
      className={cn(
        'select-none bg-[#050A10]',
        isFullscreen
          ? cn(
              'overflow-hidden',
              // Sidebar visible → use flex row so sidebar gets its column.
              // Sidebar hidden → video uses absolute inset-0 to fill the area.
              !videoCoversScreen && 'flex',
              // Hide cursor when controls auto-hid, à la YouTube fullscreen.
              controlsHidden && 'cursor-none',
            )
          // Windowed mode is now ALSO a flex row so the notes/mistakes
          // sidebar sits next to the video (watch + review at once).
          // `relative` anchors the re-open handle when the sidebar is hidden.
          : 'relative flex rounded-xl overflow-hidden border border-white/10',
      )}
    >
      {/* Video column. In fullscreen WITHOUT sidebar the video fills the
          entire container (absolute inset-0) and the progress + controls
          overlay on top with auto-hide. In fullscreen WITH sidebar the
          column stays in the flex row (flex-1) so the sidebar gets its
          space. In windowed mode it's a normal stacked column. */}
      <div
        className={cn(
          'min-w-0',
          isFullscreen
            ? videoCoversScreen
              ? 'absolute inset-0 flex flex-col'
              : 'flex-1 flex flex-col relative'
            : 'flex-1 flex flex-col',
        )}
      >
        <div
          className={cn(
            'relative bg-black cursor-pointer',
            isFullscreen ? 'flex-1 min-h-0' : '',
          )}
          onClick={togglePlay}
        >
          <video
            ref={videoRef}
            src={src}
            className={cn(
              'block object-contain',
              isFullscreen ? 'w-full h-full' : cn('w-full', videoMaxHeight),
            )}
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
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-3">
              {awaitingMetadata ? (
                <>
                  <div className="rounded-full bg-black/70 p-4">
                    <Loader2 className="h-10 w-10 text-hextech-gold animate-spin" />
                  </div>
                  <div className="text-center px-4 max-w-md">
                    <p className="text-sm font-medium text-white">Finalizing video…</p>
                    <p className="text-xs text-white/60 mt-1">
                      The recording is still being processed. It will become playable in a few seconds.
                    </p>
                  </div>
                </>
              ) : (
                <div className="rounded-full bg-black/60 p-5">
                  <Play className="h-12 w-12 text-hextech-gold fill-hextech-gold" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Progress bar + controls. In fullscreen this whole block becomes
            a translucent overlay docked to the bottom of the container so
            the video keeps the entire screen. Auto-hides after 2.5s of
            mouse idle (see useEffect above). */}
        <div
          onMouseEnter={isFullscreen ? showControlsTemporarily : undefined}
          className={cn(
            isFullscreen
              ? cn(
                  'absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/95 via-black/80 to-transparent pt-6 pointer-events-auto transition-opacity duration-200',
                  controlsHidden ? 'opacity-0 pointer-events-none' : 'opacity-100',
                )
              : '',
          )}
        >
        {/* Progress bar. The big top padding when events are visible
            reserves room for the up-to-3 marker lanes that float above
            the scrubber (kill/death/assist lane, objectives lane,
            building lane). Without it the icons would overflow into
            the video area above. */}
        <div
          className={cn(
            'px-3 pb-1',
            showEvents && positionedClusters.length > 0 ? 'pt-20' : 'pt-3',
          )}
        >
          {zoomLevel > 1 && (
            <div className="flex items-center justify-between mb-1 text-[9px] font-mono text-white/30">
              <span>{fmt(windowStart)}</span>
              <span className="text-hextech-gold/60">{zoomLevel}× zoom</span>
              <span>{fmt(windowEnd)}</span>
            </div>
          )}
          <div
            ref={progressRef}
            className="relative h-5 cursor-pointer group"
            onMouseDown={handleProgressMouseDown}
            onMouseMove={handleProgressHover}
            onMouseLeave={() => setHoverTime(null)}
          >
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 group-hover:h-3 bg-white/10 rounded-full transition-[height] duration-100 pointer-events-none" />
            <div
              className="absolute top-1/2 -translate-y-1/2 left-0 h-1.5 group-hover:h-3 bg-hextech-gold rounded-full transition-[height] duration-100 pointer-events-none"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-hextech-gold shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30"
              style={{ left: `${progress}%` }}
            />

            {/* Clip range */}
            {clipping && clipRange && duration > 0 && (
              <>
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
                    dragOffsetMsRef.current = ratio * d * 1000 - clipRange.startMs
                    draggingHandleRef.current = 'body'
                  }}
                >
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover/clip:opacity-100 transition-opacity">
                    <div className="flex gap-0.5">
                      <div className="w-0.5 h-3 rounded bg-white/40" />
                      <div className="w-0.5 h-3 rounded bg-white/40" />
                      <div className="w-0.5 h-3 rounded bg-white/40" />
                    </div>
                  </div>
                </div>

                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-6 rounded bg-hextech-teal cursor-ew-resize z-20 flex items-center justify-center shadow-md"
                  style={{ left: `${timeToPercent(clipRange.startMs / 1000)}%` }}
                  onMouseDown={(e) => { e.stopPropagation(); draggingHandleRef.current = 'start' }}
                >
                  <div className="w-0.5 h-3.5 bg-white/70 rounded" />
                </div>

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
            {duration > 0 && videoNotes.map(({ note, originalIndex }) => {
              const pct = timeToPercent(note.videoTime ?? 0)
              if (pct < 0 || pct > 100) return null
              return (
                <button
                  key={originalIndex}
                  title={`${fmt(note.videoTime!)} — ${note.note}`}
                  onClick={(e) => { e.stopPropagation(); seekTo(note.videoTime!) }}
                  style={{ left: `${pct}%` }}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#00C8C8] border-2 border-[#050A10] hover:scale-150 transition-transform z-10"
                />
              )
            })}

            {/* Game event markers — Insight-Capture style. Icons stack
                ABOVE the scrubber on 3 category lanes (K/D/A, objectives,
                buildings); colliding markers at the same X get an
                additional vertical bump from the collision pass so two
                icons never overlap. Cluster badges keep teamfights from
                spamming the bar (4 deaths → one Skull · 4). */}
            {showEvents && duration > 0 && positionedClusters.map((c, idx) => {
              if (eventFilter && !eventFilter.has(c.type)) return null
              const pct = timeToPercent(c.videoTime)
              if (pct < 0 || pct > 100) return null
              const lane = EVENT_LANE[c.type] ?? 0
              const color = EVENT_COLORS[c.type] ?? 'bg-white text-black'
              const Icon = EVENT_ICONS[c.type]
              const inGameMin = Math.floor(c.gameTimeMs / 60000)
              const inGameSec = Math.floor((c.gameTimeMs % 60000) / 1000)
              const tooltip =
                c.count === 1
                  ? `${fmt(c.videoTime)} (video) · ${inGameMin}:${String(inGameSec).padStart(2, '0')} (in-game) — ${c.label}`
                  : `${fmt(c.videoTime)} · ${c.count}× ${EVENT_LABELS[c.type]} in ${CLUSTER_WINDOW_SEC}s window`
              return (
                <button
                  key={`evt-${idx}`}
                  title={tooltip}
                  onClick={(e) => { e.stopPropagation(); seekTo(c.videoTime) }}
                  style={{ left: `${pct}%`, top: `calc(50% + ${lane + c.stackOffset}px)` }}
                  className={cn(
                    'absolute -translate-y-1/2 -translate-x-1/2 rounded-md border border-black/60 shadow-md flex items-center justify-center gap-0.5 hover:scale-[1.4] hover:z-30 transition-transform z-[5]',
                    // Wider when there's a count badge so the number fits.
                    c.count > 1 ? 'h-5 px-1' : 'w-5 h-5',
                    color,
                  )}
                >
                  <Icon className="w-3 h-3 shrink-0" strokeWidth={2.75} />
                  {c.count > 1 && (
                    <span className="text-[9px] font-bold leading-none pr-0.5">{c.count}</span>
                  )}
                </button>
              )
            })}

            {/* Bookmark markers — anchored to videoTimeMs (no game-time
                mapping). Cyan ribbon shape so they stand out from the
                gold mistake triangles and the colored event chips. Sits
                ABOVE the mistake lane (top:-92px). */}
            {duration > 0 && bookmarks?.map((b) => {
              const pct = timeToPercent(b.videoTimeMs / 1000)
              if (pct < 0 || pct > 100) return null
              const bg = b.color ?? '#00C8C8'
              return (
                <button
                  key={`bookmark-${b.id}`}
                  title={`${fmt(b.videoTimeMs / 1000)} — ${b.label ?? 'Bookmark'}`}
                  onClick={(e) => { e.stopPropagation(); seekTo(b.videoTimeMs / 1000) }}
                  style={{ left: `${pct}%`, top: 'calc(50% - 92px)', backgroundColor: bg }}
                  className="absolute -translate-y-1/2 -translate-x-1/2 flex items-center justify-center w-5 h-5 rounded-md border border-black/60 shadow-md hover:scale-[1.4] hover:z-30 transition-transform z-[6]"
                >
                  <Bookmark className="w-3 h-3 text-black" strokeWidth={2.75} />
                </button>
              )
            })}

            {/* Mistake markers — dedicated lane above everything else so
                they're never visually mixed with game events. Triangle
                badge in the tag's color; AUTO badge for heuristic-detected
                rows so the user can tell at a glance which markers came
                from the detector. */}
            {duration > 0 && mappedMistakes.map((m) => {
              const pct = timeToPercent(m.videoTime)
              if (pct < 0 || pct > 100) return null
              const bg = m.tag.color ?? '#FFB454'
              const isAuto = m.autoDetected
              return (
                <button
                  key={`mistake-${m.id}`}
                  title={`${fmt(m.videoTime)} — ${m.tag.label}${isAuto ? ' · AUTO' : ''}${m.note ? `\n${m.note}` : ''}`}
                  onClick={(e) => { e.stopPropagation(); seekTo(m.videoTime) }}
                  style={{ left: `${pct}%`, top: 'calc(50% - 72px)', backgroundColor: bg }}
                  className={cn(
                    'absolute -translate-y-1/2 -translate-x-1/2 flex items-center justify-center gap-0.5 rounded border border-black/60 shadow-md hover:scale-[1.4] hover:z-30 transition-transform z-[6]',
                    isAuto ? 'h-4 px-1 opacity-80' : 'w-5 h-5',
                  )}
                >
                  <AlertTriangle className="w-3 h-3 text-black" strokeWidth={2.75} />
                  {isAuto && <span className="text-[7px] font-bold leading-none text-black/70">A</span>}
                </button>
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

          {/* Offset-mismatch banner: 38 events came back from the
              backend but none mapped to the video range, which means the
              recording's startOffsetSec is wrong (or the game/recording
              don't actually correspond). Surfaces this loudly instead of
              silently showing an empty timeline. */}
          {gameEvents && gameEvents.length > 0 && mappedEvents.length === 0 && duration > 0 && gameMeta && (() => {
            const offsetSec = (() => {
              const ge = typeof gameMeta.gameEndAt === 'string' ? new Date(gameMeta.gameEndAt) : gameMeta.gameEndAt
              const rc = typeof gameMeta.recordingCreatedAt === 'string' ? new Date(gameMeta.recordingCreatedAt) : gameMeta.recordingCreatedAt
              if (typeof gameMeta.startOffsetSec === 'number' && Number.isFinite(gameMeta.startOffsetSec)) return gameMeta.startOffsetSec
              const gameStartMs = ge.getTime() - gameMeta.gameDurationSec * 1000
              const fromBirth = (rc.getTime() - gameStartMs) / 1000
              if (Number.isFinite(fromBirth) && Math.abs(fromBirth) <= 600) return fromBirth
              return gameMeta.gameDurationSec - duration
            })()
            return (
              <div className="mt-2 mx-0.5 rounded-md border border-[#E24C3A]/40 bg-[#E24C3A]/10 px-2 py-1.5 text-[10px] text-[#E24C3A] leading-tight">
                <span className="font-semibold">{gameEvents.length} events loaded but none fit the video range</span>
                <span className="text-[#E24C3A]/70"> · offset {offsetSec.toFixed(1)}s, video {duration.toFixed(0)}s, game {gameMeta.gameDurationSec}s. Click "Refresh" in the header to recompute.</span>
              </div>
            )
          })()}

          {/* Top-level filter mode pills + per-category legend. The mode
              pills (Mine / All / Objectives) gate which events even
              reach the renderer; the category chips below let the user
              hide a specific type within that mode. */}
          {showEvents && (gameEvents?.length ?? 0) > 0 && (() => {
            const counts = mappedEvents.reduce<Record<string, number>>((acc, ev) => {
              acc[ev.type] = (acc[ev.type] ?? 0) + 1
              return acc
            }, {})
            const visibleTypes = EVENT_ORDER.filter((t) => counts[t] > 0)
            return (
              <div className="flex flex-wrap items-center gap-1 mt-2 px-0.5">
                {/* Mode pills */}
                <div className="flex items-center rounded-md border border-white/10 bg-white/5 p-0.5 mr-1">
                  {([
                    { id: 'mine' as const, label: 'Mine', Icon: User, title: 'Only events you were involved in' },
                    { id: 'all' as const, label: 'All', Icon: Users, title: 'All events including team-fight context' },
                    { id: 'objectives' as const, label: 'Objectives', Icon: Target, title: 'All objectives + towers regardless of participation' },
                  ]).map(({ id, label, Icon, title }) => {
                    const active = filterMode === id
                    return (
                      <button
                        key={id}
                        onClick={() => { setFilterMode(id); setEventFilter(null) }}
                        title={title}
                        className={cn(
                          'flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                          active
                            ? 'bg-hextech-gold/25 text-hextech-gold'
                            : 'text-white/40 hover:text-white/70 hover:bg-white/5',
                        )}
                      >
                        <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
                        <span>{label}</span>
                      </button>
                    )
                  })}
                </div>
                {visibleTypes.map((t) => {
                  const Icon = EVENT_ICONS[t]
                  const on = !eventFilter || eventFilter.has(t)
                  return (
                    <button
                      key={t}
                      onClick={() => {
                        setEventFilter((prev) => {
                          // First click on any chip from "all visible": start
                          // filtering with this single type selected.
                          if (!prev) {
                            return new Set(visibleTypes.filter((x) => x === t))
                          }
                          const next = new Set(prev)
                          if (next.has(t)) next.delete(t)
                          else next.add(t)
                          // If user re-enabled everything, drop the filter
                          // entirely so future categories show by default.
                          if (next.size === visibleTypes.length) return null
                          if (next.size === 0) return null
                          return next
                        })
                      }}
                      title={on ? `Hide ${EVENT_LABELS[t]}s` : `Show ${EVENT_LABELS[t]}s`}
                      className={cn(
                        'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border transition-all',
                        on
                          ? cn(EVENT_COLORS[t], 'border-white/20 hover:brightness-110')
                          : 'bg-white/5 text-white/30 border-white/10 hover:bg-white/10 hover:text-white/60',
                      )}
                    >
                      <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
                      <span>{EVENT_LABELS[t]}</span>
                      <span className="opacity-60">{counts[t]}</span>
                    </button>
                  )
                })}
                {eventFilter && (
                  <>
                    <button
                      onClick={() => setEventFilter(null)}
                      title="Show all event categories (also clears the saved default)"
                      className="text-[10px] text-white/40 hover:text-white/80 underline underline-offset-2 px-1"
                    >
                      Reset
                    </button>
                    {/* Subtle hint that the current chip selection is the
                        new default for future recordings — answers the
                        question "is this sticky?" without a settings menu. */}
                    <span
                      title="Your current chip selection is saved as the default for future recordings."
                      className="text-[9px] text-hextech-gold/50 px-1 italic"
                    >
                      saved as default
                    </span>
                  </>
                )}
              </div>
            )
          })()}
        </div>

        {/* Controls */}
        <div className="px-3 pb-3 flex items-center gap-1.5 flex-wrap">
          <button onClick={() => seekBy(-1000)} title="Back 1s ([)" className="text-white/50 hover:text-white transition-colors">
            <StepBack className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => skip(-10)} title="Back 10s (J)" className="flex items-center gap-0.5 rounded px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors text-xs">
            <RotateCcw className="h-3.5 w-3.5" /><span>10</span>
          </button>
          <button onClick={togglePlay} title="Play / Pause (Space)" className="rounded-full w-9 h-9 flex items-center justify-center bg-hextech-gold hover:bg-hextech-gold-bright text-black transition-colors shrink-0">
            {playing ? <Pause className="h-4 w-4 fill-black" /> : <Play className="h-4 w-4 fill-black ml-0.5" />}
          </button>
          <button onClick={() => skip(10)} title="Forward 10s (L)" className="flex items-center gap-0.5 rounded px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors text-xs">
            <span>10</span><RotateCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => seekBy(1000)} title="Forward 1s (])" className="text-white/50 hover:text-white transition-colors">
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

          {/* Show/hide game-event markers — only rendered when we actually
              have events to show, otherwise it's a useless dead button. */}
          {mappedEvents.length > 0 && (
            <button
              onClick={() => setShowEvents((v) => !v)}
              title={showEvents ? 'Hide event markers' : 'Show event markers'}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors mr-1',
                showEvents
                  ? 'bg-hextech-gold/20 text-hextech-gold hover:bg-hextech-gold/30'
                  : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70',
              )}
            >
              {showEvents ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              Events ({mappedEvents.length})
            </button>
          )}

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

          {/* Bookmark button — works on every recording (no game data
              required). Independent of `readonly` like mistakes. */}
          {onAddBookmark && (
            <button
              onClick={openBookmarkDialog}
              title="Add a bookmark at the current time (B)"
              className="flex items-center gap-1 rounded px-2 py-1 text-hextech-cyan hover:text-white hover:bg-hextech-cyan/20 transition-colors text-xs font-medium"
            >
              <Bookmark className="h-3.5 w-3.5" />
              {(bookmarks?.length ?? 0) > 0 ? `Bookmarks (${bookmarks!.length})` : 'Bookmark'}
            </button>
          )}

          {/* Mistake controls — only rendered when the page wired up
              onAddMistake (RecordPlayerPage). Two buttons: add-at-current
              and toggle show-auto-detected. The "Mistakes (N)" count
              indicator helps the user notice that the heuristic detector
              found something to review. Independent of `readonly` because
              mistakes are a separate data plane from notes. */}
          {onAddMistake && gameMeta && (
            <>
              <button
                onClick={openMistakeDialog}
                title="Tag a mistake at the current time (X)"
                className="flex items-center gap-1 rounded px-2 py-1 text-amber-300 hover:text-white hover:bg-amber-500/20 transition-colors text-xs font-medium"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Mistake
              </button>
              {(mistakes?.some((m) => m.autoDetected) ?? false) && (
                <button
                  onClick={() => setShowAutoDetected((v) => !v)}
                  title={showAutoDetected ? 'Hide auto-detected mistakes' : 'Show auto-detected mistakes'}
                  className={cn(
                    'rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                    showAutoDetected ? 'bg-amber-500/30 text-amber-200' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70',
                  )}
                >
                  Auto
                </button>
              )}
            </>
          )}

          {/* Sidebar toggle — works in BOTH windowed and fullscreen now.
              N cycles position (right→left→hidden), H toggles visibility. */}
          {sidebarHasAnyContent && (
            <button
              onClick={cycleSidebar}
              title={`Panel position (N) / Hide (H) — currently: ${sidebarPosition}`}
              className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 px-2.5 py-1 text-[11px] font-medium text-white/90 transition-colors"
            >
              {sidebarPosition === 'right' && <><PanelRight className="h-3.5 w-3.5" /><span>Panel ▸</span></>}
              {sidebarPosition === 'left' && <><PanelLeft className="h-3.5 w-3.5" /><span>◂ Panel</span></>}
              {sidebarPosition === 'hidden' && <><PanelRightClose className="h-3.5 w-3.5" /><span>Show panel</span></>}
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
        </div>{/* /controls overlay wrapper */}

      </div>{/* /video column */}

      {/* Unified tabbed sidebar (Notes / Mistakes / Bookmarks) — present in
          both windowed and fullscreen modes so the user can watch + review
          simultaneously. Hideable via the collapse button, the N/H hotkeys,
          or the control-bar toggle. */}
      {sidebarVisible && sidebarPanel}
      {sidebarPosition === 'hidden' && sidebarReopenHandle}
    </div>
  )
}
