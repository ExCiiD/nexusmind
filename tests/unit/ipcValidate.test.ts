import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}))

import {
  validatedHandle,
  id,
  discordWebhookUrl,
  youtubeUrl,
  httpsUrl,
  userUpdateSchema,
} from '../../electron/main/ipc/validate'

const fakeEvent = {}

beforeEach(() => handlers.clear())

describe('validatedHandle', () => {
  it('passes parsed args to the handler', async () => {
    validatedHandle('t:ok', z.tuple([id, z.number()]), (_e, a, b) => `${a}:${b}`)
    expect(await handlers.get('t:ok')!(fakeEvent, 'abc123', 4)).toBe('abc123:4')
  })

  it('rejects invalid args with a readable error', async () => {
    validatedHandle('t:bad', z.tuple([id]), () => 'never')
    await expect(handlers.get('t:bad')!(fakeEvent, '../../etc')).rejects.toThrow(/Invalid input for t:bad/)
  })

  it('pads omitted trailing optional args and ignores surplus ones', async () => {
    validatedHandle('t:opt', z.tuple([id, z.string().optional()]), (_e, a, b) => [a, b])
    expect(await handlers.get('t:opt')!(fakeEvent, 'x1')).toEqual(['x1', undefined])
    expect(await handlers.get('t:opt')!(fakeEvent, 'x1', 'y', 'extra')).toEqual(['x1', 'y'])
  })
})

describe('schemas', () => {
  it('accepts real Discord webhooks only', () => {
    expect(discordWebhookUrl.safeParse('https://discord.com/api/webhooks/123/abc-DEF_1').success).toBe(true)
    expect(discordWebhookUrl.safeParse('https://ptb.discord.com/api/v10/webhooks/123/abc?thread_id=9').success).toBe(true)
    expect(discordWebhookUrl.safeParse('https://evil.com/api/webhooks/123/abc').success).toBe(false)
    expect(discordWebhookUrl.safeParse('https://discord.com.evil.com/api/webhooks/1/a').success).toBe(false)
  })

  it('normalises YouTube links and rejects other hosts', () => {
    expect(youtubeUrl.parse('youtu.be/abc')).toBe('https://youtu.be/abc')
    expect(youtubeUrl.parse('http://www.youtube.com/watch?v=1')).toBe('https://www.youtube.com/watch?v=1')
    expect(youtubeUrl.safeParse('javascript:alert(1)').success).toBe(false)
    expect(youtubeUrl.safeParse('https://evil.com/watch').success).toBe(false)
  })

  it('requires https for generic URLs', () => {
    expect(httpsUrl.safeParse('https://litter.catbox.moe/x.mp4').success).toBe(true)
    expect(httpsUrl.safeParse('http://litter.catbox.moe/x.mp4').success).toBe(false)
  })

  it('strips unknown user fields and type-checks known ones', () => {
    expect(userUpdateSchema.parse({ autoRecord: true, puuid: 'hijack', isActive: false })).toEqual({ autoRecord: true })
    expect(userUpdateSchema.safeParse({ recordFps: 'sixty' }).success).toBe(false)
  })
})
