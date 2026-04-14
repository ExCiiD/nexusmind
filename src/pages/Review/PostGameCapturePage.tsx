import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExternalReviewCustomStep } from '@/pages/Review/wizard/ExternalReviewCustomStep'
import type { WizardState } from '@/pages/Review/ExternalReviewWizard'
import { useToast } from '@/hooks/useToast'
import { useSessionStore } from '@/store/useSessionStore'
/**
 * After a match: title + optional objectives, then either external review (orphan capture)
 * or in-app review when a Game row exists. If the game belongs to the active session, user can
 * pre-fill objectives/KPIs from that session.
 */
export function PostGameCapturePage() {
  const [searchParams] = useSearchParams()
  const recordingId = searchParams.get('recordingId')
  const gameId = searchParams.get('gameId')
  const navigate = useNavigate()
  const { toast } = useToast()
  const activeSession = useSessionStore((s) => s.activeSession)
  const loadActiveSession = useSessionStore((s) => s.loadActiveSession)

  const [loading, setLoading] = useState(true)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [useSessionFocus, setUseSessionFocus] = useState(false)
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

  const gameInActiveSession =
    Boolean(gameId && activeSession?.games?.some((g) => g.id === gameId))

  useEffect(() => {
    loadActiveSession()
  }, [loadActiveSession])

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

  const applySessionObjectives = useCallback((on: boolean) => {
    setUseSessionFocus(on)
    if (!on || !activeSession) {
      setState((prev) => ({ ...prev, wantsObjective: false, objectiveIds: [], selectedKpiIds: [] }))
      return
    }
    try {
      const oids = JSON.parse(activeSession.objectiveIds || '[]') as string[]
      const kids = JSON.parse(activeSession.selectedKpiIds || '[]') as string[]
      setState((prev) => ({
        ...prev,
        wantsObjective: true,
        objectiveIds: Array.isArray(oids) && oids.length > 0 ? oids : [activeSession.objectiveId],
        selectedKpiIds: Array.isArray(kids) ? kids : [],
      }))
    } catch {
      setState((prev) => ({
        ...prev,
        wantsObjective: true,
        objectiveIds: [activeSession.objectiveId],
        selectedKpiIds: [],
      }))
    }
  }, [activeSession])

  const handleContinue = useCallback(async () => {
    if (!state.title.trim() || !filePath || !recordingId) {
      toast({ title: 'Titre ou fichier manquant', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      if (gameId) {
        navigate(`/review?gameId=${encodeURIComponent(gameId)}`, {
          replace: true,
          state: {
            postGameSetup: {
              title: state.title.trim(),
              objectiveIds: state.objectiveIds,
              selectedKpiIds: state.selectedKpiIds,
              usedSessionObjectives: useSessionFocus,
            },
          },
        })
        return
      }
      const review = await window.api.createExternalReview({
        title: state.title.trim(),
        objectiveId: state.objectiveIds[0],
        objectiveIds: JSON.stringify(state.objectiveIds),
        selectedKpiIds: JSON.stringify(state.selectedKpiIds),
        filePath,
      })
      if (review?.id) navigate(`/external-review/${review.id}`, { replace: true })
    } catch (err: unknown) {
      toast({
        title: 'Échec',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }, [
    state.title,
    state.objectiveIds,
    state.selectedKpiIds,
    filePath,
    recordingId,
    gameId,
    navigate,
    toast,
    useSessionFocus,
  ])

  if (!recordingId) {
    return <div className="p-8 text-hextech-text-dim">Lien invalide.</div>
  }
  if (loading) return <div className="p-12 text-center text-hextech-text-dim">Chargement…</div>
  if (!filePath) {
    return (
      <div className="p-8 max-w-lg mx-auto space-y-4">
        <p className="text-hextech-text-dim">Enregistrement introuvable.</p>
        <Button type="button" variant="outline" onClick={() => navigate(-1)}>
          Retour
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
          aria-label="Retour"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-xl font-bold text-hextech-gold-bright">Revue — après partie</h1>
      </div>
      <p className="text-xs text-hextech-text-dim mb-4">
        Donne un titre à ta revue et choisis des objectifs optionnels. La capture est déjà liée.
        {gameId ? ' Ensuite ouvre la revue du match avec la vidéo.' : ' Une revue externe sera créée.'}
      </p>

      {gameInActiveSession && (
        <label className="flex items-start gap-3 mb-4 cursor-pointer rounded-lg border border-hextech-border-dim/60 bg-hextech-elevated/50 px-3 py-2.5">
          <input
            type="checkbox"
            checked={useSessionFocus}
            onChange={(e) => applySessionObjectives(e.target.checked)}
            className="mt-1 rounded border-hextech-border-dim"
          />
          <span className="text-sm text-hextech-text">
            <span className="font-medium text-hextech-text-bright">Session en cours</span>
            <span className="block text-xs text-hextech-text-dim mt-0.5">
              Pré-remplir les fondamentaux / KPIs de ta session active (tu peux les modifier ensuite).
            </span>
          </span>
        </label>
      )}

      <ExternalReviewCustomStep
        state={state}
        onChange={patch}
        creating={creating}
        onCreate={handleContinue}
        submitLabel={gameId ? 'Ouvrir la revue du match' : 'Créer la revue externe'}
      />
    </div>
  )
}
