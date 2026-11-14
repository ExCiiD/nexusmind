import { describe, it, expect } from 'vitest'
import { identityKeys, normalizeRole, normalizeSlots, groupDuplicates } from '../../src/lib/teamIdentity'

describe('normalizeRole', () => {
  it('maps Riot position names to the internal role enum', () => {
    expect(normalizeRole('TOP')).toBe('TOP')
    expect(normalizeRole('JUNGLE')).toBe('JUNGLE')
    expect(normalizeRole('MIDDLE')).toBe('MID')
    expect(normalizeRole('BOTTOM')).toBe('ADC')
    expect(normalizeRole('UTILITY')).toBe('SUPPORT')
  })

  it('is case-insensitive and passes through unknown values unchanged', () => {
    expect(normalizeRole('top')).toBe('TOP')
    expect(normalizeRole('NONE')).toBe('NONE')
  })

  it('returns empty string for null/undefined', () => {
    expect(normalizeRole(null)).toBe('')
    expect(normalizeRole(undefined)).toBe('')
  })
})

describe('identityKeys', () => {
  it('produces puuid, riot-id, ign and displayName keys in priority order', () => {
    expect(identityKeys({ puuid: 'P1', ign: 'Faker', tagLine: 'KR1', displayName: 'Faker' })).toEqual([
      'puuid:P1', 'riot:faker#kr1', 'ign:faker', 'name:faker',
    ])
  })

  it('skips keys it has no data for', () => {
    expect(identityKeys({ displayName: 'Trial Player' })).toEqual(['name:trial player'])
    expect(identityKeys({})).toEqual([])
  })
})

describe('normalizeSlots', () => {
  it('wraps a legacy flat string[] into one-element slots', () => {
    expect(normalizeSlots(['Renekton', 'Ornn'])).toEqual([['Renekton'], ['Ornn']])
  })

  it('passes a string[][] (multi-option slots) through, stripping empty strings', () => {
    expect(normalizeSlots([['Renekton', ''], ['Ornn', 'Sion']])).toEqual([['Renekton'], ['Ornn', 'Sion']])
  })

  it('returns [] for undefined/non-array input', () => {
    expect(normalizeSlots(undefined)).toEqual([])
  })
})

describe('groupDuplicates', () => {
  it('groups two members that share a Riot identity, oldest first', () => {
    const a = { id: 'a', puuid: 'P1', ign: null, tagLine: null, displayName: 'Faker' }
    const b = { id: 'b', puuid: 'P1', ign: null, tagLine: null, displayName: 'Faker (import)' }
    const groups = groupDuplicates([a, b])
    expect(groups).toHaveLength(1)
    expect(groups[0].map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('does not group members with no shared identity signal', () => {
    const a = { id: 'a', puuid: 'P1', ign: null, tagLine: null, displayName: 'Faker' }
    const b = { id: 'b', puuid: 'P2', ign: null, tagLine: null, displayName: 'Chovy' }
    expect(groupDuplicates([a, b])).toHaveLength(0)
  })

  it('never groups members with zero identity signal at all', () => {
    const a = { id: 'a', puuid: null, ign: null, tagLine: null, displayName: null }
    const b = { id: 'b', puuid: null, ign: null, tagLine: null, displayName: null }
    expect(groupDuplicates([a, b])).toHaveLength(0)
  })

  it('matches on ign alone when tagLine is missing on one side', () => {
    const a = { id: 'a', puuid: null, ign: 'Faker', tagLine: 'KR1', displayName: 'Faker' }
    const b = { id: 'b', puuid: null, ign: 'Faker', tagLine: null, displayName: 'Faker' }
    expect(groupDuplicates([a, b])).toHaveLength(1)
  })
})
