import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { ExternalReviewModeStep } from './wizard/ExternalReviewModeStep'
import { ExternalReviewCustomStep } from './wizard/ExternalReviewCustomStep'
import { ExternalReviewPlayerStep } from './wizard/ExternalReviewPlayerStep'
import { ExternalReviewGamesStep } from './wizard/ExternalReviewGamesStep'
import { ArrowLeft } from 'lucide-react'

export type WizardMode = 'select' | 'custom' | 'player-input' | 'player-games'

export interface WizardState {
  title: string
  objectiveIds: string[]
  selectedKpiIds: string[]
  wantsObjective: boolean
  gameName: string
  tagLine: string
  region: string
  fetchedGames: any[]
  selectedGame: any | null
  playerName: string
}

interface Props {
  open: boolean
  onClose: () => void
}

export function ExternalReviewWizard({ open, onClose }: Props) {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [mode, setMode] = useState<WizardMode>('select')
  const [creating, setCreating] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [fetchedCount, setFetchedCount] = useState(10)
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

  const patch = (partial: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...partial }))

  const handleLoadMore = async () => {
    const nextCount = fetchedCount + 10
    setLoadingMore(true)
    try {
      const games = await window.api.fetchExternalPlayerHistory(
        state.gameName.trim(),
        state.tagLine.trim(),
        state.region,
        nextCount,
      )
      patch({ fetchedGames: games })
      setFetchedCount(nextCount)
    } catch { /* ignore */ } finally {
      setLoadingMore(false)
    }
  }

  const handleClose = () => {
    onClose()
    // Reset after close animation
    setTimeout(() => {
      setMode('select')
      setFetchedCount(10)
      setState({
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
    }, 300)
  }

  const handleCreate = async (overrides?: Partial<WizardState>) => {
    const merged = { ...state, ...overrides }
    const isExternal = mode === 'player-games'

    const title = isExternal && merged.selectedGame
      ? `${merged.selectedGame.champion} — ${merged.playerName}`
      : merged.title.trim()

    if (!title) {
      toast({ title: 'Please enter a title', variant: 'destructive' })
      return
    }

    setCreating(true)
    try {
      const review = await window.api.createExternalReview({
        title,
        objectiveId: merged.objectiveIds[0] ?? undefined,
        objectiveIds: JSON.stringify(merged.objectiveIds),
        selectedKpiIds: JSON.stringify(merged.selectedKpiIds),
        playerName: isExternal ? merged.playerName : undefined,
        matchData: isExternal && merged.selectedGame
          ? JSON.stringify(merged.selectedGame)
          : undefined,
      })
      handleClose()
      navigate(`/external-review/${review.id}`)
    } catch (err: any) {
      toast({ title: 'Failed to create review', description: err.message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const canGoBack = mode !== 'select'

  const handleBack = () => {
    if (mode === 'custom') setMode('select')
    else if (mode === 'player-input') setMode('select')
    else if (mode === 'player-games') setMode('player-input')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {canGoBack && (
              <button onClick={handleBack} className="text-hextech-text-dim hover:text-hextech-text mr-1 transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            External Review
          </DialogTitle>
        </DialogHeader>

        {mode === 'select' && (
          <ExternalReviewModeStep
            onCustom={() => setMode('custom')}
            onExternal={() => setMode('player-input')}
          />
        )}

        {mode === 'custom' && (
          <ExternalReviewCustomStep
            state={state}
            onChange={patch}
            creating={creating}
            onCreate={handleCreate}
          />
        )}

        {mode === 'player-input' && (
          <ExternalReviewPlayerStep
            state={state}
            onChange={patch}
            onGames={(games, playerName) => {
              patch({ fetchedGames: games, playerName })
              setFetchedCount(10)
              setMode('player-games')
            }}
          />
        )}

        {mode === 'player-games' && (
          <ExternalReviewGamesStep
            state={state}
            onChange={patch}
            creating={creating}
            onCreate={handleCreate}
            onLoadMore={handleLoadMore}
            loadingMore={loadingMore}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
