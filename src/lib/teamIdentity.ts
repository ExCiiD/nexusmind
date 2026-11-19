/**
 * Pure helpers for matching/merging team members by Riot identity, and for
 * normalizing draft pick/ban slots. Shared by the desktop IPC handlers
 * (electron/main/ipc/team.ipc.ts) and the web team CRUD (teamCore.ts, E14)
 * so "what counts as a duplicate" and "what a draft slot looks like" can
 * never drift apart between platforms.
 */

/**
 * All candidate identity keys for a member, in priority order. A member
 * contributes multiple keys (puuid, ign+tag, ign, displayName) so two
 * records created at different points in the workflow (e.g. added
 * manually without a tag, then re-imported with the full Riot ID) still
 * match on at least one.
 */
export function identityKeys(m: { puuid?: string | null; ign?: string | null; tagLine?: string | null; displayName?: string | null }): string[] {
  const norm = (s?: string | null) => (s ?? '').toLowerCase().trim()
  const keys: string[] = []
  if (m.puuid) keys.push(`puuid:${m.puuid}`)
  if (m.ign && m.tagLine) keys.push(`riot:${norm(m.ign)}#${norm(m.tagLine)}`)
  if (m.ign) keys.push(`ign:${norm(m.ign)}`)
  if (m.displayName) keys.push(`name:${norm(m.displayName)}`)
  return keys
}

/**
 * Normalize draft slot payloads to the canonical `string[][]` shape.
 * Accepts:
 *   - undefined        → []
 *   - string[]         (legacy single-pick) → [[c1], [c2], ...]
 *   - string[][]       (new multi-option)   → passed through
 *   - mixed array      → entries that are strings get wrapped
 *
 * Strips empty strings inside slot arrays. Returns ALL slots, even empty
 * ones, so downstream readers see consistent positional indices.
 */
export function normalizeSlots(input?: string[][] | string[]): string[][] {
  if (!Array.isArray(input)) return []
  return input.map((slot) => {
    if (Array.isArray(slot)) return slot.filter((c): c is string => typeof c === 'string' && c.length > 0)
    if (typeof slot === 'string') return slot.length > 0 ? [slot] : []
    return []
  })
}

/**
 * Riot's role names (from `teamPosition`/`individualPosition` on a match
 * participant) → the internal TOP/JUNGLE/MID/ADC/SUPPORT convention used
 * by TeamMember/ChampionPoolEntry.role everywhere else in the app. Without
 * this, the `roleOnly` filter in scout/auto-fill would reject every MID/
 * ADC/SUPPORT game (since "MIDDLE" !== "MID"), and pool entries would be
 * stored with Riot's names, which never match the Draft Sim's filters.
 */
const RIOT_TO_INTERNAL_ROLE: Record<string, string> = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MID',
  BOTTOM: 'ADC',
  UTILITY: 'SUPPORT',
}
export function normalizeRole(role: string | null | undefined): string {
  if (!role) return ''
  const upper = role.toUpperCase()
  return RIOT_TO_INTERNAL_ROLE[upper] ?? upper
}

/**
 * Groups members by progressive identity matching — each member joins the
 * canonical group of the first earlier member it shares ANY key with,
 * otherwise it starts a new group keyed by its own top-priority candidate.
 * Members with no identity signal at all (no puuid/ign/displayName) are
 * never grouped — nothing to safely match them on.
 *
 * Returns only the groups with 2+ members (the actual duplicate sets).
 */
export function groupDuplicates<T extends { puuid?: string | null; ign?: string | null; tagLine?: string | null; displayName?: string | null }>(
  membersOldestFirst: T[],
): T[][] {
  const keyToCanonical = new Map<string, string>()
  const groups = new Map<string, T[]>()
  for (const m of membersOldestFirst) {
    const candidates = identityKeys(m)
    if (candidates.length === 0) continue
    const existingCanonical = candidates.map((c) => keyToCanonical.get(c)).find(Boolean)
    const canonical = existingCanonical ?? candidates[0]
    for (const c of candidates) keyToCanonical.set(c, canonical)
    const arr = groups.get(canonical) ?? []
    arr.push(m)
    groups.set(canonical, arr)
  }
  return Array.from(groups.values()).filter((g) => g.length >= 2)
}

/**
 * #38: what to store when Riot reports a puuid's current Riot ID. null when nothing changed. The display name
 * follows the Riot name only when it was the Riot name (or empty): a name the staff typed is kept.
 */
export function riotIdRename(
  stored: { ign?: string | null; tagLine?: string | null; displayName?: string | null },
  fresh: { gameName?: string | null; tagLine?: string | null },
): { ign: string; tagLine: string; displayName?: string } | null {
  const ign = fresh.gameName?.trim()
  const tagLine = fresh.tagLine?.trim()
  if (!ign || !tagLine) return null
  if (ign === (stored.ign ?? '').trim() && tagLine === (stored.tagLine ?? '').trim()) return null
  const shown = (stored.displayName ?? '').trim()
  const followsRiot = !shown || shown === (stored.ign ?? '').trim()
  return { ign, tagLine, ...(followsRiot ? { displayName: ign } : {}) }
}
