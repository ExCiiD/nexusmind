import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Target } from 'lucide-react'
import { rankMistakes, type MistakeOccurrence } from '@/lib/mistakeInsights'
import { codexFor, dominantPhase } from '@/lib/microReview/codex'
import { CodexCard } from './CodexCard'
import { usePrepareSession } from './usePrepareSession'
import { useTeamCodex } from './useTeamCodex'
import { tagLabel } from './text'

/**
 * "Assistant — bilan de la semaine" footer: the mistake that cost the most
 * in the last 7 days (garbage time aside), its Codex prescription for the
 * phase where it happens, and a 1-click setup of the next session.
 */
export function WeeklyCodex({ role }: { role: string | null | undefined }) {
  const { t } = useTranslation()
  const prepare = usePrepareSession()
  const teamRules = useTeamCodex()
  const [occ, setOcc] = useState<MistakeOccurrence[] | null>(null)

  useEffect(() => {
    let alive = true
    window.api.getMistakeOccurrences({ days: 7 })
      .then((rows) => { if (alive) setOcc(rows ?? []) })
      .catch(() => { if (alive) setOcc([]) })
    return () => { alive = false }
  }, [])

  const focus = useMemo(() => {
    const decisive = (occ ?? []).filter((o) => !o.garbageTime)
    for (const r of rankMistakes(decisive)) {
      const times = decisive.filter((o) => o.tag.slug === r.slug).map((o) => o.gameTimeSec)
      const phase = dominantPhase(times)
      const entry = codexFor(r.slug, role, phase, teamRules)
      if (entry) return { row: r, phase, entry }
    }
    return null
  }, [occ, role, teamRules])

  if (!occ) return null
  if (!focus) return <p className="border-t border-hextech-border-dim/60 pt-3 text-[11px] text-hextech-text-dim">{t('codex.weekly.empty')}</p>
  return (
    <div className="space-y-2 border-t border-hextech-border-dim/60 pt-3" data-testid="weekly-codex">
      <p className="flex items-start gap-1.5 text-xs text-hextech-text">
        <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hextech-gold" />
        <span>
          <span className="font-semibold text-hextech-gold">{t('codex.weekly.title')}</span>{' '}
          {t('codex.weekly.desc', {
            label: tagLabel(t, focus.row.slug, focus.row.label),
            count: focus.row.count,
            phase: focus.phase ? t(`codex.phaseIn.${focus.phase}`) : '',
          })}
        </span>
      </p>
      <CodexCard entry={focus.entry} compact onPrepare={() => prepare(focus.entry)} />
    </div>
  )
}
