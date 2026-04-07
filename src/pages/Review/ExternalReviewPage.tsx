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
import { Loader2, Check, Link2, Trash2 } from 'lucide-react'
import { ShareButton } from '@/components/Share/ShareButton'

function filePathToNxmUrl(filePath: string): string {
  const n = filePath.replace(/\\/g, '/')
  return n.startsWith('/') ? `nxm://${n}` : `nxm:///${n}`
}

export function ExternalReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [review, setReview] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [timelineNotes, setTimelineNotes] = useState<TimelineNote[]>([])
  const [freeText, setFreeText] = useState('')
  const [kpiScores, setKpiScores] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [linkingFile, setLinkingFile] = useState(false)

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-hextech-gold" />
      </div>
    )
  }

  if (!review) return null

  return (
    <div className="space-y-6 animate-fade-in">
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

      {/* Video */}
      {review.filePath ? (
        <div className="space-y-2">
          <VideoReviewPlayer
            src={filePathToNxmUrl(review.filePath)}
            notes={timelineNotes}
            onAddNote={(note) => setTimelineNotes((prev) => [...prev, note])}
          />
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

      <TimelineNoteInput notes={timelineNotes} onChange={setTimelineNotes} objectiveLabel={objectiveIds[0] ?? ''} />

      {/* KPI form — only shown when objectives were set */}
      {objectiveIds.length > 0 && selectedKpiIds.length > 0 && (
        <DynamicKPIForm
          objectiveIds={objectiveIds}
          scores={kpiScores}
          onChange={(kpiId, score) => setKpiScores((prev) => ({ ...prev, [kpiId]: score }))}
          selectedKpiIds={selectedKpiIds}
        />
      )}

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

      <Button onClick={handleSave} disabled={saving} size="lg" className="w-full">
        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
        {saved ? 'Saved ✓' : 'Save review'}
      </Button>
    </div>
  )
}
