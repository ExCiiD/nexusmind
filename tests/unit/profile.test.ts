import { describe, it, expect } from 'vitest'
import {
  tierForLevel,
  tierProgress,
  isTierReached,
  evaluateTitles,
  sanitizeProfile,
  DEFAULT_PROFILE,
  PROFILE_ICONS,
  PROFILE_BANNERS,
  type ProfileStats,
} from '../../src/lib/profile'

const stats = (p: Partial<ProfileStats> = {}): ProfileStats => ({
  games: 0, reviews: 0, sessions: 0, recordings: 0, clips: 0, bookmarks: 0, mistakes: 0,
  externalReviews: 0, assessments: 0, xp: 0, streakDays: 0, memberSince: new Date().toISOString(), ...p,
})

describe('tiers', () => {
  it('maps levels to tiers', () => {
    expect(tierForLevel(1).id).toBe('recrue')
    expect(tierForLevel(6).id).toBe('adepte')
    expect(tierForLevel(27).id).toBe('oracle')
    expect(tierForLevel(99).id).toBe('legende')
  })

  it('reports progress toward the next tier', () => {
    const p = tierProgress(0)
    expect(p.tier.id).toBe('recrue')
    expect(p.next?.id).toBe('initie')
    expect(p.progress).toBeGreaterThanOrEqual(0)
    expect(p.progress).toBeLessThan(100)
  })

  it('compares tiers', () => {
    expect(isTierReached('stratege', 'adepte')).toBe(true)
    expect(isTierReached('adepte', 'stratege')).toBe(false)
  })
})

describe('evaluateTitles', () => {
  it('unlocks at the threshold and reports progress below it', () => {
    const titles = evaluateTitles(stats({ clips: 30, reviews: 5 }))
    expect(titles.find((t) => t.id === 'camera')?.unlocked).toBe(true)
    const analyst = titles.find((t) => t.id === 'analyst')!
    expect(analyst.unlocked).toBe(false)
    expect(analyst.progress).toBe(50)
  })

  it('keeps an earned streak title after the streak breaks', () => {
    const t = evaluateTitles(stats({ streakDays: 0 }), ['regular'])
    expect(t.find((x) => x.id === 'regular')?.unlocked).toBe(true)
  })

  it('counts days since install', () => {
    const now = Date.UTC(2026, 10, 17)
    const t = evaluateTitles(stats({ memberSince: new Date(now - 31 * 86_400_000).toISOString() }), [], now)
    expect(t.find((x) => x.id === 'loyal')?.unlocked).toBe(true)
    expect(t.find((x) => x.id === 'pillar')?.unlocked).toBe(false)
  })
})

describe('assets & prefs', () => {
  it('ships the profile icons and banners', () => {
    expect(PROFILE_ICONS.length).toBeGreaterThanOrEqual(13)
    expect(PROFILE_BANNERS.some((b) => b.id === 'nebuleuse')).toBe(true)
  })

  it('sanitizes stored prefs', () => {
    expect(sanitizeProfile(null)).toEqual(DEFAULT_PROFILE)
    const p = sanitizeProfile({ iconId: 'nope', bio: 'x'.repeat(500), showcase: ['grinder', 'grinder', 'fake', 'lynx', 'mentor', 'elder'], titleId: 'fake' })
    expect(p.iconId).toBe(DEFAULT_PROFILE.iconId)
    expect(p.bio.length).toBe(120)
    expect(p.showcase).toEqual(['grinder', 'lynx', 'mentor'])
    expect(p.titleId).toBeNull()
  })
})
