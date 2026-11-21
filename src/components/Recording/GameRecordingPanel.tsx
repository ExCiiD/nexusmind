import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Video, Youtube, Link2, Trash2, Loader2, ExternalLink, RefreshCw, Unlink, FileX2, Target } from 'lucide-react'
import { VideoReviewPlayer } from './VideoReviewPlayer'
import { RecordingMediaPanel } from './RecordingMediaPanel'
import { useToast } from '@/hooks/useToast'
import { useTranslation } from 'react-i18next'
import type { TimelineNote } from '@/components/ReviewForm/TimelineNoteInput'
import type { GameEvent, Mistake, MistakeTag } from '@/lib/ipc'
import { toNxmUrl } from '@/lib/mediaCore'
import { useReviewPlayerStore } from '@/store/useReviewPlayerStore'
import { useUserStore } from '@/store/useUserStore'
import { deriveOffsetSec } from '@/lib/eventSync'
import { useNavigate } from 'react-router-dom'
import { NOTE_BOOKMARK_COLOR } from '@/lib/playerLayers'

// ── Types & helpers ───────────────────────────────────────────────────────────

interface Recording {
  id: string
  gameId: string
  filePath: string | null
  youtubeUrl: string | null
  source: string
  createdAt?: string
  startOffsetSec?: number | null
}

function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
  } catch {}
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

interface GameRecordingPanelProps {
  gameId: string
  readonly?: boolean
  hasReview?: boolean
  onReviewDeleted?: () => void
  timelineNotes?: TimelineNote[]
  /** Game timing meta — required to align timeline event markers with video */
  gameMeta?: {
    gameEndAt: string | Date
    gameDurationSec: number
  }
  onAddNote?: (note: TimelineNote) => void
  onEditNote?: (index: number, newText: string) => void
  onDeleteNote?: (index: number) => void
  /**
   * The Review's single player (DECISIONS 21/11): open from the start, driven by the micro-review box through
   * useReviewPlayerStore (seek, the moment's window and markers), with the layer toggles.
   */
  shared?: boolean
}

export function GameRecordingPanel({ gameId, readonly, hasReview, onReviewDeleted, timelineNotes = [], gameMeta, onAddNote, onEditNote, onDeleteNote, shared = false }: GameRecordingPanelProps) {
  const { toast } = useToast()
  const { t } = useTranslation()
  const [recording, setRecording] = useState<Recording | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [showYtInput, setShowYtInput] = useState(false)
  const [ytUrl, setYtUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(shared)
  const seek = useReviewPlayerStore((s) => (shared ? s.seek : null))
  // The micro-review moment, only while the right panel shows the micro-review (or the panel is closed).
  const clip = useReviewPlayerStore((s) => (shared && (s.activeTab !== 'notes' || !s.panelOpen) ? s.clip : null))
  const layers = useReviewPlayerStore((s) => s.layers)
  const setLayers = useReviewPlayerStore((s) => s.setLayers)
  // « Je tague mes erreurs moi-même »: no « Erreurs détectées » filter.
  const hideMistakes = !!useUserStore((s) => s.user?.selfTagMistakes)
  const rootRef = useRef<HTMLDivElement>(null)
  // A seek from the micro-review box opens the player and brings it into view.
  useEffect(() => {
    if (!seek) return
    setOpen(true)
    rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [seek])
  const [fileNotFound, setFileNotFound] = useState(false)
  const [confirmDeleteVideo, setConfirmDeleteVideo] = useState(false)
  // True while ffmpeg/remux is finalizing the just-stopped recording. The
  // recording row may already exist in the DB but the file is not yet playable
  // (no moov atom, 0:00 duration). We block the player UI behind a clear
  // "Finalizing…" overlay until `recording:ready` arrives.
  const [processing, setProcessing] = useState(false)
  // In-game events (kills, dragons, towers…) for the player timeline markers.
  // Best-effort: empty array if timeline isn't available for this match.
  const [gameEvents, setGameEvents] = useState<GameEvent[]>([])

  // Mistake Library — same data plane as RecordPlayerPage, surfaced here so
  // the review player's sidebar exposes the "Mistakes" section/chip too.
  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const [mistakeTags, setMistakeTags] = useState<MistakeTag[]>([])

  // Clip mode: run by the single player (DECISIONS 21/11 « Mode clip, nouvelle interface »); here, its triggers.
  const [clipSaveKey, setClipSaveKey] = useState(0)
  const [clipOpen, setClipOpen] = useState<{ nonce: number; gameWindow?: { startSec: number; endSec: number } | null } | null>(null)
  const [clipModeOn, setClipModeOn] = useState(false)
  const openClipMode = (gameWindow?: { startSec: number; endSec: number } | null) => setClipOpen((c) => ({ nonce: (c?.nonce ?? 0) + 1, gameWindow }))
  const timeRef = useRef({ sec: 0, durationSec: 0 })
  const [seekVideo, setSeekVideo] = useState<{ ms: number; nonce: number } | null>(null)
  const navigate = useNavigate()
  const clipRequest = useReviewPlayerStore((s) => (shared ? s.clipRequest : null))

  const load = useCallback(async () => {
    setLoading(true)
    setFileNotFound(false)
    try {
      const r = await window.api.getRecording(gameId)
      setRecording(r)
    } finally {
      setLoading(false)
    }
  }, [gameId])

  useEffect(() => { load() }, [load])

  // Fetch the compact game-event list once per gameId. The backend lazily
  // fetches + caches the timeline blob if needed; we just consume the result.
  useEffect(() => {
    let cancelled = false
    window.api.getGameEvents(gameId)
      .then((evts) => { if (!cancelled) setGameEvents(evts ?? []) })
      .catch(() => { /* best-effort, timeline often unavailable */ })
    return () => { cancelled = true }
  }, [gameId])

  // Mistake tags are a near-static catalog (seeded on app start) — load once.
  useEffect(() => {
    window.api.listMistakeTags().then(setMistakeTags).catch(() => setMistakeTags([]))
  }, [])

  // Review v2 (spec § 19, § 21): the recording's bookmarks are the « Notes marquées »; « Prise de note » adds one.
  const bookmarks = useReviewPlayerStore((s) => s.bookmarks)
  const setBookmarks = useReviewPlayerStore((s) => s.setBookmarks)
  const bookmarksNonce = useReviewPlayerStore((s) => s.bookmarksNonce)
  const togglePanel = useReviewPlayerStore((s) => s.togglePanel)
  const panelOpen = useReviewPlayerStore((s) => s.panelOpen)
  const panelSide = useReviewPlayerStore((s) => s.panelSide)
  const toggleSide = useReviewPlayerStore((s) => s.toggleSide)
  // The reopen tab: « Micro-review 2 / 3 » or « Notes marquées 4 », the tab the panel would show.
  const mrCount = useReviewPlayerStore((s) => s.microReviewCount)
  const activeTab = useReviewPlayerStore((s) => s.activeTab)
  const panelTabLabel = activeTab === 'notes' || !mrCount
    ? `${t('review.panel.notes')} ${bookmarks.length}`
    : `${t('review.panel.microReview')} ${mrCount.done} / ${mrCount.total}`
  const videoSeek = useReviewPlayerStore((s) => (shared ? s.videoSeek : null))
  useEffect(() => {
    if (!shared || !recording?.id) { if (shared) setBookmarks([]); return }
    let alive = true
    window.api.listBookmarks(recording.id).then((l) => { if (alive) setBookmarks(l) }).catch(() => { if (alive) setBookmarks([]) })
    return () => { alive = false }
  }, [shared, recording?.id, bookmarksNonce, setBookmarks])
  // A marked note clicked in the right panel: the player jumps there.
  useEffect(() => { if (videoSeek) setSeekVideo({ ms: videoSeek.ms, nonce: Date.now() }) }, [videoSeek])
  // Beta.20 « AUTO »: the detected mistakes, for the side panel.
  useEffect(() => {
    if (!shared) return
    useReviewPlayerStore.setState({
      detectedMistakes: mistakes.filter((m) => m.autoDetected).sort((a, b) => a.gameTimeSec - b.gameTimeSec)
        .map((m) => ({ id: m.id, gameTimeSec: m.gameTimeSec, videoTimeMs: m.videoTimeMs ?? null, label: m.tag?.label ?? '' })),
    })
    return () => useReviewPlayerStore.setState({ detectedMistakes: [] })
  }, [shared, mistakes])
  // Beta.20: no resume at an older position; the one-shot requests die with this player (or its game).
  useEffect(() => () => { if (shared) useReviewPlayerStore.getState().clearRequests() }, [shared, gameId])

  const reloadMistakes = useCallback(async () => {
    try {
      setMistakes(await window.api.listMistakesByGame(gameId))
    } catch {
      setMistakes([])
    }
  }, [gameId])

  useEffect(() => { reloadMistakes() }, [reloadMistakes])

  const handleAddMistake = useCallback(async (payload: {
    tagId: string
    gameTimeSec: number
    videoTimeMs?: number
    note?: string
    severity?: number
  }) => {
    try {
      await window.api.createMistake({
        gameId,
        tagId: payload.tagId,
        gameTimeSec: payload.gameTimeSec,
        videoTimeMs: payload.videoTimeMs,
        note: payload.note,
        severity: payload.severity,
        recordingId: recording?.id,
      })
      await reloadMistakes()
      toast({ title: t('mistakes.tagged', { defaultValue: 'Mistake tagged' }) })
    } catch (err) {
      toast({ title: t('mistakes.tagFailed', { defaultValue: 'Failed to tag mistake' }), description: (err as Error)?.message, variant: 'destructive' })
    }
  }, [gameId, recording?.id, reloadMistakes, toast, t])

  /** « Prise de note » (§ 21): a bookmark at that time (the text, then its tags), and each tag as my mistake there. */
  const takeNote = async (n: { videoTimeMs: number; text: string; tagSlugs: string[] }) => {
    if (!recording) return
    const labels = n.tagSlugs.map((slug) => mistakeTags.find((x) => x.slug === slug)?.label ?? slug)
    const label = [n.text, labels.join(', ')].filter(Boolean).join(' · ').slice(0, 200)
    try {
      await window.api.createBookmark({ recordingId: recording.id, videoTimeMs: n.videoTimeMs, label, color: NOTE_BOOKMARK_COLOR })
      const gameTimeSec = Math.max(0, Math.round(n.videoTimeMs / 1000 + offsetSec()))
      for (const slug of n.tagSlugs) {
        const tag = mistakeTags.find((x) => x.slug === slug)
        if (tag) await window.api.createMistake({ gameId, tagId: tag.id, gameTimeSec, videoTimeMs: n.videoTimeMs, recordingId: recording.id })
      }
      setBookmarks(await window.api.listBookmarks(recording.id))
      if (n.tagSlugs.length) await reloadMistakes()
      toast({ title: t('recording.note.saved'), variant: 'gold' })
    } catch {
      toast({ title: t('recording.note.failed'), variant: 'destructive' })
      throw new Error('NOTE_NOT_SAVED')
    }
  }

  const handleDeleteMistake = useCallback(async (id: string) => {
    try {
      await window.api.deleteMistake(id)
      await reloadMistakes()
    } catch (err) {
      toast({ title: t('mistakes.deleteFailed', { defaultValue: 'Failed to delete mistake' }), description: (err as Error)?.message, variant: 'destructive' })
    }
  }, [reloadMistakes, toast, t])

  useEffect(() => {
    const off = window.api.onRecordingLinked((data) => {
      if (data.gameId === gameId) load()
    })
    return off
  }, [gameId, load])

  // Subscribe to finalization lifecycle so the panel can show a
  // "Finalizing video…" overlay instead of a 0:00 broken player.
  useEffect(() => {
    const offProcessing = window.api.onRecordingProcessing((data) => {
      // Auto path doesn't always know the gameId yet, but if it does and
      // it's NOT ours, ignore. If gameId is undefined, assume it's for the
      // currently active game (i.e. us, since this panel only mounts for one).
      if (data.gameId && data.gameId !== gameId) return
      setProcessing(true)
    })
    const offReady = window.api.onRecordingReady((data) => {
      if (data.gameId && data.gameId !== gameId) return
      setProcessing(false)
      // Reload to pick up the new filePath / recording row that the backend
      // just created/updated post-finalization.
      load()
    })
    const offFailed = window.api.onRecordingFailed((data) => {
      setProcessing(false)
      toast({
        title: t('recording.finalizationFailed', { defaultValue: 'Recording finalization failed' }),
        description: data.reason,
        variant: 'destructive',
      })
    })
    return () => { offProcessing(); offReady(); offFailed() }
  }, [gameId, load, toast, t])

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleScan = async () => {
    setScanning(true)
    try { await window.api.scanRecordings(); await load() }
    finally { setScanning(false) }
  }

  const handleLinkFile = async () => {
    try {
      const r = await window.api.linkRecordingFile(gameId)
      if (!r) return

      if (r.error) {
        console.error('[GameRecordingPanel] Link failed:', r.message)
        toast({
          title: t('recording.panel.linkFailed'),
          description: r.message ?? t('recording.panel.unknownError'),
          variant: 'destructive',
        })
        return
      }

      setRecording(r)
      setOpen(true)
    } catch (err) {
      console.error('[GameRecordingPanel] linkRecordingFile error:', err)
      toast({
        title: t('recording.panel.linkFailed'),
        description: (err as Error)?.message ?? t('recording.panel.unknownError'),
        variant: 'destructive',
      })
    }
  }

  const handleSaveYoutube = async () => {
    if (!ytUrl.trim()) return
    setSaving(true)
    try {
      const r = await window.api.setYoutubeUrl(gameId, ytUrl.trim())
      setRecording(r)
      setShowYtInput(false)
      setYtUrl('')
      setOpen(true)
    } finally { setSaving(false) }
  }

  const handleDeleteVideo = async () => {
    await window.api.deleteRecording(gameId)
    setRecording(null)
    setOpen(false)
    setConfirmDeleteVideo(false)
    toast({ title: t('recording.videoDeleted') })
  }

  const handleDeleteReview = async () => {
    await window.api.deleteReview(gameId)
    toast({ title: t('review.deleted') })
    onReviewDeleted?.()
  }

  const handleUnlink = async () => {
    await window.api.unlinkRecording(gameId)
    setRecording(null)
    setOpen(false)
    toast({ title: t('recording.panel.unlinked'), description: t('recording.panel.unlinkedDesc') })
  }

  /** The recording's offset: video time = game time − offset (the micro-review moment as a clip). */
  const offsetSec = () => (recording?.createdAt && gameMeta ? deriveOffsetSec({
    gameEndAt: new Date(gameMeta.gameEndAt), gameDurationSec: gameMeta.gameDurationSec,
    recordingCreatedAt: new Date(recording.createdAt), videoDurationSec: timeRef.current.durationSec || gameMeta.gameDurationSec,
    startOffsetSec: recording.startOffsetSec,
  }) : 0)
  // The player's time as game time (gameT = videoT + offset), for « à l'heure du lecteur » in the micro-review box.
  useEffect(() => {
    if (!shared || !recording?.filePath || fileNotFound) { if (shared) useReviewPlayerStore.setState({ playerGameTime: null }); return }
    useReviewPlayerStore.setState({ playerGameTime: () => Math.max(0, Math.round(timeRef.current.sec + offsetSec())) })
    return () => useReviewPlayerStore.setState({ playerGameTime: null })
  }, [shared, recording?.filePath, fileNotFound]) // eslint-disable-line react-hooks/exhaustive-deps -- offsetSec reads the recording

  // « Clipper ce moment » (micro-review panel): the player's clip mode on the moment's window (game seconds).
  useEffect(() => {
    if (!clipRequest) return
    setOpen(true)
    openClipMode({ startSec: clipRequest.startSec, endSec: clipRequest.endSec })
    rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [clipRequest?.nonce]) // eslint-disable-line react-hooks/exhaustive-deps -- once per request

  // ── Render ────────────────────────────────────────────────────────────────

  const youtubeId = recording?.youtubeUrl ? extractYoutubeId(recording.youtubeUrl) : null

  if (loading) return null

  return (
    <div ref={rootRef} className="rounded-lg border border-hextech-border-dim bg-hextech-dark overflow-hidden" data-testid="game-recording-panel">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-hextech-text hover:text-hextech-gold-bright transition-colors text-left"
      >
        <Video className="h-4 w-4 text-hextech-gold shrink-0" aria-hidden />
        <span>{t('recording.panel.title')}</span>
        {recording && (
          <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] bg-hextech-gold/20 text-hextech-gold capitalize">
            {recording.source}
          </span>
        )}
        {timelineNotes.filter((n) => n.videoTime !== undefined).length > 0 && (
          <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] bg-hextech-cyan/20 text-hextech-cyan">
            {timelineNotes.filter((n) => n.videoTime !== undefined).length} moment{timelineNotes.filter((n) => n.videoTime !== undefined).length !== 1 ? 's' : ''}
          </span>
        )}
        <span className="ml-auto text-hextech-text-dim text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-hextech-border-dim">
          {/* Finalization overlay — shown while ffmpeg/remux is still writing
              the file. Without this, the user lands on a 0:00 player and
              thinks the recording is broken. */}
          {processing && !recording?.filePath && (
            <div className="p-6 flex flex-col items-center gap-3 text-center bg-[#050A10]">
              <Loader2 className="h-8 w-8 animate-spin text-hextech-gold" />
              <p className="text-sm font-medium text-hextech-text-bright">
                {t('recording.finalizing', { defaultValue: 'Finalizing video…' })}
              </p>
              <p className="text-xs text-hextech-text-dim max-w-md">
                {t('recording.finalizingDesc', {
                  defaultValue: 'The recording is being processed. This usually takes 10-60 seconds for a full game. The player will appear automatically when it\'s ready.',
                })}
              </p>
            </div>
          )}

          {/* Local file — VideoReviewPlayer + clips + share */}
          {recording?.filePath && (
            <div className="p-4 space-y-2">
              {processing && (
                <div className="rounded-lg bg-hextech-gold/10 border border-hextech-gold/40 px-3 py-2 flex items-center gap-2 text-xs text-hextech-gold">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  <span>{t('recording.finalizing', { defaultValue: 'Finalizing video — playback may be limited until it\'s done.' })}</span>
                </div>
              )}
              <VideoReviewPlayer
                src={toNxmUrl(recording.filePath)}
                seekToGameTimeSec={seek?.gameSec ?? null}
                seekNonce={seek?.nonce}
                clip={clip}
                layers={shared ? (hideMistakes ? { ...layers, mistakes: false } : layers) : undefined}
                onLayersChange={shared ? setLayers : undefined}
                hideMistakes={hideMistakes}
                bookmarks={shared ? bookmarks : undefined}
                onTakeNote={shared && !readonly ? takeNote : undefined}
                onTogglePanel={shared ? togglePanel : undefined}
                panelOpen={panelOpen}
                panelSide={panelSide}
                onToggleSide={shared ? toggleSide : undefined}
                panelTabLabel={panelTabLabel}
                barExtra={shared ? (
                  <button type="button" onClick={() => navigate(`/lane-phase/${gameId}?rec=${recording.id}`)} data-testid="laning-phase-button"
                    title={t('record.player.lanePhaseHint')}
                    className="mr-1 flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-hextech-border-dim px-2.5 text-xs text-hextech-text hover:border-hextech-gold/60 hover:text-hextech-gold-bright">
                    <Target className="h-3.5 w-3.5" />{t('recording.bar.laningPhase')}
                  </button>
                ) : undefined}
                onTimeChange={(sec, durationSec) => { timeRef.current = { sec, durationSec } }}
                seekVideo={seekVideo}
                clipRecordingId={shared && !readonly ? recording.id : undefined}
                clipOpen={clipOpen}
                onClipModeChange={setClipModeOn}
                onClipSaved={() => setClipSaveKey((k) => k + 1)}
                notes={timelineNotes}
                onAddNote={onAddNote}
                onEditNote={onEditNote}
                onDeleteNote={onDeleteNote}
                onFileNotFound={() => setFileNotFound(true)}
                readonly={readonly}
                videoMaxHeight="max-h-[62vh] min-h-[300px]"
                gameEvents={gameEvents}
                gameMeta={gameMeta && recording.createdAt ? {
                  gameEndAt: gameMeta.gameEndAt,
                  gameDurationSec: gameMeta.gameDurationSec,
                  recordingCreatedAt: recording.createdAt,
                  startOffsetSec: recording.startOffsetSec,
                } : undefined}
                mistakes={mistakes}
                mistakeTags={mistakeTags}
                onAddMistake={handleAddMistake}
                onDeleteMistake={handleDeleteMistake}
              />

              {fileNotFound && !readonly ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={handleLinkFile} className="gap-1.5">
                    <Link2 className="h-3.5 w-3.5" />Re-link file
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleUnlink} className="gap-1.5">
                    <Unlink className="h-3.5 w-3.5" />Unlink
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDeleteVideo} className="text-[#E24C3A] hover:text-[#E24C3A] gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" />Remove entry
                  </Button>
                </div>
              ) : !readonly && (
                <>
                  <div className="flex items-center justify-between gap-2 px-0.5">
                    <span className="text-xs text-hextech-text-dim truncate max-w-[70%]">{recording.filePath}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {hasReview && (
                        <Button variant="ghost" size="sm" onClick={handleDeleteReview} className="text-amber-400 hover:text-amber-400 h-7" title={t('recording.deleteReviewButton')}>
                          <FileX2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={handleUnlink} className="text-hextech-text-dim hover:text-hextech-gold h-7" title={t('recording.unlinkButton')}>
                        <Unlink className="h-3.5 w-3.5" />
                      </Button>
                      {confirmDeleteVideo ? (
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={handleDeleteVideo} className="text-[#E24C3A] hover:text-[#E24C3A] h-7 text-[10px] font-bold">
                            {t('recording.confirmDeleteVideo')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteVideo(false)} className="text-hextech-text-dim h-7 text-[10px]">
                            ✕
                          </Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteVideo(true)} className="text-[#E24C3A] hover:text-[#E24C3A] h-7" title={t('recording.deleteVideoButton')}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <RecordingMediaPanel
                    recordingId={recording.id}
                    filePath={recording.filePath}
                    title={t('recording.panel.title')}
                    creatingClip={clipModeOn}
                    onNewClip={() => openClipMode()}
                    clipSaveKey={clipSaveKey}
                  />
                </>
              )}
            </div>
          )}

          {/* YouTube embed */}
          {youtubeId && (
            <div className="p-4 space-y-3">
              <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
                <iframe
                  title={t('a11y.youtubePlayer')}
                  className="absolute inset-0 w-full h-full rounded-md"
                  src={`https://www.youtube.com/embed/${youtubeId}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              {!readonly && (
                <div className="flex items-center justify-between">
                  <a href={recording!.youtubeUrl!} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-hextech-text-dim hover:text-hextech-gold transition-colors">
                    <ExternalLink className="h-3 w-3" />Open on YouTube
                  </a>
                  <div className="flex items-center gap-1">
                    {hasReview && (
                      <Button variant="ghost" size="sm" onClick={handleDeleteReview} className="text-amber-400 hover:text-amber-400" title={t('recording.deleteReviewButton')}>
                        <FileX2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={handleUnlink} className="text-hextech-text-dim hover:text-hextech-gold" title={t('recording.unlinkButton')}>
                      <Unlink className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleDeleteVideo} className="text-[#E24C3A] hover:text-[#E24C3A]" title={t('recording.deleteVideoButton')}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* YouTube URL only (no embed) */}
          {recording?.youtubeUrl && !youtubeId && (
            <div className="px-4 py-3 flex items-center justify-between">
              <a href={recording.youtubeUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-sm text-hextech-gold hover:underline">
                <ExternalLink className="h-3.5 w-3.5" />Open YouTube link
              </a>
              {!readonly && (
                <div className="flex items-center gap-1">
                  {hasReview && (
                    <Button variant="ghost" size="sm" onClick={handleDeleteReview} className="text-amber-400 hover:text-amber-400" title={t('recording.deleteReviewButton')}>
                      <FileX2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleUnlink} className="text-hextech-text-dim hover:text-hextech-gold" title={t('recording.unlinkButton')}>
                    <Unlink className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDeleteVideo} className="text-[#E24C3A] hover:text-[#E24C3A]" title={t('recording.deleteVideoButton')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* No recording yet — link options */}
          {!recording && !readonly && (
            <div className="p-4 space-y-3">
              {showYtInput ? (
                <div className="space-y-2">
                  <input
                    type="url"
                    value={ytUrl}
                    onChange={(e) => setYtUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=..."
                    aria-label={t('recording.panel.youtubeUrl')}
                    className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveYoutube} disabled={saving || !ytUrl.trim()} className="gap-1">
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Youtube className="h-3 w-3" />}
                      {t('recording.panel.saveLink')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setShowYtInput(false); setYtUrl('') }}>{t('common.cancel')}</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning} className="gap-1.5">
                    {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {t('recording.panel.scan')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLinkFile} className="gap-1.5">
                    <Link2 className="h-3.5 w-3.5" aria-hidden />{t('recording.panel.linkFile')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowYtInput(true)} className="gap-1.5">
                    <Youtube className="h-3.5 w-3.5" aria-hidden />{t('recording.panel.addYoutube')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
