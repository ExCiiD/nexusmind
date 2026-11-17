/**
 * Player profile (Profile page + sidebar dock): Ascend tier, avatar icons,
 * banners, titles earned from activity in the app. Pure except for the
 * localStorage helpers at the bottom.
 *
 * Progression is about *using the app*, not the LoL rank: the tier follows
 * the Ascend level (XP from reviews, sessions, assessments…), and titles
 * come from counters returned by `profile:get-stats`. Customization is a
 * per-device preference keyed by user id (no sync yet — see ROADMAP).
 */
import { getLevelFromXp } from './utils'
import { BACKGROUND_IMAGES } from './appearance'

const iconModules = import.meta.glob('../assets/profile/icons/*.webp', { eager: true, import: 'default' }) as Record<string, string>
const bannerModules = import.meta.glob('../assets/profile/banners/*.webp', { eager: true, import: 'default' }) as Record<string, string>
const byName = (mods: Record<string, string>) =>
  Object.fromEntries(Object.entries(mods).map(([path, url]) => [path.split('/').pop()!.replace('.webp', ''), url]))
const ICON_URLS = byName(iconModules)
const BANNER_URLS = byName(bannerModules)

/* ─── Counters ─── */

export interface ProfileStats {
  games: number
  reviews: number
  sessions: number
  recordings: number
  clips: number
  bookmarks: number
  mistakes: number
  externalReviews: number
  assessments: number
  xp: number
  streakDays: number
  memberSince: string
}

/* ─── Tiers ─── */

export const TIERS = [
  { id: 'iron', minLevel: 1, from: '#5B5F66', to: '#8C9097', glow: 'rgba(140,144,151,0.35)' },
  { id: 'bronze', minLevel: 3, from: '#7A4A2A', to: '#C98A55', glow: 'rgba(201,138,85,0.4)' },
  { id: 'silver', minLevel: 6, from: '#8A97A6', to: '#E3EAF2', glow: 'rgba(214,224,235,0.4)' },
  { id: 'gold', minLevel: 10, from: '#A8781F', to: '#F5D27A', glow: 'rgba(245,210,122,0.45)' },
  { id: 'platinum', minLevel: 15, from: '#2E8C86', to: '#9BE6D8', glow: 'rgba(110,220,200,0.45)' },
  { id: 'emerald', minLevel: 20, from: '#127A4E', to: '#4FE0A0', glow: 'rgba(79,224,160,0.45)' },
  { id: 'diamond', minLevel: 27, from: '#3A5FD0', to: '#B6C8FF', glow: 'rgba(150,180,255,0.5)' },
  { id: 'master', minLevel: 35, from: '#7D2FC4', to: '#E6A8FF', glow: 'rgba(210,140,255,0.55)' },
] as const
export type TierId = (typeof TIERS)[number]['id']
export type Tier = (typeof TIERS)[number]

export interface TierProgress {
  level: number
  tier: Tier
  next: Tier | null
  /** 0–100: progress from this tier's first level to the next tier's. */
  progress: number
  levelsToNext: number
}

export function tierForLevel(level: number): Tier {
  let current: Tier = TIERS[0]
  for (const t of TIERS) if (level >= t.minLevel) current = t
  return current
}

export function tierProgress(totalXp: number): TierProgress {
  const { level, currentXp, nextLevelXp } = getLevelFromXp(totalXp)
  const tier = tierForLevel(level)
  const idx = TIERS.findIndex((t) => t.id === tier.id)
  const next = TIERS[idx + 1] ?? null
  if (!next) return { level, tier, next, progress: 100, levelsToNext: 0 }
  const span = next.minLevel - tier.minLevel
  const done = level - tier.minLevel + currentXp / nextLevelXp
  return { level, tier, next, progress: Math.min(100, Math.round((done / span) * 100)), levelsToNext: next.minLevel - level }
}

const tierRank = (id: TierId) => TIERS.findIndex((t) => t.id === id)
export const isTierReached = (current: TierId, required: TierId) => tierRank(current) >= tierRank(required)

/* ─── Icons & banners ─── */

export interface ProfileIcon { id: string; url: string; unlockTier: TierId }

/** The first five are free; the rest unlock as the Ascend tier rises. */
const ICON_UNLOCKS: Array<[string, TierId]> = [
  ['tempete', 'iron'], ['survivant', 'iron'], ['souffle', 'iron'], ['jade', 'iron'], ['elevation', 'iron'],
  ['brasier', 'bronze'], ['halo', 'silver'], ['ascension', 'gold'], ['arcane', 'platinum'],
  ['cercle', 'emerald'], ['invocatrice', 'emerald'], ['chevalier', 'diamond'], ['heaume', 'master'],
]
export const PROFILE_ICONS: ProfileIcon[] = ICON_UNLOCKS
  .filter(([id]) => ICON_URLS[id])
  .map(([id, unlockTier]) => ({ id, url: ICON_URLS[id], unlockTier }))

export interface ProfileBanner { id: string; url: string | null }
export const PROFILE_BANNERS: ProfileBanner[] = [
  { id: 'theme', url: null },
  ...Object.entries(BACKGROUND_IMAGES).map(([id, img]) => ({ id, url: img.full as string })),
  ...Object.entries(BANNER_URLS).map(([id, url]) => ({ id, url })),
]

/* ─── Titles ─── */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
type Metric = keyof Pick<ProfileStats, 'games' | 'reviews' | 'sessions' | 'recordings' | 'clips' | 'bookmarks' | 'mistakes' | 'externalReviews' | 'assessments' | 'streakDays'> | 'level' | 'daysSinceInstall'

export interface TitleDef { id: string; metric: Metric; threshold: number; rarity: Rarity }

export const TITLES: TitleDef[] = [
  { id: 'first_review', metric: 'reviews', threshold: 1, rarity: 'common' },
  { id: 'analyst', metric: 'reviews', threshold: 10, rarity: 'rare' },
  { id: 'grinder', metric: 'reviews', threshold: 50, rarity: 'epic' },
  { id: 'lynx', metric: 'reviews', threshold: 150, rarity: 'legendary' },
  { id: 'clipper', metric: 'clips', threshold: 10, rarity: 'common' },
  { id: 'camera', metric: 'clips', threshold: 30, rarity: 'epic' },
  { id: 'director', metric: 'clips', threshold: 100, rarity: 'legendary' },
  { id: 'archivist', metric: 'recordings', threshold: 25, rarity: 'rare' },
  { id: 'disciplined', metric: 'sessions', threshold: 10, rarity: 'rare' },
  { id: 'war_machine', metric: 'sessions', threshold: 50, rarity: 'epic' },
  { id: 'centurion', metric: 'games', threshold: 100, rarity: 'rare' },
  { id: 'veteran', metric: 'games', threshold: 500, rarity: 'legendary' },
  { id: 'self_critic', metric: 'mistakes', threshold: 25, rarity: 'rare' },
  { id: 'hunter', metric: 'mistakes', threshold: 100, rarity: 'epic' },
  { id: 'annotator', metric: 'bookmarks', threshold: 50, rarity: 'rare' },
  { id: 'introspective', metric: 'assessments', threshold: 3, rarity: 'common' },
  { id: 'mentor', metric: 'externalReviews', threshold: 5, rarity: 'epic' },
  { id: 'regular', metric: 'streakDays', threshold: 7, rarity: 'rare' },
  { id: 'unstoppable', metric: 'streakDays', threshold: 30, rarity: 'legendary' },
  { id: 'loyal', metric: 'daysSinceInstall', threshold: 30, rarity: 'common' },
  { id: 'pillar', metric: 'daysSinceInstall', threshold: 180, rarity: 'epic' },
  { id: 'elder', metric: 'daysSinceInstall', threshold: 365, rarity: 'legendary' },
  { id: 'ascendant', metric: 'level', threshold: 10, rarity: 'rare' },
  { id: 'transcended', metric: 'level', threshold: 35, rarity: 'legendary' },
]

export const RARITY_STYLE: Record<Rarity, { text: string; border: string; bg: string }> = {
  common: { text: '#C9CED6', border: 'rgba(201,206,214,0.35)', bg: 'rgba(201,206,214,0.08)' },
  rare: { text: '#6FB7FF', border: 'rgba(111,183,255,0.45)', bg: 'rgba(111,183,255,0.10)' },
  epic: { text: '#C58BFF', border: 'rgba(197,139,255,0.5)', bg: 'rgba(197,139,255,0.12)' },
  legendary: { text: '#FFC857', border: 'rgba(255,200,87,0.6)', bg: 'rgba(255,200,87,0.12)' },
}

export function metricValue(stats: ProfileStats, metric: Metric, now = Date.now()): number {
  if (metric === 'level') return getLevelFromXp(stats.xp).level
  if (metric === 'daysSinceInstall') return Math.max(0, Math.floor((now - new Date(stats.memberSince).getTime()) / 86_400_000))
  return stats[metric]
}

export interface TitleState extends TitleDef { value: number; unlocked: boolean; progress: number }

/** `earned` keeps titles whose metric can go back down (streak) unlocked
 *  once reached. */
export function evaluateTitles(stats: ProfileStats, earned: string[] = [], now = Date.now()): TitleState[] {
  return TITLES.map((def) => {
    const value = metricValue(stats, def.metric, now)
    const unlocked = value >= def.threshold || earned.includes(def.id)
    return { ...def, value, unlocked, progress: unlocked ? 100 : Math.min(99, Math.floor((value / def.threshold) * 100)) }
  })
}

/* ─── Preferences ─── */

export interface ProfilePrefs {
  iconId: string
  bannerId: string
  titleId: string | null
  bio: string
  /** Up to 3 title ids pinned on the card. */
  showcase: string[]
  /** Titles reached at least once — never taken back. */
  earned: string[]
}

export const BIO_MAX = 120
export const SHOWCASE_MAX = 3

export const DEFAULT_PROFILE: ProfilePrefs = { iconId: 'tempete', bannerId: 'theme', titleId: null, bio: '', showcase: [], earned: [] }

export function sanitizeProfile(raw: unknown): ProfilePrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProfilePrefs>
  const titleIds = new Set(TITLES.map((t) => t.id))
  const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && titleIds.has(x)) : [])
  return {
    iconId: typeof r.iconId === 'string' && PROFILE_ICONS.some((i) => i.id === r.iconId) ? r.iconId : DEFAULT_PROFILE.iconId,
    bannerId: typeof r.bannerId === 'string' && PROFILE_BANNERS.some((b) => b.id === r.bannerId) ? r.bannerId : DEFAULT_PROFILE.bannerId,
    titleId: typeof r.titleId === 'string' && titleIds.has(r.titleId) ? r.titleId : null,
    bio: typeof r.bio === 'string' ? r.bio.slice(0, BIO_MAX) : '',
    showcase: [...new Set(strList(r.showcase))].slice(0, SHOWCASE_MAX),
    earned: [...new Set(strList(r.earned))],
  }
}

const key = (userId: string) => `ascend_profile_${userId}`

export function loadProfile(userId: string): ProfilePrefs {
  try {
    const raw = localStorage.getItem(key(userId))
    return sanitizeProfile(raw ? JSON.parse(raw) : null)
  } catch {
    return DEFAULT_PROFILE
  }
}

export function saveProfile(userId: string, prefs: ProfilePrefs): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(prefs))
    window.dispatchEvent(new CustomEvent('ascend-profile-changed'))
  } catch { /* per-device preference only */ }
}

export const iconUrl = (id: string) => PROFILE_ICONS.find((i) => i.id === id)?.url ?? PROFILE_ICONS[0]?.url ?? ''
export const bannerUrl = (id: string) => PROFILE_BANNERS.find((b) => b.id === id)?.url ?? null
