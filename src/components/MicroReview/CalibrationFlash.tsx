import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Gauge, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FAMILIES, FAMILY_COLOR, type MistakeFamily } from '@/lib/mistakeInsights'
import { codexFor } from '@/lib/microReview/codex'
import type { CalibrationResult, CalibrationStatus } from '@/lib/microReview/types'
import { useUserStore } from '@/store/useUserStore'
import { usePrepareSession } from './usePrepareSession'

/**
 * Calibration flash (every 15 games): one perception question, then the gap
 * between what the player thinks costs them and what their micro-reviews
 * and tagged mistakes say. Replaces the long periodic assessment form.
 */
export function CalibrationFlash() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const prepare = usePrepareSession()
  const role = useUserStore((s) => s.user?.mainRole ?? null)
  const [status, setStatus] = useState<CalibrationStatus | null>(null)
  const [busy, setBusy] = useState<MistakeFamily | null>(null)
  const [result, setResult] = useState<CalibrationResult | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => { window.api.calibrationStatus().then(setStatus).catch(() => {}) }, [])

  if (hidden || !status) return null
  const fam = (f: MistakeFamily) => t(`mistakeLab.family.${f}`)

  const submit = async (f: MistakeFamily) => {
    setBusy(f)
    try { setResult(await window.api.calibrationSubmit(f)) } catch { /* keep the question */ } finally { setBusy(null) }
  }

  const entry = result?.topTagSlug ? codexFor(result.topTagSlug, role, null) : null

  return (
    <section className="panel-surface rounded-xl border border-hextech-gold/30 bg-gradient-to-r from-hextech-gold/10 to-transparent p-4" data-testid="calibration-flash">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-hextech-gold-bright"><Gauge className="h-4 w-4" />{t('calibration.title')}</h2>
          <p className="mt-0.5 text-xs text-hextech-text">{t('calibration.due', { count: status.gamesSinceLast })}</p>
        </div>
        {!result && <button className="text-[11px] text-hextech-text-dim hover:text-hextech-text" onClick={() => setHidden(true)}>{t('calibration.later')}</button>}
      </div>

      {!result ? (
        <>
          <p className="mt-3 text-sm font-medium text-hextech-text-bright">{t('calibration.question')}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FAMILIES.map((f) => (
              <button key={f} disabled={!!busy} onClick={() => submit(f)}
                className="flex items-center justify-center gap-2 rounded-lg border border-hextech-border-dim bg-hextech-elevated/60 px-3 py-2.5 text-sm text-hextech-text-bright transition-colors hover:border-hextech-gold/60 disabled:opacity-60">
                {busy === f ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: FAMILY_COLOR[f] }} />}
                {fam(f)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-hextech-text-bright" data-testid="calibration-result">
            {result.aligned === null
              ? t('calibration.resultThin')
              : result.aligned
                ? t('calibration.resultAligned', { family: fam(result.perceived), share: result.perceivedShare })
                : t('calibration.resultGap', { perceived: fam(result.perceived), perceivedShare: result.perceivedShare, measured: fam(result.measuredTop!), share: result.topShare })}
          </p>
          <div>
            <p className="mb-1.5 text-[11px] text-hextech-text-dim">{t('calibration.dist', { count: status.basisGames })}</p>
            <div className="space-y-1">
              {result.distribution.map((d) => (
                <div key={d.family} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
                  <span className={cn('truncate', d.family === result.perceived ? 'font-semibold text-hextech-gold-bright' : 'text-hextech-text')}>{fam(d.family)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-hextech-elevated"><span className="block h-full rounded-full" style={{ width: `${d.share}%`, backgroundColor: FAMILY_COLOR[d.family] }} /></span>
                  <span className="text-right font-mono text-hextech-text-bright">{d.share}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {entry && <Button size="sm" onClick={() => prepare(entry)}>{t('calibration.work', { family: fam(result.measuredTop ?? result.perceived) })}</Button>}
            <Button size="sm" variant="outline" onClick={() => navigate('/assessment')}>{t('calibration.full')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>{t('calibration.close')}</Button>
          </div>
        </div>
      )}
    </section>
  )
}
