import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { VideoReviewPlayer } from '@/components/Recording/VideoReviewPlayer'
import { formatGameTime } from '@/lib/utils'
import {
  ArrowLeft, Scissors, Trash2, Loader2, ClipboardCheck,
  Clock, Calendar, Video, ExternalLink, Youtube, Share2,
  Check, Copy, Save, Square, Play, Unlink, Link2, RefreshCw, Target,
  AlertTriangle,
} from 'lucide-react'
import type { Mistake, MistakeTag, Bookmark } from '@/lib/ipc'
import { ClipSharePanel } from '@/components/Share/ClipSharePanel'
import { useToast } from '@/hooks/useToast'

type YoutubeUploadState = 'idle' | 'uploading' | 'done' | 'error'
type BottomTab = 'clips' | 'share'

interface RecordingDetail {
  id: string
  gameId: string | null
  filePath: string | null
  youtubeUrl: string | null
  source: string
  thumbnailPath: string | null
  duration: number | null
  createdAt: string
  champion: string
  opponentChampion: string | null
  win: boolean
  kills: number
  deaths: number
  assists: number
  gameDuration: number
  gameEndAt: string
  queueType: string
  hasReview: boolean
  reviewId: string | null
  isOrphaned?: boolean
}

interface ClipEntry {
  id: string
  recordingId: string
  filePath: string
  thumbnailPath: string | null
  title: string | null
  startMs: number
  endMs: number
  youtubeUrl: string | null
  tempShareUrl: string | null
  createdAt: string
  fileSize: number
}

function nxmUrl(filePath: string): string {
  const n = filePath.replace(/\\/g, '/')
  return n.startsWith('/') ? `nxm://${n}` : `nxm:///${n}`
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

function parseMmSs(v: string): number | null {
  const p = v.split(':')
  if (p.length === 2) {
    const m = parseInt(p[0], 10), s = parseInt(p[1], 10)
    if (!isNaN(m) && !isNaN(s)) return (m * 60 + s) * 1000
  }
  const sec = parseFloat(v)
  return isNaN(sec) ? null : Math.round(sec * 1000)
}

function fmtFileSize(b: number) { return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB` }

function sourceLabel(s: string) {
  return ({ capture: 'Ascend', outplayed: 'Outplayed', insightcapture: 'InsightCapture', obs: 'OBS', youtube: 'YouTube', external: 'External' } as Record<string, string>)[s] ?? 'Manual'
}

function extractYtId(url: string) {
  return url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^&?/\s]+)/)?.[1] ?? null
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RecordPlayerPage() {
  const { recordingId } = useParams<{ recordingId: string }>()
  const navigate = useNavigate()
  // ?clipId=<id> — when present we play the clip's standalone file
  // instead of the parent recording. Lets clip cards (Record Hub + the
  // bottom clip strip on this page) deep-link straight into the clip.
  const [searchParams, setSearchParams] = useSearchParams()
  const activeClipId = searchParams.get('clipId')
  // ?at=<gameTimeSec> — deep-link target (e.g. from the Lane Phase chart).
  // Forwarded to the player which maps it to video time and seeks + plays.
  const seekAtParam = searchParams.get('at')
  const seekToGameTimeSec = seekAtParam != null && Number.isFinite(Number(seekAtParam))
    ? Number(seekAtParam)
    : null

  const [recording, setRecording] = useState<RecordingDetail | null>(null)
  const [clips, setClips] = useState<ClipEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<BottomTab>('clips')
  // Game timeline events (kills, dragons, towers…) for the player markers.
  // Skipped when playing a clip — events reference the full game's time
  // so they'd be misaligned against a trimmed clip file.
  const [gameEvents, setGameEvents] = useState<any[]>([])
  const [recordingStartOffsetSec, setRecordingStartOffsetSec] = useState<number | null>(null)
  // Diagnostic state for the events badge / refresh button. `null` while
  // we haven't tried yet, then populated on every fetch.
  const [eventsDiag, setEventsDiag] = useState<{
    reason: string
    message?: string
    frameCount?: number
    playerResolvedVia?: string
  } | null>(null)
  const [refreshingEvents, setRefreshingEvents] = useState(false)

  // ── Mistake Library state ─────────────────────────────────────────────
  // Tags are loaded once per page (they rarely change). Mistakes are
  // scoped to the recording's game and re-fetched when the user adds /
  // deletes / runs auto-detect.
  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const [mistakeTags, setMistakeTags] = useState<MistakeTag[]>([])
  const [autoDetecting, setAutoDetecting] = useState(false)

  // Bookmarks — recording-scoped (works on orphans too)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  // Clip creation
  const [creatingClip, setCreatingClip] = useState(false)
  const [clipRange, setClipRange] = useState({ startMs: 0, endMs: 30_000 })
  const [clipTitle, setClipTitle] = useState('')
  const [startInput, setStartInput] = useState('0:00')
  const [endInput, setEndInput] = useState('0:30')
  const [savingClip, setSavingClip] = useState(false)

  // External review creation
  const [creatingReview, setCreatingReview] = useState(false)
  const { toast } = useToast()

  const handleOpenReview = useCallback(async () => {
    if (!recording) return
    setCreatingReview(true)
    try {
      const title = recording.isOrphaned
        ? recording.champion
        : `${recording.champion} — ${recording.win ? 'Victory' : 'Defeat'}`
      const ext = await window.api.createExternalReview({
        title,
        filePath: recording.filePath ?? undefined,
      })
      if (ext?.id) navigate(`/external-review/${ext.id}`)
    } catch (err) {
      console.error('[RecordPlayerPage] Failed to create external review:', err)
    } finally {
      setCreatingReview(false)
    }
  }, [recording, navigate])

  // YouTube
  const [ytState, setYtState] = useState<YoutubeUploadState>('idle')
  const [ytProgress, setYtProgress] = useState(0)
  const [ytUrl, setYtUrl] = useState<string | null>(null)
  const [ytError, setYtError] = useState<string | null>(null)
  const [ytConnected, setYtConnected] = useState(false)

  useEffect(() => {
    ;(window.api as any).youtubeGetStatus().then((s: any) => setYtConnected(s.connected)).catch(() => {})
  }, [])

  useEffect(() => {
    const unsub = (window.api as any).onYoutubeUploadProgress?.((d: { percent: number }) => setYtProgress(d.percent))
    return () => unsub?.()
  }, [])

  const loadData = useCallback(async () => {
    if (!recordingId) return
    setLoading(true)
    try {
      const all = await window.api.listGamesWithRecordings()
      const rec = (all as any[]).find((r: any) => r.recordingId === recordingId)
      if (!rec) { setError('Recording not found'); return }
      setRecording({
        id: rec.recordingId, gameId: rec.gameId ?? null, filePath: rec.filePath,
        youtubeUrl: rec.youtubeUrl, source: rec.source, thumbnailPath: rec.thumbnailPath,
        duration: rec.duration, createdAt: rec.gameEndAt, champion: rec.champion,
        opponentChampion: rec.opponentChampion, win: rec.win, kills: rec.kills,
        deaths: rec.deaths, assists: rec.assists, gameDuration: rec.duration,
        gameEndAt: rec.gameEndAt, queueType: rec.queueType,
        hasReview: rec.hasReview, reviewId: rec.reviewId, isOrphaned: rec.isOrphaned,
      })
      setClips(await (window.api as any).listClips(recordingId) ?? [])
    } catch (err) {
      console.error('[RecordPlayerPage] Load failed:', err)
      setError('Failed to load recording')
    } finally { setLoading(false) }
  }, [recordingId])

  useEffect(() => { loadData() }, [loadData])

  // Load mistake tags once per session — built-ins are seeded on app
  // start, so this is essentially a static catalog.
  useEffect(() => {
    window.api.listMistakeTags()
      .then(setMistakeTags)
      .catch(() => setMistakeTags([]))
  }, [])

  // Re-load mistakes whenever the recording's game changes (e.g. after
  // a successful "Try to link" recovery).
  const reloadMistakes = useCallback(async () => {
    if (!recording?.gameId) { setMistakes([]); return }
    try {
      const list = await window.api.listMistakesByGame(recording.gameId)
      setMistakes(list)
    } catch {
      setMistakes([])
    }
  }, [recording?.gameId])

  useEffect(() => { reloadMistakes() }, [reloadMistakes])

  const handleAddMistake = useCallback(async (payload: {
    tagId: string
    gameTimeSec: number
    videoTimeMs?: number
    note?: string
    severity?: number
  }) => {
    if (!recording?.gameId) return
    try {
      await window.api.createMistake({
        gameId: recording.gameId,
        tagId: payload.tagId,
        gameTimeSec: payload.gameTimeSec,
        videoTimeMs: payload.videoTimeMs,
        note: payload.note,
        severity: payload.severity,
        recordingId: recording.id,
      })
      await reloadMistakes()
      toast({ title: 'Mistake tagged', description: `Saved at ${Math.floor(payload.gameTimeSec / 60)}:${String(payload.gameTimeSec % 60).padStart(2, '0')} game time.` })
    } catch (err) {
      toast({ title: 'Failed to tag mistake', description: (err as Error)?.message ?? 'Unknown error', variant: 'destructive' })
    }
  }, [recording, reloadMistakes, toast])

  const handleDeleteMistake = useCallback(async (id: string) => {
    try {
      await window.api.deleteMistake(id)
      await reloadMistakes()
    } catch (err) {
      toast({ title: 'Failed to delete mistake', description: (err as Error)?.message ?? 'Unknown error', variant: 'destructive' })
    }
  }, [reloadMistakes, toast])

  // ── Bookmarks ─────────────────────────────────────────────────────────
  // Recording-scoped, so they work even on orphan recordings (no Riot
  // game data needed). Reload after any add/delete so the timeline and
  // side list stay in sync.
  const reloadBookmarks = useCallback(async () => {
    if (!recordingId) { setBookmarks([]); return }
    try {
      const list = await window.api.listBookmarks(recordingId)
      setBookmarks(list)
    } catch {
      setBookmarks([])
    }
  }, [recordingId])

  useEffect(() => { reloadBookmarks() }, [reloadBookmarks])

  const handleAddBookmark = useCallback(async (payload: { videoTimeMs: number; label?: string; color?: string }) => {
    if (!recordingId) return
    try {
      await window.api.createBookmark({ recordingId, ...payload })
      await reloadBookmarks()
      toast({ title: 'Bookmark added', description: `Saved at ${fmtMs(payload.videoTimeMs)}.` })
    } catch (err) {
      toast({ title: 'Failed to add bookmark', description: (err as Error)?.message ?? 'Unknown error', variant: 'destructive' })
    }
  }, [recordingId, reloadBookmarks, toast])

  const handleDeleteBookmark = useCallback(async (id: string) => {
    try {
      await window.api.deleteBookmark(id)
      await reloadBookmarks()
    } catch (err) {
      toast({ title: 'Failed to delete bookmark', description: (err as Error)?.message ?? 'Unknown error', variant: 'destructive' })
    }
  }, [reloadBookmarks, toast])

  const handleAutoDetect = useCallback(async () => {
    if (!recording?.gameId) return
    setAutoDetecting(true)
    try {
      const res = await window.api.autoDetectMistakes(recording.gameId)
      await reloadMistakes()
      toast({
        title: 'Auto-detect done',
        description: `Created ${res.created}, skipped ${res.skipped} duplicate(s).`,
        variant: res.created > 0 ? undefined : 'destructive',
      })
    } catch (err) {
      toast({ title: 'Auto-detect failed', description: (err as Error)?.message ?? 'Unknown error', variant: 'destructive' })
    } finally {
      setAutoDetecting(false)
    }
  }, [recording, reloadMistakes, toast])

  // Fetch in-game events + the recording's precise startOffsetSec once we
  // know which game this recording is linked to. Both are best-effort — the
  // markers degrade gracefully when either piece is missing.
  useEffect(() => {
    let cancelled = false
    if (!recording?.gameId) {
      setGameEvents([]); setRecordingStartOffsetSec(null); setEventsDiag(null)
      return
    }
    // Use the diagnostic variant on initial load so we can surface
    // "timeline fetch failed" or "player not resolved" instead of silently
    // showing an empty timeline. `forceRefetch: false` keeps the cache.
    window.api.refreshGameEvents(recording.gameId, false)
      .then((res) => {
        if (cancelled) return
        setGameEvents(res.events ?? [])
        setEventsDiag(res.diag ?? null)
      })
      .catch(() => { /* no events available — quietly hide markers */ })
    window.api.getRecording(recording.gameId)
      .then((r) => { if (!cancelled) setRecordingStartOffsetSec(r?.startOffsetSec ?? null) })
      .catch(() => { /* leave null — eventSync falls back to duration-based estimate */ })
    return () => { cancelled = true }
  }, [recording?.gameId])

  // Manual "Refresh events" — drops the cache and refetches from Riot.
  // Useful when the first fetch failed (rate limit, transient network).
  // Also recomputes startOffsetSec on the backend, so we re-pull the
  // recording row to pick up the new offset (otherwise markers from a
  // bad-offset backfill would stay off-screen).
  const handleRefreshEvents = useCallback(async () => {
    if (!recording?.gameId) return
    setRefreshingEvents(true)
    try {
      const res = await window.api.refreshGameEvents(recording.gameId, true)
      setGameEvents(res.events ?? [])
      setEventsDiag(res.diag ?? null)
      try {
        const r = await window.api.getRecording(recording.gameId)
        setRecordingStartOffsetSec(r?.startOffsetSec ?? null)
      } catch { /* leave previous value */ }
      if (res.events.length > 0) {
        toast({ title: 'Events refreshed', description: `${res.events.length} event(s) loaded.` })
      } else {
        const reasonHint =
          res.diag.reason === 'timeline-fetch-failed' ? 'Riot timeline API unreachable.'
          : res.diag.reason === 'player-not-resolved' ? `Player "${recording.champion}" not found in match.`
          : res.diag.reason === 'no-match-id' ? 'Recording is not linked to a Riot match.'
          : res.diag.reason === 'empty-timeline' ? 'Timeline has no relevant events.'
          : res.diag.message ?? 'No events available.'
        toast({ title: 'No events found', description: reasonHint, variant: 'destructive' })
      }
    } catch (err) {
      toast({ title: 'Refresh failed', description: (err as Error)?.message ?? 'An unknown error occurred.', variant: 'destructive' })
    } finally {
      setRefreshingEvents(false)
    }
  }, [recording, toast])

  const handleUnlink = useCallback(async () => {
    if (!recording?.gameId) return
    await window.api.unlinkRecording(recording.gameId)
    toast({ title: 'Recording unlinked', description: 'The recording is still available in your library.' })
    await loadData()
  }, [recording, loadData, toast])

  // Manual recovery for the orphan path: ask the backend to look up this
  // single recording in Riot match history. On success, reload so the
  // player picks up the new gameId / startOffset / markers.
  const [tryingLink, setTryingLink] = useState(false)
  const handleTryLink = useCallback(async () => {
    if (!recording?.id) return
    setTryingLink(true)
    try {
      const result = await window.api.backfillOrphanRecordings(recording.id)
      if (result.linked > 0) {
        toast({ title: 'Recording linked', description: 'Game data recovered from Riot history — reloading to show markers.' })
        await loadData()
      } else if (result.skipped > 0) {
        toast({
          title: 'Already linked elsewhere',
          description: 'The matching Riot game is already linked to another recording.',
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'No match found',
          description: 'No Riot game was found within ±5 min of this recording. Confirm the account you played on is linked in Ascend.',
          variant: 'destructive',
        })
      }
    } catch (err) {
      toast({ title: 'Link failed', description: (err as Error)?.message ?? 'An unknown error occurred.', variant: 'destructive' })
    } finally {
      setTryingLink(false)
    }
  }, [recording, loadData, toast])

  const handleClipRangeChange = useCallback((range: { startMs: number; endMs: number }) => {
    setClipRange(range)
    setStartInput(fmtMs(range.startMs))
    setEndInput(fmtMs(range.endMs))
  }, [])

  const applyStart = () => {
    const ms = parseMmSs(startInput)
    if (ms !== null) handleClipRangeChange({ startMs: Math.min(ms, clipRange.endMs - 500), endMs: clipRange.endMs })
  }
  const applyEnd = () => {
    const ms = parseMmSs(endInput)
    if (ms !== null) handleClipRangeChange({ startMs: clipRange.startMs, endMs: Math.max(ms, clipRange.startMs + 500) })
  }

  const openClipEditor = () => {
    setClipRange({ startMs: 0, endMs: 30_000 })
    setStartInput('0:00'); setEndInput('0:30'); setClipTitle('')
    setCreatingClip(true)
  }

  const handleSaveClip = async () => {
    if (!recordingId) return
    setSavingClip(true)
    try {
      await (window.api as any).createClip({ recordingId, startMs: clipRange.startMs, endMs: clipRange.endMs, title: clipTitle || undefined })
      setCreatingClip(false)
      await loadData()
    } catch (err) { console.error('[RecordPlayerPage] Clip save failed:', err) }
    finally { setSavingClip(false) }
  }

  // "Export" is the same operation as Save but additionally reveals the
  // produced mp4 in the OS file browser and surfaces a richer toast.
  // Useful when the user wants to share the file outside the app.
  const [exportingClip, setExportingClip] = useState(false)
  const handleExportClip = async () => {
    if (!recordingId) return
    setExportingClip(true)
    try {
      const result = await window.api.exportClip({
        recordingId,
        startMs: clipRange.startMs,
        endMs: clipRange.endMs,
        title: clipTitle || undefined,
      })
      setCreatingClip(false)
      await loadData()
      toast({
        title: 'Clip exported',
        description: `Saved to ${result.filePath}${result.revealedInFolder ? ' — opened in Explorer.' : '.'}`,
      })
    } catch (err) {
      toast({
        title: 'Clip export failed',
        description: (err as Error)?.message ?? 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setExportingClip(false)
    }
  }

  const handleDeleteClip = async (id: string) => {
    await (window.api as any).deleteClip(id)
    await loadData()
  }

  const handleYtUpload = async () => {
    if (!recording?.filePath) return
    setYtState('uploading'); setYtProgress(0); setYtError(null)
    try {
      const r = await (window.api as any).youtubeUpload({
        filePath: recording.filePath,
        title: `${recording.champion} — ${recording.win ? 'Victory' : 'Defeat'} | Ascend`,
        description: 'Recorded with Ascend', visibility: 'unlisted',
      })
      setYtUrl(r.url); setYtState('done')
      if (recording.gameId) await window.api.setYoutubeUrl(recording.gameId, r.url)
    } catch (err: any) { setYtError(err?.message ?? 'Upload failed'); setYtState('error') }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-hextech-text-dim">
      <Loader2 className="h-6 w-6 animate-spin mr-3" /><span>Loading recording…</span>
    </div>
  )
  if (error || !recording) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <p className="text-hextech-text-dim">{error ?? 'Recording not found'}</p>
      <Button variant="outline" onClick={() => navigate('/record')}>Back to Record Hub</Button>
    </div>
  )

  // Resolve the active clip (if any). When `?clipId=` is set we play the
  // clip's own file — each clip is a standalone mp4 produced by ffmpeg
  // during creation, so it's already trimmed to the requested range.
  const activeClip = activeClipId ? clips.find((c) => c.id === activeClipId) ?? null : null
  const videoSrc = activeClip?.filePath
    ? nxmUrl(activeClip.filePath)
    : recording.filePath
      ? nxmUrl(recording.filePath)
      : null

  const clearClipMode = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('clipId')
    setSearchParams(next, { replace: true })
  }
  const selectClip = (clipId: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('clipId', clipId)
    setSearchParams(next, { replace: true })
  }

  return (
    // Fixed-height column — no page scroll possible
    <div className="flex flex-col gap-2 animate-fade-in" style={{ height: 'calc(100vh - 3.25rem)', overflow: 'auto' }}>
      {/* Back nav */}
      <button onClick={() => navigate('/record')} className="flex items-center gap-1.5 text-xs text-hextech-text-dim hover:text-hextech-text transition-colors self-start shrink-0">
        <ArrowLeft className="h-3.5 w-3.5" />Back to Record Hub
      </button>

      {/* Meta bar */}
      <MetaBar
        recording={recording}
        onNavigate={(p) => navigate(p)}
        onReview={handleOpenReview}
        reviewLoading={creatingReview}
        onUnlink={handleUnlink}
        onTryLink={handleTryLink}
        tryingLink={tryingLink}
        eventsCount={gameEvents.length}
        eventsDiag={eventsDiag}
        onRefreshEvents={handleRefreshEvents}
        refreshingEvents={refreshingEvents}
        onAutoDetectMistakes={handleAutoDetect}
        autoDetectingMistakes={autoDetecting}
        mistakeCount={mistakes.length}
      />

      {/* Clip mode banner — visible only when ?clipId= is in the URL.
          Loading a clip's standalone file means the player shows that
          trimmed mp4 (not the parent recording), and we surface a one-click
          escape hatch back to the full record. */}
      {activeClip && (
        <div className="flex items-center gap-2 rounded-lg bg-hextech-gold/10 border border-hextech-gold/40 px-3 py-1.5 shrink-0">
          <Scissors className="h-3.5 w-3.5 text-hextech-gold shrink-0" />
          <span className="text-xs text-hextech-text-bright font-medium truncate">
            {activeClip.title || 'Clip'}
          </span>
          <span className="text-[10px] font-mono text-hextech-text-dim">
            {fmtMs(activeClip.startMs)}–{fmtMs(activeClip.endMs)}
          </span>
          <div className="flex-1" />
          <button
            onClick={clearClipMode}
            className="text-[11px] text-hextech-text-dim hover:text-hextech-text transition-colors flex items-center gap-1"
          >
            <Video className="h-3 w-3" />
            Full recording
          </button>
        </div>
      )}

      {/* Player — full width, shrinks to give room to controls below.
          When in clip mode we disable the clip editor (creating a clip of
          a clip would be confusing) and let the player just play the
          trimmed file end-to-end. */}
      {videoSrc ? (
        <VideoReviewPlayer
          // Force the underlying <video> to remount when switching between
          // the recording and a clip — same key change pattern as elsewhere
          // in the app, avoids stale buffer / seek state.
          key={activeClipId ?? 'full'}
          src={videoSrc}
          notes={[]}
          readonly
          // Account for everything stacked below the <video>: progress
          // bar with up to 3 lanes of event markers ABOVE it (pt-14 ≈
          // 3.5rem), the legend chips row (~2rem), the transport button
          // row (~3rem), the clip-mode banner above (~3rem), and the
          // BottomPanel below (~7.5rem).
          //
          // Earlier values (20-26rem) predated the event-marker lanes
          // and the legend chips, so the bottom controls got pushed off
          // the visible area on shorter screens — including the fullscreen
          // toggle, which made fullscreen unreachable. Adding ~6rem of
          // breathing room everywhere fixes that without forcing scroll.
          videoMaxHeight={
            activeClip
              ? 'max-h-[calc(100vh-32rem)]'
              : creatingClip
                ? 'max-h-[calc(100vh-30rem)]'
                : 'max-h-[calc(100vh-26rem)]'
          }
          clipping={creatingClip && !activeClip}
          clipRange={creatingClip && !activeClip ? clipRange : undefined}
          onClipRangeChange={creatingClip && !activeClip ? handleClipRangeChange : undefined}
          // Don't pass events when playing a clip — the gameTimeMs values
          // would be misaligned against the trimmed file.
          gameEvents={activeClip ? [] : gameEvents}
          gameMeta={!activeClip && recording.gameEndAt && recording.gameDuration && recording.createdAt ? {
            gameEndAt: recording.gameEndAt,
            gameDurationSec: recording.gameDuration,
            recordingCreatedAt: recording.createdAt,
            startOffsetSec: recordingStartOffsetSec,
          } : undefined}
          // Deep-link seek (Lane Phase chart → replay). Ignored in clip mode
          // since the trimmed file has a different time-base.
          seekToGameTimeSec={activeClip ? undefined : seekToGameTimeSec}
          // Wire mistakes only when not playing a clip: the gameTimeSec
          // anchors would be offset against a trimmed file the same way
          // gameEvents would be.
          mistakes={activeClip ? [] : mistakes}
          mistakeTags={mistakeTags}
          onAddMistake={activeClip ? undefined : handleAddMistake}
          onDeleteMistake={handleDeleteMistake}
          // Bookmarks are stored against videoTimeMs of the parent file
          // and the clip is a different file with its own time-base, so
          // skip them when a clip is active (same logic as mistakes).
          bookmarks={activeClip ? [] : bookmarks}
          onAddBookmark={activeClip ? undefined : handleAddBookmark}
          onDeleteBookmark={handleDeleteBookmark}
        />
      ) : recording.youtubeUrl ? (
        <div className="rounded-xl overflow-hidden bg-[#050A10] border border-white/10 aspect-video">
          <iframe src={`https://www.youtube.com/embed/${extractYtId(recording.youtubeUrl)}`} className="w-full h-full" allow="autoplay; encrypted-media" allowFullScreen />
        </div>
      ) : (
        <div className="rounded-xl bg-[#050A10] border border-white/10 aspect-video flex items-center justify-center">
          <p className="text-hextech-text-dim text-sm">No video file linked</p>
        </div>
      )}

      {/* Clip controls bar */}
      {creatingClip && (
        <div className="flex items-center gap-2 rounded-lg bg-[#090e17] border border-hextech-gold/30 px-3 py-1.5 shrink-0">
          <div className="flex items-center gap-1 rounded bg-white/5 border border-white/10 px-1.5 py-1">
            <span className="text-[9px] text-hextech-text-dim/60 uppercase">In</span>
            <input type="text" value={startInput} onChange={(e) => setStartInput(e.target.value)} onBlur={applyStart} onKeyDown={(e) => e.key === 'Enter' && applyStart()}
              className="w-11 bg-transparent text-[11px] font-mono text-hextech-text text-center focus:outline-none" />
          </div>
          <span className="text-[10px] font-mono text-hextech-text-dim/50">{fmtMs(Math.max(0, clipRange.endMs - clipRange.startMs))}</span>
          <div className="flex items-center gap-1 rounded bg-white/5 border border-white/10 px-1.5 py-1">
            <span className="text-[9px] text-hextech-text-dim/60 uppercase">Out</span>
            <input type="text" value={endInput} onChange={(e) => setEndInput(e.target.value)} onBlur={applyEnd} onKeyDown={(e) => e.key === 'Enter' && applyEnd()}
              className="w-11 bg-transparent text-[11px] font-mono text-hextech-text text-center focus:outline-none" />
          </div>
          <div className="flex-1" />
          <input type="text" value={clipTitle} onChange={(e) => setClipTitle(e.target.value)} placeholder={`Clip — ${recording.champion}`}
            className="w-40 rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-hextech-text placeholder:text-hextech-text-dim/40 focus:outline-none focus:border-hextech-gold/50" />
          <Button size="sm" className="h-7 gap-1 text-xs bg-hextech-gold text-hextech-dark hover:bg-hextech-gold-bright px-2.5"
            onClick={handleSaveClip} disabled={savingClip || exportingClip || clipRange.endMs <= clipRange.startMs}
            title="Save clip in Ascend (stays in the app)">
            {savingClip ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save
          </Button>
          <Button size="sm" variant="outline"
            className="h-7 gap-1 text-xs border-hextech-cyan/40 text-hextech-cyan hover:bg-hextech-cyan/10 px-2.5"
            onClick={handleExportClip} disabled={savingClip || exportingClip || clipRange.endMs <= clipRange.startMs}
            title="Export clip mp4 and reveal it in Explorer">
            {exportingClip ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}Export
          </Button>
          <button onClick={() => setCreatingClip(false)}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[#FF4655] border border-[#FF4655]/30 hover:bg-[#FF4655]/10 transition-colors">
            <Square className="h-3 w-3" />Cancel
          </button>
        </div>
      )}

      {/* Bottom tabs */}
      <BottomPanel
        recording={recording}
        clips={clips}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onNewClip={openClipEditor}
        creatingClip={creatingClip}
        onDeleteClip={handleDeleteClip}
        onPlayClip={selectClip}
        activeClipId={activeClipId}
        ytState={ytState} ytProgress={ytProgress} ytUrl={ytUrl} ytError={ytError} ytConnected={ytConnected}
        onYtUpload={handleYtUpload}
      />
    </div>
  )
}

// ── Meta bar ──────────────────────────────────────────────────────────────────

interface MetaBarProps {
  recording: RecordingDetail
  onNavigate: (p: string) => void
  onReview: () => void
  reviewLoading: boolean
  onUnlink: () => void
  onTryLink: () => void
  tryingLink: boolean
  eventsCount: number
  eventsDiag: { reason: string; message?: string; frameCount?: number; playerResolvedVia?: string } | null
  onRefreshEvents: () => void
  refreshingEvents: boolean
  onAutoDetectMistakes: () => void
  autoDetectingMistakes: boolean
  mistakeCount: number
}

function MetaBar({ recording, onNavigate, onReview, reviewLoading, onUnlink, onTryLink, tryingLink, eventsCount, eventsDiag, onRefreshEvents, refreshingEvents, onAutoDetectMistakes, autoDetectingMistakes, mistakeCount }: MetaBarProps) {
  const dateStr = new Date(recording.gameEndAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  return (
    <div className="flex items-center gap-3 rounded-xl bg-hextech-elevated border border-hextech-border-dim px-3 py-2 flex-wrap shrink-0">
      {!recording.isOrphaned && (
        <div className={`w-1 h-8 rounded-full shrink-0 ${recording.win ? 'bg-hextech-teal' : 'bg-[#FF4655]'}`} />
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-hextech-text-bright">{recording.champion}</p>
        {recording.opponentChampion && <p className="text-xs text-hextech-text-dim">vs {recording.opponentChampion}</p>}
      </div>

      {!recording.isOrphaned && (
        <>
          <Badge variant={recording.win ? 'success' : 'destructive'} className="text-[10px] shrink-0">
            {recording.win ? 'Victory' : 'Defeat'}
          </Badge>
          <span className="font-mono text-sm text-hextech-text shrink-0">{recording.kills}/{recording.deaths}/{recording.assists}</span>
          <span className="flex items-center gap-1 text-xs text-hextech-text-dim shrink-0">
            <Clock className="h-3 w-3" />{formatGameTime(recording.gameDuration)}
          </span>
        </>
      )}

      <span className="flex items-center gap-1 text-xs text-hextech-text-dim shrink-0">
        <Calendar className="h-3 w-3" />{dateStr}
      </span>
      {!recording.isOrphaned && recording.queueType && recording.queueType !== 'unknown' && (
        <Badge variant="outline" className="text-[10px] h-5 px-1.5 shrink-0">{recording.queueType.toUpperCase()}</Badge>
      )}
      <span className="flex items-center gap-1 text-xs text-hextech-text-dim shrink-0">
        <Video className="h-3 w-3" />{sourceLabel(recording.source)}
      </span>

      <div className="flex-1" />

      {/* Orphan-recovery CTA: lets the user fetch missing game data from
          Riot match history (useful if they connected the account after
          recording, or had no active Ascend session at the time). */}
      {recording.isOrphaned && (
        <Button
          variant="outline" size="sm"
          disabled={tryingLink}
          onClick={onTryLink}
          title="Look this recording up in Riot match history"
          className="gap-1.5 h-7 text-xs shrink-0 border-hextech-gold/40 text-hextech-gold hover:bg-hextech-gold/10"
        >
          {tryingLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          {tryingLink ? 'Linking…' : 'Try to link'}
        </Button>
      )}

      {/* Events status badge + manual refresh.
          Shows the live event count when extraction worked, OR a red
          "no markers" pill with a Refresh button when something went
          wrong (Riot down, player not found, etc.). Hidden while the
          first fetch hasn't finished yet (eventsDiag === null). */}
      {!recording.isOrphaned && recording.gameId && eventsDiag && (
        eventsCount > 0 ? (
          <Button
            variant="outline" size="sm"
            disabled={refreshingEvents}
            onClick={onRefreshEvents}
            title={`Refresh game events (currently ${eventsCount} loaded${eventsDiag.frameCount ? ` from ${eventsDiag.frameCount} timeline frames` : ''})`}
            className="gap-1.5 h-7 text-xs shrink-0 text-hextech-text-dim hover:text-hextech-gold hover:border-hextech-gold/40"
          >
            {refreshingEvents ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {eventsCount} events
          </Button>
        ) : (
          <Button
            variant="outline" size="sm"
            disabled={refreshingEvents}
            onClick={onRefreshEvents}
            title={eventsDiag.message ?? 'No game events available — click to retry'}
            className="gap-1.5 h-7 text-xs shrink-0 border-[#FF4655]/40 text-[#FF4655] hover:bg-[#FF4655]/10"
          >
            {refreshingEvents ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {refreshingEvents ? 'Refreshing…' : 'No markers — Refresh'}
          </Button>
        )
      )}

      {/* Session review (linked game only) */}
      {!recording.isOrphaned && recording.gameId && (
        <>
          {/* Lane Phase Comparator — opens a dedicated page that crunches
              the cached Riot timeline into a per-minute laning breakdown
              vs the direct opponent. Cheap on repeat opens (cached JSON
              on the Game row). */}
          <Button
            variant="outline" size="sm"
            className="gap-1.5 h-7 text-xs shrink-0 text-hextech-text-dim hover:text-hextech-gold hover:border-hextech-gold/40"
            onClick={() => onNavigate(`/lane-phase/${recording.gameId}?rec=${recording.id}`)}
            title="Compare your laning phase to your direct opponent (0-14 min)"
          >
            <Target className="h-3.5 w-3.5" />
            Lane Phase
          </Button>
          {/* Run the mistake heuristics on the cached Riot timeline.
              Idempotent — duplicates within 3s of an existing auto row are
              skipped, so spamming the button is safe. Shows the current
              count so the user can tell if nothing came back. */}
          <Button
            variant="outline" size="sm"
            disabled={autoDetectingMistakes}
            onClick={onAutoDetectMistakes}
            title="Run the mistake auto-detector for this game"
            className="gap-1.5 h-7 text-xs shrink-0 text-amber-300 hover:text-white hover:border-amber-400/40 hover:bg-amber-500/10"
          >
            {autoDetectingMistakes ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Mistakes ({mistakeCount})
          </Button>
          <Button
            variant="outline" size="sm"
            className={`gap-2 h-7 text-xs shrink-0 ${recording.hasReview ? 'text-hextech-cyan border-hextech-cyan/30 hover:bg-hextech-cyan/10' : ''}`}
            onClick={() => onNavigate(`/review?gameId=${recording.gameId}`)}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            {recording.hasReview ? 'Open Review' : 'Start Review'}
          </Button>
          <Button
            variant="outline" size="sm"
            className="gap-1.5 h-7 text-xs shrink-0 text-hextech-text-dim hover:text-hextech-gold hover:border-hextech-gold/40"
            onClick={onUnlink}
            title="Unlink recording from this game"
          >
            <Unlink className="h-3.5 w-3.5" />
            Unlink
          </Button>
        </>
      )}

      {recording.youtubeUrl && (
        <Button variant="outline" size="sm" className="gap-2 h-7 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10 shrink-0" onClick={() => window.open(recording.youtubeUrl!, '_blank')}>
          <Youtube className="h-3.5 w-3.5" />YouTube
        </Button>
      )}

      {/* External review — always available when there is a video file */}
      {recording.filePath && (
        <Button
          size="sm"
          disabled={reviewLoading}
          onClick={onReview}
          className="gap-2 h-7 text-xs shrink-0 bg-hextech-gold hover:bg-hextech-gold/90 text-hextech-dark font-semibold border-0"
        >
          {reviewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Review
        </Button>
      )}
    </div>
  )
}

// ── Bottom tabs panel ─────────────────────────────────────────────────────────

interface BottomPanelProps {
  recording: RecordingDetail
  clips: ClipEntry[]
  activeTab: BottomTab
  onTabChange: (t: BottomTab) => void
  onNewClip: () => void
  creatingClip: boolean
  onDeleteClip: (id: string) => void
  onPlayClip: (id: string) => void
  activeClipId: string | null
  ytState: YoutubeUploadState; ytProgress: number; ytUrl: string | null
  ytError: string | null; ytConnected: boolean; onYtUpload: () => void
}

function BottomPanel({ recording, clips, activeTab, onTabChange, onNewClip, creatingClip, onDeleteClip, onPlayClip, activeClipId, ytState, ytProgress, ytUrl, ytError, ytConnected, onYtUpload }: BottomPanelProps) {
  return (
    <div className="rounded-xl bg-hextech-elevated border border-hextech-border-dim overflow-hidden shrink-0">
      {/* Tab bar */}
      <div className="flex items-center border-b border-hextech-border-dim px-3">
        {(['clips', 'share'] as BottomTab[]).map((tab) => (
          <button key={tab} onClick={() => onTabChange(tab)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${activeTab === tab ? 'border-hextech-gold text-hextech-gold' : 'border-transparent text-hextech-text-dim hover:text-hextech-text'}`}
          >
            {tab === 'clips'
              ? <span className="flex items-center gap-1.5"><Scissors className="h-3 w-3" />Clips{clips.length > 0 && <span className="rounded-full bg-hextech-gold/20 text-hextech-gold px-1 text-[9px]">{clips.length}</span>}</span>
              : <span className="flex items-center gap-1.5"><Share2 className="h-3 w-3" />Share</span>}
          </button>
        ))}
      </div>

      <div className="px-3 py-2">
        {activeTab === 'clips' && (
          <ClipsTab
            clips={clips}
            creatingClip={creatingClip}
            onNewClip={onNewClip}
            onDeleteClip={onDeleteClip}
            onPlayClip={onPlayClip}
            activeClipId={activeClipId}
          />
        )}
        {activeTab === 'share' && recording.filePath && (
          <ShareTab
            filePath={recording.filePath} champion={recording.champion} win={recording.win} isOrphaned={recording.isOrphaned}
            ytState={ytState} ytProgress={ytProgress} ytUrl={ytUrl} ytError={ytError} ytConnected={ytConnected} onYtUpload={onYtUpload}
          />
        )}
      </div>
    </div>
  )
}

// ── Clips tab ─────────────────────────────────────────────────────────────────

function ClipsTab({ clips, creatingClip, onNewClip, onDeleteClip, onPlayClip, activeClipId }: {
  clips: ClipEntry[]
  creatingClip: boolean
  onNewClip: () => void
  onDeleteClip: (id: string) => void
  onPlayClip: (id: string) => void
  activeClipId: string | null
}) {
  return (
    <div className="flex items-center gap-3">
      {/* New clip button */}
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 shrink-0" onClick={onNewClip} disabled={creatingClip}>
        <Scissors className="h-3 w-3" />
        {creatingClip ? 'Clipping…' : '+ New clip'}
      </Button>

      {/* Clips list — horizontal scroll row */}
      {clips.length === 0 ? (
        <p className="text-xs text-hextech-text-dim/60">No clips yet</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {clips.map((clip) => (
            <ClipRow
              key={clip.id}
              clip={clip}
              onDelete={() => onDeleteClip(clip.id)}
              onPlay={() => onPlayClip(clip.id)}
              isActive={clip.id === activeClipId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Share tab ─────────────────────────────────────────────────────────────────

function ShareTab({ filePath, champion, win, isOrphaned, ytState, ytProgress, ytUrl, ytError, ytConnected, onYtUpload }: { filePath: string; champion: string; win: boolean; isOrphaned?: boolean; ytState: YoutubeUploadState; ytProgress: number; ytUrl: string | null; ytError: string | null; ytConnected: boolean; onYtUpload: () => void }) {
  return (
    <div className="flex items-center gap-6 flex-wrap">
      {/* Discord — inline share panel */}
      <ClipSharePanel filePath={filePath} fileSize={0} title={isOrphaned ? champion : `${champion} — ${win ? 'Victory' : 'Defeat'}`} />

      {/* YouTube */}
      {ytConnected && (
        <div className="flex items-center gap-2">
          {ytState === 'idle' && (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10" onClick={onYtUpload}>
              <Youtube className="h-3.5 w-3.5" />Upload to YouTube
            </Button>
          )}
          {ytState === 'uploading' && (
            <div className="flex items-center gap-2 text-xs text-hextech-text-dim">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Uploading… {ytProgress}%
              <div className="w-24 h-1 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-red-500 transition-all" style={{ width: `${ytProgress}%` }} /></div>
            </div>
          )}
          {ytState === 'done' && ytUrl && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-400 flex items-center gap-1"><Check className="h-3 w-3" />Uploaded</span>
              <a href={ytUrl} target="_blank" rel="noopener noreferrer" className="text-red-400 hover:text-red-300 flex items-center gap-1"><ExternalLink className="h-3 w-3" />Open</a>
              <button onClick={() => navigator.clipboard.writeText(ytUrl)} className="text-hextech-text-dim hover:text-hextech-text flex items-center gap-1"><Copy className="h-3 w-3" />Copy</button>
            </div>
          )}
          {ytState === 'error' && <span className="text-xs text-[#FF4655]">{ytError}</span>}
        </div>
      )}
    </div>
  )
}

// ── Clip row (grid card) ──────────────────────────────────────────────────────

function ClipRow({ clip, onDelete, onPlay, isActive }: {
  clip: ClipEntry
  onDelete: () => void
  onPlay: () => void
  isActive: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <div
      className={`w-44 shrink-0 rounded-lg border bg-hextech-background/40 px-2.5 py-1.5 flex items-center gap-2 transition-colors ${
        isActive
          ? 'border-hextech-gold/70 bg-hextech-gold/5'
          : 'border-hextech-border-dim hover:border-hextech-border'
      }`}
    >
      {/* Clicking the body plays the clip in the main player. The action
          icons on the right stop propagation so they don't double-fire. */}
      <button
        type="button"
        onClick={onPlay}
        className="flex-1 min-w-0 text-left cursor-pointer"
        title="Play this clip in the player"
      >
        <p className="text-[11px] font-medium text-hextech-text-bright truncate flex items-center gap-1">
          {isActive && <Play className="h-2.5 w-2.5 text-hextech-gold shrink-0" />}
          {clip.title ?? 'Clip'}
        </p>
        <div className="flex items-center gap-1.5 text-[10px] text-hextech-text-dim">
          <span className="font-mono">{fmtMs(clip.startMs)}–{fmtMs(clip.endMs)}</span>
          <span>{fmtFileSize(clip.fileSize)}</span>
        </div>
      </button>
      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        {clip.tempShareUrl && <a href={clip.tempShareUrl} target="_blank" rel="noopener noreferrer" className="text-hextech-teal hover:text-hextech-teal/80 transition-colors"><ExternalLink className="h-3 w-3" /></a>}
        {clip.youtubeUrl && <a href={clip.youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-red-400 hover:text-red-300 transition-colors"><Youtube className="h-3 w-3" /></a>}
        {confirmDelete
          ? <><button onClick={onDelete} className="text-[10px] text-[#FF4655] font-medium">✓</button><button onClick={() => setConfirmDelete(false)} className="text-[10px] text-hextech-text-dim">✕</button></>
          : <button onClick={() => setConfirmDelete(true)} className="text-hextech-text-dim/40 hover:text-[#FF4655] transition-colors"><Trash2 className="h-3 w-3" /></button>
        }
      </div>
    </div>
  )
}
