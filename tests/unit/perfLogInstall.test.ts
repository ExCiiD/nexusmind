/** AUDIT_PERF_2 gain 0: with NEXUSMIND_PERF_LOG=1, IPC handlers and fetch calls are timed into perf.log. */
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const h = vi.hoisted(() => ({ dir: '', handlers: new Map<string, (...a: any[]) => any>(), quit: [] as Array<() => void> }))
vi.mock('electron', () => ({
  app: { getPath: () => h.dir, on: (ev: string, fn: () => void) => { if (ev === 'before-quit') h.quit.push(fn) } },
  ipcMain: { handle: (channel: string, fn: (...a: any[]) => any) => { h.handlers.set(channel, fn) } },
}))

describe('perf log', () => {
  it('off by default: nothing is patched', async () => {
    delete process.env.NEXUSMIND_PERF_LOG
    vi.resetModules()
    const { ipcMain } = await import('electron')
    const before = ipcMain.handle
    const { installPerfLog } = await import('../../electron/main/perfLog')
    expect(installPerfLog()).toBe(false)
    expect(ipcMain.handle).toBe(before)
  })

  it('on: times handlers (errors too) and fetch calls, without ids, into userData/logs/perf.log', async () => {
    h.dir = mkdtempSync(join(tmpdir(), 'perflog-'))
    process.env.NEXUSMIND_PERF_LOG = '1'
    vi.resetModules()
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('[]', { status: 200 })) as typeof fetch
    try {
      const { ipcMain } = await import('electron')
      const { installPerfLog } = await import('../../electron/main/perfLog')
      expect(installPerfLog()).toBe(true)
      ipcMain.handle('stats:match-history', async () => 'ok')
      ipcMain.handle('boom', async () => { throw new Error('x') })
      expect(await h.handlers.get('stats:match-history')!()).toBe('ok')
      await expect(h.handlers.get('boom')!()).rejects.toThrow('x')
      await fetch('https://zwubyzrfpelhxjjezvrh.supabase.co/rest/v1/notifications?user_id=eq.secret-id')
      h.quit.forEach((fn) => fn())
      const file = join(h.dir, 'logs', 'perf.log')
      for (let i = 0; i < 50 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
      const log = readFileSync(file, 'utf-8')
      expect(log).toMatch(/\tipc\tstats:match-history\t\d+\tok\n/)
      expect(log).toMatch(/\tipc\tboom\t\d+\terror\n/)
      expect(log).toMatch(/\tsupabase\tGET \/rest\/v1\/notifications\t\d+\t200\n/)
      expect(log).not.toContain('secret-id')
    } finally {
      globalThis.fetch = realFetch
      delete process.env.NEXUSMIND_PERF_LOG
    }
  })
})
