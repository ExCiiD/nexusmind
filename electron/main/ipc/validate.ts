import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'

/**
 * Registers an `ipcMain.handle` whose positional arguments are parsed with a
 * zod tuple before the handler runs. Anything the renderer sends that does
 * not match is rejected with a readable error instead of reaching Prisma,
 * the filesystem or the network.
 *
 *   validatedHandle('bookmark:delete', z.tuple([ids.id]), async (_e, id) => …)
 */
export function validatedHandle<Items extends [z.ZodTypeAny, ...z.ZodTypeAny[]], R>(
  channel: string,
  schema: z.ZodTuple<Items, null>,
  handler: (event: IpcMainInvokeEvent, ...args: z.infer<z.ZodTuple<Items, null>>) => R | Promise<R>,
): void {
  const arity = schema.items.length
  ipcMain.handle(channel, async (event, ...rawArgs: unknown[]) => {
    // Normalise to the declared arity: trailing optional args may be
    // omitted by the caller, and surplus args are ignored.
    const args = Array.from({ length: arity }, (_, i) => rawArgs[i])
    const parsed = await schema.safeParseAsync(args)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where = issue?.path.length ? ` (arg ${issue.path.join('.')})` : ''
      throw new Error(`Invalid input for ${channel}${where}: ${issue?.message ?? 'validation failed'}`)
    }
    return handler(event, ...(parsed.data as z.infer<z.ZodTuple<Items, null>>))
  })
}

// ── Shared building blocks ────────────────────────────────────────────────

/** Database ids: cuid() or the legacy `wh_<ts>_<rand>` webhook ids. */
export const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'invalid id')

export const discordWebhookUrl = z
  .string()
  .trim()
  .max(512)
  .regex(
    /^https:\/\/((ptb|canary)\.)?(discord\.com|discordapp\.com)\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+\/?(\?[\w=&-]*)?$/,
    'must be a Discord webhook URL',
  )

export const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((u) => u.startsWith('https://'), 'must be an https:// URL')

/** Accepts pasted links without a scheme or with http://, stores them as https://. */
export const youtubeUrl = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v
    const s = v.trim()
    if (/^http:\/\//i.test(s)) return s.replace(/^http:\/\//i, 'https://')
    return /^[a-z]+:\/\//i.test(s) ? s : `https://${s}`
  },
  httpsUrl.refine(
    (u) => /^https:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(u),
    'must be a YouTube URL',
  ),
)

export const shortText = (max: number) => z.string().max(max)

/** Absolute local path (validated further by mediaAccess when it is read). */
export const localPath = z.string().min(1).max(1024)

/** Whitelisted fields for `user:update`; mirrors the previous ALLOWED_FIELDS set. */
export const userUpdateSchema = z
  .object({
    displayName: shortText(64),
    assessmentFreqDays: z.number().int().min(1).max(365),
    nextAssessmentAt: z.union([z.string().datetime({ offset: true }), z.date()]),
    queueFilter: shortText(64),
    mainRole: shortText(16).nullable(),
    profileIconId: z.number().int().min(0),
    autoRecord: z.boolean(),
    recordingPath: localPath.nullable(),
    externalRecordingPath: localPath.nullable(),
    recordQuality: shortText(32),
    recordFps: z.number().int().min(1).max(240),
    recordEncoder: shortText(32),
    recordScope: shortText(32),
    recordAllowCustom: z.boolean(),
    allowDesktopFallback: z.boolean(),
    recordAudioDesktop: z.boolean(),
    recordAudioDesktopDevice: shortText(256).nullable(),
    recordAudioMic: z.boolean(),
    recordAudioMicDevice: shortText(256).nullable(),
  })
  .partial()
  .strip()
