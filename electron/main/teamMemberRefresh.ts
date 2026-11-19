import { getPrisma } from './database'
import { getAccountByPuuid } from './riotClient'
import { riotIdRename } from '../../src/lib/teamIdentity'

/**
 * #38: keeps stored team members (own roster and scouted opponents) under their current Riot ID. A member with a
 * puuid is looked up by puuid (account-v1) at most once per app run; a rename updates ign / tagLine (and the display
 * name when it was the Riot name) on the same row, so role, champion pool and rank stay attached to the player.
 * Runs in the background after team:list; the new name shows on the next load.
 */
const checkedThisRun = new Set<string>()
let running: Promise<number> | null = null

export interface RefreshableMember {
  id: string
  puuid: string | null
  region: string | null
  ign: string | null
  tagLine: string | null
  displayName: string | null
}

/** Members to look up now: with a puuid and a region, not looked up yet this run. Pure, tested. */
export function membersToRefresh(members: RefreshableMember[], checked: ReadonlySet<string>): RefreshableMember[] {
  return members.filter((m) => !!m.puuid && !!m.region && !checked.has(m.id))
}

/** Looks the members up one by one (Riot's own rate limiter paces them). Returns how many were renamed. */
export function refreshTeamMemberRiotIds(members: RefreshableMember[]): Promise<number> {
  const todo = membersToRefresh(members, checkedThisRun)
  if (todo.length === 0) return running ?? Promise.resolve(0)
  for (const m of todo) checkedThisRun.add(m.id)
  const previous = running ?? Promise.resolve(0)
  const next = previous.then(async () => {
    let renamed = 0
    for (const m of todo) {
      try {
        const acct = await getAccountByPuuid(m.puuid as string, m.region as string)
        const change = riotIdRename(m, acct)
        if (!change) continue
        await getPrisma().teamMember.update({
          where: { id: m.id },
          // previousRiotId: the screens say the player was renamed instead of switching the name silently.
          data: {
            ign: change.ign, tagLine: change.tagLine, previousRiotId: [m.ign, m.tagLine].filter(Boolean).join('#') || null,
            ...(change.displayName !== undefined ? { displayName: change.displayName } : {}),
          },
        })
        renamed++
      } catch (err) {
        // Offline, rate-limited, or the member was deleted meanwhile: the next run retries.
        checkedThisRun.delete(m.id)
        console.warn('[team] Riot ID refresh failed for a member:', (err as Error)?.message)
      }
    }
    if (renamed > 0) console.log(`[team] ${renamed} renamed player(s) updated from Riot`)
    return renamed
  })
  running = next.finally(() => { if (running === next) running = null })
  return next
}
