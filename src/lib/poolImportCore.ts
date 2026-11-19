/**
 * #46 point 1 ("dans champ pool, un joueur a ajouté ses champions mais les autres doivent quand même fetch le
 * data, ça fait des requêtes en double"). Each teammate's desktop keeps its own local copy of the group's team, and
 * the Lobby cards and the Champion Pool read that copy's pools (ChampionPoolEntry). A player whose pool was already
 * filled and published (team_pool_entries, under the group's published roster) was still fetched from Riot again
 * by every teammate's app.
 *
 * This works out which local players can take the published pool instead: a local player whose pool is EMPTY gets
 * the published pool of the same player (puuid first, else Riot ID). A local pool that has entries is never
 * touched: a fetch made on this computer, or a hand-made pool, stays as it is. Pure, tested.
 */
import { riotIdKey } from './rosterLinkCore'

export interface PublishedPoolEntry {
  championKey: string
  role: string
  tier: string | null
  notes: string | null
  playRate: number | null
  winRate: number | null
  masteryPoints: number | null
  kda: number | null
}

export interface PublishedPlayer {
  ign: string | null
  tagLine: string | null
  puuid: string | null
  pool: PublishedPoolEntry[]
}

export interface LocalPlayer {
  id: string
  ign: string | null
  tagLine: string | null
  puuid: string | null
  /** Entries in the local pool now. */
  poolSize: number
}

export function planPoolImport(local: readonly LocalPlayer[], published: readonly PublishedPlayer[]): Array<{ memberId: string; entries: PublishedPoolEntry[] }> {
  const used = new Set<number>()
  const out: Array<{ memberId: string; entries: PublishedPoolEntry[] }> = []
  for (const m of local) {
    if (m.poolSize > 0) continue
    let idx = m.puuid ? published.findIndex((p, i) => !used.has(i) && p.puuid === m.puuid) : -1
    if (idx < 0) {
      const key = riotIdKey(m.ign, m.tagLine)
      if (key) idx = published.findIndex((p, i) => !used.has(i) && riotIdKey(p.ign, p.tagLine) === key)
    }
    if (idx < 0) continue
    used.add(idx)
    const seen = new Set<string>()
    const entries = published[idx].pool.filter((e) => {
      const k = `${e.championKey}|${e.role}`
      if (!e.championKey || !e.role || seen.has(k)) return false
      seen.add(k)
      return true
    })
    if (entries.length > 0) out.push({ memberId: m.id, entries })
  }
  return out
}
