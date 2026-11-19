import type { TFunction } from 'i18next'
import type { LftFormat, LftMode, LftRole } from '@/lib/lftCore'
import type { QueueRank } from '@/lib/rankCore'
import type { LftAccent } from './theme'

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
  /** Skin of the first champion for the background art (0: base skin). */
  skin: number
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
  /** Translations in the announcement's language. */
  t: TFunction
}
