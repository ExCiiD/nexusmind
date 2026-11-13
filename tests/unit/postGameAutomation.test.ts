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
import { registerMistakeHandlers } from '../../electron/main/ipc/mistakes.ipc'
import { autoCloseIdleSessions, IDLE_MINUTES } from '../../electron/main/sessionAutoClose'
import { DELETIONS_TO_LEARN } from '../../electron/main/mistakeTuning'

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
  registerMistakeHandlers()
  const prisma = getPrisma()
  const user = await prisma.user.create({
    data: { summonerName: 'PostGame', displayName: 'PG', puuid: PLAYER_PUUID, region: 'EUW1', nextAssessmentAt: new Date() },
  })
  userId = user.id
  const session = await prisma.session.create({
    data: { userId: user.id, objectiveId: 'tempo', objectiveIds: '["tempo"]', status: 'active' },
  })
  sessionId = session.id
  // autoDetectMistakesSilently only persists a candidate whose tag exists —
  // normally seeded by seedBuiltInMistakeTags() at app startup.
  await prisma.mistakeTag.create({ data: { slug: 'unused-gold', label: 'Unused gold', category: 'economy' } })
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

  it('returns [] when the game has no matchId yet (never hits the network)', async () => {
    const prisma = getPrisma()
    const noMatchId = await prisma.game.create({
      data: { sessionId, matchId: '', champion: 'Renekton', role: 'TOP', kills: 1, deaths: 3, assists: 2, cs: 150, visionScore: 10, duration: 1800, win: false, gameEndAt: new Date() },
    })
    expect(await invoke('review:prefilled-notes', noMatchId.id)).toEqual([])
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

describe('MX3 — learned severity threshold', () => {
  async function newSevereGoldGame(matchId: string) {
    const prisma = getPrisma()
    const game = await prisma.game.create({
      data: { sessionId, matchId, champion: 'Renekton', role: 'TOP', kills: 1, deaths: 3, assists: 2, cs: 150, visionScore: 10, duration: 1800, win: false, gameEndAt: new Date() },
    })
    await prisma.matchCache.create({ data: { matchId, matchJson: JSON.stringify(baseMatch), timelineJson: JSON.stringify(severeDeathTimeline()) } })
    await prefetchGameAnalysis(game.id)
    const mistake = await prisma.mistake.findFirstOrThrow({ where: { gameId: game.id, tag: { slug: 'unused-gold' } } })
    return { game, mistake }
  }

  it(`lowers severity by 1 after ${DELETIONS_TO_LEARN} deletions of the same auto-detected tag, never before`, async () => {
    const prisma = getPrisma()
    for (let i = 0; i < DELETIONS_TO_LEARN; i++) {
      const { mistake } = await newSevereGoldGame(`EUW1_MX3_${i}`)
      expect(mistake.severity).toBe(3) // not learned yet
      await invoke('mistake:delete', mistake.id)
    }
    const user = await prisma.user.findFirstOrThrow()
    const tag = await prisma.mistakeTag.findUniqueOrThrow({ where: { slug: 'unused-gold' } })
    const tuning = await prisma.mistakeTagTuning.findUniqueOrThrow({ where: { userId_tagId: { userId: user.id, tagId: tag.id } } })
    expect(tuning).toMatchObject({ deletedCount: DELETIONS_TO_LEARN, severityDelta: -1 })

    const { mistake: learned } = await newSevereGoldGame('EUW1_MX3_learned')
    expect(learned.severity).toBe(2) // 3 (base) - 1 (learned)
  })

  it('never lowers severity for a manually-created mistake, and leaves other tags untouched', async () => {
    const prisma = getPrisma()
    const { game } = await newSevereGoldGame('EUW1_MX3_manual')
    const manual = await prisma.mistake.create({
      data: { gameId: game.id, tagId: (await prisma.mistakeTag.findUniqueOrThrow({ where: { slug: 'unused-gold' } })).id, gameTimeSec: 500, severity: 3, autoDetected: false },
    })
    await invoke('mistake:delete', manual.id)
    const user = await prisma.user.findFirstOrThrow()
    const tag = await prisma.mistakeTag.findUniqueOrThrow({ where: { slug: 'unused-gold' } })
    // The learned tuning from the previous test is untouched by this manual deletion.
    const tuning = await prisma.mistakeTagTuning.findUnique({ where: { userId_tagId: { userId: user.id, tagId: tag.id } } })
    expect(tuning?.deletedCount).toBe(DELETIONS_TO_LEARN)
  })
})

describe('lot 5 — Mon plan endpoints', () => {
  it('coach:games-by-ids returns minimal fields, in the order requested, skipping unknown ids', async () => {
    const prisma = getPrisma()
    const g1 = await prisma.game.create({
      data: { sessionId, matchId: 'EUW1_PLAN1', champion: 'Ahri', role: 'MIDDLE', kills: 5, deaths: 2, assists: 6, cs: 220, visionScore: 25, duration: 1800, win: true, gameEndAt: new Date(1_000_000) },
    })
    const g2 = await prisma.game.create({
      data: { sessionId, matchId: 'EUW1_PLAN2', champion: 'Zed', role: 'MIDDLE', kills: 1, deaths: 7, assists: 1, cs: 120, visionScore: 8, duration: 1800, win: false, gameEndAt: new Date(2_000_000) },
    })
    await prisma.review.create({ data: { gameId: g1.id, timelineNotes: '[]', kpiScores: '{}', objectiveRespected: true } })

    const rows = await invoke('coach:games-by-ids', [g2.id, 'not-a-real-id', g1.id])
    expect(rows).toEqual([
      { id: g2.id, champion: 'Zed', win: false, endedAt: 2_000_000, reviewed: false },
      { id: g1.id, champion: 'Ahri', win: true, endedAt: 1_000_000, reviewed: true },
    ])
    expect(await invoke('coach:games-by-ids', [])).toEqual([])
  })

  it('coach:suggested-scores and coach:reassessment-check read the same latest assessment', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirstOrThrow()
    // 10 games, pushed well into the future so they are unambiguously the
    // newest (other describe blocks in this shared DB also create games
    // "now"): 5 baseline at a normal CS/min, then 5 recent at a clearly
    // higher one → a confidently positive z on csPerMin.
    const future = Date.now() + 365 * 86_400_000
    for (let i = 0; i < 10; i++) {
      await prisma.game.create({
        data: { sessionId, matchId: `EUW1_PLANCS${i}`, champion: 'Ahri', role: 'MIDDLE', kills: 4, deaths: 3, assists: 4, cs: i < 5 ? 150 : 300, visionScore: 20, duration: 1800, win: true, gameEndAt: new Date(future + i * 60_000) },
      })
    }
    await prisma.assessment.create({
      data: { userId: user.id, scores: { create: [{ fundamentalId: 'csing_pathing', score: 3 }] } },
    })

    const suggestions = await invoke('coach:suggested-scores')
    const cs = suggestions.find((s: any) => s.fundamentalId === 'csing_pathing')
    expect(cs).toBeDefined()
    expect(cs.previousScore).toBe(3)
    expect(cs.score).toBeGreaterThan(3)

    const check = await invoke('coach:reassessment-check')
    expect(check.gaps.some((g: any) => g.fundamentalId === 'csing_pathing')).toBe(true)
  })
})
