import { describe, it, expect } from 'vitest'
import {
  formatGameTime,
  formatKDA,
  calculateKDA,
  formatCSPerMin,
  getRankColor,
  xpForLevel,
  getLevelFromXp,
} from '../../src/lib/utils'

describe('Utility Functions', () => {
  describe('formatGameTime', () => {
    it('should format seconds to M:SS', () => {
      expect(formatGameTime(0)).toBe('0:00')
      expect(formatGameTime(60)).toBe('1:00')
      expect(formatGameTime(90)).toBe('1:30')
      expect(formatGameTime(1800)).toBe('30:00')
      expect(formatGameTime(65)).toBe('1:05')
    })
  })

  describe('formatKDA', () => {
    it('should format kills/deaths/assists', () => {
      expect(formatKDA(5, 3, 7)).toBe('5/3/7')
      expect(formatKDA(0, 0, 0)).toBe('0/0/0')
    })
  })

  describe('calculateKDA', () => {
    it('should calculate KDA ratio', () => {
      expect(calculateKDA(5, 2, 5)).toBe(5.0)
      expect(calculateKDA(10, 0, 5)).toBe(15)
    })
  })

  describe('formatCSPerMin', () => {
    it('should calculate CS per minute', () => {
      expect(formatCSPerMin(180, 1200)).toBe('9.0')
      expect(formatCSPerMin(0, 1200)).toBe('0.0')
    })
  })

  describe('getRankColor', () => {
    it('should return correct colors for tiers', () => {
      expect(getRankColor('GOLD')).toBe('#c8aa6e')
      expect(getRankColor('DIAMOND')).toBe('#576cce')
      expect(getRankColor('CHALLENGER')).toBe('#f4c874')
    })

    it('should return default for unknown tiers', () => {
      expect(getRankColor('UNKNOWN')).toBe('#a09b8c')
    })
  })

  describe('XP system', () => {
    it('should calculate XP for level 1', () => {
      expect(xpForLevel(1)).toBe(100)
    })

    it('should scale XP requirements', () => {
      expect(xpForLevel(2)).toBeGreaterThan(xpForLevel(1))
      expect(xpForLevel(5)).toBeGreaterThan(xpForLevel(4))
    })

    it('should determine level from total XP', () => {
      expect(getLevelFromXp(0).level).toBe(1)
      expect(getLevelFromXp(50).level).toBe(1)
      expect(getLevelFromXp(100).level).toBe(2)
      expect(getLevelFromXp(250).level).toBeGreaterThan(2)
    })

    it('should return correct current XP within level', () => {
      const info = getLevelFromXp(150)
      expect(info.level).toBe(2)
      expect(info.currentXp).toBe(50)
    })
  })
})
