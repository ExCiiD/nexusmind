/**
 * T (History page): recording:game-ids-with-recording answers, in one query, which games have a recording.
 * On a throw-away SQLite database with every migration applied.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-recids-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root, handlers: new Map<string, (...args: unknown[]) => unknown>() }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '0.0.0-test', on: () => {} },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn), on: () => {} },
  dialog: {},
  shell: {},
  screen: { getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 }, scaleFactor: 1 }) },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
}))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { registerRecordingHandlers } from '../../electron/main/ipc/recording.ipc'

const call = (channel: string, ...args: unknown[]) => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`no handler ${channel}`)
  return fn({} as never, ...args) as Promise<any>
}

const games: string[] = []

beforeAll(async () => {
  await initDatabase()
  registerRecordingHandlers()
  const prisma = getPrisma()
  const user = await prisma.user.create({ data: { summonerName: 'R', puuid: 'p-rec', region: 'EUW1', nextAssessmentAt: new Date() } })
  const session = await prisma.session.create({ data: { userId: user.id, objectiveId: 'x' } })
  for (let i = 0; i < 3; i++) {
    const g = await prisma.game.create({ data: { sessionId: session.id, matchId: `EUW1_REC${i}`, champion: 'Ahri', role: 'MID', kills: 0, deaths: 0, assists: 0, cs: 0, visionScore: 0, duration: 1, win: true, gameEndAt: new Date() } })
    games.push(g.id)
  }
  await prisma.recording.create({ data: { gameId: games[0], filePath: 'C:/fake/a.mp4' } })
  await prisma.recording.create({ data: { gameId: games[2], filePath: 'C:/fake/c.mp4' } })
  await prisma.recording.create({ data: { gameId: null, filePath: 'C:/fake/orphan.mp4' } })
}, 60_000)

afterAll(async () => {
  await closeDatabase()
  try { rmSync(h.root, { recursive: true, force: true }) } catch { /* Windows file lock */ }
})

describe('recording:game-ids-with-recording', () => {
  it('returns only the asked games that have a recording', async () => {
    expect((await call('recording:game-ids-with-recording', [...games, 'unknown-id'])).sort()).toEqual([games[0], games[2]].sort())
    expect(await call('recording:game-ids-with-recording', [games[1]])).toEqual([])
    expect(await call('recording:game-ids-with-recording', [])).toEqual([])
  })

  it('validates its input', async () => {
    await expect(call('recording:game-ids-with-recording', 'not-an-array')).rejects.toThrow(/Invalid input/)
    await expect(call('recording:game-ids-with-recording', ['bad id!'])).rejects.toThrow(/Invalid input/)
    await expect(call('recording:game-ids-with-recording', Array.from({ length: 1001 }, (_, i) => `g${i}`))).rejects.toThrow(/Invalid input/)
  })
})
