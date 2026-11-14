import { describe, it, expect } from 'vitest'
import { buildOpggUrl } from '../../src/lib/opgg'

describe('buildOpggUrl (E11: Discord bot scrim links)', () => {
  it('builds a region-slugged op.gg URL from a Riot ID', () => {
    expect(buildOpggUrl('Faker', 'KR1', 'KR')).toBe('https://op.gg/lol/summoners/kr/Faker-KR1')
  })

  it('is case-insensitive on the region code', () => {
    expect(buildOpggUrl('Caps', 'EUW', 'euw1')).toBe('https://op.gg/lol/summoners/euw/Caps-EUW')
  })

  it('url-encodes special characters in the name/tag', () => {
    expect(buildOpggUrl('Foo Bar', '1234', 'NA1')).toBe('https://op.gg/lol/summoners/na/Foo%20Bar-1234')
  })

  it('returns null when any part of the Riot ID is missing', () => {
    expect(buildOpggUrl(null, 'KR1', 'KR')).toBeNull()
    expect(buildOpggUrl('Faker', null, 'KR')).toBeNull()
    expect(buildOpggUrl('Faker', 'KR1', null)).toBeNull()
  })

  it('returns null for an unrecognized region code', () => {
    expect(buildOpggUrl('Faker', 'KR1', 'MARS1')).toBeNull()
  })
})
