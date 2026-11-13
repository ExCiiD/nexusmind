/**
 * Assistant — A3 "voice": turns rule matches into ranked, explained insights
 * for one moment (post-game 3 points, session brief, weekly summary).
 *
 * The main process only picks *which* phrasing to use (i18n key + params);
 * the renderer translates it. Variant choice is a stable hash of the insight
 * and the day, so the wording changes from one day to the next but not on
 * every re-render.
 */

import { FUNDAMENTALS } from '../../../src/lib/constants/fundamentals'
import type { GameFeatures, PlayerContext } from './features'
import { diagnose, pickFocus, type AdviceHistory, type Diagnosis } from './diagnosis'
import { criterionForProblem, type ExperimentView, type ProblemOutcome } from './experiments'
import { problemForTag } from './problems'
import { rankWinDrivers, type WinDrivers } from './regression'
import { pickPriorityGame } from './reviewPriority'
import { evaluateRules, resolveParams, resolvePath, RULES, type Moment, type Rule, type RuleMatch, type Tone } from './rules'
import { seededRng, type RuleVotes } from './weights'

export interface RewatchClip {
  gameId: string
  matchId: string
  champion: string
  recordingId: string | null
  gameTimeSec: number
}

export type InsightAction =
  | { type: 'objective'; objectiveId: string }
  | { type: 'rewatch'; clips: RewatchClip[] }
  | { type: 'lanePhase'; gameId: string }
  | { type: 'break'; minutes: number }
  | { type: 'drill'; drillId: string }
  | { type: 'review'; gameId?: string }

export interface Insight {
  /** Stable id of this insight instance (rule + subject) — feedback key. */
  key: string
  ruleId: string
  tone: Tone
  messageKey: string
  params: Record<string, string | number>
  /** Params that are fundamental ids the renderer must localise. */
  paramKinds: Record<string, 'objective'>
  why: { key: string; params: Record<string, string | number> }
  action: InsightAction | null
  score: number
  confidence: number
  vote: 1 | -1 | null
  /** Coaching-engine problem this insight is about (problems.ts). */
  problemId: string
  /** Other rules that point to the same problem (shown as "confirmed by N signals"). */
  support: number
  /** The one thing to work on now (at most one per report). */
  focus: boolean
  /** Mistake tag behind the insight, if any (to start an experiment on it). */
  tagSlug: string | null
  /** A measurable experiment can be started from this insight. */
  canExperiment: boolean
}

export interface WeeklySummary {
  games: number
  wins: number
  winrate: number | null
  previousGames: number
  previousWinrate: number | null
  reviewed: number
}

export interface AssistantReport {
  moment: Moment
  generatedAt: number
  intro: { key: string; params: Record<string, string | number> }
  insights: Insight[]
  basisGames: number
  summary?: WeeklySummary
  drivers?: WinDrivers | null
  /** Active experiment, or one that just ended (attached by the IPC layer). */
  experiment?: ExperimentView | null
}

export interface BuildReportOptions {
  moment: Moment
  gameId?: string | null
  playerName?: string
  votesByRule?: Record<string, RuleVotes>
  votesByKey?: Record<string, 1 | -1>
  limit?: number
  /** Seed for the phrasing variant (defaults to the day). */
  seed?: string
  rules?: Rule[]
  /** Advice already shown on previous days, per problem (anti-repetition). */
  history?: Record<string, AdviceHistory>
  /** Pre-computed win drivers (computed from ctx when omitted). */
  drivers?: WinDrivers | null
  /** Past experiment verdicts per problem (outcome-based learning). */
  outcomes?: Record<string, ProblemOutcome>
}

const DEFAULT_LIMIT: Record<Moment, number> = { post_game: 3, session: 3, weekly: 4 }
const MAX_CLIPS = 4

/** Curated "next step" objectives; anything else falls back to the next fundamental of the same category. */
const NEIGHBOURS: Record<string, string> = {
  csing_pathing: 'wave_management',
  wave_management: 'trades',
  trades: 'wave_management',
  tempo: 'recall_timing',
  recall_timing: 'tempo',
  vision_control: 'map_awareness',
  vision_setup: 'map_awareness',
  map_awareness: 'vision_control',
  matchup_knowledge: 'trades',
  resilience: 'fortitude',
  fortitude: 'resilience',
}

export function neighbourObjective(objectiveId: string): string | null {
  if (NEIGHBOURS[objectiveId]) return NEIGHBOURS[objectiveId]
  for (const cat of FUNDAMENTALS) {
    const idx = cat.fundamentals.findIndex((f) => f.id === objectiveId)
    if (idx < 0) continue
    if (cat.fundamentals.length > 1) return cat.fundamentals[(idx + 1) % cat.fundamentals.length].id
  }
  return null
}

export function pickVariant(seed: string, variants: number): number {
  if (variants <= 1) return 1
  return 1 + Math.floor(seededRng(seed)() * variants)
}

function matchGames(match: RuleMatch): GameFeatures[] {
  return match.results.find((r) => r.games && r.games.length)?.games ?? []
}

function resolveAction(match: RuleMatch, ctx: PlayerContext, gameId: string | null): InsightAction | null {
  const spec = match.rule.action
  if (!spec) return null
  switch (spec.type) {
    case 'objective': return { type: 'objective', objectiveId: spec.objectiveId }
    case 'neighbourObjective': {
      const from = ctx.objectiveRun?.objectiveId
      const next = from ? neighbourObjective(from) : null
      return next ? { type: 'objective', objectiveId: next } : null
    }
    case 'break': return { type: 'break', minutes: spec.minutes }
    case 'drill': return { type: 'drill', drillId: spec.drillId }
    case 'review': {
      const unreviewed = ctx.games.filter((g) => !g.reviewed)
      const priority = pickPriorityGame(unreviewed, ctx.games)
      return { type: 'review', gameId: priority?.gameId }
    }
    case 'mistakeObjective': {
      const tag = match.results.find((r) => r.tagSlug)?.tagSlug
      const objectiveId = tag ? problemForTag(tag).fundamentalId : null
      return objectiveId ? { type: 'objective', objectiveId } : null
    }
    case 'lanePhase': {
      const id = gameId ?? matchGames(match)[0]?.gameId ?? ctx.games[0]?.gameId
      return id ? { type: 'lanePhase', gameId: id } : null
    }
    case 'rewatch': {
      const games = matchGames(match)
      const clips: RewatchClip[] = []
      if (spec.source === 'earlyDeaths') {
        for (const g of games) {
          for (const t of g.deathTimesSec ?? []) {
            if (t < 600) clips.push({ gameId: g.gameId, matchId: g.matchId, champion: g.champion, recordingId: g.recordingId, gameTimeSec: Math.round(t) })
          }
        }
      } else {
        const slug = match.results.find((r) => r.tagSlug)?.tagSlug
        for (const g of games) {
          for (const m of g.mistakes) {
            if (m.tagSlug !== slug) continue
            clips.push({ gameId: g.gameId, matchId: g.matchId, champion: g.champion, recordingId: m.recordingId ?? g.recordingId, gameTimeSec: m.gameTimeSec })
          }
        }
      }
      // Clips with a recording first — those can actually be re-watched.
      clips.sort((a, b) => Number(b.recordingId != null) - Number(a.recordingId != null))
      return clips.length ? { type: 'rewatch', clips: clips.slice(0, MAX_CLIPS) } : null
    }
  }
}

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function weeklySummary(ctx: PlayerContext): WeeklySummary {
  const week = 7 * 24 * 3600 * 1000
  const thisWeek = ctx.games.filter((g) => ctx.now - g.endedAt < week)
  const prevWeek = ctx.games.filter((g) => ctx.now - g.endedAt >= week && ctx.now - g.endedAt < 2 * week)
  const wr = (gs: GameFeatures[]) => (gs.length ? Math.round((gs.filter((g) => g.values.win === 1).length / gs.length) * 100) : null)
  return {
    games: thisWeek.length,
    wins: thisWeek.filter((g) => g.values.win === 1).length,
    winrate: wr(thisWeek),
    previousGames: prevWeek.length,
    previousWinrate: wr(prevWeek),
    reviewed: thisWeek.filter((g) => g.reviewed).length,
  }
}

export function buildInsights(ctx: PlayerContext, opts: BuildReportOptions): Insight[] {
  const rules = opts.rules ?? RULES
  const gameId = opts.moment === 'post_game' ? (opts.gameId ?? ctx.games[0]?.gameId ?? null) : null
  const seed = opts.seed ?? dayKey(ctx.now)
  const matches = evaluateRules(rules, ctx, { moment: opts.moment, gameId })
  const drivers = opts.drivers !== undefined ? opts.drivers : rankWinDrivers(ctx.games)
  const diagnoses = diagnose(matches, ctx, { moment: opts.moment, votesByRule: opts.votesByRule, drivers, history: opts.history, outcomes: opts.outcomes })
  const focus = pickFocus(diagnoses)

  const seenProblems = new Set<string>()
  const seenGroups = new Set<string>()
  const out: Insight[] = []
  for (const d of diagnoses) {
    // One message per problem (the best of its positive / negative readings) and per rule group.
    const problemKey = d.problem.id === 'other-mistakes' ? `${d.problem.id}:${d.lead.match.rule.id}` : d.problem.id
    if (seenProblems.has(problemKey)) continue
    const group = d.lead.match.rule.group
    if (group && seenGroups.has(group)) continue
    seenProblems.add(problemKey)
    if (group) seenGroups.add(group)
    out.push(toInsight(d, d === focus, ctx, opts, gameId, seed))
    if (out.length >= (opts.limit ?? DEFAULT_LIMIT[opts.moment])) break
  }
  return out
}

function toInsight(d: Diagnosis, isFocus: boolean, ctx: PlayerContext, opts: BuildReportOptions, gameId: string | null, seed: string): Insight {
  const m = d.lead.match
  const key = `${m.rule.id}:${m.subject}`
  const { params, paramKinds } = resolveParams(m)
  if (opts.playerName) params.name = opts.playerName
  const whyN = m.rule.why.n ? resolvePath(m.evidence, m.rule.why.n) : null
  let action = resolveAction(m, ctx, gameId)
  // The focus always comes with something to work on: its fundamental becomes the suggested objective,
  // or, after two experiments without effect, a neighbouring fundamental (another angle).
  if (isFocus && d.problem.fundamentalId) {
    const next = d.stuck ? neighbourObjective(d.problem.fundamentalId) : null
    if (next) action = { type: 'objective', objectiveId: next }
    else if (!action) action = { type: 'objective', objectiveId: d.problem.fundamentalId }
  }
  const tagSlug = m.results.find((x) => x.tagSlug)?.tagSlug ?? null
  return {
    key,
    ruleId: m.rule.id,
    tone: m.rule.tone,
    messageKey: `assistant.rules.${m.rule.id}.v${pickVariant(`${key}:${seed}`, m.rule.variants)}`,
    params,
    paramKinds,
    why: { key: `assistant.why.${m.rule.why.key}`, params: whyN != null ? { n: whyN } : {} },
    action,
    score: Number(d.score.toFixed(4)),
    confidence: Number(d.confidence.toFixed(3)),
    vote: opts.votesByKey?.[key] ?? null,
    problemId: d.problem.id,
    support: new Set(d.support.map((s) => s.match.rule.id).filter((id) => id !== m.rule.id)).size,
    focus: isFocus,
    tagSlug,
    canExperiment: d.polarity === 'negative' && !d.problem.unscored && criterionForProblem(d.problem, ctx, tagSlug) != null,
  }
}

export function buildReport(ctx: PlayerContext, opts: BuildReportOptions): AssistantReport {
  const seed = opts.seed ?? dayKey(ctx.now)
  const drivers = opts.drivers !== undefined ? opts.drivers : rankWinDrivers(ctx.games)
  const insights = buildInsights(ctx, { ...opts, seed, drivers })
  const name = opts.playerName ?? ''
  const introBase = ctx.games.length < 3 ? 'assistant.intro.notEnough' : `assistant.intro.${opts.moment}`
  const report: AssistantReport = {
    moment: opts.moment,
    generatedAt: ctx.now,
    intro: {
      key: `${introBase}.v${pickVariant(`intro:${opts.moment}:${seed}`, 3)}`,
      params: { name, n: ctx.games.length },
    },
    insights,
    basisGames: ctx.games.length,
  }
  if (opts.moment === 'weekly') {
    report.summary = weeklySummary(ctx)
    report.drivers = drivers
  }
  return report
}
