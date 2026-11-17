/**
 * "Session basse énergie / tilt détecté" (docs/PLAN_MICRO_REVIEW.md, V4 §3):
 * proactive prompt that makes the low-energy protocol (AscendCodex) the
 * session objective in one click.
 *
 *   dashboard / session  shown only while the signal is raised (2 losses in
 *                        a row in the running session, or the current
 *                        daypart is one where the player wins under 45 %);
 *   daypart              inside the "Selon l'heure" panel: lists the risky
 *                        dayparts of the sample;
 *   tilt                 inside the "Gestion du tilt" panel: shown when the
 *                        win rate after a loss is under 45 % (or on a streak).
 *
 * Running session → its objective is updated on the spot. No session → the
 * session setup is pre-filled (objective + protocol note).
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BatteryLow, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/store/useSessionStore'
import { getKPIsForObjective } from '@/lib/constants/fundamentals'
import { tiltReport, type InsightGame } from '@/lib/statsInsights'
import { codexById } from '@/lib/microReview/codex'
import {
  LOW_ENERGY_CODEX_ID, LOW_ENERGY_WINRATE, lowEnergyActivation, lowEnergySignal, protocolActive, riskyDayparts,
  type LowEnergyActivation,
} from '@/lib/microReview/lowEnergy'
import type { SessionPrefillState } from './usePrepareSession'

export type LowEnergyContext = 'dashboard' | 'session' | 'daypart' | 'tilt'

interface Props {
  context: LowEnergyContext
  /** The Stats → Analyse sample when the host already has it (avoids a second fetch). */
  history?: InsightGame[]
  /** Session setup form: apply the protocol to the form instead of navigating. */
  onPrefill?: (activation: LowEnergyActivation) => void
  className?: string
}

const parseIds = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string')
  if (typeof raw !== 'string') return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
}

export function LowEnergyPrompt({ context, history: given, onPrefill, className }: Props) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const activeSession = useSessionStore((s) => s.activeSession)
  const updateSession = useSessionStore((s) => s.updateSession)
  const [fetched, setFetched] = useState<InsightGame[] | null>(null)
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  useEffect(() => {
    if (given) return
    let alive = true
    window.api.getMatchHistoryWithStatus(50)
      .then((rows: InsightGame[]) => { if (alive) setFetched(rows ?? []) })
      .catch(() => { if (alive) setFetched([]) })
    return () => { alive = false }
  }, [given])

  const history = given ?? fetched
  const name = t('lowEnergy.name')
  const session = useMemo(() => {
    if (!activeSession) return null
    const games: Array<{ win: boolean; gameEndAt?: string | null }> = activeSession.games ?? []
    const results = [...games]
      .sort((a, b) => new Date(a.gameEndAt ?? 0).getTime() - new Date(b.gameEndAt ?? 0).getTime())
      .map((g) => !!g.win)
    const objectiveIds = parseIds(activeSession.objectiveIds)
    return {
      objectiveIds: objectiveIds.length ? objectiveIds : activeSession.objectiveId ? [activeSession.objectiveId as string] : [],
      selectedKpiIds: parseIds(activeSession.selectedKpiIds),
      customNote: (activeSession.customNote as string | null | undefined) ?? null,
      results,
    }
  }, [activeSession])

  const view = useMemo(() => {
    if (!history) return null
    const signal = lowEnergySignal({ now: new Date(), history, sessionResults: session?.results ?? null })
    const risky = riskyDayparts(history)
    const tilt = tiltReport(history)
    const tiltWeak = tilt.afterLoss.enough && tilt.afterLoss.winrate < LOW_ENERGY_WINRATE
    const show = context === 'daypart' ? risky.length > 0
      : context === 'tilt' ? tiltWeak || signal.reasons.includes('loss-streak')
        : signal.active
    return { signal, risky, tilt, tiltWeak, show }
  }, [history, session, context])

  const entry = codexById(LOW_ENERGY_CODEX_ID)
  if (!view || !view.show || !entry) return null
  const { signal, risky, tilt, tiltWeak } = view
  const already = protocolActive(session, name)

  const activate = async () => {
    const activation = lowEnergyActivation({
      name,
      lang: i18n.language,
      protocolKpiIds: getKPIsForObjective(entry.fundamentalId).map((k) => k.id),
      current: session,
    })
    if (!activation) return
    if (activeSession) {
      setState('busy')
      try {
        await updateSession({ objectiveIds: activation.objectiveIds, selectedKpiIds: activation.selectedKpiIds, customNote: activation.customNote })
        setState('done')
      } catch {
        setState('error')
      }
    } else if (onPrefill) {
      onPrefill(activation)
      setState('done')
    } else {
      const next: SessionPrefillState = { prefill: { objectiveIds: activation.objectiveIds, customNote: activation.customNote, codexId: activation.codexId } }
      navigate('/session', { state: next })
    }
  }

  const daypartLabel = (key: string) => t(`statsInsights.daypart.${key}`)
  const lines: string[] = []
  if (context === 'daypart') {
    lines.push(t('lowEnergy.riskySlots', {
      slots: risky.map((r) => t('lowEnergy.slot', { daypart: daypartLabel(r.key), wr: r.winrate, count: r.games })).join(' · '),
    }))
    if (risky.some((r) => r.key === signal.daypart)) lines.push(t('lowEnergy.currentSlot'))
  } else if (context === 'tilt') {
    if (tiltWeak) lines.push(t('lowEnergy.afterLoss', { wr: tilt.afterLoss.winrate, count: tilt.afterLoss.games }))
    if (signal.reasons.includes('loss-streak')) lines.push(t('lowEnergy.lossStreak', { count: signal.lossStreak }))
  } else {
    if (signal.reasons.includes('loss-streak')) lines.push(t(session?.results.length ? 'lowEnergy.lossStreakSession' : 'lowEnergy.lossStreak', { count: signal.lossStreak }))
    if (signal.reasons.includes('bad-hour')) lines.push(t('lowEnergy.badHour', { daypart: daypartLabel(signal.daypart), wr: signal.daypartWinrate ?? 0, count: signal.daypartGames }))
  }

  const inline = context === 'daypart' || context === 'tilt'
  return (
    <div data-testid={`low-energy-${context}`}
      className={cn(inline ? 'mt-3 rounded-lg border border-hextech-gold/30 bg-hextech-gold/5 p-3' : 'panel-surface rounded-xl border border-hextech-gold/40 bg-gradient-to-r from-hextech-gold/10 to-transparent p-4', className)}>
      {!inline && (
        <h3 className="flex items-center gap-2 text-sm font-bold text-hextech-gold-bright">
          <BatteryLow className="h-4 w-4" />{t('lowEnergy.title')}
        </h3>
      )}
      <ul className={cn('space-y-0.5 text-xs text-hextech-text-bright', !inline && 'mt-1.5')}>
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <p className="mt-1.5 text-[11px] leading-snug text-hextech-text">{t('lowEnergy.rules')}</p>
      {already || (state === 'done' && activeSession) ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-hextech-green"><Check className="h-3.5 w-3.5" />{t('lowEnergy.activeOnSession')}</p>
      ) : state === 'done' ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-hextech-green"><Check className="h-3.5 w-3.5" />{t('lowEnergy.prefilled')}</p>
      ) : (
        <Button size="sm" className="mt-2.5 gap-1.5" disabled={state === 'busy'} onClick={activate}>
          {state === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BatteryLow className="h-3.5 w-3.5" />}
          {t(activeSession ? 'lowEnergy.activateNow' : 'lowEnergy.activate')}
        </Button>
      )}
      {state === 'error' && <p className="mt-1.5 text-[11px] text-hextech-red">{t('lowEnergy.error')}</p>}
    </div>
  )
}
