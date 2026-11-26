/**
 * Role quests in the bilans (docs/PLAN_MOTEUR_BILANS.md phase 4, docs/engine-reports/2026-11-20-quetes-de-role-dans-le-bilan-des-roams.md).
 *
 * The timeline carries no quest event, but each role holds a quest item that an ITEM_DESTROYED removes when the quest ends
 * (ids checked on 483 cached 16.x games, 16.1 to 16.23: no change at 16.9 nor 16.16, docs/engine-reports/2026-11-26-verifs-bilans.md).
 * The real end of the quest of a player, and of their direct opponent, gives the gap the bilans can show. A model of the
 * points (CS, takedowns, time in lane) is NOT used for the verdict: see roleQuestModel below and
 * docs/engine-reports/2026-11-26-calibrage-quetes.md for what the check on the cache concluded.
 */
import { patchOf } from './gameClock'

/** Quest item ids by role. Top has two variants; the support's item is destroyed several times (the last one ends the quest). */
export const QUEST_ITEM_IDS: Record<string, readonly number[]> = {
  TOP: [1200, 1222],
  MIDDLE: [1201],
  BOTTOM: [1202],
  UTILITY: [1203],
  JUNGLE: [1204],
}

/** Last 16.x minor patch whose ids were checked on the cache; a later patch is read in "careful mode" (the gap is kept, flagged unverified). */
export const LAST_VERIFIED_MINOR = 23

export interface QuestEnd {
  /** Game second at which the quest ended (the quest item left the inventory). */
  endSec: number
}

const positionOf = (p: any): string => p?.teamPosition || p?.individualPosition || ''

/** When the quest of participant `pid` ended, from the ITEM_DESTROYED of its quest item; null when the item never left (or no such event). */
export function questCompletion(match: any, timeline: any, pid: number): QuestEnd | null {
  const me = (match?.info?.participants ?? []).find((p: any) => p.participantId === pid)
  const ids = me ? QUEST_ITEM_IDS[positionOf(me)] : undefined
  if (!ids) return null
  const times: number[] = []
  for (const f of timeline?.info?.frames ?? []) {
    for (const e of f.events ?? []) {
      if (e.type === 'ITEM_DESTROYED' && e.participantId === pid && ids.includes(e.itemId) && typeof e.timestamp === 'number') times.push(e.timestamp)
    }
  }
  if (times.length === 0) return null
  times.sort((a, b) => a - b)
  return { endSec: Math.round((positionOf(me) === 'UTILITY' ? times[times.length - 1] : times[0]) / 1000) }
}

export interface QuestGap {
  endSec: number
  opponentEndSec: number
  /** Positive: the player finished later than their direct opponent (behind); negative: ahead. */
  gapSec: number
  /** The patch is one whose item ids were checked (16.1 to LAST_VERIFIED_MINOR). */
  verified: boolean
}

/** The real quest gap with the direct opponent of the same role; null when either quest never ended or there is no opponent. */
export function questGap(match: any, timeline: any, pid: number): QuestGap | null {
  const parts: any[] = match?.info?.participants ?? []
  const me = parts.find((p) => p.participantId === pid)
  if (!me) return null
  const opp = parts.find((p) => p.teamId !== me.teamId && positionOf(p) === positionOf(me))
  if (!opp) return null
  const a = questCompletion(match, timeline, pid)
  const b = questCompletion(match, timeline, opp.participantId)
  if (!a || !b) return null
  const patch = patchOf(match)
  return { endSec: a.endSec, opponentEndSec: b.endSec, gapSec: a.endSec - b.endSec, verified: patch.major === 16 && patch.minor != null && patch.minor <= LAST_VERIFIED_MINOR }
}
