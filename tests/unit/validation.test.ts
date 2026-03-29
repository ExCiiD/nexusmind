import { describe, it, expect } from 'vitest'
import {
  riotConnectSchema,
  apiKeySchema,
  sessionCreateSchema,
  reviewSchema,
  assessmentSchema,
  timelineNoteSchema,
} from '../../src/lib/validation'

describe('Validation Schemas', () => {
  describe('riotConnectSchema', () => {
    it('should accept valid Riot ID', () => {
      const result = riotConnectSchema.safeParse({ gameName: 'Faker', tagLine: 'KR1', region: 'KR' })
      expect(result.success).toBe(true)
    })

    it('should reject too-short game name', () => {
      const result = riotConnectSchema.safeParse({ gameName: 'Ab', tagLine: 'KR1', region: 'KR' })
      expect(result.success).toBe(false)
    })

    it('should reject invalid region', () => {
      const result = riotConnectSchema.safeParse({ gameName: 'Faker', tagLine: 'KR1', region: 'INVALID' })
      expect(result.success).toBe(false)
    })
  })

  describe('apiKeySchema', () => {
    it('should accept valid Riot API key', () => {
      const result = apiKeySchema.safeParse({ service: 'riot', key: 'RGAPI-xxxxxxxx-xxxx' })
      expect(result.success).toBe(true)
    })

    it('should reject unknown service', () => {
      const result = apiKeySchema.safeParse({ service: 'unknown', key: 'some-key-12345' })
      expect(result.success).toBe(false)
    })

    it('should reject too-short key', () => {
      const result = apiKeySchema.safeParse({ service: 'riot', key: 'short' })
      expect(result.success).toBe(false)
    })
  })

  describe('sessionCreateSchema', () => {
    it('should accept valid session', () => {
      const result = sessionCreateSchema.safeParse({ objectiveId: 'wave_management', subObjective: 'freeze' })
      expect(result.success).toBe(true)
    })

    it('should reject empty objectiveId', () => {
      const result = sessionCreateSchema.safeParse({ objectiveId: '' })
      expect(result.success).toBe(false)
    })
  })

  describe('timelineNoteSchema', () => {
    it('should accept valid timestamp format', () => {
      expect(timelineNoteSchema.safeParse({ time: '3:50', note: 'Missed freeze' }).success).toBe(true)
      expect(timelineNoteSchema.safeParse({ time: '12:30', note: 'Good trade' }).success).toBe(true)
      expect(timelineNoteSchema.safeParse({ time: '0:30', note: 'Level 2 all-in' }).success).toBe(true)
    })

    it('should reject invalid timestamp format', () => {
      expect(timelineNoteSchema.safeParse({ time: 'abc', note: 'test' }).success).toBe(false)
      expect(timelineNoteSchema.safeParse({ time: '3:5', note: 'test' }).success).toBe(false)
    })
  })

  describe('reviewSchema', () => {
    it('should accept valid review', () => {
      const result = reviewSchema.safeParse({
        gameId: 'test-game-id',
        timelineNotes: [{ time: '3:50', note: 'Missed freeze' }],
        kpiScores: { wave_state_awareness: 3 },
        objectiveRespected: true,
      })
      expect(result.success).toBe(true)
    })

    it('should reject KPI score out of range', () => {
      const result = reviewSchema.safeParse({
        gameId: 'test-game-id',
        timelineNotes: [],
        kpiScores: { wave_state_awareness: 6 },
        objectiveRespected: true,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('assessmentSchema', () => {
    it('should accept valid assessment scores', () => {
      const result = assessmentSchema.safeParse([
        { fundamentalId: 'wave_management', score: 3 },
        { fundamentalId: 'spacing', score: 4 },
      ])
      expect(result.success).toBe(true)
    })

    it('should reject empty array', () => {
      const result = assessmentSchema.safeParse([])
      expect(result.success).toBe(false)
    })

    it('should reject score out of range', () => {
      const result = assessmentSchema.safeParse([{ fundamentalId: 'spacing', score: 0 }])
      expect(result.success).toBe(false)
    })
  })
})
