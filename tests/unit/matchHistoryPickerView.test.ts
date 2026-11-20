import { describe, it, expect } from 'vitest'
import { normalizeHistoryResult, pickerErrorKey } from '../../src/lib/matchHistoryPickerView'

// « Importer depuis l'historique »: never a spinner forever.
describe('match history picker', () => {
  it('reads the list, or { matches, partial }', () => {
    expect(normalizeHistoryResult([{ matchId: 'a' }])).toEqual({ list: [{ matchId: 'a' }], partial: false })
    expect(normalizeHistoryResult({ matches: [{ matchId: 'b' }], partial: true })).toEqual({ list: [{ matchId: 'b' }], partial: true })
    expect(normalizeHistoryResult(null)).toEqual({ list: [], partial: false })
  })
  it('maps the errors to translated messages', () => {
    expect(pickerErrorKey(new Error('No user found'))).toBe('history.picker.errors.noAccount')
    expect(pickerErrorKey(new Error('Request timed out'))).toBe('history.picker.errors.timeout')
    expect(pickerErrorKey(new Error('TypeError: fetch failed'))).toBe('history.picker.errors.offline')
    expect(pickerErrorKey(new Error('Riot API error 403'))).toBe('history.picker.errors.riotUnavailable')
    expect(pickerErrorKey(new Error('boom'))).toBe('history.picker.errors.generic')
  })
})
