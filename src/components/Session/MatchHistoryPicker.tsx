import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, History, Download, Swords, Check, AlertTriangle, Filter } from 'lucide-react'
import { useToast } from '@/hooks/useToast'
import { formatGameTime, formatKDA } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { useUserStore } from '@/store/useUserStore'
import { AccountBadge } from '@/components/ui/AccountBadge'

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
  const [importing, setImporting] = useState(false)
  const [matches, setMatches] = useState<MatchEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const fetchHistory = async () => {
    setLoading(true)
    setSelected(new Set())
    try {
      const history = await window.api.fetchMatchHistory(15)
      setMatches(history)
      setOpen(true)
    } catch (err: any) {
      toast({ title: t('history.picker.errorTitle'), description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

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
      <Button variant="outline" onClick={fetchHistory} disabled={loading} className="gap-2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
        {t('history.picker.button')}
      </Button>
    )
  }

  const visibleMatches = mainRole ? matches.filter((m) => m.role === mainRole) : matches
  const importable = visibleMatches.filter((m) => !m.alreadyImported)

  return (
    <div className="space-y-4 rounded-xl border border-hextech-border bg-hextech-panel p-4">
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
                  </div>
                </div>
              </button>
            )
          })}
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
