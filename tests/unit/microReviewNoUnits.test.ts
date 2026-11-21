import { describe, it, expect } from 'vitest'
import fr from '../../src/i18n/locales/fr.json'
import en from '../../src/i18n/locales/en.json'

// DECISIONS 20/11: no distance unit in the micro-review cards (« aucun user ne pourra se situer avec ça »), and never
// « la fosse » / "the pit" without its objective.
function strings(o: unknown, path = 'microReview'): Array<[string, string]> {
  if (typeof o === 'string') return [[path, o]]
  if (!o || typeof o !== 'object') return []
  return Object.entries(o).flatMap(([k, v]) => strings(v, `${path}.${k}`))
}

describe('micro-review texts', () => {
  for (const [lang, json] of [['fr', fr], ['en', en]] as const) {
    const all = strings((json as Record<string, unknown>).microReview)

    it(`${lang}: no key contains a distance unit`, () => {
      const bad = all.filter(([, v]) => /\bunités?\b|\bunits?\b|\{\{\s*distance\s*\}\}/i.test(v))
      expect(bad).toEqual([])
    })

    it(`${lang}: a pit is always named by its objective`, () => {
      const bad = all.filter(([, v]) => /\bla fosse\b(?!\s*\{\{\s*objectiveOf)|\bthe pit\b/i.test(v))
      expect(bad).toEqual([])
    })
  }
})
