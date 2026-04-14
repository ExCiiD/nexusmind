import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExternalReviewCustomStep } from '@/pages/Review/wizard/ExternalReviewCustomStep'
import type { WizardState } from '@/pages/Review/ExternalReviewWizard'
import { useToast } from '@/hooks/useToast'

/**
 * Standalone flow when a capture exists but no Game row (e.g. no active session).
 * Same form as the wizard “custom” step: title, optional objectives/KPIs, then ExternalReview with file attached.
 */
export function ExternalReviewNewPage() {
  const [searchParams] = useSearchParams()
  const recordingId = searchParams.get('recordingId')
  const navigate = useNavigate()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [state, setState] = useState<WizardState>({
    title: '',
    objectiveIds: [],
    selectedKpiIds: [],
    wantsObjective: false,
    gameName: '',
    tagLine: '',
    region: 'EUW1',
    fetchedGames: [],
    selectedGame: null,
    playerName: '',
  })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!recordingId) {
      setLoading(false)
      return
    }
    window.api
      .getRecordingById(recordingId)
      .then((r) => {
        if (r?.filePath) {
          setFilePath(r.filePath)
          const base = r.filePath.split(/[/\\]/).pop() ?? 'Match capture'
          setState((s) => ({ ...s, title: base.replace(/\.[^.]+$/, '') }))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [recordingId])

  const patch = (partial: Partial<WizardState>) => setState((prev) => ({ ...prev, ...partial }))

  const handleCreate = useCallback(async () => {
    if (!state.title.trim() || !filePath) {
      toast({ title: 'Missing title or file', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const review = await window.api.createExternalReview({
        title: state.title.trim(),
        objectiveId: state.objectiveIds[0],
        objectiveIds: JSON.stringify(state.objectiveIds),
        selectedKpiIds: JSON.stringify(state.selectedKpiIds),
        filePath,
      })
      if (review?.id) navigate(`/external-review/${review.id}`)
    } catch (err: unknown) {
      toast({
        title: 'Failed to create review',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }, [state.title, state.objectiveIds, state.selectedKpiIds, filePath, navigate, toast])

  if (!recordingId) {
    return (
      <div className="p-8 text-hextech-text-dim">
        Invalid link — open this page from a post-game capture flow.
      </div>
    )
  }

  if (loading) {
    return <div className="p-12 text-center text-hextech-text-dim">Loading…</div>
  }

  if (!filePath) {
    return (
      <div className="p-8 space-y-4 max-w-lg mx-auto">
        <p className="text-hextech-text-dim">Recording file not found for this id.</p>
        <Button type="button" variant="outline" onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
    )
  }

  return (
    <div className="animate-fade-in max-w-lg mx-auto pb-20 px-4">
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-hextech-text-dim hover:text-hextech-text"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-xl font-bold text-hextech-gold-bright">External review</h1>
      </div>
      <p className="text-xs text-hextech-text-dim mb-4">
        This match was not linked to a session. Your capture is already attached — set a title and optionally
        pick session fundamentals / KPIs, or leave objectives off for a free-form review.
      </p>
      <ExternalReviewCustomStep state={state} onChange={patch} creating={creating} onCreate={handleCreate} />
    </div>
  )
}
