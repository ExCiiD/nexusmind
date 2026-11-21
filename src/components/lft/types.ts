import type { TFunction } from 'i18next'
import type { LftFormat, LftMode, LftRole } from '@/lib/lftCore'
import type { QueueRank } from '@/lib/rankCore'
import type { LftAccent } from './theme'
import type { CardLook } from '@/lib/cardLookCore'

export interface LftChampionView {
  key: string
  name: string
  games: number
  winRate: number | null
}

/** loading: asked to Riot; none: no full Riot ID; error: Riot didn't answer. */
export type LftRankState = 'loading' | 'ok' | 'none' | 'error'

export interface LftPlayerView {
  id: string
  /** Riot game name (else the roster name). */
  name: string
  tag: string | null
  region: string | null
  /** The roster role (solo) or the lobby seat (multi search). */
  role: LftRole
  rank: QueueRank | null
  rankState: LftRankState
  champions: LftChampionView[]
  /** Skin of the art champion for the background art (0: base skin). */
  skin: number
  /** 21/11: the champion of the art, picked like on the Lobby card (any of the player's champions); null: the first one. */
  artKey: string | null
  /** 21/11 (spec § 22): the art champion's hosted cut-out for that skin; null: the splash art. */
  artCutoutUrl: string | null
  /** Fundamentals picked as strengths / weaknesses, already named. */
  strengths: string[]
  weaknesses: string[]
  /** The profile icon the player shared; null: the first champion stands in. */
  avatarUrl: string | null
}

export interface LftContent {
  lookingFor: string
  languages: string
  discord: string
  tags: string[]
  message: string
}

export interface LftPosterProps {
  mode: LftMode
  format: LftFormat
  /** Solo: the first one. */
  players: LftPlayerView[]
  /** Multi search: the seats shown with a "+". */
  wanted: LftRole[]
  /** Multi search: the profile wanted for those seats (fundamentals, named). */
  profile: { strengths: string[]; required: string[] }
  region: string | null
  content: LftContent
  accent: LftAccent
  /** Data Dragon version, for the champion icons. */
  version: string
  design: LftDesign
  /** Translations in the announcement's language. */
  t: TFunction
}

/** How the announcement is drawn, beyond its colour. */
export interface LftDesign {
  /** Behind everything: the main champion's splash art, or a card pattern
   *  (`look.background`) over the colour's glow. */
  art: 'splash' | 'pattern'
  /** Pattern, colour filter, blur and light of the background. */
  look: CardLook
  show: { rankDetails: boolean; mains: boolean; champStats: boolean; frame: boolean; region: boolean }
  /** Replaces the small line above the region / lobby title when set. */
  kicker: string
  /** Multi search: replaces "On cherche N joueurs" when set. */
  title: string
  /** Champions listed per player (the lobby seats show 3 at most). */
  championCount: number
}
