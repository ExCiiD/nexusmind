/**
 * #40: the analyst IPC channels check every input with zod before anything reaches Supabase or Riot, and every
 * AnalystApi method of the preload has its channel.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const h = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => h.handlers.set(c, fn) } }))
vi.mock('../../electron/main/cloud/analyst', () => {
  const ok = (name: string) => vi.fn(async (...args: unknown[]) => ({ called: name, args }))
  return Object.fromEntries(['teamObjectivesGames', 'teamObjectivesGameTimeline', 'draftLogList', 'draftLogSyncFromGames', 'draftLogCreate', 'draftLogUpdate',
    'draftLogDelete', 'opponentDossierGet', 'opponentDossierSave', 'opponentDossierPublish', 'opponentDossierUnpublish', 'opponentDossierRefresh'].map((n) => [n, ok(n)]))
})

import { registerAnalystHandlers } from '../../electron/main/ipc/analyst.ipc'

const G = '11111111-1111-4111-8111-111111111111'
const call = (channel: string, ...args: unknown[]) => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`no handler ${channel}`)
  return fn({} as never, ...args) as Promise<any>
}

beforeAll(() => registerAnalystHandlers())

describe('analyst IPC', () => {
  it('every channel the preload invokes is registered', () => {
    const preload = readFileSync(join(process.cwd(), 'electron/preload/index.ts'), 'utf-8')
    const channels = [...preload.matchAll(/'(analyst:[a-z-]+)'/g)].map((m) => m[1])
    expect(channels).toHaveLength(12)
    for (const c of channels) expect(h.handlers.has(c), c).toBe(true)
  })

  it('valid inputs reach the wrappers', async () => {
    expect(await call('analyst:objectives-games', G, { sources: ['scrim'], side: 'both', from: '2026-11-01' })).toMatchObject({ called: 'teamObjectivesGames' })
    expect(await call('analyst:draft-log-create', G, {
      playedAt: '2026-11-18T19:00:00Z', source: 'manual', opponentName: 'Aegis', side: 'red', win: null,
      ourPicks: [{ champion: 'Ahri', role: 'MID' }], theirPicks: [], ourBans: null, theirBans: ['Zed'],
    })).toMatchObject({ called: 'draftLogCreate' })
    expect(await call('analyst:draft-log-update', G, { notes: 'flex pick', pickOrder: null })).toMatchObject({ called: 'draftLogUpdate' })
    expect(await call('analyst:dossier-save', G, 'aegis gaming', { opponentName: 'Aegis Gaming', howTheyPlay: null, suggestedBans: ['Zed'], gamePlan: null }))
      .toMatchObject({ called: 'opponentDossierSave' })
  })

  it('refuses bad inputs before any call', async () => {
    const bad: Array<[string, unknown[]]> = [
      ['analyst:objectives-games', ['not-a-uuid', { sources: ['scrim'], side: 'both' }]],
      ['analyst:objectives-games', [G, { sources: [], side: 'both' }]],
      ['analyst:objectives-games', [G, { sources: ['ranked'], side: 'both' }]],
      ['analyst:objectives-games', [G, { sources: ['scrim'], side: 'both', extra: 1 }]],
      ['analyst:draft-log-create', [G, { playedAt: 'yesterday', source: 'manual', opponentName: null, side: 'red', win: null, ourPicks: [], theirPicks: [], ourBans: null, theirBans: null }]],
      ['analyst:draft-log-create', [G, { playedAt: '2026-11-18', source: 'manual', opponentName: null, side: 'red', win: null, ourPicks: Array(6).fill({ champion: 'Ahri', role: 'MID' }), theirPicks: [], ourBans: null, theirBans: null }]],
      ['analyst:draft-log-update', [G, { createdBy: 'someone' }]],
      ['analyst:draft-log-update', [G, { pickOrder: Array(11).fill('Ahri') }]],
      ['analyst:dossier-save', [G, 'aegis', { opponentName: 'Aegis', howTheyPlay: 'x'.repeat(601), suggestedBans: [], gamePlan: null }]],
      ['analyst:dossier-save', [G, 'aegis', { opponentName: 'Aegis', howTheyPlay: null, suggestedBans: ['a', 'b', 'c', 'd', 'e', 'f'], gamePlan: null }]],
      ['analyst:dossier-get', [G, '']],
      ['analyst:draft-log-delete', ['1; drop table']],
    ]
    for (const [channel, args] of bad) {
      await expect(call(channel, ...args), `${channel} ${JSON.stringify(args).slice(0, 80)}`).rejects.toThrow(/Invalid input/)
    }
  })
})
