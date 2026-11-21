/** 21/11/2026 (beta.22 bug): the details of detected mistakes in the UI's language, from the stored English notes. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { detectedNoteKey, localizeDetectedNote, type Translate } from '../../src/lib/detectedMistakeNote'

const load = (lang: string) => JSON.parse(readFileSync(join(__dirname, '../../src/i18n/locales', `${lang}.json`), 'utf-8'))
const tFor = (lang: string): Translate => {
  const dict = load(lang)
  return (key, params = {}) => {
    const v = key.split('.').reduce((o: any, k) => o?.[k], dict)
    if (typeof v !== 'string') throw new Error(`missing ${lang} key ${key}`)
    return v.replace(/\{\{(\w+)\}\}/g, (_, p) => String(params[p] ?? `{{${p}}}`))
  }
}
const fr = tFor('fr')
const en = tFor('en')

/** One sample per detector template (electron/main/mistakeDetector.ts, mistakeRules.ts), as stored. */
const SAMPLES = [
  'Recall with 1450g unspent (~4.2min since last purchase)',
  'Died with 1600g unspent',
  'Died 812u from an enemy turret',
  'Greed — took a plate just before · died 63% into enemy territory',
  'Greed — died 70% into enemy territory',
  'Died 34s before the enemy took Baron',
  'Still dead (12s left) when the enemy took Elder Dragon at 31:05',
  'No ward placed in the 90s before Dragon (15:30, lost)',
  'No ward placed in the 90s before Void Grubs (6:02, taken by your team)',
  'No ward placed for 6 min (from 12:00)',
  'Died at the top-side pit with no ally nearby',
  'Died at the top-side pit with only one ally nearby',
  'Caught alone by 3 enemies, no ally within reach',
  'Solo-killed by your lane opponent (Gnar)',
  'First to die in a 5-kill fight',
  'Rough lane opening vs Gnar: died at 3:12 · -12 CS at 5:00 · -450 gold at 5:00',
  '-23 CS behind Gnar at 10:00 (61 vs 84)',
  "Level 5 vs Gnar's level 7 at 8:00",
  'Died at level 3 to a level-4 Lee Sin during the early level race',
]

describe('detected mistake details', () => {
  it('every detector form is recognised, and its FR and EN keys exist with no parameter left out', () => {
    for (const s of SAMPLES) {
      expect(detectedNoteKey(s), s).not.toBeNull()
      for (const t of [fr, en]) expect(localizeDetectedNote(s, t), s).not.toMatch(/\{\{|@mistakes/)
    }
  })
  it('in French', () => {
    expect(localizeDetectedNote('Died with 1600g unspent', fr)).toBe('Mort avec 1600 gold non dépensés')
    expect(localizeDetectedNote('No ward placed in the 90s before Dragon (15:30, lost)', fr)).toBe('Aucune ward posée dans les 90 s avant le Dragon (15:30, perdu)')
    expect(localizeDetectedNote('Greed — took a plate just before · died 63% into enemy territory', fr)).toBe('Greed : plate prise juste avant · mort à 63 % dans le territoire ennemi')
    expect(localizeDetectedNote('Still dead (12s left) when the enemy took Elder Dragon at 31:05', fr)).toBe('Encore mort (12 s restantes) quand l’ennemi a pris le Dragon ancestral à 31:05')
  })
  it('a note written by the player, an empty one or an unknown form stays as it is', () => {
    expect(localizeDetectedNote('je push trop loin sans vision', fr)).toBe('je push trop loin sans vision')
    expect(localizeDetectedNote(null, fr)).toBe('')
    expect(localizeDetectedNote('Died 34s before the enemy took Atakhan', fr)).toBe('Died 34s before the enemy took Atakhan')
    expect(localizeDetectedNote('Greed — something new', fr)).toBe('Greed — something new')
  })
})
