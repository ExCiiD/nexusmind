import { sb, currentUserId } from './supabase'
import * as core from '@/lib/collabCore'
import * as cardSkins from '@/lib/cardSkinsCore'
import type { CardChampion, CardSkinLocale, CollabApi } from '@/lib/collab'

/**
 * Team Lobby cards, web side (20/11/2026): the members' looks with the champion and skin each picked for their card,
 * my own choice, and the skins with a hosted cut-out. Same core as the desktop (electron/main/cloud/collab.ts).
 * The web's CSP already allows ascend-cutouts (images and connect) and Data Dragon (connect).
 * Spread into the web's window.api (web/src/api.ts) like analystWebApi.
 */
export const cardChampionWebApi: Pick<CollabApi, 'collabListMemberLooks' | 'collabSetMyCardChampion' | 'collabListCardSkins'> = {
  collabListMemberLooks: async () => {
    const uid = await currentUserId().catch(() => null)
    return uid ? core.listMemberLooks(sb, uid) : []
  },
  collabSetMyCardChampion: async (choice: CardChampion | null) => {
    const uid = await currentUserId().catch(() => null)
    return uid ? core.setMyCardChampion(sb, uid, choice).catch(() => false) : false
  },
  collabListCardSkins: (championId: string, locale?: CardSkinLocale) =>
    cardSkins.listCardSkins((url) => fetch(url), championId, locale),
}
