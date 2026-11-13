/**
 * Integration: the experiment lifecycle (closed loop) through the IPC
 * handlers, on a throw-away SQLite database with every migration applied.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-coach-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root, handlers: new Map<string, (...args: unknown[]) => unknown>() }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '0.0.0-test' },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn), on: () => {} },
  dialog: { showOpenDialog: vi.fn(), showErrorBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false },
}))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { registerAssistantHandlers, GRADUATED_BADGE } from '../../electron/main/assistant/assistant.ipc'

const invoke = (channel: string, ...args: unknown[]) => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return fn({}, ...args) as Promise<any>
}

const MIN = 60_000
let sessionId = ''
let seq = 0

/** A 30-min mid game ending at `endedAt` with `cs` creeps (cs / 30 = CS/min). */
async function addGame(endedAt: number, cs: number) {
  seq++
  return getPrisma().game.create({
    data: {
      sessionId, matchId: `EUW1_C${seq}`, champion: 'Ahri', role: 'MIDDLE',
      kills: 3, deaths: 4, assists: 5, cs, visionScore: 20, duration: 1800,
      win: seq % 2 === 0, gameEndAt: new Date(endedAt),
    },
  })
}

beforeAll(async () => {
  await initDatabase()
  registerAssistantHandlers()
  const prisma = getPrisma()
  const user = await prisma.user.create({
    data: { summonerName: 'Coachee', displayName: 'Ari', puuid: 'puuid-coach', region: 'EUW1', nextAssessmentAt: new Date() },
  })
  const now = Date.now()
  // The live session works on farming; it started 5 h ago.
  const s = await prisma.session.create({
    data: { userId: user.id, objectiveId: 'csing_pathing', objectiveIds: '["csing_pathing"]', status: 'active', date: new Date(now - 300 * MIN) },
  })
  sessionId = s.id
  // Baseline: 6 games at 5 CS/min before the session…
  for (let i = 0; i < 6; i++) await addGame(now - (2000 + i * 40) * MIN, 150)
  // …then 2 games at 7 CS/min in the session.
  await addGame(now - 200 * MIN, 210)
  await addGame(now - 150 * MIN, 210)
})

afterAll(async () => {
  await closeDatabase()
  rmSync(h.root, { recursive: true, force: true })
})

describe('coaching experiments (IPC)', () => {
  it('starts automatically from the session objective, with a criterion based on the games before it', async () => {
    const state = await invoke('coach:experiments')
    expect(state.active).toMatchObject({
      problemId: 'farming',
      fundamentalId: 'csing_pathing',
      source: 'session',
      status: 'active',
      criterion: { kind: 'metric', metric: 'csPerMin', op: '>=', target: 5.5 },
      baseline: { mean: 5, games: 6 },
    })
    expect(state.active.progress).toMatchObject({ counted: 2, passes: 2, done: false })
  })

  it('R2: says whether a game met the criterion', async () => {
    const [g] = await getPrisma().game.findMany({ orderBy: { gameEndAt: 'desc' }, take: 1 })
    expect(await invoke('coach:objective-check', g.id)).toMatchObject({ problemId: 'farming', passed: true, value: 7 })
    const [old] = await getPrisma().game.findMany({ orderBy: { gameEndAt: 'asc' }, take: 1 })
    expect(await invoke('coach:objective-check', old.id)).toBeNull()
  })

  it('the report carries the experiment', async () => {
    const report = await invoke('assistant:get-report', 'session')
    expect(report.experiment?.problemId).toBe('farming')
  })

  it('gives a verdict once the window is full, and does not restart in the same session', async () => {
    const now = Date.now()
    for (const ago of [120, 90, 60]) await addGame(now - ago * MIN, 200)
    const state = await invoke('coach:experiments')
    expect(state.active).toBeNull()
    expect(state.recent).toMatchObject({ status: 'done', verdict: 'acquired', progress: { counted: 5, passes: 5, passRate: 1 } })
    expect(state.recent.graduated).toBe(false)
    expect((await invoke('coach:experiments')).active).toBeNull()
  })

  it('two acquired verdicts in a row graduate the fundamental and unlock the badge', async () => {
    const started = await invoke('coach:start-experiment', 'farming', null, 'cs10_low')
    expect(started).toMatchObject({ status: 'active', source: 'assistant', problemId: 'farming' })
    const t0 = Date.now()
    for (let i = 1; i <= 5; i++) await addGame(t0 + i * 1000, 240)
    const state = await invoke('coach:experiments')
    expect(state.recent).toMatchObject({ verdict: 'acquired', graduated: true })
    expect(state.recent.nextObjectiveId).toBeTruthy()
    expect(state.graduated).toContain('csing_pathing')
    const user = await getPrisma().user.findFirstOrThrow()
    expect(await getPrisma().badge.count({ where: { userId: user.id, badgeId: GRADUATED_BADGE } })).toBe(1)
  })

  it('one experiment at a time; abandon; validation', async () => {
    const a = await invoke('coach:start-experiment', 'deaths', null, null)
    const b = await invoke('coach:start-experiment', 'vision', null, 'vision_drop')
    const rows = await getPrisma().coachingExperiment.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(rows.find((r) => r.id === a.id)?.status).toBe('abandoned')
    expect(rows.find((r) => r.id === b.id)?.status).toBe('active')
    expect(a.source).toBe('player')
    await invoke('coach:abandon-experiment', b.id)
    expect((await getPrisma().coachingExperiment.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('abandoned')

    await expect(invoke('coach:start-experiment', 'not-a-problem', null, null)).rejects.toThrow(/unknown problem/)
    await expect(invoke('coach:start-experiment', 'review-habit', null, null)).rejects.toThrow(/NOT_MEASURABLE/)
    await expect(invoke('coach:start-experiment', 'farming', 'Bad Tag!', null)).rejects.toThrow(/Invalid input/)
  })
})
