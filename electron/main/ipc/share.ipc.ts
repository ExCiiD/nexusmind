import { ipcMain, clipboard } from 'electron'
import { getPrisma } from '../database'
import { existsSync, createReadStream, statSync } from 'fs'
import { basename, extname } from 'path'
import { z } from 'zod'
import { validatedHandle, id, discordWebhookUrl, shortText, localPath } from './validate'
import { isMediaPathAllowed } from '../mediaAccess'

const SHAREABLE_VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov'])

/**
 * Files leave the machine through these handlers, so only recordings/clips
 * the app knows about may be sent — never an arbitrary path from the renderer.
 */
async function assertShareableFile(filePath: string): Promise<void> {
  if (!SHAREABLE_VIDEO_EXTS.has(extname(filePath).toLowerCase())) throw new Error('UNSUPPORTED_FILE_TYPE')
  if (!existsSync(filePath)) throw new Error('FILE_NOT_FOUND')
  if (!(await isMediaPathAllowed(filePath))) throw new Error('FILE_NOT_ALLOWED')
}


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

export function registerShareHandlers() {
  /**
   * Posts a pre-built Discord embed payload to an explicit webhook URL.
   * The renderer is responsible for building the embed object and picking the target webhook.
   */
  validatedHandle('share:send-to-discord', z.tuple([z.array(z.record(z.unknown())).max(10), discordWebhookUrl]), async (_event, embeds, webhookUrl) => {
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
  validatedHandle('share:add-webhook', z.tuple([shortText(100).trim().min(1), discordWebhookUrl]), async (_event, name, url) => {

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
  validatedHandle('share:rename-webhook', z.tuple([id, shortText(100).trim().min(1)]), async (_event, webhookId, name) => {
    const prisma = getPrisma()
    await prisma.$executeRawUnsafe(
      `UPDATE "DiscordWebhook" SET name = ? WHERE id = ?`,
      name.trim(),
      webhookId,
    )
    return { success: true }
  })

  /** Deletes a Discord webhook by id. */
  validatedHandle('share:delete-webhook', z.tuple([id]), async (_event, webhookId) => {
    const prisma = getPrisma()
    await prisma.$executeRawUnsafe(
      `DELETE FROM "DiscordWebhook" WHERE id = ?`,
      webhookId,
    )
    return { success: true }
  })

  /**
   * Copies a plain-text review summary to the system clipboard.
   * Falls back option when no webhook is configured.
   */
  validatedHandle('share:copy-text', z.tuple([z.string().max(20_000)]), (_event, text) => {
    clipboard.writeText(text)
    return { success: true }
  })

  /**
   * Sends a video file directly to a Discord webhook via multipart/form-data.
   * Discord free-tier limit is 8 MB. Throws 'FILE_TOO_LARGE' if exceeded.
   */
  validatedHandle('share:send-file-to-discord', z.tuple([localPath, discordWebhookUrl, shortText(2000).optional()]), async (_event, filePath, webhookUrl, caption) => {
    await assertShareableFile(filePath)

    const fileSize = statSync(filePath).size
    const MAX_DISCORD_BYTES = 8 * 1024 * 1024 // 8 MB (free tier)
    if (fileSize > MAX_DISCORD_BYTES) throw new Error('FILE_TOO_LARGE')

    // Build multipart form via native fetch (Node 18+)
    const { FormData, Blob } = await import('buffer').then(() => require('undici')).catch(() => ({
      FormData: globalThis.FormData,
      Blob: globalThis.Blob,
    }))

    const fileBuffer = await require('fs').promises.readFile(filePath)
    const form = new FormData()

    if (caption?.trim()) {
      form.append('payload_json', JSON.stringify({ content: caption.trim().slice(0, 2000) }))
    }

    form.append('files[0]', new Blob([fileBuffer], { type: 'video/mp4' }), basename(filePath))

    const res = await fetch(webhookUrl, { method: 'POST', body: form })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Discord API error ${res.status}: ${text.slice(0, 200)}`)
    }
    return { success: true, fileSize }
  })

  /**
   * Uploads a file to litterbox.catbox.moe for temporary hosting and returns the URL.
   * Supported expiry: 1h, 12h, 24h, 72h.
   */
  validatedHandle('share:upload-temp', z.tuple([localPath, z.union([z.literal(1), z.literal(12), z.literal(24), z.literal(72)])]), async (_event, filePath, expiryHours) => {
    await assertShareableFile(filePath)

    const fileBuffer = await require('fs').promises.readFile(filePath)

    // Use undici FormData if native FormData is not available in this Node version
    let FormDataClass: typeof FormData
    let BlobClass: typeof Blob
    try {
      const undici = require('undici')
      FormDataClass = undici.FormData
      BlobClass = undici.Blob
    } catch {
      FormDataClass = globalThis.FormData
      BlobClass = globalThis.Blob
    }

    const form = new FormDataClass()
    form.append('reqtype', 'fileupload')
    form.append('time', `${expiryHours}h`)
    form.append('fileToUpload', new BlobClass([fileBuffer], { type: 'video/mp4' }), basename(filePath))

    const res = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
      method: 'POST',
      body: form,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Litterbox error ${res.status}: ${text.slice(0, 200)}`)
    }

    const url = (await res.text()).trim()
    if (!url.startsWith('https://')) throw new Error(`Unexpected litterbox response: ${url.slice(0, 100)}`)

    return { url, expiryHours }
  })
}
