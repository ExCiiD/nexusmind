/** Thin helpers over Discord's REST + Interactions response shapes. */

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
} as const

export const InteractionCallbackFlags = {
  EPHEMERAL: 1 << 6,
} as const

/** A reply only the invoking user sees — used for link codes, errors, and
 *  anything personal (never for team-wide info like /calendar). */
export function ephemeralReply(content: string) {
  return jsonResponse({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content, flags: InteractionCallbackFlags.EPHEMERAL } })
}

/** A reply visible to the whole channel — team-wide info commands. */
export function publicReply(content: string) {
  return jsonResponse({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content } })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Opens (or reuses) the direct-message channel with a Discord user and
 *  posts there. Someone who doesn't accept DMs from this bot's servers just
 *  doesn't get it: false, logged, never thrown. */
export async function sendDirectMessage(botToken: string, discordUserId: string, content: string): Promise<boolean> {
  const res = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ recipient_id: discordUserId }),
  })
  if (!res.ok) {
    console.error('[discord-bot] open DM failed', res.status, await res.text().catch(() => ''))
    return false
  }
  const channel = (await res.json().catch(() => null)) as { id?: string } | null
  if (!channel?.id) return false
  // A DM never pings anyone, whatever its text (CyberSecurity, beta.14).
  await postChannelMessage(botToken, channel.id, content, { noMentions: true })
  return true
}

/** Posts a message to a channel using the bot token — used by the
 *  reminder cron (not a reply to an interaction, so it needs the full
 *  REST API rather than an interaction response). */
export async function postChannelMessage(botToken: string, channelId: string, content: string, opts: { noMentions?: boolean } = {}): Promise<void> {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(opts.noMentions ? { content, allowed_mentions: { parse: [] } } : { content }),
  })
  if (!res.ok) {
    console.error('[discord-bot] postChannelMessage failed', res.status, await res.text().catch(() => ''))
  }
}
