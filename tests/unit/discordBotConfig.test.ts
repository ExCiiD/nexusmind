/**
 * Health check of 28/11/2026: the bot's 100 exceptions (18-19/11) were cron runs without the Worker's secrets.
 * A missing secret or an unreachable Supabase must now be logged by name, never thrown.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ listGuilds: vi.fn(), adminClient: vi.fn(() => ({})) }))
vi.mock('../../cloudflare/discord-bot/src/supabaseAdmin', () => ({ adminClient: h.adminClient }))
vi.mock('../../src/lib/discordBotCore', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/discordBotCore')>()),
  listGuildsWithNotifyChannel: h.listGuilds,
  listPendingDirectNotifications: vi.fn(async () => []),
}))

import { missingConfig } from '../../cloudflare/discord-bot/src/config'

// Loaded by a non-literal path: the Worker's own types (ScheduledEvent, BufferSource of workers-types) stay out of
// the tests' TypeScript program, the module itself runs as usual.
const WORKER = '../../cloudflare/discord-bot/src/index'
let worker: { fetch: (req: Request, env: any) => Promise<Response>; scheduled: (e: unknown, env: any) => Promise<void> }
beforeAll(async () => { worker = (await import(/* @vite-ignore */ WORKER)).default })

const fullEnv = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', DISCORD_PUBLIC_KEY: 'p', DISCORD_BOT_TOKEN: 't' }

beforeEach(() => { h.listGuilds.mockReset(); h.adminClient.mockClear() })

describe('discord bot configuration', () => {
  it('names the missing or empty secrets', () => {
    expect(missingConfig(fullEnv)).toEqual([])
    expect(missingConfig({ ...fullEnv, SUPABASE_SERVICE_ROLE_KEY: undefined, DISCORD_BOT_TOKEN: ' ' })).toEqual(['SUPABASE_SERVICE_ROLE_KEY', 'DISCORD_BOT_TOKEN'])
  })

  it('a cron run without its secrets logs them and does not throw (the 18-19/11 failure)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(worker.scheduled({}, { ...fullEnv, SUPABASE_SERVICE_ROLE_KEY: '' } as any)).resolves.toBeUndefined()
    expect(h.adminClient).not.toHaveBeenCalled()
    expect(err.mock.calls[0].join(' ')).toContain('SUPABASE_SERVICE_ROLE_KEY')
    err.mockRestore()
  })

  it('a cron run with Supabase unreachable logs and does not throw', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    h.listGuilds.mockRejectedValue(new Error('fetch failed'))
    await expect(worker.scheduled({}, fullEnv as any)).resolves.toBeUndefined()
    expect(err.mock.calls.some((c) => c.join(' ').includes('fetch failed'))).toBe(true)
    err.mockRestore()
  })

  it('an interaction without the configuration answers 503 instead of throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await worker.fetch(new Request('https://bot.example/', { method: 'POST', body: '{}' }), { ...fullEnv, DISCORD_PUBLIC_KEY: '' } as any)
    expect(res.status).toBe(503)
    err.mockRestore()
  })
})
