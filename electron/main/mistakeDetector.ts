/**
 * Mistake Library — heuristic auto-detection.
 *
 * Pure function: walks the Riot Match-Timeline-V5 + Match-V5 data and
 * emits "candidate" mistakes for 4 well-defined patterns. The IPC layer
 * persists the candidates (with `autoDetected: true`) and the renderer
 * decides whether to show them via a "Show auto-detected" toggle.
 *
 * Conservative by design — false positives erode trust in the feature
 * faster than missing detections. When in doubt, return nothing.
 */

import type { PlayerSelector } from './eventExtractor'
import { detectAdvancedMistakes, type AdvancedTag } from './mistakeRules'

export interface MistakeCandidate {
  tagSlug: 'unused-gold' | 'dove-tower' | 'late-back' | 'overstay' | AdvancedTag
  gameTimeSec: number
  note?: string
  severity?: 1 | 2 | 3
}

interface ParticipantInfo {
  participantId: number
  puuid: string
  championName: string
  teamId: 100 | 200
}

/**
 * Approximate Summoner's Rift turret coordinates. Pulled from public Riot
 * data and rounded — accurate to ~50 units, which is plenty for a "did the
 * player die <700u of a tower" check. Only outer/inner/inhib turrets are
 * included; nexus turrets are inside the fountain so we never flag those.
 */
const TURRET_POSITIONS: Record<100 | 200, Array<{ x: number; y: number }>> = {
  // Blue side towers — turrets that BELONG to team 100 (the player's side
  // if teamId=100). When the player is on team 100 these are friendly, so
  // we'd compare against the 200 list and vice versa.
  100: [
    // Top lane
    { x: 981,   y: 10441 }, // outer
    { x: 1512,  y: 6699 },  // inner
    { x: 1169,  y: 4287 },  // inhib
    // Mid lane
    { x: 5846,  y: 6396 },  // outer
    { x: 5048,  y: 4812 },  // inner
    { x: 3651,  y: 3696 },  // inhib
    // Bot lane
    { x: 10504, y: 1029 },  // outer
    { x: 6919,  y: 1483 },  // inner
    { x: 4281,  y: 1253 },  // inhib
  ],
  // Red side towers — symmetric around (~7500, 7500)
  200: [
    { x: 14029, y: 4564 },  // top outer
    { x: 13498, y: 8306 },  // top inner
    { x: 13841, y: 10719 }, // top inhib
    { x: 9164,  y: 8609 },  // mid outer
    { x: 9962,  y: 10193 }, // mid inner
    { x: 11359, y: 11309 }, // mid inhib
    { x: 4506,  y: 13976 }, // bot outer
    { x: 8091,  y: 13522 }, // bot inner
    { x: 10729, y: 13752 }, // bot inhib
  ],
}

/**
 * Fountain centers, used to detect recalls (player position teleports to
 * a small disc around the fountain).
 */
const FOUNTAIN_POSITIONS: Record<100 | 200, { x: number; y: number }> = {
  100: { x: 400,   y: 400 },
  200: { x: 14400, y: 14400 },
}
const FOUNTAIN_RADIUS = 2200
const TOWER_DEATH_RADIUS = 700

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Projection of point `p` onto the axis running from the player's own
 * fountain (`own`) to the enemy fountain (`enemy`), normalized to [0, 1].
 *   0   → at own fountain
 *   0.5 → mid (river diagonal)
 *   1   → at enemy fountain
 * Used to decide whether a death happened "deep" in enemy territory.
 * Side-agnostic (works for both blue and red teams).
 */
function enemyTerritoryProgress(
  p: { x: number; y: number },
  own: { x: number; y: number },
  enemy: { x: number; y: number },
): number {
  const ax = enemy.x - own.x
  const ay = enemy.y - own.y
  const len2 = ax * ax + ay * ay
  if (len2 === 0) return 0
  const t = ((p.x - own.x) * ax + (p.y - own.y) * ay) / len2
  return Math.max(0, Math.min(1, t))
}

function resolvePlayer(participants: ParticipantInfo[], match: any, selector: PlayerSelector): ParticipantInfo | null {
  if (selector.puuids?.length) {
    const set = new Set(selector.puuids)
    const hit = participants.find((p) => p.puuid && set.has(p.puuid))
    if (hit) return hit
  }
  if (selector.championName) {
    const champ = selector.championName.toLowerCase()
    const same = participants.filter((p) => p.championName?.toLowerCase() === champ)
    if (same.length === 1) return same[0]
    if (same.length > 1 && typeof selector.win === 'boolean') {
      const teams = match?.info?.teams ?? []
      const winningTeamId = teams.find((t: any) => t.win === true)?.teamId
      if (winningTeamId) {
        const playerTeamId = selector.win ? winningTeamId : winningTeamId === 100 ? 200 : 100
        const onSide = same.find((p) => p.teamId === playerTeamId)
        if (onSide) return onSide
      }
      return same[0]
    }
  }
  return null
}

export function detectMistakes(
  timelineJson: string | object,
  matchJson: string | object,
  selector: PlayerSelector,
): MistakeCandidate[] {
  let timeline: any, match: any
  try {
    timeline = typeof timelineJson === 'string' ? JSON.parse(timelineJson) : timelineJson
    match = typeof matchJson === 'string' ? JSON.parse(matchJson) : matchJson
  } catch {
    return []
  }
  if (!timeline?.info?.frames || !match?.info?.participants) return []

  const participants: ParticipantInfo[] = match.info.participants.map((p: any) => ({
    participantId: p.participantId,
    puuid: p.puuid,
    championName: p.championName,
    teamId: p.teamId,
  }))

  const player = resolvePlayer(participants, match, selector)
  if (!player) return []
  const pid = player.participantId
  const enemyTeamId: 100 | 200 = player.teamId === 100 ? 200 : 100
  const enemyTurrets = TURRET_POSITIONS[enemyTeamId]
  const fountain = FOUNTAIN_POSITIONS[player.teamId as 100 | 200]
  const enemyFountain = FOUNTAIN_POSITIONS[enemyTeamId]

  const out: MistakeCandidate[] = []
  const frames: any[] = timeline.info.frames

  // First pass: extract a chronological list of the player's ITEM_PURCHASED
  // timestamps so the late-back heuristic can ask "when did I last spend
  // gold?".
  const playerPurchases: number[] = []
  // Timestamps where the player got the last hit on an enemy turret plate.
  // Used by the overstay heuristic ("took one more plate then died").
  const playerPlateTimestamps: number[] = []
  for (const f of frames) {
    for (const ev of (f.events ?? []) as any[]) {
      if (ev.type === 'ITEM_PURCHASED' && ev.participantId === pid && typeof ev.timestamp === 'number') {
        playerPurchases.push(ev.timestamp)
      }
      if (ev.type === 'TURRET_PLATE_DESTROYED' && ev.killerId === pid && typeof ev.timestamp === 'number') {
        playerPlateTimestamps.push(ev.timestamp)
      }
    }
  }
  playerPurchases.sort((a, b) => a - b)
  playerPlateTimestamps.sort((a, b) => a - b)

  // Helper — get player gold at the frame just before a timestamp ms.
  function goldAtTs(ts: number): number {
    let lastGold = 0
    for (const f of frames) {
      const fts = f.timestamp ?? 0
      if (fts > ts) break
      const pf = f.participantFrames?.[String(pid)]
      if (typeof pf?.currentGold === 'number') lastGold = pf.currentGold
    }
    return lastGold
  }

  // Pre-pass: collect timestamps of major objective kills (dragon, baron,
  // herald, atakhan, voidgrubs). The overstay heuristic excludes deaths
  // that happen within OBJECTIVE_WINDOW_MS of one of these — those are
  // teamfight deaths in a contested objective context, not actual
  // "should have reset" overstays. Massive false-positive reducer.
  const OBJECTIVE_WINDOW_MS = 30_000
  const objectiveKillTimestamps: number[] = []
  for (const f of frames) {
    for (const ev of (f.events ?? []) as any[]) {
      if (ev.type === 'ELITE_MONSTER_KILL' && typeof ev.timestamp === 'number') {
        objectiveKillTimestamps.push(ev.timestamp)
      }
    }
  }
  const inObjectiveWindow = (ts: number): boolean =>
    objectiveKillTimestamps.some((ots) => Math.abs(ts - ots) <= OBJECTIVE_WINDOW_MS)

  // ── Overstay tuning ─────────────────────────────────────────────────
  // A death counts as a greedy "overstay" when, OUTSIDE an objective
  // fight, it shows one of two greed signals:
  //   1. the player took a turret plate in the GREED_PLATE_WINDOW before
  //      dying ("one more plate"), or
  //   2. the death happened deep in enemy territory — past
  //      DEEP_ENEMY_PROGRESS along the own→enemy fountain axis ("one more
  //      wave" / went for an enemy camp / refused to reset on the map).
  const GREED_PLATE_WINDOW_MS = 20_000
  const DEEP_ENEMY_PROGRESS = 0.6

  // Track player position per frame so we can detect a recall (sudden jump
  // to fountain area between consecutive frames).
  let prevFrameInFountain = false
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const pf = f.participantFrames?.[String(pid)]
    const pos = pf?.position
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      const inFountain = dist2(pos, fountain) <= FOUNTAIN_RADIUS * FOUNTAIN_RADIUS
      // late-back: just teleported INTO fountain this frame, with high
      // currentGold and no purchase in the last 4 minutes → emit at the
      // recall time (≈ frame ts).
      if (!prevFrameInFountain && inFountain && i > 0) {
        const ts: number = f.timestamp ?? 0
        const gold = typeof pf.currentGold === 'number' ? pf.currentGold : goldAtTs(ts)
        const lastPurchaseTs = [...playerPurchases].reverse().find((p) => p <= ts) ?? 0
        const minutesSincePurchase = (ts - lastPurchaseTs) / 60_000
        if (gold > 2000 && minutesSincePurchase > 4) {
          out.push({
            tagSlug: 'late-back',
            gameTimeSec: Math.floor(ts / 1000),
            note: `Recall with ${gold}g unspent (~${minutesSincePurchase.toFixed(1)}min since last purchase)`,
            severity: 2,
          })
        }
      }
      prevFrameInFountain = inFountain
    } else {
      prevFrameInFountain = false
    }

    // CHAMPION_KILL events on this frame where the player died.
    for (const ev of (f.events ?? []) as any[]) {
      if (ev.type !== 'CHAMPION_KILL' || ev.victimId !== pid) continue
      const ts: number = ev.timestamp ?? 0
      const evPos = ev.position
      const gold = goldAtTs(ts)

      // unused-gold: died with > 1500g unspent. Strong indicator of poor
      // back timing or distraction.
      if (gold > 1500) {
        out.push({
          tagSlug: 'unused-gold',
          gameTimeSec: Math.floor(ts / 1000),
          note: `Died with ${gold}g unspent`,
          severity: gold > 2500 ? 3 : 2,
        })
      }

      // dove-tower: died within 700u of an enemy outer/inner/inhib turret.
      if (evPos && typeof evPos.x === 'number' && typeof evPos.y === 'number') {
        const closest = enemyTurrets.reduce<{ d2: number } | null>((best, t) => {
          const d = dist2(evPos, t)
          return !best || d < best.d2 ? { d2: d } : best
        }, null)
        if (closest && closest.d2 <= TOWER_DEATH_RADIUS * TOWER_DEATH_RADIUS) {
          out.push({
            tagSlug: 'dove-tower',
            gameTimeSec: Math.floor(ts / 1000),
            note: `Died ${Math.round(Math.sqrt(closest.d2))}u from an enemy turret`,
            severity: 3,
          })
        }
      }

      // overstay (greed): re-modeled after the player's definition —
      // greed / "one more wave" / refusing to accept the map state. We no
      // longer fire on any multi-attacker collapse (that flagged almost
      // every teamfight). Instead, OUTSIDE an objective fight, a death is
      // an overstay only when it carries a greed signal:
      //   • took an enemy turret plate in the last GREED_PLATE_WINDOW
      //     ("one more plate" before resetting), or
      //   • died deep in enemy territory — past DEEP_ENEMY_PROGRESS on the
      //     own→enemy fountain axis ("one more wave" / went for an enemy
      //     camp / stayed pushed instead of recalling).
      // Severity climbs when both signals coincide.
      if (!inObjectiveWindow(ts)) {
        const tookPlate = playerPlateTimestamps.some(
          (pts) => pts <= ts && ts - pts <= GREED_PLATE_WINDOW_MS,
        )
        let deep = false
        let progress = 0
        if (evPos && typeof evPos.x === 'number' && typeof evPos.y === 'number') {
          progress = enemyTerritoryProgress(evPos, fountain, enemyFountain)
          deep = progress >= DEEP_ENEMY_PROGRESS
        }
        if (tookPlate || deep) {
          const reasons: string[] = []
          if (tookPlate) reasons.push('took a plate just before')
          if (deep) reasons.push(`died ${Math.round(progress * 100)}% into enemy territory`)
          out.push({
            tagSlug: 'overstay',
            gameTimeSec: Math.floor(ts / 1000),
            note: `Greed — ${reasons.join(' · ')}`,
            severity: tookPlate && deep ? 3 : 2,
          })
        }
      }
    }
  }

  // Rules M5–M13 (see docs/AUDIT_REGLES_METIER.md §3.1).
  const raw = match.info.participants.find((p: any) => p.participantId === pid)
  out.push(...detectAdvancedMistakes(timeline, match, {
    participantId: pid,
    teamId: player.teamId,
    championName: player.championName,
    position: raw?.teamPosition ?? raw?.individualPosition ?? '',
  }))

  return out
}
