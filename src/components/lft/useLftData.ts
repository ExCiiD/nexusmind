import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TeamMember } from '@/lib/ipc'
import type { MemberLook } from '@/lib/collab'
import { displayRank, type MemberRankResult } from '@/lib/rankCore'
import { mainChampions, parseChampionSkins, riotIdOf, type LftRole, type TraitPicks } from '@/lib/lftCore'
import { lookForMember, type LookSources } from '@/lib/playerCard'
import { iconUrl } from '@/lib/profile'
import { useAllChampions } from '@/hooks/useAllChampions'
import { useProfilePrefs } from '@/components/Profile/ProfileCard'
import { useUserStore } from '@/store/useUserStore'
import type { LftPlayerView } from './types'
import { fundamentalLabel } from './fundamentals'

/** Ranks of the team's roster, read once when the dialog opens. */
export function useMemberRanks(teamId: string, enabled: boolean) {
  const [results, setResults] = useState<Record<string, MemberRankResult>>({})
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(async (force: boolean) => {
    if (!window.api.teamMemberRanks) return
    setLoading(true)
    setFailure(null)
    try {
      const list = await window.api.teamMemberRanks(teamId, { force })
      setResults(Object.fromEntries((Array.isArray(list) ? list : []).map((r) => [r.memberId, r])))
    } catch (err) {
      setFailure((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => {
    if (enabled) void load(false)
  }, [enabled, load])

  return { results, loading, failure, reload: () => load(true), available: !!window.api.teamMemberRanks }
}

/** Where the players' profile icons come from (same as the roster cards). */
export function useLookSources(enabled: boolean): LookSources {
  const user = useUserStore((s) => s.user)
  const prefs = useProfilePrefs(user?.id)
  const [looks, setLooks] = useState<MemberLook[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    window.api.collabListMemberLooks?.()
      .then((l) => { if (alive) setLooks(Array.isArray(l) ? l : []) })
      .catch(() => { /* signed out or offline: champion icons stand in */ })
    return () => { alive = false }
  }, [enabled])
  return useMemo<LookSources>(() => ({
    me: user
      ? {
          puuid: user.puuid,
          riotId: user.tagLine ? `${user.summonerName}#${user.tagLine}` : user.summonerName,
          look: prefs ? { iconId: prefs.iconId, bannerId: prefs.bannerId } : null,
        }
      : null,
    looks,
  }), [user, prefs, looks])
}

/** Champion display names (Data Dragon), the key meanwhile. */
export function useChampionNames(): (key: string) => string {
  const { champions } = useAllChampions()
  return useMemo(() => {
    const names = new Map(champions.map((c) => [c.key, c.name]))
    return (key: string) => names.get(key) ?? key
  }, [champions])
}

export interface ChampionSkin {
  num: number
  name: string
}

const skinCache = new Map<string, Promise<ChampionSkin[]>>()

/** Skins of a champion from Data Dragon, names in `lang`; read once per
 *  launch. Only the base skin while loading or offline. */
export function useChampionSkins(championKey: string | null, version: string, lang: 'fr' | 'en'): ChampionSkin[] {
  const [skins, setSkins] = useState<ChampionSkin[]>([{ num: 0, name: 'default' }])
  useEffect(() => {
    if (!championKey) return
    let alive = true
    const locale = lang === 'fr' ? 'fr_FR' : 'en_US'
    const key = `${version}|${locale}|${championKey}`
    let pending = skinCache.get(key)
    if (!pending) {
      pending = fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/${locale}/champion/${championKey}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => parseChampionSkins(json, championKey))
        .catch(() => {
          skinCache.delete(key)
          return parseChampionSkins(null, championKey)
        })
      skinCache.set(key, pending)
    }
    void pending.then((list) => { if (alive) setSkins(list) })
    return () => { alive = false }
  }, [championKey, version, lang])
  return skins
}

/** Skin picked for a member, kept with its champion: a new main champion
 *  starts again from the base skin. */
export type SkinChoice = { key: string; num: number }

/** What an announcement shows of one roster member. */
export function playerView(
  member: TeamMember,
  role: LftRole,
  ctx: { rank: MemberRankResult | undefined; ranksLoading: boolean; looks: LookSources; nameOf: (key: string) => string; skin?: SkinChoice; traits?: TraitPicks; lang: 'fr' | 'en' },
): LftPlayerView {
  const id = riotIdOf(member)
  const look = lookForMember(member, ctx.looks)
  const r = ctx.rank
  const champions = mainChampions(member.champPool, role).map((c) => ({ key: c.championKey, name: ctx.nameOf(c.championKey), games: c.games, winRate: c.winRate }))
  return {
    strengths: (ctx.traits?.strengths ?? []).map((f) => fundamentalLabel(f, ctx.lang)),
    weaknesses: (ctx.traits?.weaknesses ?? []).map((f) => fundamentalLabel(f, ctx.lang)),
    skin: ctx.skin && ctx.skin.key === champions[0]?.key ? ctx.skin.num : 0,
    id: member.id,
    name: id?.name || member.displayName,
    tag: id?.tag ?? null,
    region: member.region ?? null,
    role,
    rank: r?.status === 'ok' ? displayRank(r.ranks) : null,
    rankState: r ? (r.status === 'ok' ? 'ok' : r.status === 'no-riot-id' ? 'none' : 'error') : ctx.ranksLoading ? 'loading' : 'none',
    champions,
    avatarUrl: look?.iconId ? iconUrl(look.iconId) : null,
  }
}
