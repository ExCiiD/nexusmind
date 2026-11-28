import { FAMILIES, TIERS, type MistakeFamily, type RankSort, type TierFilter } from '@/lib/mistakeInsights'

/**
 * The Mistake Lab state lives in the URL (`/stats/mistakes?d=14&m=bad-trade&tier=fatal…`), so that « Rewatch » → back (the app's button,
 * the mouse button, the history) lands on the same Lab: same period, filters, sort, selected mistake and expanded list.
 * Defaults are left out of the URL; every update replaces the entry (filter clicks never pile up in the history).
 */

export const LAB_WINDOWS = [7, 14, 30, 90] as const
export type LabWindow = (typeof LAB_WINDOWS)[number]
export const LAB_ROLES = ['', 'TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const

export interface LabUrlState {
  days: LabWindow
  role: string
  champion: string
  family: MistakeFamily | 'all'
  tier: TierFilter
  sort: RankSort
  /** Selected mistake (tag slug). */
  focus: string | null
  /** « Show all » of the latest moments. */
  showAll: boolean
}

export const LAB_DEFAULTS: LabUrlState = { days: 30, role: '', champion: '', family: 'all', tier: 'all', sort: 'frequency', focus: null, showAll: false }

const KEY: Record<keyof LabUrlState, string> = { days: 'd', role: 'role', champion: 'q', family: 'fam', tier: 'tier', sort: 'sort', focus: 'm', showAll: 'all' }

const pick = <T extends string>(v: string | null, valid: readonly T[], def: T): T => (v != null && (valid as readonly string[]).includes(v) ? (v as T) : def)

/** Reads the Lab state; anything missing or invalid falls back to the default. */
export function parseLabParams(sp: URLSearchParams): LabUrlState {
  const d = Number(sp.get(KEY.days))
  return {
    days: (LAB_WINDOWS as readonly number[]).includes(d) ? (d as LabWindow) : LAB_DEFAULTS.days,
    role: pick(sp.get(KEY.role), LAB_ROLES, ''),
    champion: sp.get(KEY.champion) ?? '',
    family: pick(sp.get(KEY.family), ['all', ...FAMILIES] as const, 'all'),
    tier: pick(sp.get(KEY.tier), ['all', ...TIERS] as const, 'all'),
    sort: pick(sp.get(KEY.sort), ['frequency', 'severity'] as const, 'frequency'),
    focus: sp.get(KEY.focus) || null,
    showAll: sp.get(KEY.showAll) === '1',
  }
}

/** The params after changing some of the Lab state: defaults are removed, other params (outside the Lab's) are kept. */
export function patchLabParams(sp: URLSearchParams, patch: Partial<LabUrlState>): URLSearchParams {
  const next = new URLSearchParams(sp)
  for (const k of Object.keys(patch) as Array<keyof LabUrlState>) {
    const v = patch[k]
    const isDefault = v == null || v === '' || v === false || v === LAB_DEFAULTS[k]
    if (isDefault) next.delete(KEY[k])
    else next.set(KEY[k], v === true ? '1' : String(v))
  }
  return next
}
