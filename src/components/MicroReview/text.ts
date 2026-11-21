import type { TFunction } from 'i18next'
import type { QcmSummary } from '@/lib/microReview/smartQcm'
import { fmtClock } from '@/lib/mistakeInsights'
import { parsePlaceKey, placeText } from './placeText'

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
    // ANALYSIS_VERSION 12 params (Back-end, 20/11):
    // - a game time `xxxSec` (towerAtSec, spawnSec, killSec…) also reads as a clock `xxx` (« 15:14 »);
    for (const [k, v] of Object.entries(p)) if (k.length > 3 && k.endsWith('Sec') && typeof v === 'number') out[k.slice(0, -3)] = fmtClock(v)
    // - a lane in Riot's casing reads as the jargon (« top »);
    if (typeof p.towerLane === 'string') out.towerLane = p.towerLane.toLowerCase()
    // - `placeKey` ('lane:mid', 'river:top', 'pit:dragon:herald', 'camp:wolves:blue', 'base:red') reads as `place`,
    //   in a sentence (« tu étais dans la fosse du Dragon »), never as a distance;
    const place = typeof p.placeKey === 'string' ? parsePlaceKey(p.placeKey) : null
    if (place) out.place = placeText(t, place, { inSentence: true })
    // - `positionKind` 'estimated' adds « (position estimée) » to `posNote`.
    out.posNote = p.positionKind === 'estimated' ? ` (${t('microReview.position.estimated')})` : ''
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
