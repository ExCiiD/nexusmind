import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Video, Youtube, Link2, Trash2, Loader2, ExternalLink, RefreshCw } from 'lucide-react'
import { VideoReviewPlayer } from './VideoReviewPlayer'
import { RecordingMediaPanel } from './RecordingMediaPanel'
import { useToast } from '@/hooks/useToast'
import type { TimelineNote } from '@/components/ReviewForm/TimelineNoteInput'

// ── Types & helpers ───────────────────────────────────────────────────────────

interface Recording {
  id: string
  gameId: string
  filePath: string | null
  youtubeUrl: string | null
  source: string
}

function filePathToNxmUrl(filePath: string): string {
  const n = filePath.replace(/\\/g, '/')
  return n.startsWith('/') ? `nxm://${n}` : `nxm:///${n}`
}

function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
  } catch {}
  return null
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

function parseMmSs(v: string): number | null {
  const p = v.split(':')
  if (p.length === 2) {
    const [m, s] = p.map(Number)
    if (!isNaN(m) && !isNaN(s)) return (m * 60 + s) * 1000
  }
  const sec = parseFloat(v)
  return isNaN(sec) ? null : Math.round(sec * 1000)
}

// ── Component ─────────────────────────────────────────────────────────────────

interface GameRecordingPanelProps {
  gameId: string
  readonly?: boolean
  timelineNotes?: TimelineNote[]
  onAddNote?: (note: TimelineNote) => void
}

export function GameRecordingPanel({ gameId, readonly, timelineNotes = [], onAddNote }: GameRecordingPanelProps) {
  const { toast } = useToast()
  const [recording, setRecording] = useState<Recording | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [showYtInput, setShowYtInput] = useState(false)
  const [ytUrl, setYtUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [fileNotFound, setFileNotFound] = useState(false)

  // Clip creation
  const [creatingClip, setCreatingClip] = useState(false)
  const [clipRange, setClipRange] = useState({ startMs: 0, endMs: 30_000 })
  const [clipTitle, setClipTitle] = useState('')
  const [startInput, setStartInput] = useState('0:00')
  const [endInput, setEndInput] = useState('0:30')
  const [savingClip, setSavingClip] = useState(false)
  const [clipSaveKey, setClipSaveKey] = useState(0)

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

  useEffect(() => {
    const off = window.api.onRecordingLinked((data) => {
      if (data.gameId === gameId) load()
    })
    return off
  }, [gameId, load])

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
          title: 'Failed to link recording',
          description: r.message ?? 'An unknown error occurred.',
          variant: 'destructive',
        })
        return
      }

      setRecording(r)
      setOpen(true)
    } catch (err) {
      console.error('[GameRecordingPanel] linkRecordingFile error:', err)
      toast({
        title: 'Failed to link recording',
        description: (err as Error)?.message ?? 'An unexpected error occurred.',
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

  const handleDelete = async () => {
    await window.api.deleteRecording(gameId)
    setRecording(null)
    setOpen(false)
  }

  // Clip editing
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
    if (!recording) return
    setSavingClip(true)
    try {
      await window.api.createClip({
        recordingId: recording.id,
        startMs: clipRange.startMs,
        endMs: clipRange.endMs,
        title: clipTitle || undefined,
      })
      setCreatingClip(false)
      setClipSaveKey((k) => k + 1)
    } catch (err) {
      console.error('[GameRecordingPanel] Clip save failed:', err)
    } finally { setSavingClip(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const youtubeId = recording?.youtubeUrl ? extractYoutubeId(recording.youtubeUrl) : null

  if (loading) return null

  return (
    <div className="rounded-lg border border-hextech-border-dim bg-hextech-dark overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-hextech-text hover:text-hextech-gold-bright transition-colors text-left"
      >
        <Video className="h-4 w-4 text-hextech-gold shrink-0" />
        <span>Recording</span>
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
          {/* Local file — VideoReviewPlayer + clips + share */}
          {recording?.filePath && (
            <div className="p-4 space-y-2">
              <VideoReviewPlayer
                src={filePathToNxmUrl(recording.filePath)}
                notes={timelineNotes}
                onAddNote={onAddNote}
                onFileNotFound={() => setFileNotFound(true)}
                readonly={readonly}
                clipping={creatingClip}
                clipRange={creatingClip ? clipRange : undefined}
                onClipRangeChange={creatingClip ? handleClipRangeChange : undefined}
                videoMaxHeight="max-h-[62vh] min-h-[300px]"
              />

              {/* Inline clip controls bar */}
              {creatingClip && (
                <div className="flex items-center gap-2 rounded-lg bg-[#090e17] border border-hextech-gold/30 px-3 py-1.5">
                  <div className="flex items-center gap-1 rounded bg-white/5 border border-white/10 px-1.5 py-1">
                    <span className="text-[9px] text-hextech-text-dim/60 uppercase">In</span>
                    <input
                      type="text"
                      value={startInput}
                      onChange={(e) => setStartInput(e.target.value)}
                      onBlur={applyStart}
                      onKeyDown={(e) => e.key === 'Enter' && applyStart()}
                      className="w-11 bg-transparent text-[11px] font-mono text-hextech-text text-center focus:outline-none"
                    />
                  </div>
                  <span className="text-[10px] font-mono text-hextech-text-dim/50">
                    {fmtMs(Math.max(0, clipRange.endMs - clipRange.startMs))}
                  </span>
                  <div className="flex items-center gap-1 rounded bg-white/5 border border-white/10 px-1.5 py-1">
                    <span className="text-[9px] text-hextech-text-dim/60 uppercase">Out</span>
                    <input
                      type="text"
                      value={endInput}
                      onChange={(e) => setEndInput(e.target.value)}
                      onBlur={applyEnd}
                      onKeyDown={(e) => e.key === 'Enter' && applyEnd()}
                      className="w-11 bg-transparent text-[11px] font-mono text-hextech-text text-center focus:outline-none"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Clip title (optional)"
                    value={clipTitle}
                    onChange={(e) => setClipTitle(e.target.value)}
                    className="flex-1 min-w-0 rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-hextech-text placeholder:text-hextech-text-dim/40 focus:outline-none"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      disabled={savingClip}
                      onClick={handleSaveClip}
                      className="h-6 px-2.5 text-[11px] gap-1 bg-hextech-gold text-hextech-dark hover:bg-hextech-gold/90"
                    >
                      {savingClip ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      Save
                    </Button>
                    <button
                      onClick={() => setCreatingClip(false)}
                      className="h-6 px-2 rounded text-[11px] text-hextech-text-dim hover:text-hextech-text border border-transparent hover:border-hextech-border-dim transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {fileNotFound && !readonly ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={handleLinkFile} className="gap-1.5">
                    <Link2 className="h-3.5 w-3.5" />Re-link file
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDelete} className="text-[#FF4655] hover:text-[#FF4655] gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" />Remove entry
                  </Button>
                </div>
              ) : !readonly && (
                <>
                  <div className="flex items-center justify-between gap-2 px-0.5">
                    <span className="text-xs text-hextech-text-dim truncate max-w-[70%]">{recording.filePath}</span>
                    <Button variant="ghost" size="sm" onClick={handleDelete} className="text-[#FF4655] hover:text-[#FF4655] h-7 shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <RecordingMediaPanel
                    recordingId={recording.id}
                    filePath={recording.filePath}
                    title="Recording"
                    creatingClip={creatingClip}
                    onNewClip={openClipEditor}
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
                  <Button variant="ghost" size="sm" onClick={handleDelete} className="text-[#FF4655] hover:text-[#FF4655]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
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
                <Button variant="ghost" size="sm" onClick={handleDelete} className="text-[#FF4655] hover:text-[#FF4655]">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
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
                    className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveYoutube} disabled={saving || !ytUrl.trim()} className="gap-1">
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Youtube className="h-3 w-3" />}
                      Save link
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setShowYtInput(false); setYtUrl('') }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning} className="gap-1.5">
                    {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Scan for recording
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleLinkFile} className="gap-1.5">
                    <Link2 className="h-3.5 w-3.5" />Link local file
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowYtInput(true)} className="gap-1.5">
                    <Youtube className="h-3.5 w-3.5" />Add YouTube link
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
