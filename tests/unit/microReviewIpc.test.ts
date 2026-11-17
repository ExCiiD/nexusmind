/**
 * Integration: the micro-review through its real IPC handlers, on a
 * throw-away SQLite database built by the real migrations — analysis cache,
 * QCM answers (mistake / justified / custom), what re-answering undoes, XP
 * granted once, objective verification, low-energy context, calibration
 * flash, and the garbage-time flag of the Mistake Lab.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-microreview-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root, handlers: new Map<string, (...args: unknown[]) => unknown>(), push: [] as any[] }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '0.0.0-test' },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn), on: () => {} },
  dialog: { showOpenDialog: vi.fn(), showErrorBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false },
}))
// The cloud copy for coaches is best effort: here we only record what would be sent.
vi.mock('../../electron/main/cloud/collab', () => ({ microReviewPushAnswer: async (payload: unknown) => { h.push.push(payload) } }))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { registerMicroReviewHandlers, ANALYSIS_VERSION, MICRO_REVIEW_XP } from '../../electron/main/ipc/microReview.ipc'
import { registerMistakeHandlers } from '../../electron/main/ipc/mistakes.ipc'
import { mistakeDuplicateIndex, AUTO_DEDUPE_SEC, MOMENT_WINDOW, OBJECTIVE_MOMENT_WINDOW, momentWindow } from '../../electron/main/mistakeDedupe'
import { splitSqlStatements } from '../../electron/main/database'
import { readFileSync } from 'fs'
import { seedBuiltInMistakeTags } from '../../electron/main/seeds/mistakeTags'
import { BUILT_IN_MISTAKE_TAGS } from '../../src/lib/mistakeTagCatalog'
import { optionsFor, type QcmContext } from '../../src/lib/microReview/smartQcm'
import { BARON_PIT, DRAGON_PIT } from '../../src/lib/microReview/geometry'
import { buildGame, at } from './microReviewFixtures'

const invoke = (channel: string, ...args: unknown[]) => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return fn({}, ...args) as Promise<any>
}

const DEATH_KEY = 'critical-death@1528'
const DRAGON_KEY = 'absent-objective@910'
/** A local afternoon: no "late night" low-energy reason whatever the machine's time zone. */
const AFTERNOON = new Date(2026, 10, 10, 15, 0)

/** Top laner: enemy dragon at 15:30 without a ward, then a death next to Baron 30 s before it is lost. */
function scenario() {
  return buildGame({ minutes: 30, me: 1, events: [
    { type: 'ELITE_MONSTER_KILL', timestamp: at(15, 30), killerId: 7, killerTeamId: 200, monsterType: 'DRAGON', position: DRAGON_PIT },
    { type: 'CHAMPION_KILL', timestamp: at(25, 28), victimId: 1, killerId: 7, assistingParticipantIds: [8, 9], position: { x: 5600, y: 10000 } },
    { type: 'ELITE_MONSTER_KILL', timestamp: at(25, 58), killerId: 7, killerTeamId: 200, monsterType: 'BARON_NASHOR', position: BARON_PIT },
  ] })
}

let userId = ''
let sessionId = ''
let gameId = ''
let seq = 0

async function addGame(opts: { sessionId: string; win?: boolean; gameEndAt?: Date; fixture?: ReturnType<typeof buildGame> | null; champion?: string }) {
  const prisma = getPrisma()
  const matchId = `EUW1_MR_${++seq}`
  const game = await prisma.game.create({
    data: {
      sessionId: opts.sessionId, matchId, champion: opts.champion ?? 'Champ1', role: 'TOP', kills: 2, deaths: 4, assists: 3, cs: 180, visionScore: 15,
      duration: 1800, win: opts.win ?? false, gameEndAt: opts.gameEndAt ?? AFTERNOON,
    },
  })
  if (opts.fixture !== null) {
    const g = opts.fixture ?? scenario()
    await prisma.matchCache.create({ data: { matchId, matchJson: JSON.stringify(g.match), timelineJson: JSON.stringify(g.timeline) } })
  }
  return game
}

const answer = (momentKey: string, over: Record<string, unknown> = {}) => invoke('microreview:answer', {
  gameId, momentKey, trigger: momentKey.split('@')[0], gameTimeSec: Number(momentKey.split('@')[1]),
  outcome: 'mistake', tagSlug: 'no-ward-pre-obj', reason: 'setupFail', viaOther: false,
  summary: { gameTimeSec: Number(momentKey.split('@')[1]), zone: 'top-river', head: { key: 'death' }, extras: [] },
  ...over,
})
const mistakesOf = () => getPrisma().mistake.findMany({ where: { gameId }, include: { tag: true }, orderBy: { createdAt: 'asc' } })
const answerRow = (momentKey: string) => getPrisma().microReviewAnswer.findUnique({ where: { gameId_momentKey: { gameId, momentKey } } })

beforeAll(async () => {
  await initDatabase()
  registerMicroReviewHandlers()
  registerMistakeHandlers()
  const prisma = getPrisma()
  await seedBuiltInMistakeTags()
  const user = await prisma.user.create({ data: { summonerName: 'Micro', displayName: 'MR', puuid: 'puuid-1', region: 'EUW1', nextAssessmentAt: new Date(), xp: 100 } })
  userId = user.id
  const session = await prisma.session.create({ data: { userId, objectiveId: 'vision_control', objectiveIds: '["vision_control","resilience"]', status: 'active' } })
  sessionId = session.id
  gameId = (await addGame({ sessionId })).id
})

afterAll(async () => {
  await closeDatabase()
  rmSync(h.root, { recursive: true, force: true })
})

describe('database', () => {
  it('migrations created the micro-review tables and the seed wrote the shared catalog', async () => {
    const prisma = getPrisma()
    const tables = (await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r.name)
    for (const t of ['GameAnalysis', 'MicroReviewAnswer', 'CalibrationFlash']) expect(tables).toContain(t)
    const cols = (await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("MicroReviewAnswer")`)).map((r) => r.name)
    expect(cols).toContain('mistakeOrigin')
    expect(await prisma.mistakeTag.count({ where: { isBuiltIn: true } })).toBe(BUILT_IN_MISTAKE_TAGS.length)
  })
  it('every diagnosis the QCM can offer points at a seeded tag and passes the IPC schema', async () => {
    const slugs = new Set((await getPrisma().mistakeTag.findMany()).map((t) => t.slug))
    const contexts: QcmContext[] = ['objective', 'gold', 'isolated', 'duel', 'teamfight', 'absent', 'early-cs', 'early-xp', 'hesitation', 'jungle-cycle', 'jungle-passive',
      'rotation', 'baron-siege', 'tempo-recall', 'tempo-front', 'gank-timer', 'carry-first', 'jungle-window', 'bad-rotation', 'duel-early', 'outnumbered', 'chokepoint', 'mid-roam',
      'eco-tempo', 'side-overextend', 'early-3v3', 'low-energy']
    for (const c of contexts) {
      for (const o of [...optionsFor(c), ...optionsFor(c, { nearObjective: true, secondsSinceOwnPlay: 5 })]) {
        if (o.tagSlug) expect(slugs.has(o.tagSlug), `${c}: ${o.tagSlug}`).toBe(true)
        expect(o.reason, `${c}: ${o.reason}`).toMatch(/^[A-Za-z0-9]+$/)
        expect(o.reason.length).toBeLessThanOrEqual(40)
      }
    }
  })
})

describe('microreview:get', () => {
  it('analyses the cached timeline and returns the moments, in game order', async () => {
    const p = await invoke('microreview:get', gameId)
    expect(p.analysis.moments.map((m: any) => m.key)).toEqual([DRAGON_KEY, DEATH_KEY])
    expect(p).toMatchObject({ champion: 'Champ1', role: 'TOP', win: false, answers: [], pastAnswers: [], recording: null, lowEnergy: { active: false, reasons: [] } })
    expect(p.analysis.contested).toHaveLength(2)
    expect(p.analysis.moments[1].facts).toMatchObject({ objectiveLost: 'baron', objectiveLostAfterSec: 30, nearObjective: true, enemiesInvolved: 3 })
  })
  it('caches the analysis: a second call no longer needs the timeline', async () => {
    const prisma = getPrisma()
    const row = await prisma.gameAnalysis.findUnique({ where: { gameId } })
    expect(row).toMatchObject({ version: ANALYSIS_VERSION, reviewXpAwarded: false })
    const game = await prisma.game.findUnique({ where: { id: gameId } })
    const cache = await prisma.matchCache.findUnique({ where: { matchId: game!.matchId } })
    await prisma.matchCache.delete({ where: { matchId: game!.matchId } })
    const again = await invoke('microreview:get', gameId)
    expect(again.analysis.moments).toHaveLength(2)
    await prisma.matchCache.create({ data: { matchId: cache!.matchId, matchJson: cache!.matchJson, timelineJson: cache!.timelineJson } })
  })
  it('recomputes when the detector version changes, and says why when it cannot analyse', async () => {
    const prisma = getPrisma()
    await prisma.gameAnalysis.update({ where: { gameId }, data: { version: 0, payload: '{"moments":[]}' } })
    expect((await invoke('microreview:get', gameId)).analysis.moments).toHaveLength(2)
    expect((await prisma.gameAnalysis.findUnique({ where: { gameId } }))!.version).toBe(ANALYSIS_VERSION)
    // Someone else's game: the player is not in the match → no analysis, with a reason.
    const stranger = buildGame({ minutes: 5 })
    for (const p of stranger.match.info.participants) { p.puuid = `other-${p.participantId}`; p.championName = `Other${p.participantId}` }
    const foreign = await addGame({ sessionId, fixture: stranger, gameEndAt: new Date(2026, 10, 9, 15, 0) })
    expect(await invoke('microreview:get', foreign.id)).toMatchObject({ analysis: null, reason: 'player-not-resolved' })
    expect(await invoke('microreview:get', 'missing-game')).toBeNull()
    await prisma.game.delete({ where: { id: foreign.id } })
  })
})

describe('microreview:answer', () => {
  it('a mistake answer creates one Mistake and is mirrored for the coach', async () => {
    const before = h.push.length
    const res = await answer(DEATH_KEY)
    expect(res).toMatchObject({ xpAwarded: 0, completed: false, answer: { momentKey: DEATH_KEY, outcome: 'mistake', tagSlug: 'no-ward-pre-obj', reason: 'setupFail', viaOther: false } })
    const [m] = await mistakesOf()
    expect(m).toMatchObject({ gameTimeSec: 1528, severity: 3, autoDetected: false, note: null })
    expect(m.tag.slug).toBe('no-ward-pre-obj')
    expect(res.answer.mistakeId).toBe(m.id)
    expect((await answerRow(DEATH_KEY))!.mistakeOrigin).toBe('created')
    expect(h.push.length).toBe(before + 1)
    expect(h.push.at(-1)).toMatchObject({ localId: res.answer.id, champion: 'Champ1', role: 'TOP', gameTimeSec: 1528, trigger: 'critical-death', outcome: 'mistake', tagSlug: 'no-ward-pre-obj', summary: { head: { key: 'death' } } })
  })
  it('a justified answer creates NO Mistake, completes the review and grants XP once', async () => {
    const res = await answer(DRAGON_KEY, { outcome: 'justified', tagSlug: null, reason: 'notContestable' })
    expect(res).toMatchObject({ xpAwarded: MICRO_REVIEW_XP, completed: true, answer: { outcome: 'justified', tagSlug: null, mistakeId: null } })
    expect(await mistakesOf()).toHaveLength(1)
    expect((await getPrisma().user.findUnique({ where: { id: userId } }))!.xp).toBe(100 + MICRO_REVIEW_XP)
    expect((await getPrisma().gameAnalysis.findUnique({ where: { gameId } }))!.reviewXpAwarded).toBe(true)
  })
  it('re-answering never grants XP again, and accepts reason ids with digits', async () => {
    const res = await answer(DRAGON_KEY, { tagSlug: 'bad-wave-sync', reason: 'archetype3v3' })
    expect(res).toMatchObject({ xpAwarded: 0, completed: true, answer: { tagSlug: 'bad-wave-sync', reason: 'archetype3v3' } })
    expect(await mistakesOf()).toHaveLength(2)
    expect((await getPrisma().user.findUnique({ where: { id: userId } }))!.xp).toBe(100 + MICRO_REVIEW_XP)
    expect(await getPrisma().microReviewAnswer.count({ where: { gameId } })).toBe(2)
  })
  it('changing a mistake to justified deletes the Mistake that answer had created', async () => {
    const res = await answer(DEATH_KEY, { outcome: 'justified', tagSlug: null, reason: 'stealAttempt' })
    expect(res.answer).toMatchObject({ outcome: 'justified', mistakeId: null })
    expect((await mistakesOf()).map((m) => m.tag.slug)).toEqual(['bad-wave-sync'])
    expect((await answerRow(DEATH_KEY))!.mistakeOrigin).toBeNull()
  })
  it('confirms an auto-detected mistake instead of duplicating it — and un-confirms it when re-answered', async () => {
    const prisma = getPrisma()
    const tag = await prisma.mistakeTag.findUnique({ where: { slug: 'caught-out' } })
    const auto = await prisma.mistake.create({ data: { gameId, tagId: tag!.id, gameTimeSec: 1520, autoDetected: true, note: 'auto', severity: 2 } })
    const res = await answer(DEATH_KEY, { tagSlug: 'caught-out', reason: 'noMinimap' })
    expect(res.answer.mistakeId).toBe(auto.id)
    expect(await mistakesOf()).toHaveLength(2)
    expect((await prisma.mistake.findUnique({ where: { id: auto.id } }))).toMatchObject({ autoDetected: false, note: 'auto' })
    expect((await answerRow(DEATH_KEY))!.mistakeOrigin).toBe('confirmed-auto')

    await answer(DEATH_KEY, { outcome: 'justified', tagSlug: null, reason: 'stealAttempt' })
    expect((await prisma.mistake.findUnique({ where: { id: auto.id } }))).toMatchObject({ autoDetected: true })
    await prisma.mistake.delete({ where: { id: auto.id } })
  })
  it('reuses a mistake the player had tagged by hand, and never touches it afterwards', async () => {
    const prisma = getPrisma()
    const tag = await prisma.mistakeTag.findUnique({ where: { slug: 'overstay' } })
    const manual = await prisma.mistake.create({ data: { gameId, tagId: tag!.id, gameTimeSec: 1540, autoDetected: false, note: 'vu en VOD', severity: 2 } })
    const res = await answer(DEATH_KEY, { tagSlug: 'overstay', reason: 'overstay' })
    expect(res.answer.mistakeId).toBe(manual.id)
    expect((await answerRow(DEATH_KEY))!.mistakeOrigin).toBe('existing')
    await answer(DEATH_KEY, { outcome: 'justified', tagSlug: null, reason: 'stealAttempt' })
    expect(await prisma.mistake.findUnique({ where: { id: manual.id } })).toMatchObject({ autoDetected: false, note: 'vu en VOD' })
    await prisma.mistake.delete({ where: { id: manual.id } })
  })
  it('a mistake further than 20 s from the moment is another mistake', async () => {
    const prisma = getPrisma()
    const tag = await prisma.mistakeTag.findUnique({ where: { slug: 'overstay' } })
    const far = await prisma.mistake.create({ data: { gameId, tagId: tag!.id, gameTimeSec: 1528 + 21, autoDetected: true, severity: 2 } })
    const res = await answer(DEATH_KEY, { tagSlug: 'overstay', reason: 'overstay' })
    expect(res.answer.mistakeId).not.toBe(far.id)
    expect((await answerRow(DEATH_KEY))!.mistakeOrigin).toBe('created')
    expect((await prisma.mistake.findUnique({ where: { id: far.id } }))!.autoDetected).toBe(true)
    await prisma.mistake.delete({ where: { id: far.id } })
  })
  it('"Autre cause…": a personal tag is created once, with the coach note', async () => {
    const prisma = getPrisma()
    const res = await answer(DEATH_KEY, { outcome: 'custom', tagSlug: null, customLabel: 'Mon erreur perso', reason: null, viaOther: true, note: '  Flash gardé trop longtemps  ' })
    expect(res.answer).toMatchObject({ outcome: 'custom', tagSlug: 'mon-erreur-perso', viaOther: true, note: 'Flash gardé trop longtemps' })
    const tag = await prisma.mistakeTag.findUnique({ where: { slug: 'mon-erreur-perso' } })
    expect(tag).toMatchObject({ label: 'Mon erreur perso', isBuiltIn: false })
    expect((await prisma.mistake.findUnique({ where: { id: res.answer.mistakeId } }))).toMatchObject({ note: 'Flash gardé trop longtemps', tagId: tag!.id })
    await answer(DEATH_KEY, { outcome: 'custom', tagSlug: null, customLabel: 'Mon erreur perso', reason: null, viaOther: true })
    expect(await prisma.mistakeTag.count({ where: { label: 'Mon erreur perso' } })).toBe(1)
  })
  it('an unknown tag is refused before anything is undone', async () => {
    const before = (await mistakesOf()).map((m) => m.id)
    await expect(answer(DEATH_KEY, { tagSlug: 'does-not-exist' })).rejects.toThrow('Unknown mistake tag')
    expect((await mistakesOf()).map((m) => m.id)).toEqual(before)
    expect((await answerRow(DEATH_KEY))!.tagSlug).toBe('mon-erreur-perso')
  })
  it('rejects malformed input', async () => {
    await expect(answer('not a key')).rejects.toThrow(/Invalid input/)
    await expect(answer(DEATH_KEY, { outcome: 'whatever' })).rejects.toThrow(/Invalid input/)
    await expect(answer(DEATH_KEY, { reason: 'with spaces' })).rejects.toThrow(/Invalid input/)
    await expect(invoke('microreview:answer', { gameId: 'missing-game', momentKey: DEATH_KEY, trigger: 'critical-death', gameTimeSec: 1528, outcome: 'justified', viaOther: false })).rejects.toThrow('Game not found')
  })
  it('XP is not granted again after the analysis is recomputed', async () => {
    const prisma = getPrisma()
    await prisma.gameAnalysis.update({ where: { gameId }, data: { version: 0 } })
    await invoke('microreview:get', gameId)
    expect((await prisma.gameAnalysis.findUnique({ where: { gameId } }))!.reviewXpAwarded).toBe(true)
    const res = await answer(DRAGON_KEY, { outcome: 'justified', tagSlug: null, reason: 'notContestable' })
    expect(res).toMatchObject({ xpAwarded: 0, completed: true })
    expect((await prisma.user.findUnique({ where: { id: userId } }))!.xp).toBe(100 + MICRO_REVIEW_XP)
  })
  it('returns the stored answers and the local-learning history with the next payload', async () => {
    const p = await invoke('microreview:get', gameId)
    expect(p.answers.map((a: any) => [a.momentKey, a.outcome])).toEqual([[DRAGON_KEY, 'justified'], [DEATH_KEY, 'custom']])
    expect(p.pastAnswers).toHaveLength(2)
    expect(p.pastAnswers).toContainEqual({ role: 'TOP', champion: 'Champ1', tagSlug: 'mon-erreur-perso', viaOther: true })
  })
})

describe('microreview:verify-objectives', () => {
  it('checks each session objective against the game', async () => {
    const res = await invoke('microreview:verify-objectives', gameId)
    expect(res.overall).toBe(false)
    expect(res.results).toEqual([
      // 2 enemy objectives, but the top laner was dead for the Baron: only the dragon is theirs to ward — and it was not.
      { fundamentalId: 'vision_control', ruleId: 'ward-before-objectives', failedTags: [], objectivesWarded: 0, objectivesTotal: 1, status: 'failed' },
      // Low-energy protocol: none of its tags in this game, and the game was reviewed.
      { fundamentalId: 'resilience', ruleId: 'low-energy', failedTags: [], status: 'passed' },
    ])
  })
  it('a tagged mistake of the rule fails it', async () => {
    await answer(DEATH_KEY, { tagSlug: 'caught-out', reason: 'noMinimap' })
    const res = await invoke('microreview:verify-objectives', gameId)
    expect(res.results[1]).toMatchObject({ ruleId: 'low-energy', status: 'failed', failedTags: ['caught-out'] })
  })
  it('returns null for an unknown game', async () => {
    expect(await invoke('microreview:verify-objectives', 'missing-game')).toBeNull()
  })
})

describe('low-energy context of a game', () => {
  it('flags a game played right after two losses of its session', async () => {
    const prisma = getPrisma()
    const session = await prisma.session.create({ data: { userId, objectiveId: 'tempo', objectiveIds: '["tempo"]', status: 'completed' } })
    await addGame({ sessionId: session.id, win: false, gameEndAt: new Date(2026, 10, 12, 14, 0), fixture: null })
    await addGame({ sessionId: session.id, win: false, gameEndAt: new Date(2026, 10, 12, 14, 40), fixture: null })
    const third = await addGame({ sessionId: session.id, win: true, gameEndAt: new Date(2026, 10, 12, 15, 20) })
    // Two losses right before it — and the player's 3 earlier afternoon games are all losses (0 % < 45 %).
    expect((await invoke('microreview:get', third.id)).lowEnergy).toEqual({ active: true, reasons: ['loss-streak', 'bad-hour'] })
    // A win in between resets the streak (the afternoon stays a weak slot: 1 win in 3).
    await prisma.game.updateMany({ where: { sessionId: session.id, gameEndAt: new Date(2026, 10, 12, 14, 40) }, data: { win: true } })
    expect((await invoke('microreview:get', third.id)).lowEnergy).toEqual({ active: true, reasons: ['bad-hour'] })
    // With a second afternoon win the slot is at 2 in 3: nothing left to flag.
    await prisma.game.updateMany({ where: { sessionId: session.id, gameEndAt: new Date(2026, 10, 12, 14, 0) }, data: { win: true } })
    expect((await invoke('microreview:get', third.id)).lowEnergy).toEqual({ active: false, reasons: [] })
  })
  it('flags a game that ended at night', async () => {
    const prisma = getPrisma()
    const session = await prisma.session.create({ data: { userId, objectiveId: 'tempo', objectiveIds: '["tempo"]', status: 'completed' } })
    const night = await addGame({ sessionId: session.id, gameEndAt: new Date(2026, 10, 13, 2, 30) })
    expect((await invoke('microreview:get', night.id)).lowEnergy.reasons).toContain('late-night')
  })
})

describe('calibration flash', () => {
  it('is not due before 15 games and measures the family distribution of the last 15', async () => {
    const s = await invoke('microreview:calibration-status')
    expect(s.every).toBe(15)
    expect(s.due).toBe(false)
    expect(s.lastAt).toBeNull()
    expect(s.gamesSinceLast).toBe(await getPrisma().game.count())
    const total = s.distribution.reduce((n: number, d: any) => n + d.count, 0)
    expect(total).toBe(await getPrisma().mistake.count())
  })
  it('stores the perception, returns the gap and restarts the 15-game counter', async () => {
    const prisma = getPrisma()
    const res = await invoke('microreview:calibration-submit', 'mechanics')
    expect(res.perceived).toBe('mechanics')
    expect(res.evidence).toBe(await prisma.mistake.count())
    expect(res.aligned).toBeNull() // fewer than 5 tagged mistakes: no verdict
    expect(await prisma.calibrationFlash.count({ where: { userId } })).toBe(1)
    expect((await prisma.user.findUnique({ where: { id: userId } }))!.nextAssessmentAt.getTime()).toBeGreaterThan(Date.now())
    const s = await invoke('microreview:calibration-status')
    expect(s.lastAt).not.toBeNull()
    expect(s.gamesSinceLast).toBe(0)
    await expect(invoke('microreview:calibration-submit', 'nonsense')).rejects.toThrow(/Invalid input/)
  })
  it('is due again after 15 new games', async () => {
    const future = Date.now() + 60_000
    for (let i = 0; i < 15; i++) await addGame({ sessionId, gameEndAt: new Date(future + i * 1000), fixture: null })
    const s = await invoke('microreview:calibration-status')
    expect(s).toMatchObject({ due: true, gamesSinceLast: 15 })
  })
})

describe('Mistake Lab — garbage-time flag', () => {
  it('marks a mistake made when the game was already decided, and only that one', async () => {
    const prisma = getPrisma()
    // Blue is 9000 gold ahead from 10:00 on → P(win) > 0.85 for the blue player.
    const stomp = buildGame({ minutes: 20, me: 1 })
    for (const f of stomp.timeline.info.frames.slice(10)) f.participantFrames['3'].totalGold += 9000
    const game = await addGame({ sessionId, fixture: stomp, gameEndAt: new Date(Date.now() - 3_600_000), champion: 'Champ1' })
    const tag = await prisma.mistakeTag.findUnique({ where: { slug: 'overstay' } })
    await prisma.mistake.create({ data: { gameId: game.id, tagId: tag!.id, gameTimeSec: 300, severity: 2 } })
    await prisma.mistake.create({ data: { gameId: game.id, tagId: tag!.id, gameTimeSec: 700, severity: 2 } })
    const rows: any[] = (await invoke('mistake-stats:occurrences', { days: 30 })).filter((r: any) => r.game.id === game.id)
    expect(rows.map((r) => [r.gameTimeSec, r.garbageTime]).sort((a, b) => a[0] - b[0])).toEqual([[300, false], [700, true]])
    // The analysis was computed on the way (cached timeline only) and is now cached.
    expect(await prisma.gameAnalysis.findUnique({ where: { gameId: game.id } })).not.toBeNull()
  })
  it('does not flag anything when the game has no cached timeline', async () => {
    const prisma = getPrisma()
    const game = await addGame({ sessionId, fixture: null, gameEndAt: new Date(Date.now() - 7_200_000) })
    const tag = await prisma.mistakeTag.findUnique({ where: { slug: 'overstay' } })
    await prisma.mistake.create({ data: { gameId: game.id, tagId: tag!.id, gameTimeSec: 700, severity: 2 } })
    const rows: any[] = (await invoke('mistake-stats:occurrences', { days: 30 })).filter((r: any) => r.game.id === game.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].garbageTime).toBe(false)
  })
})

describe('one mistake, one row — auto-detector and micro-review', () => {
  const answerFor = (gid: string, momentKey: string, over: Record<string, unknown> = {}) => invoke('microreview:answer', {
    gameId: gid, momentKey, trigger: momentKey.split('@')[0], gameTimeSec: Number(momentKey.split('@')[1]),
    outcome: 'mistake', tagSlug: 'no-ward-pre-obj', reason: 'setupFail', viaOther: false, ...over,
  })
  const rows = (gid: string) => getPrisma().mistake.findMany({ where: { gameId: gid }, include: { tag: true }, orderBy: { gameTimeSec: 'asc' } })
  const noWard = async (gid: string) => (await rows(gid)).filter((m) => m.tag.slug === 'no-ward-pre-obj').map((m) => [m.gameTimeSec, m.autoDetected])
  let day = 0
  /** A new game with the same timeline, its analysis already computed. */
  const fresh = async () => {
    const g = await addGame({ sessionId, gameEndAt: new Date(2026, 9, 1 + (day++ % 28), 15, 0) })
    await invoke('microreview:get', g.id)
    return g.id
  }
  const tagId = async (slug: string) => (await getPrisma().mistakeTag.findUnique({ where: { slug } }))!.id

  it('windows: ±20 s around a moment, 90 s before → 30 s after an objective moment, ±3 s for the auto-detector', () => {
    expect(MOMENT_WINDOW).toEqual({ before: 20, after: 20 })
    expect(OBJECTIVE_MOMENT_WINDOW).toEqual({ before: 90, after: 30 })
    expect(AUTO_DEDUPE_SEC).toBe(3)
    expect(momentWindow('absent-objective')).toBe(OBJECTIVE_MOMENT_WINDOW)
    expect(momentWindow('critical-death')).toBe(MOMENT_WINDOW)
    expect(momentWindow('early-deficit')).toBe(MOMENT_WINDOW)
  })
  it('an objective moment confirms the auto-detected "no ward" stamped 90 s before the objective', async () => {
    const prisma = getPrisma()
    const gid = await fresh()
    // Dragon at 15:30 → auto-detected row at 14:00 (840 s); the moment is anchored at 15:10 (910 s), 70 s later.
    const auto = await prisma.mistake.create({ data: { gameId: gid, tagId: await tagId('no-ward-pre-obj'), gameTimeSec: 840, autoDetected: true, severity: 1 } })
    const res = await answerFor(gid, DRAGON_KEY)
    expect(res.answer.mistakeId).toBe(auto.id)
    expect(await noWard(gid)).toEqual([[840, false]])
    expect((await prisma.microReviewAnswer.findUnique({ where: { gameId_momentKey: { gameId: gid, momentKey: DRAGON_KEY } } }))!.mistakeOrigin).toBe('confirmed-auto')
    // Changing the answer to another tag un-confirms it, and picking it again confirms it again — never a second row.
    await answerFor(gid, DRAGON_KEY, { tagSlug: 'bad-wave-sync', reason: 'absentNoRotate' })
    expect(await noWard(gid)).toEqual([[840, true]])
    await answerFor(gid, DRAGON_KEY)
    await answerFor(gid, DRAGON_KEY)
    expect(await noWard(gid)).toEqual([[840, false]])
    expect(await rows(gid)).toHaveLength(1)
  })
  it('the objective window is 90 s before the moment to 30 s after, inclusive', async () => {
    const prisma = getPrisma()
    for (const [t, same] of [[910 - 90, true], [910 - 91, false], [910 + 30, true], [910 + 31, false]] as const) {
      const gid = await fresh()
      const row = await prisma.mistake.create({ data: { gameId: gid, tagId: await tagId('no-ward-pre-obj'), gameTimeSec: t, autoDetected: true, severity: 1 } })
      const res = await answerFor(gid, DRAGON_KEY)
      expect(res.answer.mistakeId === row.id, 't=' + t).toBe(same)
      expect(await rows(gid), 't=' + t).toHaveLength(same ? 1 : 2)
    }
  })
  it('the auto-detector never repeats what the player already answered — in either order', async () => {
    // Answer first: the row sits on the moment (910 s); the detector's own candidate (840 s) is that same objective.
    const first = await fresh()
    await answerFor(first, DRAGON_KEY)
    expect((await invoke('mistake:auto-detect', first)).reason).toBe('ok')
    expect(await noWard(first)).toEqual([[910, false]])
    // Detector first: one auto row at 840 s, confirmed by the answer, and left alone by every later refresh.
    const second = await fresh()
    await invoke('mistake:auto-detect', second)
    expect(await noWard(second)).toEqual([[840, true]])
    await answerFor(second, DRAGON_KEY)
    await invoke('mistake:auto-detect', second)
    await invoke('mistake:auto-detect', second)
    expect(await noWard(second)).toEqual([[840, false]])
  })
  it('the duplicate index knows every row of the game, and gives objective answers their wider reach', async () => {
    const prisma = getPrisma()
    const gid = await fresh()
    const [overstay, vision, trade] = await Promise.all([tagId('overstay'), tagId('no-ward-pre-obj'), tagId('bad-trade')])
    await prisma.mistake.create({ data: { gameId: gid, tagId: overstay, gameTimeSec: 600, autoDetected: false, severity: 2 } }) // tagged by hand
    await answerFor(gid, DRAGON_KEY) // no-ward-pre-obj at 910, from an objective moment
    const known = await mistakeDuplicateIndex(gid)
    expect([known.has(overstay, 603), known.has(overstay, 604), known.has(overstay, 597), known.has(overstay, 596)]).toEqual([true, false, true, false])
    expect([820, 819, 840, 940, 941].map((t) => known.has(vision, t))).toEqual([true, false, true, true, false])
    expect(known.has(trade, 910)).toBe(false)
    known.add(trade, 100)
    expect([known.has(trade, 103), known.has(trade, 104)]).toEqual([true, false])
  })
  it('takes over a mistake left by an answer to a moment the analysis no longer has', async () => {
    const prisma = getPrisma()
    const gid = await fresh()
    // What an older detector version left behind: a death it placed at 25:20, which today's analysis places at 25:28.
    const left = await prisma.mistake.create({ data: { gameId: gid, tagId: await tagId('caught-out'), gameTimeSec: 1520, autoDetected: false, severity: 3 } })
    const stale = await prisma.microReviewAnswer.create({ data: {
      userId, gameId: gid, momentKey: 'critical-death@1520', trigger: 'critical-death', gameTimeSec: 1520, outcome: 'mistake', tagSlug: 'caught-out',
      reason: 'noMinimap', viaOther: false, role: 'TOP', champion: 'Champ1', mistakeId: left.id, mistakeOrigin: 'created' } })
    const res = await answerFor(gid, DEATH_KEY, { tagSlug: 'caught-out', reason: 'noMinimap' })
    expect(res.answer.mistakeId).toBe(left.id)
    expect(await prisma.microReviewAnswer.findUnique({ where: { id: stale.id } })).toMatchObject({ mistakeId: null, mistakeOrigin: null })
    expect((await prisma.microReviewAnswer.findUnique({ where: { gameId_momentKey: { gameId: gid, momentKey: DEATH_KEY } } }))!.mistakeOrigin).toBe('created')
    // …so calling the moment justified removes the mistake instead of leaving it behind for ever.
    await answerFor(gid, DEATH_KEY, { outcome: 'justified', tagSlug: null, reason: 'stealAttempt' })
    expect(await rows(gid)).toHaveLength(0)
  })
  it('re-answering with the same diagnosis keeps exactly one row', async () => {
    const gid = await fresh()
    for (let i = 0; i < 3; i++) await answerFor(gid, DEATH_KEY, { tagSlug: 'caught-out', reason: 'noMinimap' })
    const all = await rows(gid)
    expect(all.map((m) => [m.tag.slug, m.gameTimeSec, m.autoDetected])).toEqual([['caught-out', 1528, false]])
    expect((await getPrisma().microReviewAnswer.findUnique({ where: { gameId_momentKey: { gameId: gid, momentKey: DEATH_KEY } } }))).toMatchObject({ mistakeId: all[0].id, mistakeOrigin: 'created' })
  })
  it('two answers landing together complete the review once', async () => {
    const prisma = getPrisma()
    const gid = await fresh()
    const before = (await prisma.user.findUnique({ where: { id: userId } }))!.xp
    const both = await Promise.all([
      answerFor(gid, DRAGON_KEY, { outcome: 'justified', tagSlug: null, reason: 'notContestable' }),
      answerFor(gid, DEATH_KEY, { outcome: 'justified', tagSlug: null, reason: 'stealAttempt' }),
    ])
    expect(both.reduce((n: number, r: any) => n + r.xpAwarded, 0)).toBe(MICRO_REVIEW_XP)
    expect((await prisma.user.findUnique({ where: { id: userId } }))!.xp).toBe(before + MICRO_REVIEW_XP)
    expect(await prisma.microReviewAnswer.count({ where: { gameId: gid } })).toBe(2)
  })
  it('a mistake that comes from a micro-review answer is never re-judged as garbage time by its own timestamp', async () => {
    const prisma = getPrisma()
    // Dragon at 20:10. P(win) is 0.855 at the 19:00 snapshot (garbage) and 0.828 at 20:00 (not): the detector
    // gates on the objective itself (20:10 → kept), while the moment — and its Mistake — is anchored at 19:50.
    const g = buildGame({ minutes: 24, me: 1, events: [{ type: 'ELITE_MONSTER_KILL', timestamp: at(20, 10), killerId: 7, killerTeamId: 200, monsterType: 'DRAGON', position: DRAGON_PIT }] })
    g.timeline.info.frames[19].participantFrames['3'].totalGold += 4500
    for (const f of g.timeline.info.frames.slice(20)) f.participantFrames['3'].totalGold += 4200
    const game = await addGame({ sessionId, fixture: g, gameEndAt: new Date(Date.now() - 1_800_000) })
    const payload = await invoke('microreview:get', game.id)
    expect(payload.analysis.winProb.slice(19, 21)).toEqual([0.855, 0.828])
    expect(payload.analysis.moments.map((m: any) => m.key)).toEqual(['absent-objective@1190'])
    await answerFor(game.id, 'absent-objective@1190')
    // A hand-made tag at the same second is judged by the snapshot before it, as before.
    await prisma.mistake.create({ data: { gameId: game.id, tagId: await tagId('overstay'), gameTimeSec: 1190, severity: 2 } })
    const occ: any[] = (await invoke('mistake-stats:occurrences', { days: 30 })).filter((r: any) => r.game.id === game.id)
    expect(occ.map((r) => [r.tag.slug, r.garbageTime]).sort()).toEqual([['no-ward-pre-obj', false], ['overstay', true]])
  })
  it('says why a game on another map or mode has no micro-review', async () => {
    const aram = scenario()
    Object.assign(aram.match.info, { mapId: 12, gameMode: 'ARAM' })
    const game = await addGame({ sessionId, fixture: aram, gameEndAt: new Date(2026, 9, 30, 15, 0) })
    expect(await invoke('microreview:get', game.id)).toMatchObject({ analysis: null, reason: 'unsupported-mode', answers: [] })
    expect(await getPrisma().gameAnalysis.findUnique({ where: { gameId: game.id } })).toBeNull()
  })
  it('migration: a review answered before the XP flag existed is never paid a second time', async () => {
    const prisma = getPrisma()
    const answered = await fresh()
    const untouched = await fresh()
    await answerFor(answered, DRAGON_KEY, { outcome: 'justified', tagSlug: null, reason: 'notContestable' })
    await prisma.gameAnalysis.updateMany({ where: { gameId: { in: [answered, untouched] } }, data: { reviewXpAwarded: false } })
    const sql = readFileSync(join(process.cwd(), 'prisma', 'migrations', '20261117220000_micro_review_origin', 'migration.sql'), 'utf8')
    const backfill = splitSqlStatements(sql).filter((st) => st.startsWith('UPDATE'))
    expect(backfill).toHaveLength(1)
    await prisma.$executeRawUnsafe(backfill[0])
    expect((await prisma.gameAnalysis.findUnique({ where: { gameId: answered } }))!.reviewXpAwarded).toBe(true)
    expect((await prisma.gameAnalysis.findUnique({ where: { gameId: untouched } }))!.reviewXpAwarded).toBe(false)
    // Finishing that review now grants nothing more.
    const res = await answerFor(answered, DEATH_KEY, { outcome: 'justified', tagSlug: null, reason: 'stealAttempt' })
    expect(res).toMatchObject({ completed: true, xpAwarded: 0 })
  })
})
