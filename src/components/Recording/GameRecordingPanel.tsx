import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Video, Youtube, Link2, Trash2, Loader2, ExternalLink, RefreshCw } from 'lucide-react'
import { VideoReviewPlayer } from './VideoReviewPlayer'
import type { TimelineNote } from '@/components/ReviewForm/TimelineNoteInput'

interface Recording {
  id: string
  gameId: string
  filePath: string | null
  youtubeUrl: string | null
  source: string
}

interface GameRecordingPanelProps {
  gameId: string
  readonly?: boolean
  /** Timeline notes that have videoTime — displayed as markers in the video player */
  timelineNotes?: TimelineNote[]
  /** Called when user marks a moment in the video player */
  onAddNote?: (note: TimelineNote) => void
}

/** Convert an OS file path to a nxm:// URL for video playback in the renderer. */
function filePathToNxmUrl(filePath: string): string {
  // Normalise Windows backslashes → forward slashes
  const normalised = filePath.replace(/\\/g, '/')
  // Windows: C:/path → nxm:///C:/path  |  Unix: /path → nxm:///path
  return normalised.startsWith('/')
    ? `nxm://${normalised}`      // nxm:// + /home/user/... = nxm:///home/user/...
    : `nxm:///${normalised}`     // nxm:/// + C:/... = nxm:///C:/...
}

function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
  } catch {}
  return null
}

export function GameRecordingPanel({ gameId, readonly, timelineNotes = [], onAddNote }: GameRecordingPanelProps) {
  const [recording, setRecording] = useState<Recording | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [showYtInput, setShowYtInput] = useState(false)
  const [ytUrl, setYtUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [fileNotFound, setFileNotFound] = useState(false)

  const load = async () => {
    setLoading(true)
    setFileNotFound(false)
    try {
      const r = await window.api.getRecording(gameId)
      setRecording(r)
      if (r) setOpen(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [gameId])

  // Auto-refresh when main process links a new recording
  useEffect(() => {
    const off = window.api.onRecordingLinked((data) => {
      if (data.gameId === gameId) load()
    })
    return off
  }, [gameId])

  const handleScan = async () => {
    setScanning(true)
    try {
      await window.api.scanRecordings()
      await load()
    } finally {
      setScanning(false)
    }
  }

  const handleLinkFile = async () => {
    const r = await window.api.linkRecordingFile(gameId)
    if (r) { setRecording(r); setOpen(true) }
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
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    await window.api.deleteRecording(gameId)
    setRecording(null)
    setOpen(false)
  }

  const youtubeId = recording?.youtubeUrl ? extractYoutubeId(recording.youtubeUrl) : null

  if (loading) return null

  return (
    <div className="rounded-lg border border-hextech-border-dim bg-hextech-dark overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-hextech-text hover:text-hextech-gold-bright transition-colors text-left"
      >
        <Video className="h-4 w-4 text-hextech-gold shrink-0" />
        {recording ? (
          <>
            <span>Recording</span>
            <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] bg-hextech-gold/20 text-hextech-gold capitalize">
              {recording.source}
            </span>
            {timelineNotes.filter((n) => n.videoTime !== undefined).length > 0 && (
              <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] bg-hextech-cyan/20 text-hextech-cyan">
                {timelineNotes.filter((n) => n.videoTime !== undefined).length} moment{timelineNotes.filter((n) => n.videoTime !== undefined).length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        ) : (
          <span>Recording</span>
        )}
        <span className="ml-auto text-hextech-text-dim text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-hextech-border-dim">
          {/* Local file → VideoReviewPlayer */}
          {recording?.filePath && (
            <div className="p-4 space-y-3">
              <VideoReviewPlayer
                src={filePathToNxmUrl(recording.filePath)}
                notes={timelineNotes}
                onAddNote={onAddNote}
                onFileNotFound={() => setFileNotFound(true)}
                readonly={readonly}
              />
              {fileNotFound ? (
                /* File is missing — offer re-link or delete */
                !readonly && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={handleLinkFile} className="gap-1.5">
                      <Link2 className="h-3.5 w-3.5" />
                      Re-link file
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleDelete} className="text-[#FF4655] hover:text-[#FF4655] gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove entry
                    </Button>
                  </div>
                )
              ) : (
                !readonly && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-hextech-text-dim truncate max-w-[60%]">{recording.filePath}</span>
                    <Button variant="ghost" size="sm" onClick={handleDelete} className="text-[#FF4655] hover:text-[#FF4655] ml-2 shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
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
                  <a
                    href={recording!.youtubeUrl!}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-hextech-text-dim hover:text-hextech-gold transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open on YouTube
                  </a>
                  <Button variant="ghost" size="sm" onClick={handleDelete} className="text-[#FF4655] hover:text-[#FF4655]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* YouTube URL only (no valid embed ID) */}
          {recording?.youtubeUrl && !youtubeId && (
            <div className="px-4 py-3 flex items-center justify-between">
              <a href={recording.youtubeUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-sm text-hextech-gold hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> Open YouTube link
              </a>
              {!readonly && (
                <Button variant="ghost" size="sm" onClick={handleDelete} className="text-[#FF4655] hover:text-[#FF4655]">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}

          {/* No recording — actions */}
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
                    <Link2 className="h-3.5 w-3.5" />
                    Link local file
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowYtInput(true)} className="gap-1.5">
                    <Youtube className="h-3.5 w-3.5" />
                    Add YouTube link
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
