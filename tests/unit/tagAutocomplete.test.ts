import { describe, it, expect } from 'vitest'
import { matchTags } from '../../src/components/MicroReview/TagAutocomplete'
import type { MistakeTag } from '../../src/lib/ipc'

const tag = (slug: string, label: string, archivedAt: string | null = null) => ({ id: slug, slug, label, category: 'macro', isBuiltIn: true, archivedAt }) as MistakeTag
const tags = [tag('bad-trade', 'Bad trade'), tag('caught-out', 'Caught out'), tag('trade-lost', 'Trade perdu'), tag('old', 'Trade ancien', '2026-01-01')]
const labelOf = (t: MistakeTag) => t.label

// Beta.20: tag search with auto-completion.
describe('tag auto-completion', () => {
  it('filters on the name or the slug, names starting with the query first, archived tags out', () => {
    expect(matchTags(tags, 'trade', labelOf).map((t) => t.slug)).toEqual(['trade-lost', 'bad-trade'])
    expect(matchTags(tags, 'caught', labelOf).map((t) => t.slug)).toEqual(['caught-out'])
    expect(matchTags(tags, 'zzz', labelOf)).toEqual([])
  })
  it('skips the excluded tags, and lists the first ones on an empty query', () => {
    expect(matchTags(tags, 'trade', labelOf, new Set(['bad-trade'])).map((t) => t.slug)).toEqual(['trade-lost'])
    expect(matchTags(tags, '', labelOf).map((t) => t.slug)).toEqual(['bad-trade', 'caught-out', 'trade-lost'])
  })
})
