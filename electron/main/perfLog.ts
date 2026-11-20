/**
 * Performance log (AUDIT_PERF_2 gain 0, 20/11/2026): with NEXUSMIND_PERF_LOG=1, the duration of every IPC handler
 * and of every Riot and Supabase call goes to `<userData>/logs/perf.log`, one tab-separated line each
 * (perfLogCore.ts). Meant to be run once by the user on their real session, to get the cloud figures.
 *
 * Off by default, and then nothing is patched: zero cost. On, it wraps `ipcMain.handle` (validatedHandle uses it
 * too) and the global `fetch` (the Riot client and supabase-js both go through it). Lines are written in batches,
 * never blocking a handler.
 */
import { app, ipcMain } from 'electron'
import { appendFile, mkdirSync } from 'fs'
import { join } from 'path'
import { formatPerfLine, labelForUrl, perfLogEnabled, type PerfKind } from './perfLogCore'

let file: string | null = null
let buffer: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let installed = false

function flush(): void {
  flushTimer = null
  if (!file || buffer.length === 0) return
  const chunk = buffer.join('')
  buffer = []
  appendFile(file, chunk, () => { /* best effort */ })
}

export function perfRecord(kind: PerfKind, label: string, ms: number, outcome: string | number): void {
  if (!file) return
  buffer.push(formatPerfLine(new Date(), kind, label, ms, outcome))
  if (!flushTimer) flushTimer = setTimeout(flush, 1_000)
}

/** Call once, before any handler is registered. Does nothing unless NEXUSMIND_PERF_LOG=1. */
export function installPerfLog(): boolean {
  if (installed || !perfLogEnabled()) return false
  installed = true
  const dir = join(app.getPath('userData'), 'logs')
  try { mkdirSync(dir, { recursive: true }) } catch { /* appendFile reports nothing either */ }
  file = join(dir, 'perf.log')
  perfRecord('ipc', '(perf log started)', 0, process.pid)

  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((channel: string, listener: (...args: any[]) => unknown) => handle(channel, async (...args: any[]) => {
    const t0 = performance.now()
    try {
      const out = await listener(...args)
      perfRecord('ipc', channel, performance.now() - t0, 'ok')
      return out
    } catch (err) {
      perfRecord('ipc', channel, performance.now() - t0, 'error')
      throw err
    }
  })) as typeof ipcMain.handle

  const baseFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input)
    const { kind, label } = labelForUrl(url, init?.method ?? input?.method ?? 'GET')
    const t0 = performance.now()
    try {
      const res = await baseFetch(input, init)
      perfRecord(kind, label, performance.now() - t0, res.status)
      return res
    } catch (err) {
      perfRecord(kind, label, performance.now() - t0, 'error')
      throw err
    }
  }) as typeof fetch

  app.on('before-quit', flush)
  console.log(`[perf] logging to ${file}`)
  return true
}
