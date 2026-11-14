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

/** Posts a message to a channel using the bot token — used by the
 *  reminder cron (not a reply to an interaction, so it needs the full
 *  REST API rather than an interaction response). */
export async function postChannelMessage(botToken: string, channelId: string, content: string): Promise<void> {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    console.error('[discord-bot] postChannelMessage failed', res.status, await res.text().catch(() => ''))
  }
}
