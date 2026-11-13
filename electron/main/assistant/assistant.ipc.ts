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
import { buildPlayerContext, laneFromReport, type GameRecord, type SessionRecord } from './features'
import { buildReport, type AssistantReport } from './report'
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
      mistakes: { select: { id: true, gameTimeSec: true, recordingId: true, tag: { select: { slug: true, label: true } } } },
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
      mistakes: g.mistakes.map((m) => ({
        id: m.id,
        tagSlug: m.tag.slug,
        tagLabel: m.tag.label,
        gameTimeSec: m.gameTimeSec,
        recordingId: m.recordingId,
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

export async function getAssistantReport(moment: Moment, gameId?: string | null, now = Date.now()): Promise<AssistantReport | null> {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) return null
  const accounts = await prisma.account.findMany({ where: { userId: user.id }, select: { puuid: true } })
  const { games, sessions } = await loadInputs(user.id, [user.puuid, ...accounts.map((a) => a.puuid)])
  const ctx = buildPlayerContext({ games, sessions, now })

  const votes = await prisma.assistantFeedback.findMany({
    where: { userId: user.id },
    select: { ruleId: true, insightKey: true, vote: true },
  })
  const votesByKey: Record<string, 1 | -1> = {}
  for (const v of votes) if (v.vote === 1 || v.vote === -1) votesByKey[v.insightKey] = v.vote

  return buildReport(ctx, {
    moment,
    gameId: gameId ?? null,
    playerName: user.displayName || user.summonerName,
    votesByRule: tallyVotes(votes),
    votesByKey,
    seed: `${user.id}:${new Date(now).toISOString().slice(0, 10)}`,
  })
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
