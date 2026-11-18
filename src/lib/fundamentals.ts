import { FUNDAMENTALS, type Fundamental, type FundamentalCategory } from './constants/fundamentals'
import type { GroupFundamental } from './teamSessions'

/**
 * Merges a group's custom fundamentals (the "+ Add a fundamental" button,
 * Phase 3 of the Planning rework) into the static FUNDAMENTALS list as one
 * synthetic trailing category, objective-only (no KPI sub-scoring — see
 * GroupFundamental's doc comment in teamSessions.ts). `getAllFundamentals`/
 * `getFundamentalById` in constants/fundamentals.ts read the hardcoded
 * constant directly and can't take a per-group list, so this is a parallel
 * set of lookups that return the exact same `Fundamental` shape, rather
 * than mutating the constants file.
 */

const TEAM_CUSTOM_CATEGORY_ID = 'team_custom'

export function mergedFundamentalCategories(groupFundamentals: GroupFundamental[]): FundamentalCategory[] {
  if (groupFundamentals.length === 0) return FUNDAMENTALS
  return [...FUNDAMENTALS, {
    id: TEAM_CUSTOM_CATEGORY_ID,
    label: 'Team Fundamentals',
    fundamentals: groupFundamentals.map((f): Fundamental => ({ id: f.id, label: f.label, description: f.description ?? '', kpis: [] })),
  }]
}

export function getAllFundamentalsForGroup(groupFundamentals: GroupFundamental[]): Fundamental[] {
  return mergedFundamentalCategories(groupFundamentals).flatMap((c) => c.fundamentals)
}

export function getFundamentalByIdForGroup(id: string, groupFundamentals: GroupFundamental[]): Fundamental | undefined {
  return getAllFundamentalsForGroup(groupFundamentals).find((f) => f.id === id)
}

/** Label of a fundamental in `list` (e.g. useLocalizedFundamentalList()), else the id itself. */
export function findFundamentalLabel(id: string, list: Fundamental[]): string {
  return list.find((f) => f.id === id)?.label ?? id
}

/** Label of a KPI across every fundamental of `list`, else the KPI id itself. */
export function findKpiLabel(kpiId: string, list: Fundamental[]): string {
  for (const f of list) {
    const match = f.kpis.find((k) => k.id === kpiId)
    if (match) return match.label
  }
  return kpiId
}
