import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, History, Download, Swords, Check, AlertTriangle, Filter, ChevronsDown } from 'lucide-react'
import { useToast } from '@/hooks/useToast'
import { formatGameTime, formatKDA } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { PICKER_SLOW_MS, normalizeHistoryResult, pickerErrorKey } from '@/lib/matchHistoryPickerView'
import { riotErrorText, riotRateLimitSeconds } from '@/lib/riotErrors'
import { useUserStore } from '@/store/useUserStore'
import { AccountBadge } from '@/components/ui/AccountBadge'
import { invalidateCached } from '@/lib/queryCache'

const ROLE_LABELS: Record<string, string> = {
  TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support',
}

interface MatchEntry {
  matchId: string
  champion: string
  role: string
  kills: number
  deaths: number
  assists: number
  cs: number
  duration: number
  win: boolean
  gameEndAt: string
  alreadyImported: boolean
  offSession?: boolean
  accountName?: string
  accountProfileIconId?: number
}

interface MatchHistoryPickerProps {
  onImported: () => void
}

export function MatchHistoryPicker({ onImported }: MatchHistoryPickerProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const mainRole = useUserStore((s) => s.user?.mainRole ?? null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [importing, setImporting] = useState(false)
  const [matches, setMatches] = useState<MatchEntry[]>([])
  const [fetchedCount, setFetchedCount] = useState(15)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Never a spinner forever: after 25 s « Riot met du temps à répondre » with Réessayer / Fermer (a late answer is
  // still shown); an error is shown translated, in place. Each request has an id: Fermer or a newer request makes an
  // older answer stale.
  const [problem, setProblem] = useState<{ kind: 'slow' | 'error'; text?: string } | null>(null)
  const [partial, setPartial] = useState(false)
  const requestId = useRef(0)
  const slowTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(slowTimer.current), [])

  const load = async (count: number, more: boolean) => {
    const id = ++requestId.current
    clearTimeout(slowTimer.current)
    setProblem(null)
    if (more) setLoadingMore(true); else { setLoading(true); setSelected(new Set()) }
    slowTimer.current = setTimeout(() => {
      if (id !== requestId.current) return
      setLoading(false); setLoadingMore(false)
      setProblem({ kind: 'slow' })
    }, PICKER_SLOW_MS)
    try {
      const { list, partial: isPartial } = normalizeHistoryResult<MatchEntry>(await window.api.fetchMatchHistory(count))
      if (id !== requestId.current) return
      setMatches(list)
      setPartial(isPartial)
      setFetchedCount(count)
      setProblem(null)
      setOpen(true)
    } catch (err) {
      if (id !== requestId.current) return
      setProblem({ kind: 'error', text: riotRateLimitSeconds(err) !== null ? riotErrorText(err, t) : t(pickerErrorKey(err)) })
    } finally {
      if (id === requestId.current) { clearTimeout(slowTimer.current); setLoading(false); setLoadingMore(false) }
    }
  }
  const fetchHistory = () => load(15, false)
  const fetchMore = () => load(fetchedCount + 10, true)
  const closeProblem = () => { requestId.current++; clearTimeout(slowTimer.current); setProblem(null); setLoading(false); setLoadingMore(false) }
  const problemPanel = problem && (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-hextech-gold/40 bg-hextech-gold/5 px-3 py-2 text-sm text-hextech-text">
      <span className="min-w-0 flex-1">{problem.kind === 'slow' ? t('history.picker.slow') : problem.text}</span>
      <Button size="sm" variant="outline" onClick={() => { void (open ? load(fetchedCount + 10, true) : fetchHistory()) }}>{t('history.picker.retry')}</Button>
      <Button size="sm" variant="ghost" onClick={closeProblem}>{t('common.close')}</Button>
    </div>
  )

  const toggleSelect = (matchId: string, alreadyImported: boolean) => {
    if (alreadyImported) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(matchId)) next.delete(matchId)
      else next.add(matchId)
      return next
    })
  }

  const handleImport = async () => {
    if (selected.size === 0) return
    setImporting(true)
    try {
      const imported = await window.api.importGamesToSession([...selected])
      invalidateCached('games:') // the game lists (History, Stats, Dashboard) refetch
      toast({
        title: t('history.picker.importedTitle'),
        description: t('history.picker.importedDesc', { count: imported.length }),
        variant: 'gold',
      })
      setOpen(false)
      setSelected(new Set())
      onImported()
    } catch (err: any) {
      toast({ title: t('history.picker.importErrorTitle'), description: err.message, variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <Button variant="outline" onClick={() => { void fetchHistory() }} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
          {t('history.picker.button')}
        </Button>
        {problemPanel}
      </div>
    )
  }

  const visibleMatches = mainRole ? matches.filter((m) => m.role === mainRole) : matches
  const importable = visibleMatches.filter((m) => !m.alreadyImported)

  return (
    <div className="space-y-4 rounded-xl border border-hextech-border bg-hextech-panel p-4">
      {problemPanel}
      {partial && <p className="text-xs text-hextech-gold">{t('history.picker.partial')}</p>}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-semibold text-hextech-gold-bright flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('history.picker.title')}
            {mainRole && (
              <span className="inline-flex items-center gap-1 rounded-full border border-hextech-cyan/40 bg-hextech-cyan/10 px-2 py-0.5 text-[10px] font-medium text-hextech-cyan">
                <Filter className="h-2.5 w-2.5" />
                {ROLE_LABELS[mainRole] ?? mainRole} only
              </span>
            )}
          </h3>
          <p className="text-xs text-hextech-text mt-0.5">{t('history.picker.subtitle')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="text-hextech-text-dim">
          ✕
        </Button>
      </div>

      {visibleMatches.length === 0 ? (
        <div className="flex items-center gap-2 text-hextech-text py-4 justify-center">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">{t('history.picker.empty')}</span>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {visibleMatches.map((m) => {
            const isSelected = selected.has(m.matchId)
            const disabled = m.alreadyImported
            return (
              <button
                key={m.matchId}
                onClick={() => toggleSelect(m.matchId, m.alreadyImported)}
                disabled={disabled}
                className={[
                  'w-full text-left rounded-lg border px-3 py-2.5 transition-all',
                  disabled
                    ? 'border-hextech-border-dim opacity-50 cursor-not-allowed bg-hextech-bg'
                    : isSelected
                    ? 'border-hextech-gold bg-hextech-gold/10 cursor-pointer'
                    : 'border-hextech-border-dim hover:border-hextech-border bg-hextech-bg cursor-pointer',
                ].join(' ')}
              >
                <div className="flex items-center gap-3">
                  <div className={[
                    'h-5 w-5 rounded border flex items-center justify-center flex-shrink-0',
                    isSelected ? 'bg-hextech-gold border-hextech-gold' : 'border-hextech-border',
                  ].join(' ')}>
                    {isSelected && <Check className="h-3 w-3 text-black" />}
                    {disabled && <Check className="h-3 w-3 text-hextech-text-dim" />}
                  </div>

                  <Badge
                    variant={m.win ? 'success' : 'destructive'}
                    className="text-xs px-2 py-0 flex-shrink-0 w-16 justify-center"
                  >
                    {m.win ? t('review.victory') : t('review.defeat')}
                  </Badge>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-hextech-text-bright">{m.champion}</span>
                      <span className="text-xs text-hextech-text-dim">{m.role}</span>
                    </div>
                    <div className="text-xs text-hextech-text flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Swords className="h-3 w-3" />
                        {formatKDA(m.kills, m.deaths, m.assists)}
                      </span>
                      <span>{m.cs} CS</span>
                      <span>{formatGameTime(m.duration)}</span>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0 space-y-1">
                    <div className="text-xs text-hextech-text-dim">{formatDate(m.gameEndAt)}</div>
                    {m.accountName && (
                      <div className="flex justify-end">
                        <AccountBadge name={m.accountName} profileIconId={m.accountProfileIconId} />
                      </div>
                    )}
                    {disabled && (
                      <div className="text-xs text-hextech-text-dim">{t('history.picker.alreadyImported')}</div>
                    )}
                    {!disabled && m.offSession && (
                      <div className="text-xs text-hextech-cyan">{t('history.picker.offSession')}</div>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {visibleMatches.length > 0 && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-hextech-text-dim hover:text-hextech-text"
            onClick={() => { void fetchMore() }}
            disabled={loadingMore}
          >
            {loadingMore
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <ChevronsDown className="h-3 w-3" />}
            {loadingMore ? t('common.loading') : t('history.picker.loadMore')}
          </Button>
        </div>
      )}

      {importable.length > 0 && (
        <div className="flex items-center justify-between pt-2 border-t border-hextech-border-dim">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-hextech-text"
              onClick={() => setSelected(new Set(importable.map((m) => m.matchId)))}
            >
              {t('history.picker.selectAll')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-hextech-text"
              onClick={() => setSelected(new Set())}
            >
              {t('history.picker.selectNone')}
            </Button>
          </div>
          <Button
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
            size="sm"
            className="gap-2"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t('history.picker.import', { count: selected.size })}
          </Button>
        </div>
      )}
    </div>
  )
}
