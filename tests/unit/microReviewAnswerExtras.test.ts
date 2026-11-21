import { describe, it, expect } from 'vitest'
import { EMPTY_EXTRAS, answerNote, bookmarkLabelOf, extraTagsPayload, parseClock } from '../../src/components/MicroReview/answerExtras'

// DECISIONS 21/11: the player's reasons and extra error tags on a micro-review answer.
describe('micro-review answer extras', () => {
  it('keeps both the « autre cause » note and the reasons', () => {
    expect(answerNote(null, EMPTY_EXTRAS)).toBeNull()
    expect(answerNote(' ', { reasons: 'Je pensais que le jungler était top', extraTags: [] })).toBe('Je pensais que le jungler était top')
    expect(answerNote('vu trop tard', { reasons: 'pas de ward', extraTags: [] })).toBe('vu trop tard\npas de ward')
  })

  it('sends the chosen extra tags once, never the answer’s own tag, at most 5', () => {
    const extras = { reasons: '', extraTags: [
      { key: '1', tagSlug: 'bad-trade', note: ' trade niveau 3 ' }, { key: '2', tagSlug: '', note: 'x' },
      { key: '3', tagSlug: 'bad-trade', note: '' }, { key: '4', tagSlug: 'caught-out', note: '' },
      { key: '5', tagSlug: 'a', note: '' }, { key: '6', tagSlug: 'b', note: '' }, { key: '7', tagSlug: 'c', note: '' }, { key: '8', tagSlug: 'd', note: '' },
    ] }
    expect(extraTagsPayload(extras, 'caught-out')).toEqual([
      { tagSlug: 'bad-trade', note: 'trade niveau 3' }, { tagSlug: 'a', note: null }, { tagSlug: 'b', note: null }, { tagSlug: 'c', note: null }, { tagSlug: 'd', note: null },
    ])
  })

  it('labels the bookmark with the moment and the tag, at most 80 characters', () => {
    expect(bookmarkLabelOf('Mort critique', 'Bad trade')).toBe('Mort critique — Bad trade')
    expect(bookmarkLabelOf('Mort critique', null)).toBe('Mort critique')
    expect(bookmarkLabelOf('x'.repeat(100), 'y')).toHaveLength(80)
  })

  it('reads a game time', () => {
    expect(parseClock('1:17')).toBe(77)
    expect(parseClock('25:03')).toBe(1503)
    expect(parseClock('77')).toBe(77)
    expect(parseClock('1:7')).toBeNull()
    expect(parseClock('abc')).toBeNull()
  })
})
