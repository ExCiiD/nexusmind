/**
 * Integration: post-game automation (lot 3) through the real IPC handlers
 * on a throw-away SQLite database — MX2 (mistake auto-detect on prefetch),
 * MX5 (auto-bookmark severity-3 mistakes), R1 (pre-filled review notes),
 * R4 (priority game to review), S3 (session auto-close).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-postgame-'))
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
import { registerStatsHandlers, prefetchGameAnalysis } from '../../electron/main/ipc/stats.ipc'
import { registerAssistantHandlers } from '../../electron/main/assistant/assistant.ipc'
import { autoCloseIdleSessions, IDLE_MINUTES } from '../../electron/main/sessionAutoClose'

const invoke = (channel: string, ...args: unknown[]) => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return fn({}, ...args) as Promise<any>
}

const MIN = 60_000
const PLAYER_PUUID = 'puuid-postgame'

const baseMatch = {
  info: {
    participants: [
      { participantId: 1, puuid: PLAYER_PUUID, championName: 'Renekton', teamId: 100 },
      { participantId: 2, puuid: 'jg-blue', championName: 'Vi', teamId: 100 },
      { participantId: 6, puuid: 'top-red', championName: 'Olaf', teamId: 200 },
    ],
  },
}

/** A timeline with one early death where the player had > 2500g unspent (severity-3 unused-gold). */
function severeDeathTimeline(): any {
  const frames: any[] = []
  for (let i = 0; i < 3; i++) {
    const participantFrames: Record<string, any> = {}
    for (let pid = 1; pid <= 10; pid++) participantFrames[String(pid)] = { currentGold: pid === 1 ? 3000 : 0 }
    frames.push({
      timestamp: i * 60_000,
      participantFrames,
      events: i === 2 ? [{ type: 'CHAMPION_KILL', timestamp: 125_000, killerId: 6, victimId: 1 }] : [],
    })
  }
  return { info: { frames } }
}

let userId = ''
let sessionId = ''

beforeAll(async () => {
  await initDatabase()
  registerStatsHandlers()
  registerAssistantHandlers()
  const prisma = getPrisma()
  const user = await prisma.user.create({
    data: { summonerName: 'PostGame', displayName: 'PG', puuid: PLAYER_PUUID, region: 'EUW1', nextAssessmentAt: new Date() },
  })
  userId = user.id
  const session = await prisma.session.create({
    data: { userId: user.id, objectiveId: 'tempo', objectiveIds: '["tempo"]', status: 'active' },
  })
  sessionId = session.id
})

afterAll(async () => {
  await closeDatabase()
  rmSync(h.root, { recursive: true, force: true })
})

describe('MX2 + MX5 — prefetchGameAnalysis', () => {
  it('auto-detects mistakes and auto-bookmarks severity-3 ones with a linked, trustworthy recording', async () => {
    const prisma = getPrisma()
    const game = await prisma.game.create({
      data: {
        sessionId, matchId: 'EUW1_POSTGAME1', champion: 'Renekton', role: 'TOP',
        kills: 1, deaths: 3, assists: 2, cs: 150, visionScore: 10, duration: 1800, win: false,
        gameEndAt: new Date(),
      },
    })
    await prisma.matchCache.create({ data: { matchId: 'EUW1_POSTGAME1', matchJson: JSON.stringify(baseMatch), timelineJson: JSON.stringify(severeDeathTimeline()) } })
    const recording = await prisma.recording.create({ data: { gameId: game.id, filePath: 'C:/fake/rec.mp4', startOffsetSec: 5 } })

    console.log('DEBUG game', game.id, game.matchId)
    console.log('DEBUG cache', await prisma.matchCache.findUnique({ where: { matchId: game.matchId } }))
    console.log('DEBUG user', await prisma.user.findFirst({ where: { isActive: true } }))
    await prefetchGameAnalysis(game.id)

    const mistakes = await prisma.mistake.findMany({ where: { gameId: game.id } })
    expect(mistakes.some((m) => m.severity === 3 && m.autoDetected)).toBe(true)

    const bookmarks = await prisma.bookmark.findMany({ where: { recordingId: recording.id } })
    expect(bookmarks).toHaveLength(1)
    expect(bookmarks[0].videoTimeMs).toBe(Math.max(0, (125 - 5) * 1000 - 15_000))
    expect(bookmarks[0].label).toMatch(/gold/i)

    // Re-running must not duplicate either the mistake or the bookmark.
    await prefetchGameAnalysis(game.id)
    expect(await prisma.mistake.count({ where: { gameId: game.id } })).toBe(mistakes.length)
    expect(await prisma.bookmark.count({ where: { recordingId: recording.id } })).toBe(1)
  })

  it('creates no bookmark without a linked recording, or without a plausible offset', async () => {
    const prisma = getPrisma()
    const noRecording = await prisma.game.create({
      data: { sessionId, matchId: 'EUW1_POSTGAME2', champion: 'Renekton', role: 'TOP', kills: 1, deaths: 3, assists: 2, cs: 150, visionScore: 10, duration: 1800, win: false, gameEndAt: new Date() },
    })
    await prisma.matchCache.create({ data: { matchId: 'EUW1_POSTGAME2', matchJson: JSON.stringify(baseMatch), timelineJson: JSON.stringify(severeDeathTimeline()) } })
    await prefetchGameAnalysis(noRecording.id)
    expect(await prisma.bookmark.count()).toBe(1) // only the one from the previous test

    const badOffset = await prisma.game.create({
      data: { sessionId, matchId: 'EUW1_POSTGAME3', champion: 'Renekton', role: 'TOP', kills: 1, deaths: 3, assists: 2, cs: 150, visionScore: 10, duration: 1800, win: false, gameEndAt: new Date() },
    })
    await prisma.matchCache.create({ data: { matchId: 'EUW1_POSTGAME3', matchJson: JSON.stringify(baseMatch), timelineJson: JSON.stringify(severeDeathTimeline()) } })
    await prisma.recording.create({ data: { gameId: badOffset.id, filePath: 'C:/fake/rec2.mp4', startOffsetSec: 9999 } })
    await prefetchGameAnalysis(badOffset.id)
    expect(await prisma.bookmark.count()).toBe(1)
  })
})

describe('R1 — review:prefilled-notes', () => {
  it('builds draft notes from the game\'s own events and severity-3 mistakes', async () => {
    const notes = await invoke('review:prefilled-notes', (await getPrisma().game.findFirstOrThrow({ where: { matchId: 'EUW1_POSTGAME1' } })).id)
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.every((n: any) => n.auto === true)).toBe(true)
    expect(notes.some((n: any) => /gold/i.test(n.note))).toBe(true)
  })

  it('returns [] when the timeline cannot be loaded', async () => {
    const prisma = getPrisma()
    const noCache = await prisma.game.create({
      data: { sessionId, matchId: 'EUW1_NOCACHE', champion: 'Renekton', role: 'TOP', kills: 1, deaths: 3, assists: 2, cs: 150, visionScore: 10, duration: 1800, win: false, gameEndAt: new Date() },
    })
    expect(await invoke('review:prefilled-notes', noCache.id)).toEqual([])
  })
})

describe('R4 — review:priority-game', () => {
  it('picks an unreviewed game and reports the backlog size', async () => {
    const result = await invoke('review:priority-game')
    expect(result).not.toBeNull()
    expect(result.backlogCount).toBeGreaterThanOrEqual(1)
    expect(['close_loss', 'severe_mistakes', 'deviation', 'recency']).toContain(result.reason)
  })

  it('returns null once every game is reviewed', async () => {
    const prisma = getPrisma()
    const games = await prisma.game.findMany({ where: { sessionId } })
    for (const g of games) {
      await prisma.review.upsert({
        where: { gameId: g.id },
        create: { gameId: g.id, timelineNotes: '[]', kpiScores: '{}', objectiveRespected: true },
        update: {},
      })
    }
    expect(await invoke('review:priority-game')).toBeNull()
  })
})

describe('S3 — autoCloseIdleSessions', () => {
  it('closes a session whose last game ended ≥ 45 minutes ago, with a pre-filled conclusion', async () => {
    const prisma = getPrisma()
    const idleSession = await prisma.session.create({
      data: { userId, objectiveId: 'tempo', objectiveIds: '["tempo"]', status: 'active', date: new Date(Date.now() - 200 * MIN) },
    })
    await prisma.game.create({
      data: {
        sessionId: idleSession.id, matchId: 'EUW1_IDLE1', champion: 'Renekton', role: 'TOP',
        kills: 5, deaths: 2, assists: 3, cs: 200, visionScore: 15, duration: 1800, win: true,
        gameEndAt: new Date(Date.now() - (IDLE_MINUTES + 1) * MIN),
      },
    })
    const closed = await autoCloseIdleSessions()
    expect(closed).toBe(1)
    const updated = await prisma.session.findUniqueOrThrow({ where: { id: idleSession.id } })
    expect(updated.status).toBe('completed')
    expect(updated.sessionConclusion).toMatch(/automatically/i)
    expect(updated.sessionConclusion).toMatch(/1 game/)
  })

  it('leaves a session active while within the idle window, and never touches a session with no games yet', async () => {
    const prisma = getPrisma()
    const recent = await prisma.session.create({
      data: { userId, objectiveId: 'tempo', objectiveIds: '["tempo"]', status: 'active', date: new Date(Date.now() - 200 * MIN) },
    })
    await prisma.game.create({
      data: {
        sessionId: recent.id, matchId: 'EUW1_IDLE2', champion: 'Renekton', role: 'TOP',
        kills: 5, deaths: 2, assists: 3, cs: 200, visionScore: 15, duration: 1800, win: true,
        gameEndAt: new Date(Date.now() - (IDLE_MINUTES - 5) * MIN),
      },
    })
    const freshNoGames = await prisma.session.create({
      data: { userId, objectiveId: 'tempo', objectiveIds: '["tempo"]', status: 'active', date: new Date() },
    })
    await autoCloseIdleSessions()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: recent.id } })).status).toBe('active')
    expect((await prisma.session.findUniqueOrThrow({ where: { id: freshNoGames.id } })).status).toBe('active')
  })
})
