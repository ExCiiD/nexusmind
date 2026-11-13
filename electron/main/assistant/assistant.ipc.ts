/**
 * Assistant IPC — loads the active player's recent games from Prisma (plus
 * cached Riot JSON for death timings / KP), builds the feature store and
 * returns a rule-based report for one moment. Also stores 👍/👎 feedback.
 *
 * Everything runs locally; nothing here touches the network.
 */

import { z } from 'zod'
import { getPrisma } from '../database'
import { id, validatedHandle } from '../ipc/validate'
import { tryUnlockBadge } from '../badgeUnlock'
import type { AdviceHistory } from './diagnosis'
import {
  baselineFor,
  criterionForProblem,
  DEFAULT_WINDOW,
  evaluateExperiment,
  graduatedFundamentals,
  outcomeVotes,
  problemForObjective,
  problemOutcomes,
  type Criterion,
  type ExperimentView,
  type FinishedExperiment,
  type Verdict,
} from './experiments'
import { buildPlayerContext, laneFromReport, type GameRecord, type PlayerContext, type SessionRecord } from './features'
import { problemById } from './problems'
import { buildReport, neighbourObjective, type AssistantReport } from './report'
import { pickPriorityGame } from './reviewPriority'
import { RULES, type Moment } from './rules'
import { extractTimelineFacts, type TimelineFacts } from './timeline'
import { tallyVotes } from './weights'

const MOMENTS = ['post_game', 'session', 'weekly'] as const
const MAX_GAMES = 40
/** Riot timelines are 1–2 MB each: only the newest games are parsed. */
const MAX_TIMELINES = 20

const factsCache = new Map<string, TimelineFacts>()

function parseIds(json: string | null | undefined, fallback?: string): string[] {
  try {
    const v = JSON.parse(json ?? '[]')
    if (Array.isArray(v) && v.length) return v.filter((x): x is string => typeof x === 'string')
  } catch { /* fall through */ }
  return fallback ? [fallback] : []
}

function parseScores(json: string | null | undefined): Record<string, number> | null {
  if (!json) return null
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? (v as Record<string, number>) : null
  } catch { return null }
}

async function loadInputs(userId: string, puuids: string[]): Promise<{ games: GameRecord[]; sessions: SessionRecord[] }> {
  const prisma = getPrisma()
  const sessions = await prisma.session.findMany({
    where: { userId },
    orderBy: { date: 'desc' },
    take: 30,
    select: { id: true, date: true, status: true, objectiveId: true, objectiveIds: true, selectedKpiIds: true },
  })
  const games = await prisma.game.findMany({
    where: { session: { userId }, isSessionEligible: true, duration: { gte: 300 } },
    orderBy: { gameEndAt: 'desc' },
    take: MAX_GAMES,
    include: {
      session: { select: { objectiveId: true, objectiveIds: true } },
      review: { select: { kpiScores: true, objectiveRespected: true } },
      recording: { select: { id: true } },
      mistakes: { select: { id: true, gameTimeSec: true, recordingId: true, severity: true, tag: { select: { slug: true, label: true } } } },
    },
  })

  const needFacts = games.slice(0, MAX_TIMELINES).filter((g) => !factsCache.has(g.matchId)).map((g) => g.matchId)
  if (needFacts.length) {
    const caches = await prisma.matchCache.findMany({ where: { matchId: { in: needFacts } } })
    for (const c of caches) {
      const g = games.find((x) => x.matchId === c.matchId)
      if (!g) continue
      const facts = extractTimelineFacts(c.matchJson, c.timelineJson, { puuids, championName: g.champion, win: g.win }, {
        computeLane: !g.lanePhaseReport,
      })
      if (factsCache.size > 300) factsCache.delete(factsCache.keys().next().value as string)
      factsCache.set(c.matchId, facts)
    }
  }

  const records: GameRecord[] = games.map((g) => {
    const facts = factsCache.get(g.matchId)
    let lane = facts?.lane ?? null
    if (g.lanePhaseReport) {
      try { lane = laneFromReport(JSON.parse(g.lanePhaseReport)) ?? lane } catch { /* keep computed */ }
    }
    return {
      id: g.id,
      matchId: g.matchId,
      sessionId: g.sessionId,
      endedAt: new Date(g.gameEndAt).getTime(),
      durationSec: g.duration,
      win: g.win,
      kills: g.kills,
      deaths: g.deaths,
      assists: g.assists,
      cs: g.cs,
      visionScore: g.visionScore,
      role: g.role,
      champion: g.champion,
      objectiveIds: parseIds(g.session.objectiveIds, g.session.objectiveId),
      reviewed: g.review != null,
      kpiScores: parseScores(g.review?.kpiScores),
      objectiveRespected: g.review?.objectiveRespected ?? null,
      lane,
      deathTimesSec: facts?.deathTimesSec ?? null,
      killParticipation: facts?.killParticipation ?? null,
      finalGoldDiff: facts?.finalGoldDiff ?? null,
      mistakes: g.mistakes.map((m) => ({
        id: m.id,
        tagSlug: m.tag.slug,
        tagLabel: m.tag.label,
        gameTimeSec: m.gameTimeSec,
        recordingId: m.recordingId,
        severity: m.severity,
      })),
      recordingId: g.recording?.id ?? null,
    }
  })

  return {
    games: records,
    sessions: sessions.map((s) => ({
      id: s.id,
      date: new Date(s.date).getTime(),
      status: s.status,
      objectiveIds: parseIds(s.objectiveIds, s.objectiveId),
      selectedKpiIds: parseIds(s.selectedKpiIds),
    })),
  }
}

/** Local calendar day (the player's "today"), YYYY-MM-DD. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const HISTORY_DAYS = 7

/** Per problem: on how many previous days (last 7, today excluded) it was put forward, and when last. */
export async function loadAdviceHistory(userId: string, now: number): Promise<Record<string, AdviceHistory>> {
  const today = localDay(now)
  const rows = await getPrisma().adviceLog.findMany({
    where: { userId, shownAt: { gte: new Date(now - HISTORY_DAYS * 86_400_000) }, NOT: { day: today } },
    select: { problemId: true, day: true, shownAt: true },
  })
  const out: Record<string, AdviceHistory & { days: Set<string> }> = {}
  for (const r of rows) {
    const h = (out[r.problemId] ??= { priorDays: 0, lastShownAt: 0, days: new Set() })
    h.days.add(r.day)
    h.priorDays = h.days.size
    h.lastShownAt = Math.max(h.lastShownAt, new Date(r.shownAt).getTime())
  }
  return Object.fromEntries(Object.entries(out).map(([k, { priorDays, lastShownAt }]) => [k, { priorDays, lastShownAt }]))
}

/** Remembers which problems this report put forward today (one row per problem and day). */
async function logAdvice(userId: string, report: AssistantReport, now: number): Promise<void> {
  const prisma = getPrisma()
  const day = localDay(now)
  for (const i of report.insights) {
    await prisma.adviceLog.upsert({
      where: { userId_problemId_day: { userId, problemId: i.problemId, day } },
      create: { userId, problemId: i.problemId, insightKey: i.key, moment: report.moment, day, shownAt: new Date(now) },
      update: { insightKey: i.key, moment: report.moment, shownAt: new Date(now) },
    })
  }
}

// ── Experiments (closed loop) ───────────────────────────────────────────

type ExperimentRow = Awaited<ReturnType<ReturnType<typeof getPrisma>['coachingExperiment']['findFirstOrThrow']>>

export const GRADUATED_BADGE = 'fundamental_graduated'
/** A finished experiment's verdict stays on screen this long. */
const RECENT_VERDICT_MS = 3 * 86_400_000

function parseJson<T>(json: string | null | undefined, fallback: T): T {
  try { return json ? (JSON.parse(json) as T) : fallback } catch { return fallback }
}

function toFinished(r: ExperimentRow): FinishedExperiment | null {
  if (r.status !== 'done' || !r.verdict || !r.endedAt) return null
  return { problemId: r.problemId, fundamentalId: r.fundamentalId, ruleId: r.ruleId, verdict: r.verdict as Verdict, endedAt: new Date(r.endedAt).getTime() }
}

function inputOf(r: ExperimentRow) {
  return {
    problemId: r.problemId,
    criterion: parseJson<Criterion>(r.criterion, { kind: 'noMistake', tags: [] }),
    baseline: parseJson(r.baseline, { games: 0 }),
    windowGames: r.windowGames,
    startedAt: new Date(r.startedAt).getTime(),
  }
}

function toView(r: ExperimentRow, ctx: PlayerContext, finished: FinishedExperiment[]): ExperimentView {
  const input = inputOf(r)
  let progress = evaluateExperiment(input, ctx.games)
  if (r.status === 'done' && r.results) {
    // Frozen at the verdict: later games or edits never change a past result.
    const results = parseJson<Array<{ gameId: string; passed: boolean; value: number | null }>>(r.results, [])
    progress = {
      results,
      counted: results.length,
      passes: results.filter((x) => x.passed).length,
      passRate: r.passRate,
      done: true,
      verdict: (r.verdict as Verdict | null) ?? null,
    }
  }
  const endedAt = r.endedAt ? new Date(r.endedAt).getTime() : null
  const latestForFundamental = finished
    .filter((f) => f.fundamentalId != null && f.fundamentalId === r.fundamentalId)
    .sort((a, b) => b.endedAt - a.endedAt)[0]
  const graduated = r.status === 'done' && r.fundamentalId != null
    && graduatedFundamentals(finished).includes(r.fundamentalId)
    && latestForFundamental?.endedAt === endedAt
  return {
    id: r.id,
    problemId: r.problemId,
    fundamentalId: r.fundamentalId,
    tagSlug: r.tagSlug,
    criterion: input.criterion,
    baseline: input.baseline,
    windowGames: r.windowGames,
    source: r.source,
    status: r.status as ExperimentView['status'],
    verdict: (r.verdict as Verdict | null) ?? null,
    startedAt: input.startedAt,
    endedAt,
    progress,
    graduated,
    nextObjectiveId: graduated && r.fundamentalId ? neighbourObjective(r.fundamentalId) : null,
  }
}

async function createExperiment(
  userId: string,
  ctx: PlayerContext,
  input: { problemId: string; tagSlug?: string | null; ruleId?: string | null; source: string; startedAt: number },
): Promise<ExperimentRow | null> {
  const problem = problemById(input.problemId)
  if (!problem) return null
  const label = input.tagSlug ? ctx.games.flatMap((g) => g.mistakes).find((m) => m.tagSlug === input.tagSlug)?.tagLabel ?? null : null
  const before = ctx.games.filter((g) => g.endedAt <= input.startedAt)
  const criterion = criterionForProblem(problem, ctx, input.tagSlug, label, before)
  if (!criterion) return null
  const prisma = getPrisma()
  // One experiment at a time: starting a new one abandons the current one.
  await prisma.coachingExperiment.updateMany({ where: { userId, status: 'active' }, data: { status: 'abandoned', endedAt: new Date() } })
  return prisma.coachingExperiment.create({
    data: {
      userId,
      problemId: problem.id,
      fundamentalId: problem.fundamentalId,
      ruleId: input.ruleId ?? null,
      tagSlug: input.tagSlug ?? null,
      criterion: JSON.stringify(criterion),
      baseline: JSON.stringify(baselineFor(criterion, before)),
      windowGames: DEFAULT_WINDOW,
      source: input.source,
      startedAt: new Date(input.startedAt),
    },
  })
}

export interface ExperimentState {
  active: ExperimentView | null
  /** Finished in the last 3 days (verdict banner), when nothing is active. */
  recent: ExperimentView | null
  history: ExperimentView[]
  finished: FinishedExperiment[]
  graduated: string[]
}

/**
 * Closes the active experiment once its window is full (verdict, badge) and,
 * when nothing is running, starts one from the active session's objective.
 */
export async function refreshExperiments(userId: string, ctx: PlayerContext, sessions: SessionRecord[], now: number): Promise<ExperimentState> {
  const prisma = getPrisma()
  let active: ExperimentRow | null = await prisma.coachingExperiment.findFirst({ where: { userId, status: 'active' }, orderBy: { startedAt: 'desc' } })
  let justFinished = false
  if (active) {
    const progress = evaluateExperiment(inputOf(active), ctx.games)
    if (progress.done) {
      await prisma.coachingExperiment.update({
        where: { id: active.id },
        data: { status: 'done', verdict: progress.verdict, passRate: progress.passRate, results: JSON.stringify(progress.results), endedAt: new Date(now) },
      })
      active = null
      justFinished = true
    }
  }

  if (!active && !justFinished) {
    const live = sessions.find((s) => s.status === 'active')
    if (live) {
      for (const objectiveId of live.objectiveIds) {
        const problem = problemForObjective(objectiveId)
        if (!problem) continue
        const already = await prisma.coachingExperiment.count({ where: { userId, fundamentalId: objectiveId, startedAt: { gte: new Date(live.date) } } })
        if (already) continue
        active = await createExperiment(userId, ctx, { problemId: problem.id, source: 'session', startedAt: live.date })
        if (active) break
      }
    }
  }

  const doneRows = await prisma.coachingExperiment.findMany({ where: { userId, status: 'done' }, orderBy: { endedAt: 'desc' }, take: 30 })
  const finished = doneRows.map(toFinished).filter((f): f is FinishedExperiment => f != null)
  const graduated = graduatedFundamentals(finished)
  if (justFinished && graduated.length) await tryUnlockBadge(userId, GRADUATED_BADGE).catch(() => {})
  const latestDone = doneRows[0]
  const recent = !active && latestDone?.endedAt && now - new Date(latestDone.endedAt).getTime() < RECENT_VERDICT_MS
    ? toView(latestDone, ctx, finished)
    : null
  return {
    active: active ? toView(active, ctx, finished) : null,
    recent,
    history: doneRows.slice(0, 10).map((r) => toView(r, ctx, finished)),
    finished,
    graduated,
  }
}

async function activeUserContext(now: number) {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) return null
  const accounts = await prisma.account.findMany({ where: { userId: user.id }, select: { puuid: true } })
  const { games, sessions } = await loadInputs(user.id, [user.puuid, ...accounts.map((a) => a.puuid)])
  return { user, sessions, ctx: buildPlayerContext({ games, sessions, now }) }
}

export async function getAssistantReport(moment: Moment, gameId?: string | null, now = Date.now()): Promise<AssistantReport | null> {
  const prisma = getPrisma()
  const loaded = await activeUserContext(now)
  if (!loaded) return null
  const { user, sessions, ctx } = loaded
  const experiments = await refreshExperiments(user.id, ctx, sessions, now)

  const votes = await prisma.assistantFeedback.findMany({
    where: { userId: user.id },
    select: { ruleId: true, insightKey: true, vote: true },
  })
  const votesByKey: Record<string, 1 | -1> = {}
  for (const v of votes) if (v.vote === 1 || v.vote === -1) votesByKey[v.insightKey] = v.vote

  const report = buildReport(ctx, {
    moment,
    gameId: gameId ?? null,
    playerName: user.displayName || user.summonerName,
    votesByRule: outcomeVotes(experiments.finished, tallyVotes(votes)),
    outcomes: problemOutcomes(experiments.finished, now),
    votesByKey,
    seed: `${user.id}:${new Date(now).toISOString().slice(0, 10)}`,
    history: await loadAdviceHistory(user.id, now),
  })
  report.experiment = experiments.active ?? experiments.recent
  await logAdvice(user.id, report, now).catch(() => { /* history is best-effort */ })
  return report
}

const RULE_IDS = new Set(RULES.map((r) => r.id))
const insightKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9_:.-]+$/, 'invalid insight key')
const ruleId = z.string().max(64).refine((r) => RULE_IDS.has(r), 'unknown rule')

export function registerAssistantHandlers(): void {
  validatedHandle(
    'assistant:get-report',
    z.tuple([z.enum(MOMENTS), id.nullable().optional()]),
    async (_e, moment, gameId) => getAssistantReport(moment, gameId ?? null),
  )

  validatedHandle('coach:experiments', z.tuple([]), async () => {
    const now = Date.now()
    const loaded = await activeUserContext(now)
    if (!loaded) return null
    const state = await refreshExperiments(loaded.user.id, loaded.ctx, loaded.sessions, now)
    return { active: state.active, recent: state.recent, history: state.history, graduated: state.graduated }
  })

  validatedHandle(
    'coach:start-experiment',
    z.tuple([
      z.string().max(40).refine((p) => problemById(p) != null, 'unknown problem'),
      z.string().max(64).regex(/^[a-z0-9-]+$/).nullable(),
      ruleId.nullable(),
    ]),
    async (_e, problemId, tagSlug, rule) => {
      const now = Date.now()
      const loaded = await activeUserContext(now)
      if (!loaded) throw new Error('No active user')
      const row = await createExperiment(loaded.user.id, loaded.ctx, { problemId, tagSlug, ruleId: rule, source: rule ? 'assistant' : 'player', startedAt: now })
      if (!row) throw new Error('NOT_MEASURABLE')
      return toView(row, loaded.ctx, [])
    },
  )

  validatedHandle('coach:abandon-experiment', z.tuple([id]), async (_e, experimentId) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No active user')
    await prisma.coachingExperiment.updateMany({
      where: { id: experimentId, userId: user.id, status: 'active' },
      data: { status: 'abandoned', endedAt: new Date() },
    })
    return { ok: true }
  })

  /** R2: did this game meet the running (or a finished) experiment's criterion? */
  validatedHandle('coach:objective-check', z.tuple([id]), async (_e, gameId) => {
    const now = Date.now()
    const loaded = await activeUserContext(now)
    if (!loaded) return null
    const state = await refreshExperiments(loaded.user.id, loaded.ctx, loaded.sessions, now)
    for (const exp of [state.active, ...state.history]) {
      const r = exp?.progress.results.find((x) => x.gameId === gameId)
      if (exp && r) return { experimentId: exp.id, problemId: exp.problemId, criterion: exp.criterion, passed: r.passed, value: r.value }
    }
    return null
  })

  /** R4/R5 — which unreviewed game to review first, and how big the backlog is. */
  validatedHandle('review:priority-game', z.tuple([]), async () => {
    const loaded = await activeUserContext(Date.now())
    if (!loaded) return null
    const unreviewed = loaded.ctx.games.filter((g) => !g.reviewed)
    const priority = pickPriorityGame(unreviewed, loaded.ctx.games)
    return priority ? { ...priority, backlogCount: unreviewed.length } : null
  })

  /** vote: 1 = 👍, -1 = 👎, 0 = withdraw the vote. */
  validatedHandle(
    'assistant:feedback',
    z.tuple([insightKey, ruleId, z.enum(MOMENTS), z.union([z.literal(1), z.literal(-1), z.literal(0)])]),
    async (_e, key, rule, moment, vote) => {
      const prisma = getPrisma()
      const user = await prisma.user.findFirst({ where: { isActive: true } })
      if (!user) throw new Error('No active user')
      if (vote === 0) {
        await prisma.assistantFeedback.deleteMany({ where: { userId: user.id, insightKey: key } })
        return { ok: true }
      }
      await prisma.assistantFeedback.upsert({
        where: { userId_insightKey: { userId: user.id, insightKey: key } },
        create: { userId: user.id, insightKey: key, ruleId: rule, moment, vote },
        update: { vote, ruleId: rule, moment },
      })
      return { ok: true }
    },
  )
}
