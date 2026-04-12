import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { VideoReviewPlayer } from '@/components/Recording/VideoReviewPlayer'
import { formatGameTime } from '@/lib/utils'
import {
  ArrowLeft, Scissors, Trash2, Loader2, ClipboardCheck,
  Clock, Calendar, Video, ExternalLink, Youtube, Share2,
  Check, Copy, Save, Square, Play,
} from 'lucide-react'
import { ClipSharePanel } from '@/components/Share/ClipSharePanel'

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
  return ({ capture: 'NexusMind', outplayed: 'Outplayed', insightcapture: 'InsightCapture', obs: 'OBS', youtube: 'YouTube', external: 'External' } as Record<string, string>)[s] ?? 'Manual'
}

function extractYtId(url: string) {
  return url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^&?/\s]+)/)?.[1] ?? null
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RecordPlayerPage() {
  const { recordingId } = useParams<{ recordingId: string }>()
  const navigate = useNavigate()

  const [recording, setRecording] = useState<RecordingDetail | null>(null)
  const [clips, setClips] = useState<ClipEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<BottomTab>('clips')

  // Clip creation
  const [creatingClip, setCreatingClip] = useState(false)
  const [clipRange, setClipRange] = useState({ startMs: 0, endMs: 30_000 })
  const [clipTitle, setClipTitle] = useState('')
  const [startInput, setStartInput] = useState('0:00')
  const [endInput, setEndInput] = useState('0:30')
  const [savingClip, setSavingClip] = useState(false)

  // External review creation
  const [creatingReview, setCreatingReview] = useState(false)

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
        title: `${recording.champion} — ${recording.win ? 'Victory' : 'Defeat'} | NexusMind`,
        description: 'Recorded with NexusMind', visibility: 'unlisted',
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

  const videoSrc = recording.filePath ? nxmUrl(recording.filePath) : null

  return (
    // Fixed-height column — no page scroll possible
    <div className="flex flex-col gap-2 animate-fade-in" style={{ height: 'calc(100vh - 3.25rem)', overflow: 'hidden' }}>
      {/* Back nav */}
      <button onClick={() => navigate('/record')} className="flex items-center gap-1.5 text-xs text-hextech-text-dim hover:text-hextech-text transition-colors self-start shrink-0">
        <ArrowLeft className="h-3.5 w-3.5" />Back to Record Hub
      </button>

      {/* Meta bar */}
      <MetaBar recording={recording} onNavigate={(p) => navigate(p)} onReview={handleOpenReview} reviewLoading={creatingReview} />

      {/* Player — full width, shrinks to give room to controls below */}
      {videoSrc ? (
        <VideoReviewPlayer
          src={videoSrc}
          notes={[]}
          readonly
          videoMaxHeight={creatingClip ? 'max-h-[calc(100vh-22rem)]' : 'max-h-[calc(100vh-18rem)]'}
          clipping={creatingClip}
          clipRange={creatingClip ? clipRange : undefined}
          onClipRangeChange={creatingClip ? handleClipRangeChange : undefined}
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
            onClick={handleSaveClip} disabled={savingClip || clipRange.endMs <= clipRange.startMs}>
            {savingClip ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save
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
}

function MetaBar({ recording, onNavigate, onReview, reviewLoading }: MetaBarProps) {
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

      {/* Session review (linked game only) */}
      {!recording.isOrphaned && recording.gameId && (
        <Button
          variant="outline" size="sm"
          className={`gap-2 h-7 text-xs shrink-0 ${recording.hasReview ? 'text-hextech-cyan border-hextech-cyan/30 hover:bg-hextech-cyan/10' : ''}`}
          onClick={() => onNavigate(`/review?gameId=${recording.gameId}`)}
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
          {recording.hasReview ? 'Open Review' : 'Start Review'}
        </Button>
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
  ytState: YoutubeUploadState; ytProgress: number; ytUrl: string | null
  ytError: string | null; ytConnected: boolean; onYtUpload: () => void
}

function BottomPanel({ recording, clips, activeTab, onTabChange, onNewClip, creatingClip, onDeleteClip, ytState, ytProgress, ytUrl, ytError, ytConnected, onYtUpload }: BottomPanelProps) {
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
          <ClipsTab clips={clips} creatingClip={creatingClip} onNewClip={onNewClip} onDeleteClip={onDeleteClip} />
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

function ClipsTab({ clips, creatingClip, onNewClip, onDeleteClip }: { clips: ClipEntry[]; creatingClip: boolean; onNewClip: () => void; onDeleteClip: (id: string) => void }) {
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
          {clips.map((clip) => <ClipRow key={clip.id} clip={clip} onDelete={() => onDeleteClip(clip.id)} />)}
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

function ClipRow({ clip, onDelete }: { clip: ClipEntry; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <div className="w-44 shrink-0 rounded-lg border border-hextech-border-dim bg-hextech-background/40 px-2.5 py-1.5 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-hextech-text-bright truncate">{clip.title ?? 'Clip'}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-hextech-text-dim">
          <span className="font-mono">{fmtMs(clip.startMs)}–{fmtMs(clip.endMs)}</span>
          <span>{fmtFileSize(clip.fileSize)}</span>
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
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
