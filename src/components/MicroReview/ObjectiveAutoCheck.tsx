import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ObjectiveVerificationPayload } from '@/lib/microReview/types'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'

/**
 * Automatic post-game verification of the session objectives
 * (objectiveVerification.ts). `refreshKey` changes after each micro-review
 * answer; `onVerdict` lets the Review page pre-fill "objective respected".
 */
export function ObjectiveAutoCheck({ gameId, refreshKey, onVerdict }: { gameId: string; refreshKey: number; onVerdict?: (passed: boolean) => void }) {
  const { t } = useTranslation()
  const fundamentals = useLocalizedFundamentals().flatMap((c) => c.fundamentals)
  const [data, setData] = useState<ObjectiveVerificationPayload | null>(null)

  useEffect(() => {
    let alive = true
    window.api.microReviewVerifyObjectives(gameId)
      .then((d) => {
        if (!alive) return
        setData(d)
        if (d?.overall != null) onVerdict?.(d.overall)
      })
      .catch(() => { if (alive) setData(null) })
    return () => { alive = false }
    // onVerdict is a stable setter wrapper from the page; refreshKey drives reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, refreshKey])

  if (!data || data.results.length === 0) return null
  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-hextech-border-dim bg-hextech-black/20 p-2.5" data-testid="objective-auto-check">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('objectiveCheck.title')}</p>
      {data.results.map((r) => {
        const Icon = r.status === 'passed' ? CheckCircle2 : r.status === 'failed' ? XCircle : CircleDashed
        return (
          <div key={r.fundamentalId} className="flex items-start gap-2 text-xs">
            <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', r.status === 'passed' ? 'text-hextech-green' : r.status === 'failed' ? 'text-hextech-red' : 'text-hextech-text-dim')} />
            <span className="min-w-0">
              <span className="font-medium text-hextech-text-bright">{fundamentals.find((f) => f.id === r.fundamentalId)?.label ?? r.fundamentalId}</span>
              <span className="text-hextech-text"> — {t(`objectiveCheck.rule.${r.ruleId}`, { warded: r.objectivesWarded ?? 0, total: r.objectivesTotal ?? 0, cs: r.csDiff10 ?? '—' })}</span>
              <span className={cn('ml-1.5 text-[10px] font-semibold', r.status === 'passed' ? 'text-hextech-green' : r.status === 'failed' ? 'text-hextech-red' : 'text-hextech-text-dim')}>{t(`objectiveCheck.status.${r.status}`)}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
