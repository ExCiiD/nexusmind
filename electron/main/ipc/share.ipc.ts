import { ipcMain, clipboard } from 'electron'
import { getPrisma } from '../database'

const DISCORD_WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//

/**
 * Enforces Discord embed limits to avoid 400 errors:
 * - title: max 256 chars
 * - description: max 4096 chars
 * - field name: max 256 chars, field value: max 1024 chars, max 25 fields
 * - Total text across title + description + all field names + values: max 6000 chars
 * Strips empty fields and truncates oversized values.
 */
function sanitizeEmbeds(embeds: object[]): object[] {
  return (embeds as Record<string, unknown>[]).map((embed) => {
    const clean: Record<string, unknown> = {}

    const title = typeof embed.title === 'string' && embed.title.trim()
      ? embed.title.trim().slice(0, 256)
      : undefined
    if (title) clean.title = title

    const description = typeof embed.description === 'string' && embed.description.trim()
      ? embed.description.trim().slice(0, 4096)
      : undefined
    if (description) clean.description = description

    if (embed.color !== undefined) clean.color = embed.color
    if (embed.footer)             clean.footer = embed.footer
    if (embed.timestamp)          clean.timestamp = embed.timestamp
    if (embed.image)              clean.image = embed.image
    if (embed.thumbnail)          clean.thumbnail = embed.thumbnail
    if (embed.author)             clean.author = embed.author

    let totalChars = (title?.length ?? 0) + (description?.length ?? 0)
    const MAX_TOTAL = 6000

    if (Array.isArray(embed.fields)) {
      const validFields: Record<string, unknown>[] = []

      for (const f of embed.fields as Record<string, unknown>[]) {
        const nameStr  = typeof f.name  === 'string' ? f.name.trim().slice(0, 256)  : ''
        const valueStr = typeof f.value === 'string' ? f.value.trim().slice(0, 1024) : ''
        if (!nameStr || !valueStr) continue
        if (validFields.length >= 25) break

        const fieldChars = nameStr.length + valueStr.length
        if (totalChars + fieldChars > MAX_TOTAL) {
          const remaining = MAX_TOTAL - totalChars - nameStr.length
          if (remaining > 50) {
            validFields.push({ name: nameStr, value: valueStr.slice(0, remaining) + '…', inline: f.inline })
            totalChars = MAX_TOTAL
          }
          break
        }

        validFields.push({ name: nameStr, value: valueStr, inline: f.inline })
        totalChars += fieldChars
      }

      if (validFields.length > 0) clean.fields = validFields
    }

    return clean
  })
}

function validateWebhookUrl(url: string): void {
  if (!DISCORD_WEBHOOK_RE.test(url)) {
    throw new Error('Invalid webhook URL — must be a Discord webhook (https://discord.com/api/webhooks/…)')
  }
}

export function registerShareHandlers() {
  /**
   * Posts a pre-built Discord embed payload to an explicit webhook URL.
   * The renderer is responsible for building the embed object and picking the target webhook.
   */
  ipcMain.handle('share:send-to-discord', async (_event, embeds: object[], webhookUrl: string) => {
    if (!webhookUrl) throw new Error('No webhook URL provided.')

    const sanitized = sanitizeEmbeds(embeds)
    const bodyToSend = JSON.stringify({ embeds: sanitized })

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyToSend,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Discord API error ${response.status}: ${body}`)
    }

    return { success: true }
  })

  /** Returns all Discord webhooks for the active user, ordered by creation date. */
  ipcMain.handle('share:list-webhooks', async () => {
    const prisma = getPrisma()
    const rows: Array<{ id: string; name: string; url: string; createdAt: string }> =
      await prisma.$queryRawUnsafe(
        `SELECT id, name, url, createdAt FROM "DiscordWebhook"
         WHERE userId = (SELECT id FROM "User" WHERE isActive = 1 LIMIT 1)
         ORDER BY createdAt ASC`,
      )
    return rows
  })

  /** Adds a new named Discord webhook for the active user. */
  ipcMain.handle('share:add-webhook', async (_event, name: string, url: string) => {
    validateWebhookUrl(url)

    const prisma = getPrisma()
    const users: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `SELECT id FROM "User" WHERE isActive = 1 LIMIT 1`,
    )
    if (!users[0]) throw new Error('No active user found.')

    const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DiscordWebhook" (id, userId, name, url, createdAt) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      id,
      users[0].id,
      name.trim(),
      url.trim(),
    )

    return { id, name: name.trim(), url: url.trim() }
  })

  /** Renames an existing webhook. */
  ipcMain.handle('share:rename-webhook', async (_event, id: string, name: string) => {
    const prisma = getPrisma()
    await prisma.$executeRawUnsafe(
      `UPDATE "DiscordWebhook" SET name = ? WHERE id = ?`,
      name.trim(),
      id,
    )
    return { success: true }
  })

  /** Deletes a Discord webhook by id. */
  ipcMain.handle('share:delete-webhook', async (_event, id: string) => {
    const prisma = getPrisma()
    await prisma.$executeRawUnsafe(
      `DELETE FROM "DiscordWebhook" WHERE id = ?`,
      id,
    )
    return { success: true }
  })

  /**
   * Copies a plain-text review summary to the system clipboard.
   * Falls back option when no webhook is configured.
   */
  ipcMain.handle('share:copy-text', (_event, text: string) => {
    clipboard.writeText(text)
    return { success: true }
  })
}
