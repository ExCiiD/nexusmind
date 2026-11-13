/**
 * Assistant — small pure extractor for the per-game facts the feature store
 * needs from cached Riot JSON: the player's death timestamps and kill
 * participation, plus lane numbers when no LanePhaseReport is cached.
 */

import { analyzeLanePhase } from '../lanePhaseAnalyzer'
import type { PlayerSelector } from '../eventExtractor'
import { laneFromReport, type LaneRecord } from './features'

export interface TimelineFacts {
  deathTimesSec: number[] | null
  killParticipation: number | null
  lane: LaneRecord | null
}

function parse(json: string | object | null | undefined): any {
  if (json == null) return null
  if (typeof json !== 'string') return json
  try { return JSON.parse(json) } catch { return null }
}

export function resolveParticipant(match: any, selector: PlayerSelector): any | null {
  const participants: any[] = match?.info?.participants ?? []
  if (selector.puuids?.length) {
    const set = new Set(selector.puuids)
    const hit = participants.find((p) => p.puuid && set.has(p.puuid))
    if (hit) return hit
  }
  if (selector.championName) {
    const champ = selector.championName.toLowerCase()
    const same = participants.filter((p) => String(p.championName ?? '').toLowerCase() === champ)
    if (same.length === 1) return same[0]
    if (same.length > 1 && typeof selector.win === 'boolean') return same.find((p) => p.win === selector.win) ?? same[0]
  }
  return null
}

export function extractTimelineFacts(
  matchJson: string | object | null,
  timelineJson: string | object | null,
  selector: PlayerSelector,
  opts: { computeLane?: boolean } = {},
): TimelineFacts {
  const match = parse(matchJson)
  const timeline = parse(timelineJson)
  const empty: TimelineFacts = { deathTimesSec: null, killParticipation: null, lane: null }
  if (!match) return empty
  const p = resolveParticipant(match, selector)
  if (!p) return empty

  const teamKills = (match.info.participants as any[])
    .filter((x) => x.teamId === p.teamId)
    .reduce((a, x) => a + (x.kills ?? 0), 0)
  const killParticipation = teamKills > 0 ? (((p.kills ?? 0) + (p.assists ?? 0)) / teamKills) * 100 : null

  let deathTimesSec: number[] | null = null
  const frames: any[] | undefined = timeline?.info?.frames
  if (Array.isArray(frames)) {
    deathTimesSec = []
    for (const f of frames) {
      for (const e of f.events ?? []) {
        if (e.type === 'CHAMPION_KILL' && e.victimId === p.participantId) deathTimesSec.push(Math.round((e.timestamp ?? 0) / 1000))
      }
    }
  }

  let lane: LaneRecord | null = null
  if (opts.computeLane && timeline) {
    try {
      lane = laneFromReport(analyzeLanePhase({ matchJson: match, timelineJson: timeline, selector }).report)
    } catch { lane = null }
  }
  return { deathTimesSec, killParticipation, lane }
}
