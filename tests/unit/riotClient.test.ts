import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractPlayerStats } from '../../electron/main/riotClient'

vi.mock('../../electron/main/keychain', () => ({
  getSecret: vi.fn().mockReturnValue('RGAPI-test-key'),
}))

describe('Riot Client', () => {
  describe('extractPlayerStats', () => {
    const mockMatchData = {
      metadata: {
        matchId: 'EUW1_1234567890',
      },
      info: {
        gameDuration: 1800,
        gameEndTimestamp: 1700000000000,
        participants: [
          {
            puuid: 'test-puuid-123',
            championName: 'Yasuo',
            teamPosition: 'MIDDLE',
            individualPosition: 'MIDDLE',
            kills: 8,
            deaths: 3,
            assists: 5,
            totalMinionsKilled: 180,
            neutralMinionsKilled: 10,
            visionScore: 22,
            win: true,
          },
          {
            puuid: 'other-puuid-456',
            championName: 'Lux',
            teamPosition: 'SUPPORT',
            kills: 2,
            deaths: 5,
            assists: 12,
            totalMinionsKilled: 30,
            neutralMinionsKilled: 0,
            visionScore: 45,
            win: false,
          },
        ],
      },
    }

    it('should extract correct stats for a matching puuid', () => {
      const stats = extractPlayerStats(mockMatchData, 'test-puuid-123')

      expect(stats).not.toBeNull()
      expect(stats!.champion).toBe('Yasuo')
      expect(stats!.role).toBe('MIDDLE')
      expect(stats!.kills).toBe(8)
      expect(stats!.deaths).toBe(3)
      expect(stats!.assists).toBe(5)
      expect(stats!.cs).toBe(190)
      expect(stats!.visionScore).toBe(22)
      expect(stats!.duration).toBe(1800)
      expect(stats!.win).toBe(true)
      expect(stats!.matchId).toBe('EUW1_1234567890')
    })

    it('should return null for non-matching puuid', () => {
      const stats = extractPlayerStats(mockMatchData, 'nonexistent-puuid')
      expect(stats).toBeNull()
    })

    it('should calculate CS as minions + neutrals', () => {
      const stats = extractPlayerStats(mockMatchData, 'test-puuid-123')
      expect(stats!.cs).toBe(180 + 10)
    })
  })
})
