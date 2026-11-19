/** Shared types for the Discord bot integration (E11). */
import { randomCode } from './tokens'

export interface DiscordGuildLink {
  guildId: string
  groupId: string
  notifyChannelId: string | null
  linkedBy: string | null // null once the author deleted their account (S19-16 / #33)
  linkedAt: string
}

export interface DiscordUserLink {
  discordUserId: string
  userId: string
  linkedAt: string
}

/** 6-char uppercase, excludes ambiguous characters (0/O, 1/I/L) since a
 *  human types this into a Discord slash command. Drawn with Web Crypto: the
 *  code links a Discord account to an Ascend account while it is valid. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function generateLinkCode(): string {
  return randomCode(CODE_ALPHABET, 6)
}
