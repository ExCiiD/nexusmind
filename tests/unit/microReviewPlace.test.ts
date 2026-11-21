import { describe, it, expect } from 'vitest'
import i18next from 'i18next'
import fr from '../../src/i18n/locales/fr.json'
import en from '../../src/i18n/locales/en.json'
import { parsePlaceKey, placeKeyOf, placeText, positionKindText, type Place } from '../../src/components/MicroReview/placeText'
import { summaryText } from '../../src/components/MicroReview/text'

// DECISIONS 20/11: places in words, the pit named by its objective, no distance.
const i18n = i18next.createInstance()
await i18n.init({ lng: 'fr', resources: { fr: { translation: fr }, en: { translation: en } }, interpolation: { escapeValue: false } })
const t = i18n.getFixedT('fr')
const tEn = i18n.getFixedT('en')

describe('micro-review places', () => {
  it('reads every place in words', () => {
    expect(placeText(t, { kind: 'lane', lane: 'mid' })).toBe('mid')
    expect(placeText(t, { kind: 'river', side: 'top' })).toBe('river top')
    expect(placeText(t, { kind: 'pit', pit: 'baron', objective: 'herald' })).toBe('fosse du Héraut')
    expect(placeText(t, { kind: 'pit', pit: 'dragon', objective: null })).toBe('fosse du Dragon')
    expect(placeText(t, { kind: 'pit', pit: 'dragon', objective: 'dragon' }, { inSentence: true })).toBe('dans la fosse du Dragon')
    expect(placeText(t, { kind: 'camp', camp: 'wolves', side: 'blue' })).toBe('près des loups, blue side')
    expect(placeText(t, { kind: 'camp', camp: 'raptors', side: 'red' })).toBe('près des wraiths, red side')
    expect(placeText(t, { kind: 'base', side: 'red' }, { inSentence: true })).toBe('dans la base red side')
    expect(placeText(tEn, { kind: 'camp', camp: 'wolves', side: 'blue' })).toBe('near the wolves, blue side')
  })

  it('says when a position is estimated', () => {
    expect(positionKindText(t, 'estimated', [960, 1020])).toBe('position estimée (entre 16:00 et 17:00)')
    expect(positionKindText(t, 'exact')).toBe('position exacte')
    expect(positionKindText(t, null)).toBeNull()
  })

  it('a place key goes both ways, and a bad one is ignored', () => {
    const all: Place[] = [{ kind: 'lane', lane: 'bot' }, { kind: 'river', side: 'bot' }, { kind: 'pit', pit: 'baron', objective: 'grubs' },
      { kind: 'pit', pit: 'dragon', objective: null }, { kind: 'camp', camp: 'krugs', side: 'red' }, { kind: 'base', side: 'blue' }]
    for (const p of all) expect(parsePlaceKey(placeKeyOf(p))).toEqual(p)
    expect(parsePlaceKey('pit:nowhere')).toBeNull()
    expect(parsePlaceKey('camp:wolves')).toBeNull()
  })

  it('the « hesitation » card of the 16:00 example reads with its real times and lane', () => {
    const s = summaryText(t, { gameTimeSec: 985, zone: 'mid-lane', head: { key: 'towerBeforeSpawn', params: { towerLane: 'TOP', towerAtSec: 914, spawnSec: 935, objective: 'dragon' } },
      extras: [{ key: 'placeAt', params: { placeKey: 'lane:mid', positionKind: 'estimated' } }, { key: 'objectiveFell', params: { killSec: 985, objective: 'dragon' } }] } as never)
    expect(s.line).toBe('tu as pris la tour top à 15:14, avant l’apparition du Dragon (15:35), tu étais mid (position estimée), l’ennemi prend le Dragon à 16:25 dans la fosse du Dragon')
  })
})
