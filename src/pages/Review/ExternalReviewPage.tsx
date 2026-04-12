import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/useToast'
import { ExternalReviewHeader } from './ExternalReviewHeader'
import { VideoReviewPlayer } from '@/components/Recording/VideoReviewPlayer'
import { TimelineNoteInput, type TimelineNote } from '@/components/ReviewForm/TimelineNoteInput'
import { DynamicKPIForm } from '@/components/ReviewForm/DynamicKPIForm'
import { RecordingMediaPanel } from '@/components/Recording/RecordingMediaPanel'
import { Loader2, Check, Link2, Trash2, Scissors, Square, Save } from 'lucide-react'
import { ShareButton } from '@/components/Share/ShareButton'

// ── Helpers ───────────────────────────────────────────────────────────────────

function filePathToNxmUrl(filePath: string): string {
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
    const [m, s] = p.map(Number)
    if (!isNaN(m) && !isNaN(s)) return (m * 60 + s) * 1000
  }
  const sec = parseFloat(v)
  return isNaN(sec) ? null : Math.round(sec * 1000)
}

// ── External review data shape ────────────────────────────────────────────────

interface ExternalReview {
  id: string
  title: string | null
  filePath: string | null
  youtubeUrl: string | null
  fundamentalId: string | null
  subcategoryId: string | null
  notes: string | null
  kpiScores: Record<string, number> | null
  timelineNotes: TimelineNote[] | null
  createdAt: string
  updatedAt: string
}

// ── Page component ────────────────────────────────────────────────────────────

export function ExternalReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  // Review data
  const [review, setReview] = useState<ExternalReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [timelineNotes, setTimelineNotes] = useState<TimelineNote[]>([])
  const [freeText, setFreeText] = useState('')
  const [kpiScores, setKpiScores] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [linkingFile, setLinkingFile] = useState(false)

  // Clip creation
  const [creatingClip, setCreatingClip] = useState(false)
  const [clipRange, setClipRange] = useState({ startMs: 0, endMs: 30_000 })
  const [clipTitle, setClipTitle] = useState('')
  const [startInput, setStartInput] = useState('0:00')
  const [endInput, setEndInput] = useState('0:30')
  const [savingClip, setSavingClip] = useState(false)
  /** Increments after each save to tell the media panel to reload clips */
  const [clipSaveKey, setClipSaveKey] = useState(0)

  // Recording lookup (needed for clip:create which requires a recordingId)
  const [matchingRecordingId, setMatchingRecordingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const r = await window.api.getExternalReview(id)
      setReview(r)
      if (r) {
        try { setTimelineNotes(JSON.parse(r.timelineNotes ?? '[]')) } catch { setTimelineNotes([]) }
        setFreeText(r.freeText ?? '')
        try { setKpiScores(JSON.parse(r.kpiScores ?? '{}')) } catch { setKpiScores({}) }
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // Find the Recording row that owns this file so clip:create has a recordingId
  useEffect(() => {
    if (!review?.filePath) return
    window.api.listGamesWithRecordings()
      .then((all: any[]) => {
        const match = all.find((r: any) => r.filePath === review.filePath)
        setMatchingRecordingId(match?.recordingId ?? null)
      })
      .catch(() => {})
  }, [review?.filePath])

  const matchData: any = useMemo(() => {
    if (!review?.matchData) return null
    try { return JSON.parse(review.matchData) } catch { return null }
  }, [review])

  const objectiveIds: string[] = useMemo(() => {
    if (!review) return []
    try { return JSON.parse(review.objectiveIds ?? '[]') } catch { return review.objectiveId ? [review.objectiveId] : [] }
  }, [review])

  const selectedKpiIds: string[] = useMemo(() => {
    if (!review) return []
    try { return JSON.parse(review.selectedKpiIds ?? '[]') } catch { return [] }
  }, [review])

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!id) return
    setSaving(true)
    try {
      await window.api.saveExternalReview(id, {
        timelineNotes: JSON.stringify(timelineNotes),
        freeText: freeText || undefined,
        kpiScores: JSON.stringify(kpiScores),
      })
      setSaved(true)
      toast({ title: 'Review saved', variant: 'gold' })
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleLinkFile = async () => {
    if (!id) return
    setLinkingFile(true)
    try {
      const path = await window.api.pickExternalReviewFile()
      if (!path) return
      await window.api.saveExternalReview(id, { filePath: path })
      await load()
    } finally {
      setLinkingFile(false)
    }
  }

  const handleUnlinkFile = async () => {
    if (!id) return
    await window.api.saveExternalReview(id, { filePath: '' })
    await load()
  }

  const handleDelete = async () => {
    if (!id) return
    await window.api.deleteExternalReview(id)
    navigate('/review')
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
    if (!matchingRecordingId) return
    setSavingClip(true)
    try {
      await (window.api as any).createClip({
        recordingId: matchingRecordingId,
        startMs: clipRange.startMs,
        endMs: clipRange.endMs,
        title: clipTitle || undefined,
      })
      setCreatingClip(false)
      setClipSaveKey((k) => k + 1)
    } catch (err) {
      console.error('[ExternalReviewPage] Clip save failed:', err)
    } finally {
      setSavingClip(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-hextech-gold" />
      </div>
    )
  }

  if (!review) return null

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <ExternalReviewHeader review={review} onDelete={handleDelete} />
        </div>
        <ShareButton
          className="shrink-0 mt-1"
          data={{
            title: review.title,
            win: matchData?.win,
            champion: matchData?.champion,
            opponentChampion: matchData?.opponentChampion ?? undefined,
            kills: matchData?.kills,
            deaths: matchData?.deaths,
            assists: matchData?.assists,
            cs: matchData?.cs,
            visionScore: matchData?.visionScore,
            duration: matchData?.duration,
            gameEndAt: matchData?.gameEndAt,
            playerName: review.playerName ?? undefined,
            objectiveIds,
            selectedKpiIds,
            kpiScores,
            timelineNotes,
            freeText,
          }}
        />
      </div>

      {/* Video + clip controls */}
      {review.filePath ? (
        <div className="space-y-2">
          <VideoReviewPlayer
            src={filePathToNxmUrl(review.filePath)}
            notes={timelineNotes}
            onAddNote={(note) => setTimelineNotes((prev) => [...prev, note])}
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
                  disabled={savingClip || !matchingRecordingId}
                  onClick={handleSaveClip}
                  className="h-6 px-2.5 text-[11px] gap-1 bg-hextech-gold text-hextech-dark hover:bg-hextech-gold/90"
                >
                  {savingClip ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </Button>
                <button
                  onClick={() => setCreatingClip(false)}
                  className="h-6 px-2 rounded text-[11px] text-hextech-text-dim hover:text-hextech-text border border-transparent hover:border-hextech-border-dim transition-colors"
                >
                  <Square className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* File path + unlink */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-hextech-text-dim truncate max-w-[70%]">{review.filePath}</span>
            <Button variant="ghost" size="sm" onClick={handleUnlinkFile} className="text-hextech-text-dim hover:text-[#FF4655] shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={handleLinkFile} disabled={linkingFile} className="gap-2">
          {linkingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          Link recording file
        </Button>
      )}

      {/* Clips & Share panel — only when a video file is present */}
      {review.filePath && (
        <RecordingMediaPanel
          recordingId={matchingRecordingId}
          filePath={review.filePath}
          title={review.title}
          creatingClip={creatingClip}
          onNewClip={openClipEditor}
          clipSaveKey={clipSaveKey}
        />
      )}

      {/* Timeline notes */}
      <TimelineNoteInput
        notes={timelineNotes}
        onChange={setTimelineNotes}
        objectiveLabel={objectiveIds[0] ?? ''}
      />

      {/* KPI form — only when objectives are set */}
      {objectiveIds.length > 0 && selectedKpiIds.length > 0 && (
        <DynamicKPIForm
          objectiveIds={objectiveIds}
          scores={kpiScores}
          onChange={(kpiId, score) => setKpiScores((prev) => ({ ...prev, [kpiId]: score }))}
          selectedKpiIds={selectedKpiIds}
        />
      )}

      {/* Free text */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Thoughts & Feelings</CardTitle>
          <CardDescription>Write down your analysis, impressions, or anything you noticed.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="What stood out? What would you do differently?"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Save */}
      <Button onClick={handleSave} disabled={saving} size="lg" className="w-full">
        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
        {saved ? 'Saved ✓' : 'Save review'}
      </Button>
    </div>
  )
}
