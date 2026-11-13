/**
 * Integration: assistant IPC handlers on a throw-away SQLite database with
 * every migration applied (incl. AssistantFeedback), Electron faked.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-assistant-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root, handlers: new Map<string, (...args: unknown[]) => unknown>() }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => join(h.root, 'userData'),
    getAppPath: () => process.cwd(),
    getVersion: () => '0.0.0-test',
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn),
    on: () => {},
  },
  dialog: { showOpenDialog: vi.fn(), showErrorBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false },
}))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { registerAssistantHandlers } from '../../electron/main/assistant/assistant.ipc'

const invoke = (channel: string, ...args: unknown[]) => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return fn({}, ...args) as Promise<any>
}

const timelineWithEarlyDeaths = (pid: number) => JSON.stringify({
  info: { frames: [{ events: [
    { type: 'CHAMPION_KILL', victimId: pid, timestamp: 180_000 },
    { type: 'CHAMPION_KILL', victimId: pid, timestamp: 420_000 },
  ] }] },
})

beforeAll(async () => {
  await initDatabase()
  registerAssistantHandlers()
  const prisma = getPrisma()
  const user = await prisma.user.create({
    data: { summonerName: 'Tester', displayName: 'Ari', puuid: 'puuid-me', region: 'EUW1', nextAssessmentAt: new Date() },
  })
  const session = await prisma.session.create({
    data: { userId: user.id, objectiveId: 'trades', objectiveIds: '["trades"]', status: 'active' },
  })
  const tag = await prisma.mistakeTag.create({ data: { slug: 'overstay-test', label: 'Overstay', category: 'macro' } })
  const now = Date.now()
  for (let i = 0; i < 6; i++) {
    const matchId = `EUW1_A${i}`
    const game = await prisma.game.create({
      data: {
        sessionId: session.id, matchId, champion: 'Ahri', role: 'MIDDLE',
        kills: 2, deaths: 6, assists: 3, cs: 180, visionScore: 18, duration: 1800,
        win: false, gameEndAt: new Date(now - (i * 40 + 5) * 60_000),
      },
    })
    await prisma.matchCache.create({
      data: {
        matchId,
        matchJson: JSON.stringify({ info: { participants: [
          { participantId: 3, puuid: 'puuid-me', championName: 'Ahri', teamId: 100, kills: 2, assists: 3 },
          { participantId: 4, puuid: 'ally', championName: 'Lee', teamId: 100, kills: 8, assists: 1 },
        ] } }),
        timelineJson: timelineWithEarlyDeaths(3),
      },
    })
    if (i < 3) await prisma.mistake.create({ data: { gameId: game.id, tagId: tag.id, gameTimeSec: 500 + i } })
  }
}, 60_000)

afterAll(async () => {
  await closeDatabase()
  try { rmSync(h.root, { recursive: true, force: true }) } catch { /* Windows may hold the file */ }
})

describe('assistant IPC', () => {
  it('builds a session brief from DB rows and cached timelines', async () => {
    const r = await invoke('assistant:get-report', 'session', null)
    expect(r.moment).toBe('session')
    expect(r.basisGames).toBe(6)
    expect(r.intro.params.name).toBe('Ari')
    const ids = r.insights.map((i: any) => i.ruleId)
    // 6 straight losses over ~4 h of continuous play → tilt first.
    expect(ids[0]).toBe('tilt_break')
    expect(ids).toContain('early_deaths_pattern')
    const early = r.insights.find((i: any) => i.ruleId === 'early_deaths_pattern')
    expect(early.action.clips[0]).toMatchObject({ champion: 'Ahri', gameTimeSec: 180 })
  })

  it('post-game report is about the requested game', async () => {
    const game = await getPrisma().game.findUniqueOrThrow({ where: { matchId: 'EUW1_A0' } })
    const r = await invoke('assistant:get-report', 'post_game', game.id)
    expect(r.insights.length).toBeLessThanOrEqual(3)
    expect(r.insights.every((i: any) => i.key.endsWith(`:${game.id}`))).toBe(true)
    // The 5-game pattern supersedes the single-game rule (same group).
    expect(r.insights.map((i: any) => i.ruleId)).toEqual(['tilt_break', 'early_deaths_pattern', 'recurring_mistake'])
  })

  it('weekly report includes a summary', async () => {
    const r = await invoke('assistant:get-report', 'weekly')
    expect(r.summary).toMatchObject({ games: 6, wins: 0, winrate: 0 })
  })

  it('stores, updates and withdraws feedback, and reflects it in the report', async () => {
    const r = await invoke('assistant:get-report', 'session', null)
    const target = r.insights.find((i: any) => i.ruleId === 'early_deaths_pattern')
    await invoke('assistant:feedback', target.key, target.ruleId, 'session', -1)
    await invoke('assistant:feedback', target.key, target.ruleId, 'session', 1)
    const rows = await getPrisma().assistantFeedback.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ruleId: 'early_deaths_pattern', vote: 1, moment: 'session' })

    const again = await invoke('assistant:get-report', 'session', null)
    expect(again.insights.find((i: any) => i.key === target.key).vote).toBe(1)

    await invoke('assistant:feedback', target.key, target.ruleId, 'session', 0)
    expect(await getPrisma().assistantFeedback.count()).toBe(0)
  })

  it('logs each problem it puts forward once per day, and reads it back as history', async () => {
    const prisma = getPrisma()
    await prisma.adviceLog.deleteMany()
    const report = await invoke('assistant:get-report', 'session')
    expect(report.insights.length).toBeGreaterThan(0)
    await invoke('assistant:get-report', 'session') // same day: no duplicate rows
    const rows = await prisma.adviceLog.findMany()
    expect(rows.map((r) => r.problemId).sort()).toEqual([...new Set(report.insights.map((i: any) => i.problemId))].sort())
    expect(report.insights.filter((i: any) => i.focus).length).toBeLessThanOrEqual(1)

    // Rows from previous days become history; today's do not count.
    const { loadAdviceHistory, localDay } = await import('../../electron/main/assistant/assistant.ipc')
    const user = await prisma.user.findFirstOrThrow()
    const now = Date.now()
    for (const daysAgo of [1, 2, 3]) {
      const at = now - daysAgo * 86_400_000
      await prisma.adviceLog.create({ data: { userId: user.id, problemId: 'farming', insightKey: `cs10_low:x${daysAgo}`, moment: 'session', day: localDay(at), shownAt: new Date(at) } })
    }
    const history = await loadAdviceHistory(user.id, now)
    expect(history.farming.priorDays).toBe(3)
    expect(history.farming.lastShownAt).toBe(now - 86_400_000)
    const todayOnly = rows[0]?.problemId
    if (todayOnly && todayOnly !== 'farming') expect(history[todayOnly]).toBeUndefined()
  })

  it('rejects invalid input', async () => {
    await expect(invoke('assistant:get-report', 'monthly')).rejects.toThrow(/Invalid input/)
    await expect(invoke('assistant:feedback', 'k:1', 'not_a_rule', 'session', 1)).rejects.toThrow(/unknown rule/)
    await expect(invoke('assistant:feedback', 'k 1; drop', 'win_streak', 'session', 1)).rejects.toThrow(/Invalid input/)
    await expect(invoke('assistant:feedback', 'k:1', 'win_streak', 'session', 5)).rejects.toThrow(/Invalid input/)
  })
})
