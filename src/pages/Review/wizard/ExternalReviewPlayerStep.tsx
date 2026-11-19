import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { PLATFORM_REGIONS } from '@/lib/regions'

interface Props {
  state: { gameName: string; tagLine: string; region: string }
  onChange: (partial: { gameName?: string; tagLine?: string; region?: string }) => void
  onGames: (games: any[], playerName: string) => void
}

export function ExternalReviewPlayerStep({ state, onChange, onGames }: Props) {
  const { t } = useTranslation()
  const [fetching, setFetching] = useState(false)
  const { toast } = useToast()

  const handleFetch = async () => {
    if (!state.gameName.trim() || !state.tagLine.trim()) {
      toast({ title: t('externalReview.player.invalidId'), variant: 'destructive' })
      return
    }
    setFetching(true)
    try {
      const games = await window.api.fetchExternalPlayerHistory(
        state.gameName.trim(),
        state.tagLine.trim(),
        state.region,
      )
      if (!games.length) {
        toast({ title: t('externalReview.player.noGames'), variant: 'destructive' })
        return
      }
      onGames(games, `${state.gameName.trim()}#${state.tagLine.trim()}`)
    } catch (err: any) {
      toast({ title: t('externalReview.player.notFound'), description: err.message, variant: 'destructive' })
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="space-y-4 pt-1">
      <p className="text-xs text-hextech-text-dim">
        {t('externalReview.player.intro')}
      </p>

      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <label htmlFor="ext-game-name" className="text-[10px] text-hextech-text-dim uppercase tracking-wider">{t('externalReview.player.gameName')}</label>
          <input
            id="ext-game-name"
            autoFocus
            type="text"
            value={state.gameName}
            onChange={(e) => onChange({ gameName: e.target.value })}
            placeholder="Faker"
            className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
            onKeyDown={(e) => { if (e.key === 'Enter') handleFetch() }}
          />
        </div>
        <div className="w-28 space-y-1">
          <label htmlFor="ext-tag" className="text-[10px] text-hextech-text-dim uppercase tracking-wider">{t('externalReview.player.tag')}</label>
          <input
            id="ext-tag"
            type="text"
            value={state.tagLine}
            onChange={(e) => onChange({ tagLine: e.target.value })}
            placeholder="KR1"
            className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
            onKeyDown={(e) => { if (e.key === 'Enter') handleFetch() }}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="ext-region" className="text-[10px] text-hextech-text-dim uppercase tracking-wider">{t('externalReview.player.region')}</label>
        <select
          id="ext-region"
          value={state.region}
          onChange={(e) => onChange({ region: e.target.value })}
          className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text focus:outline-none focus:border-hextech-gold"
        >
          {PLATFORM_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <Button
        onClick={handleFetch}
        disabled={fetching || !state.gameName.trim() || !state.tagLine.trim()}
        className="w-full"
        size="lg"
      >
        {fetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <Search className="h-4 w-4 mr-2" aria-hidden />}
        {t('externalReview.player.fetch')}
      </Button>
    </div>
  )
}
