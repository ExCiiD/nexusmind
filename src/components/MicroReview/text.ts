import type { TFunction } from 'i18next'
import type { QcmSummary } from '@/lib/microReview/smartQcm'
import { fmtClock } from '@/lib/mistakeInsights'

/** Localised label of a Mistake Library tag (built-ins are translated, custom tags keep their own label). */
export function tagLabel(t: TFunction, slug: string | null | undefined, fallback?: string | null): string {
  if (!slug) return fallback ?? ''
  return t(`microReview.tag.${slug}`, { defaultValue: fallback ?? slug })
}

/** "25:28 • Rivière haute — mort 30 s avant la perte du Baron, 1650 g en poche". */
export function summaryText(t: TFunction, s: QcmSummary): { clock: string; zone: string | null; line: string } {
  const params = (p?: Record<string, string | number>) => {
    if (!p) return {}
    const out: Record<string, string | number> = { ...p }
    if (typeof p.objective === 'string') {
      out.objectiveOf = t(`microReview.objectiveOf.${p.objective}`)
      out.objectiveThe = t(`microReview.objectiveThe.${p.objective}`)
    }
    return out
  }
  const head = t(`microReview.summary.${s.head.key}`, params(s.head.params))
  const extras = s.extras.map((e) => t(`microReview.summary.${e.key}`, { ...params(e.params), count: e.params?.count ?? 0 }))
  return {
    clock: fmtClock(s.gameTimeSec),
    zone: s.zone ? t(`microReview.zone.${s.zone}`) : null,
    line: [head, ...extras].join(', '),
  }
}
