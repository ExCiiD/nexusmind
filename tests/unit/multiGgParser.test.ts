import { describe, expect, it } from 'vitest'
import { parseMultiGgUrl } from '../../src/lib/multiGgParser'

describe('parseMultiGgUrl', () => {
  describe('op.gg URLs', () => {
    it('parses canonical op.gg multisearch URL with dash separator', () => {
      const url = 'https://www.op.gg/multisearch/euw?summoners=Faker-KR1,Caps-EUW'
      const result = parseMultiGgUrl(url)
      expect(result.inferredRegion).toBe('EUW1')
      expect(result.players).toEqual([
        { gameName: 'Faker', tagLine: 'KR1', region: 'KR' },
        { gameName: 'Caps', tagLine: 'EUW', region: 'EUW1' },
      ])
      expect(result.warnings).toHaveLength(0)
    })

    it('handles URL-encoded # in summoners', () => {
      const url = 'https://op.gg/multisearch/na?summoners=Doublelift%23NA1,Sneaky%23NA1'
      const result = parseMultiGgUrl(url)
      expect(result.inferredRegion).toBe('NA1')
      expect(result.players).toHaveLength(2)
      expect(result.players[0]).toEqual({ gameName: 'Doublelift', tagLine: 'NA1', region: 'NA1' })
    })

    it('preserves dashes inside player names (splits on LAST dash)', () => {
      const url = 'https://www.op.gg/multisearch/euw?summoners=Some-Cool-Player-EUW'
      const result = parseMultiGgUrl(url)
      expect(result.players[0].gameName).toBe('Some-Cool-Player')
      expect(result.players[0].tagLine).toBe('EUW')
    })
  })

  describe('blitz.gg URLs', () => {
    it('parses blitz.gg multisearch path', () => {
      const url = 'https://blitz.gg/lol/multisearch/euw1?summoners=Faker-KR1,Caps-EUW'
      const result = parseMultiGgUrl(url)
      expect(result.inferredRegion).toBe('EUW1')
      expect(result.players).toHaveLength(2)
    })
  })

  describe('plain text input', () => {
    it('parses newline-separated Riot IDs', () => {
      const input = 'PlayerA#EUW\nPlayerB#EUW\nPlayerC#KR1'
      const result = parseMultiGgUrl(input)
      expect(result.players).toHaveLength(3)
      expect(result.players[2]).toEqual({ gameName: 'PlayerC', tagLine: 'KR1', region: 'KR' })
    })

    it('parses comma-separated Riot IDs', () => {
      const input = 'PlayerA#EUW, PlayerB#EUW ,PlayerC#NA1'
      const result = parseMultiGgUrl(input)
      expect(result.players).toHaveLength(3)
    })

    it('parses semicolon-separated lists', () => {
      const input = 'PlayerA#EUW;PlayerB#EUW'
      const result = parseMultiGgUrl(input)
      expect(result.players).toHaveLength(2)
    })

    it('trims whitespace around names', () => {
      const input = '  PlayerA#EUW  \n  PlayerB#EUW  '
      const result = parseMultiGgUrl(input)
      expect(result.players[0].gameName).toBe('PlayerA')
      expect(result.players[1].gameName).toBe('PlayerB')
    })
  })

  describe('deduplication', () => {
    it('dedupes identical Riot IDs (case-insensitive) and warns', () => {
      const input = 'PlayerA#EUW\nplayera#euw\nPlayerB#EUW'
      const result = parseMultiGgUrl(input)
      expect(result.players).toHaveLength(2)
      expect(result.warnings.some((w) => w.includes('Duplicate'))).toBe(true)
    })
  })

  describe('error handling', () => {
    it('warns and skips tokens without a tag when no fallback region', () => {
      const input = 'JustAName\nAnother#TAG'
      const result = parseMultiGgUrl(input)
      // First has no tag and no fallback region → skipped with warning
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.players).toHaveLength(1)
      expect(result.players[0].gameName).toBe('Another')
    })

    it('returns empty result for empty input', () => {
      const result = parseMultiGgUrl('')
      expect(result.players).toHaveLength(0)
    })

    it('returns empty result for whitespace-only input', () => {
      const result = parseMultiGgUrl('   \n\t  ')
      expect(result.players).toHaveLength(0)
    })
  })

  describe('region inference', () => {
    it('uses URL region as fallback when tagLine is unknown', () => {
      const url = 'https://www.op.gg/multisearch/kr?summoners=Faker-ABC'
      const result = parseMultiGgUrl(url)
      // ABC isn't a known region alias → fall back to URL-inferred KR
      expect(result.players[0].region).toBe('KR')
    })

    it('normalizes lowercase region codes to canonical form', () => {
      const url = 'https://op.gg/multisearch/eune?summoners=A-EUN1'
      const result = parseMultiGgUrl(url)
      expect(result.inferredRegion).toBe('EUN1')
    })
  })

  describe('robustness', () => {
    it('does not throw on malformed URLs', () => {
      expect(() => parseMultiGgUrl('not://a real url')).not.toThrow()
    })

    it('handles tokens with only short tags via dash split', () => {
      // "X-LONGTAG" — LONGTAG is 7 chars, doesn't match /^[A-Za-z0-9]{2,5}$/
      // so it should fall through and be treated as a name-only token
      const result = parseMultiGgUrl('https://op.gg/multisearch/euw?summoners=X-LONGTAG')
      // Falls through to "no tag" branch, but EUW1 inferred from URL → keeps it
      expect(result.players).toHaveLength(1)
      expect(result.players[0].gameName).toBe('X-LONGTAG')
      expect(result.players[0].region).toBe('EUW1')
    })
  })
})
