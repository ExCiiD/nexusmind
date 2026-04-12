import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ClipSharePanel } from '@/components/Share/ClipSharePanel'
import {
  Scissors, Share2, Trash2, Youtube, ExternalLink,
  Loader2, Check, Copy,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClipEntry {
  id: string
  filePath: string
  title: string | null
  startMs: number
  endMs: number
  youtubeUrl: string | null
  tempShareUrl: string | null
  fileSize: number
}

type YoutubeUploadState = 'idle' | 'uploading' | 'done' | 'error'
type MediaTab = 'clips' | 'share'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

function fmtFileSize(b: number): string {
  return b < 1_048_576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1_048_576).toFixed(1)} MB`
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface RecordingMediaPanelProps {
  /** recordingId for clip operations — null when the file isn't linked to a Recording row */
  recordingId: string | null
  filePath: string
  title: string
  creatingClip: boolean
  onNewClip: () => void
  /** Increment this after each successful clip save to trigger a list refresh */
  clipSaveKey: number
}

export function RecordingMediaPanel({
  recordingId,
  filePath,
  title,
  creatingClip,
  onNewClip,
  clipSaveKey,
}: ExternalReviewMediaPanelProps) {
  const [tab, setTab] = useState<MediaTab>('clips')
  const [clips, setClips] = useState<ClipEntry[]>([])
  const [loadingClips, setLoadingClips] = useState(false)

  // YouTube
  const [ytConnected, setYtConnected] = useState(false)
  const [ytState, setYtState] = useState<YoutubeUploadState>('idle')
  const [ytProgress, setYtProgress] = useState(0)
  const [ytUrl, setYtUrl] = useState<string | null>(null)
  const [ytError, setYtError] = useState<string | null>(null)

  const loadClips = useCallback(async () => {
    if (!recordingId) return
    setLoadingClips(true)
    try {
      const data = await (window.api as any).listClips(recordingId)
      setClips(data ?? [])
    } catch { /* non-critical */ }
    finally { setLoadingClips(false) }
  }, [recordingId])

  // Reload clips when recording changes or after a new clip is saved
  useEffect(() => { loadClips() }, [loadClips, clipSaveKey])

  // YouTube status
  useEffect(() => {
    ;(window.api as any).youtubeGetStatus?.()
      .then((s: any) => setYtConnected(s?.connected ?? false))
      .catch(() => {})
  }, [])

  // YouTube upload progress listener
  useEffect(() => {
    const unsub = (window.api as any).onYoutubeUploadProgress?.((d: { percent: number }) => setYtProgress(d.percent))
    return () => unsub?.()
  }, [])

  const handleDeleteClip = async (id: string) => {
    await (window.api as any).deleteClip(id)
    await loadClips()
  }

  const handleYtUpload = async () => {
    setYtState('uploading'); setYtProgress(0); setYtError(null)
    try {
      const r = await (window.api as any).youtubeUpload({
        filePath,
        title,
        description: 'Reviewed with NexusMind',
        visibility: 'unlisted',
      })
      setYtUrl(r.url)
      setYtState('done')
    } catch (err: any) {
      setYtError(err?.message ?? 'Upload failed')
      setYtState('error')
    }
  }

  return (
    <div className="rounded-xl bg-hextech-elevated border border-hextech-border-dim overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b border-hextech-border-dim px-3">
        {(['clips', 'share'] as MediaTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-hextech-gold text-hextech-gold'
                : 'border-transparent text-hextech-text-dim hover:text-hextech-text'
            }`}
          >
            {t === 'clips' ? (
              <span className="flex items-center gap-1.5">
                <Scissors className="h-3 w-3" />
                Clips
                {clips.length > 0 && (
                  <span className="rounded-full bg-hextech-gold/20 text-hextech-gold px-1 text-[9px]">
                    {clips.length}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Share2 className="h-3 w-3" />
                Share
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="px-3 py-2.5">
        {tab === 'clips' && (
          <ClipsSection
            clips={clips}
            loading={loadingClips}
            recordingId={recordingId}
            creatingClip={creatingClip}
            onNewClip={onNewClip}
            onDelete={handleDeleteClip}
          />
        )}
        {tab === 'share' && (
          <ShareSection
            filePath={filePath}
            title={title}
            ytConnected={ytConnected}
            ytState={ytState}
            ytProgress={ytProgress}
            ytUrl={ytUrl}
            ytError={ytError}
            onYtUpload={handleYtUpload}
          />
        )}
      </div>
    </div>
  )
}

// ── Clips section ─────────────────────────────────────────────────────────────

interface ClipsSectionProps {
  clips: ClipEntry[]
  loading: boolean
  recordingId: string | null
  creatingClip: boolean
  onNewClip: () => void
  onDelete: (id: string) => void
}

function ClipsSection({ clips, loading, recordingId, creatingClip, onNewClip, onDelete }: ClipsSectionProps) {
  return (
    <div className="flex items-center gap-3 min-h-[2rem]">
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1.5 shrink-0"
        disabled={creatingClip || !recordingId}
        title={!recordingId ? 'File must be linked to a recording to create clips' : undefined}
        onClick={onNewClip}
      >
        <Scissors className="h-3 w-3" />
        {creatingClip ? 'Clipping…' : '+ New clip'}
      </Button>

      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-hextech-text-dim/60" />
      ) : clips.length === 0 ? (
        <p className="text-xs text-hextech-text-dim/60">No clips yet</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {clips.map((c) => (
            <ClipRow key={c.id} clip={c} onDelete={() => onDelete(c.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Clip row ──────────────────────────────────────────────────────────────────

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
        {clip.tempShareUrl && (
          <a href={clip.tempShareUrl} target="_blank" rel="noopener noreferrer" className="text-hextech-teal hover:text-hextech-teal/80 transition-colors">
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {clip.youtubeUrl && (
          <a href={clip.youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-red-400 hover:text-red-300 transition-colors">
            <Youtube className="h-3 w-3" />
          </a>
        )}
        {confirmDelete ? (
          <>
            <button onClick={onDelete} className="text-[10px] text-[#FF4655] font-medium">✓</button>
            <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-hextech-text-dim">✕</button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-hextech-text-dim/40 hover:text-[#FF4655] transition-colors">
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Share section ─────────────────────────────────────────────────────────────

interface ShareSectionProps {
  filePath: string
  title: string
  ytConnected: boolean
  ytState: YoutubeUploadState
  ytProgress: number
  ytUrl: string | null
  ytError: string | null
  onYtUpload: () => void
}

function ShareSection({ filePath, title, ytConnected, ytState, ytProgress, ytUrl, ytError, onYtUpload }: ShareSectionProps) {
  return (
    <div className="flex flex-wrap gap-6">
      {/* Discord / temp share */}
      <div className="flex-1 min-w-[200px]">
        <ClipSharePanel filePath={filePath} fileSize={0} title={title} />
      </div>

      {/* YouTube */}
      {ytConnected && (
        <div className="flex items-start pt-1">
          {ytState === 'idle' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
              onClick={onYtUpload}
            >
              <Youtube className="h-3.5 w-3.5" />Upload to YouTube
            </Button>
          )}
          {ytState === 'uploading' && (
            <div className="flex items-center gap-2 text-xs text-hextech-text-dim">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Uploading… {ytProgress}%
              <div className="w-24 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-red-500 transition-all" style={{ width: `${ytProgress}%` }} />
              </div>
            </div>
          )}
          {ytState === 'done' && ytUrl && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-400 flex items-center gap-1"><Check className="h-3 w-3" />Uploaded</span>
              <a href={ytUrl} target="_blank" rel="noopener noreferrer" className="text-red-400 hover:text-red-300 flex items-center gap-1">
                <ExternalLink className="h-3 w-3" />Open
              </a>
              <button onClick={() => navigator.clipboard.writeText(ytUrl)} className="text-hextech-text-dim hover:text-hextech-text flex items-center gap-1">
                <Copy className="h-3 w-3" />Copy
              </button>
            </div>
          )}
          {ytState === 'error' && <span className="text-xs text-[#FF4655]">{ytError}</span>}
        </div>
      )}
    </div>
  )
}
