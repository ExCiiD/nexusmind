/** Shared types for the Discord bot integration (E11). */

export interface DiscordGuildLink {
  guildId: string
  groupId: string
  notifyChannelId: string | null
  linkedBy: string
  linkedAt: string
}

export interface DiscordUserLink {
  discordUserId: string
  userId: string
  linkedAt: string
}

/** 6-char uppercase, excludes ambiguous characters (0/O, 1/I/L) since a
 *  human types this into a Discord slash command. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function generateLinkCode(): string {
  let code = ''
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return code
}
