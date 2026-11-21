import type { TFunction } from 'i18next'
import { fmtClock } from '@/lib/mistakeInsights'

/**
 * A place in words (DECISIONS 20/11: no distance units; « top, river top, fosse du Dragon, mid, river bot, bot », in the
 * jungle « près du blue, blue side »). The shape is the engine's (ANALYSIS_VERSION 12, anomalyDetector.ts), read here
 * structurally so the card works before and after it lands.
 */
export type Place =
  | { kind: 'lane'; lane: 'top' | 'mid' | 'bot' }
  | { kind: 'river'; side: 'top' | 'bot' }
  | { kind: 'pit'; pit: 'dragon' | 'baron'; objective: 'dragon' | 'elder' | 'grubs' | 'herald' | 'baron' | null }
  | { kind: 'camp'; camp: 'blue' | 'gromp' | 'wolves' | 'raptors' | 'red' | 'krugs'; side: 'blue' | 'red' }
  | { kind: 'base'; side: 'blue' | 'red' }

export type PositionKind = 'exact' | 'estimated'

/** `inSentence`: after « tu étais / you were » (« dans la fosse du Dragon », « in the blue side base »). */
export function placeText(t: TFunction, place: Place, opts: { inSentence?: boolean } = {}): string {
  const inS = opts.inSentence ? 'In' : ''
  switch (place.kind) {
    case 'lane': return t(`microReview.place.lane.${place.lane}`)
    case 'river': return t(`microReview.place.river.${place.side}`)
    // Named by the objective alive at that time, else by the pit itself: never « la fosse » alone.
    case 'pit': return t(`microReview.place.pit${inS}`, { objectiveOf: t(`microReview.objectiveOf.${place.objective ?? place.pit}`) })
    case 'camp': return t('microReview.place.camp', { camp: t(`microReview.place.camps.${place.camp}`), side: t(`microReview.place.side.${place.side}`) })
    case 'base': return t(`microReview.place.base${inS}`, { side: t(`microReview.place.side.${place.side}`) })
  }
}

const LANES = ['top', 'mid', 'bot'], SIDES = ['top', 'bot'], PITS = ['dragon', 'baron'], MAP_SIDES = ['blue', 'red']
const PIT_OBJECTIVES = ['dragon', 'elder', 'grubs', 'herald', 'baron']
const CAMPS = ['blue', 'gromp', 'wolves', 'raptors', 'red', 'krugs']

/** A summary param can only be text: the engine sends a place as 'lane:mid', 'pit:dragon:herald', 'camp:wolves:blue'… */
export function parsePlaceKey(key: string): Place | null {
  const [kind, a, b] = key.split(':')
  if (kind === 'lane' && LANES.includes(a)) return { kind, lane: a as 'top' }
  if (kind === 'river' && SIDES.includes(a)) return { kind, side: a as 'top' }
  if (kind === 'pit' && PITS.includes(a)) return { kind, pit: a as 'dragon', objective: PIT_OBJECTIVES.includes(b) ? b as 'dragon' : null }
  if (kind === 'camp' && CAMPS.includes(a) && MAP_SIDES.includes(b)) return { kind, camp: a as 'blue', side: b as 'blue' }
  if (kind === 'base' && MAP_SIDES.includes(a)) return { kind, side: a as 'blue' }
  return null
}

/** The other way round, for the engine (and the tests). */
export function placeKeyOf(p: Place): string {
  switch (p.kind) {
    case 'lane': return `lane:${p.lane}`
    case 'river': return `river:${p.side}`
    case 'pit': return p.objective ? `pit:${p.pit}:${p.objective}` : `pit:${p.pit}`
    case 'camp': return `camp:${p.camp}:${p.side}`
    case 'base': return `base:${p.side}`
  }
}

/** « position estimée (entre 16:00 et 17:00) » or « position exacte »; nothing when unknown. */
export function positionKindText(t: TFunction, kind: PositionKind | null | undefined, between?: [number, number] | null): string | null {
  if (kind === 'exact') return t('microReview.position.exact')
  if (kind !== 'estimated') return null
  return between ? t('microReview.position.estimatedBetween', { from: fmtClock(between[0]), to: fmtClock(between[1]) }) : t('microReview.position.estimated')
}
