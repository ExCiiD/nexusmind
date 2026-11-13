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
import { rankWinDrivers, type WinDrivers } from './regression'
import { evaluateRules, resolveParams, resolvePath, RULES, type Moment, type Rule, type RuleMatch, type Tone } from './rules'
import { ruleMultiplier, seededRng, type RuleVotes } from './weights'

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
  | { type: 'review' }

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
    case 'review': return { type: 'review' }
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

  const scored = matches.map((m) => {
    const multiplier = m.rule.fixedWeight ? 1 : ruleMultiplier(opts.votesByRule?.[m.rule.id])
    return { m, score: (m.rule.priority / 100) * m.rule.confidence * multiplier }
  })
  scored.sort((a, b) => b.score - a.score || a.m.rule.id.localeCompare(b.m.rule.id))

  const seenGroups = new Set<string>()
  const out: Insight[] = []
  for (const { m, score } of scored) {
    if (m.rule.group) {
      if (seenGroups.has(m.rule.group)) continue
      seenGroups.add(m.rule.group)
    }
    const key = `${m.rule.id}:${m.subject}`
    const { params, paramKinds } = resolveParams(m)
    if (opts.playerName) params.name = opts.playerName
    const whyN = m.rule.why.n ? resolvePath(m.evidence, m.rule.why.n) : null
    out.push({
      key,
      ruleId: m.rule.id,
      tone: m.rule.tone,
      messageKey: `assistant.rules.${m.rule.id}.v${pickVariant(`${key}:${seed}`, m.rule.variants)}`,
      params,
      paramKinds,
      why: { key: `assistant.why.${m.rule.why.key}`, params: whyN != null ? { n: whyN } : {} },
      action: resolveAction(m, ctx, gameId),
      score: Number(score.toFixed(4)),
      confidence: m.rule.confidence,
      vote: opts.votesByKey?.[key] ?? null,
    })
    if (out.length >= (opts.limit ?? DEFAULT_LIMIT[opts.moment])) break
  }
  return out
}

export function buildReport(ctx: PlayerContext, opts: BuildReportOptions): AssistantReport {
  const seed = opts.seed ?? dayKey(ctx.now)
  const insights = buildInsights(ctx, { ...opts, seed })
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
    report.drivers = rankWinDrivers(ctx.games)
  }
  return report
}
