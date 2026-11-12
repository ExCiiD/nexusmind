/**
 * Lane Phase Comparator — analyzer.
 *
 * Pure function that crunches a Riot Match-V5 + Timeline-V5 pair into a
 * compact "lane phase" report covering the first 14 minutes (the standard
 * laning phase, before plates fall and mid game starts).
 *
 * The output is small (~14 frames × ~5 fields), JSON-serializable and
 * cacheable on the Game row. The renderer just draws charts from it.
 *
 * Player resolution reuses the same cascade as eventExtractor.resolvePlayer
 * (PUUID first, then champion name + win flag) so unlinked accounts still
 * get a report.
 */

import type { PlayerSelector } from './eventExtractor'

export interface LanePhaseInput {
  matchJson: string | object
  timelineJson: string | object
  selector: PlayerSelector
}

export type LanePhaseGrade = 'S' | 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F'

export type LanePhaseReason =
  | 'ok'
  | 'no-player'
  | 'no-opponent'
  | 'no-frames'
  | 'bad-data'

export interface LanePhaseDiagnostic {
  reason: LanePhaseReason
  message?: string
  /** How the player was resolved — mirrors loadGameEvents diag. */
  playerResolvedVia?: 'puuid' | 'champion' | 'none'
  /** Total frames in the timeline (may be less than 15 for short games). */
  frameCount?: number
}

export interface LanePhaseFrameStat {
  player: number
  opponent: number
  diff: number
}

export interface LanePhaseFrame {
  /** Frame minute, 0 = pre-game, 1 = 0:00–1:00 boundary, etc. */
  minute: number
  cs: LanePhaseFrameStat
  gold: LanePhaseFrameStat
  xp: LanePhaseFrameStat
  level: LanePhaseFrameStat
  damageTaken: LanePhaseFrameStat
  /** Cumulative damage dealt to champions (player vs opponent). */
  damageDealt: LanePhaseFrameStat
}

export interface LanePhasePlate {
  minute: number
  takenByPlayer: boolean
}

export interface LanePhaseSoloEvent {
  minute: number
  type: 'kill' | 'death'
}

export interface LanePhaseScoreComponents {
  csAt14: number
  goldAt14: number
  xpAt14: number
  soloKD: { k: number; d: number }
  plates: { taken: number; lost: number }
  /** Damage dealt to champions @14 (player vs opponent + diff). */
  dmgAt14: { player: number; opponent: number; diff: number }
  /** Kill participation during the laning phase (0..1) for both laners. */
  kp: { player: number; opponent: number }
  /** Full-game damage dealt to objectives (turrets, dragons, baron…). Not
   *  laning-phase-scoped — the timeline doesn't track objective damage per
   *  minute — but useful as a relative comparison vs the lane opponent. */
  objDmg: { player: number; opponent: number }
  numericScore: number
}

export interface LanePhaseReport {
  schemaVersion: 2
  player: { participantId: number; puuid?: string; championName: string; teamPosition: string }
  opponent: { participantId: number; championName: string; teamPosition: string }
  framesByMinute: LanePhaseFrame[]
  plates: LanePhasePlate[]
  soloEvents: LanePhaseSoloEvent[]
  grade: LanePhaseGrade
  scoreComponents: LanePhaseScoreComponents
}

export interface LanePhaseResult {
  report: LanePhaseReport | null
  diag: LanePhaseDiagnostic
}

interface ParticipantInfo {
  participantId: number
  puuid: string
  championName: string
  teamId: 100 | 200
  teamPosition: string
}

interface FrameParticipantStats {
  currentGold?: number
  totalGold?: number
  level?: number
  xp?: number
  minionsKilled?: number
  jungleMinionsKilled?: number
  position?: { x?: number; y?: number }
  damageStats?: {
    totalDamageTaken?: number
    totalDamageDone?: number
    totalDamageDoneToChampions?: number
  }
}

interface MatchParticipantStats {
  participantId: number
  damageDealtToObjectives?: number
}

/** Cap analysis at the standard laning phase boundary. */
const MAX_MINUTE = 14

/**
 * Resolve player participantId — same cascade as eventExtractor. Kept inline
 * to avoid coupling to that module's internal helpers.
 */
function resolvePlayer(
  participants: ParticipantInfo[],
  match: any,
  selector: PlayerSelector,
): { participant: ParticipantInfo; via: 'puuid' | 'champion' } | null {
  if (selector.puuids?.length) {
    const set = new Set(selector.puuids)
    const hit = participants.find((p) => p.puuid && set.has(p.puuid))
    if (hit) return { participant: hit, via: 'puuid' }
  }
  if (selector.championName) {
    const champ = selector.championName.toLowerCase()
    const same = participants.filter((p) => p.championName?.toLowerCase() === champ)
    if (same.length === 1) return { participant: same[0], via: 'champion' }
    if (same.length > 1 && typeof selector.win === 'boolean') {
      const teams = match?.info?.teams ?? []
      const winningTeamId = teams.find((t: any) => t.win === true)?.teamId
      if (winningTeamId) {
        const playerTeamId = selector.win ? winningTeamId : winningTeamId === 100 ? 200 : 100
        const onSide = same.find((p) => p.teamId === playerTeamId)
        if (onSide) return { participant: onSide, via: 'champion' }
      }
      return { participant: same[0], via: 'champion' }
    }
  }
  return null
}

/**
 * Find the laning opponent.
 *   1. Same teamPosition on the opposing team (the cheap, accurate case).
 *   2. Fallback: closest opponent across early frames (1–8) by average
 *      Euclidean distance on the map. Handles Arena/customs/swaps where
 *      teamPosition is missing or wrong.
 */
function resolveOpponent(
  player: ParticipantInfo,
  participants: ParticipantInfo[],
  frames: any[],
): ParticipantInfo | null {
  const opponents = participants.filter((p) => p.teamId !== player.teamId)
  if (opponents.length === 0) return null

  if (player.teamPosition) {
    const sameRole = opponents.find((o) => o.teamPosition === player.teamPosition)
    if (sameRole) return sameRole
  }

  // Distance fallback. We pick the opponent who minimises sum-of-distances to
  // the player over the first ~8 frames where both have a position.
  const sampled = frames.slice(0, Math.min(frames.length, 9))
  const distances = new Map<number, { total: number; samples: number }>()
  for (const o of opponents) distances.set(o.participantId, { total: 0, samples: 0 })

  for (const frame of sampled) {
    const pfs = frame.participantFrames ?? {}
    const playerPos = pfs[String(player.participantId)]?.position
    if (!playerPos || typeof playerPos.x !== 'number' || typeof playerPos.y !== 'number') continue
    for (const o of opponents) {
      const oppPos = pfs[String(o.participantId)]?.position
      if (!oppPos || typeof oppPos.x !== 'number' || typeof oppPos.y !== 'number') continue
      const dx = playerPos.x - oppPos.x
      const dy = playerPos.y - oppPos.y
      const d = Math.sqrt(dx * dx + dy * dy)
      const entry = distances.get(o.participantId)!
      entry.total += d
      entry.samples += 1
    }
  }

  let best: ParticipantInfo | null = null
  let bestAvg = Infinity
  for (const o of opponents) {
    const entry = distances.get(o.participantId)!
    if (entry.samples === 0) continue
    const avg = entry.total / entry.samples
    if (avg < bestAvg) {
      bestAvg = avg
      best = o
    }
  }
  // If absolutely no position data, fall back to the first opponent —
  // better than no report at all.
  return best ?? opponents[0] ?? null
}

function getParticipantFrame(frame: any, pid: number): FrameParticipantStats {
  const pfs = frame?.participantFrames ?? {}
  return pfs[String(pid)] ?? {}
}

function computeFrame(frame: any, pid: number, oid: number, minute: number): LanePhaseFrame {
  const p = getParticipantFrame(frame, pid)
  const o = getParticipantFrame(frame, oid)

  const pCs = (p.minionsKilled ?? 0) + (p.jungleMinionsKilled ?? 0)
  const oCs = (o.minionsKilled ?? 0) + (o.jungleMinionsKilled ?? 0)
  const pGold = p.totalGold ?? 0
  const oGold = o.totalGold ?? 0
  const pXp = p.xp ?? 0
  const oXp = o.xp ?? 0
  const pLevel = p.level ?? 0
  const oLevel = o.level ?? 0
  const pDt = p.damageStats?.totalDamageTaken ?? 0
  const oDt = o.damageStats?.totalDamageTaken ?? 0
  const pDd = p.damageStats?.totalDamageDoneToChampions ?? 0
  const oDd = o.damageStats?.totalDamageDoneToChampions ?? 0

  return {
    minute,
    cs:          { player: pCs,    opponent: oCs,    diff: pCs - oCs },
    gold:        { player: pGold,  opponent: oGold,  diff: pGold - oGold },
    xp:          { player: pXp,    opponent: oXp,    diff: pXp - oXp },
    level:       { player: pLevel, opponent: oLevel, diff: pLevel - oLevel },
    damageTaken: { player: pDt,    opponent: oDt,    diff: pDt - oDt },
    damageDealt: { player: pDd,    opponent: oDd,    diff: pDd - oDd },
  }
}

/**
 * Map a numeric score (-Infinity..+Infinity, centered on ~0) to a letter
 * grade. Bands are tuned so a "balanced lane" lands around B and a clear
 * dominant performance reaches A+/S.
 */
function gradeFromScore(score: number): LanePhaseGrade {
  if (score >= 90) return 'S'
  if (score >= 75) return 'A+'
  if (score >= 60) return 'A'
  if (score >= 45) return 'B+'
  if (score >= 30) return 'B'
  if (score >= 15) return 'C'
  if (score >= 0)  return 'D'
  return 'F'
}

/**
 * Composite score from the components. Normalises each delta to a 0..100
 * scale (centered on 50 = even with your opponent) based on what "feels like
 * a clear advantage" in pro/SoloQ play, then applies a weighted sum.
 *
 * Weights (sum = 100):
 *   Gold 25 · CS 20 · Solo KD 15 · Damage@14 10 · KP@14 9 · XP 8 · Plates 8 ·
 *   Obj dmg 5.
 *
 * KP and champion-damage capture skirmish impact that pure CS/gold miss
 * (e.g. a roaming mid with even CS but high KP). Objective damage is
 * full-game and gets the lightest weight — it's a soft signal of who
 * snowballed the lead into towers/dragons rather than a pure laning stat.
 */
function computeNumericScore(c: LanePhaseScoreComponents): number {
  // CS diff @14: ±30 → ±50 pts contribution (centered on 50)
  const csComp = clamp(50 + c.csAt14 * (50 / 30), 0, 100)
  // Gold diff @14: ±1500g → ±50 pts
  const goldComp = clamp(50 + c.goldAt14 * (50 / 1500), 0, 100)
  // XP diff @14: ±2000xp → ±50 pts
  const xpComp = clamp(50 + c.xpAt14 * (50 / 2000), 0, 100)
  // Solo KD: each net kill ≈ 25 pts above neutral 50
  const soloComp = clamp(50 + (c.soloKD.k - c.soloKD.d) * 25, 0, 100)
  // Plates: each net plate ≈ 12.5 pts above neutral 50 (5 max plates per tower)
  const plateComp = clamp(50 + (c.plates.taken - c.plates.lost) * 12.5, 0, 100)
  // Damage to champions @14: ±3000 dmg → ±50 pts
  const dmgComp = clamp(50 + (c.dmgAt14?.diff ?? 0) * (50 / 3000), 0, 100)
  // Kill participation: ±0.4 (40 pp) advantage over the opponent → ±50 pts
  const kpComp = clamp(50 + ((c.kp?.player ?? 0) - (c.kp?.opponent ?? 0)) * (50 / 0.4), 0, 100)
  // Objective damage (full game): ±5000 dmg → ±50 pts
  const objComp = clamp(50 + ((c.objDmg?.player ?? 0) - (c.objDmg?.opponent ?? 0)) * (50 / 5000), 0, 100)

  return (
    goldComp * 0.25 +
    csComp   * 0.20 +
    soloComp * 0.15 +
    dmgComp  * 0.10 +
    kpComp   * 0.09 +
    xpComp   * 0.08 +
    plateComp* 0.08 +
    objComp  * 0.05
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

export function analyzeLanePhase(input: LanePhaseInput): LanePhaseResult {
  let timeline: any
  let match: any
  try {
    timeline = typeof input.timelineJson === 'string' ? JSON.parse(input.timelineJson) : input.timelineJson
    match = typeof input.matchJson === 'string' ? JSON.parse(input.matchJson) : input.matchJson
  } catch (err) {
    return { report: null, diag: { reason: 'bad-data', message: (err as Error)?.message ?? 'JSON parse failed' } }
  }

  if (!timeline?.info?.frames || !Array.isArray(timeline.info.frames)) {
    return { report: null, diag: { reason: 'no-frames', message: 'Timeline has no frames.' } }
  }
  if (!match?.info?.participants) {
    return { report: null, diag: { reason: 'bad-data', message: 'Match has no participants.' } }
  }

  const participants: ParticipantInfo[] = match.info.participants.map((p: any) => ({
    participantId: p.participantId,
    puuid: p.puuid,
    championName: p.championName,
    teamId: p.teamId,
    teamPosition: p.teamPosition ?? '',
  }))

  const resolved = resolvePlayer(participants, match, input.selector)
  if (!resolved) {
    return { report: null, diag: { reason: 'no-player', message: 'Player not found in match.', playerResolvedVia: 'none' } }
  }
  const player = resolved.participant

  const opponent = resolveOpponent(player, participants, timeline.info.frames)
  if (!opponent) {
    return {
      report: null,
      diag: {
        reason: 'no-opponent',
        message: 'Could not identify the laning opponent.',
        playerResolvedVia: resolved.via,
        frameCount: timeline.info.frames.length,
      },
    }
  }

  const framesByMinute: LanePhaseFrame[] = []
  for (let i = 0; i < timeline.info.frames.length && i <= MAX_MINUTE; i++) {
    framesByMinute.push(computeFrame(timeline.info.frames[i], player.participantId, opponent.participantId, i))
  }

  // Team membership lookup for kill-participation accounting.
  const teamOf = new Map<number, number>(participants.map((p) => [p.participantId, p.teamId]))
  let playerTeamKills = 0, playerKP = 0
  let oppTeamKills = 0, oppKP = 0

  const plates: LanePhasePlate[] = []
  const soloEvents: LanePhaseSoloEvent[] = []
  for (const frame of timeline.info.frames) {
    for (const ev of (frame.events ?? []) as any[]) {
      const tsMin = Math.floor((ev.timestamp ?? 0) / 60000)
      if (tsMin > MAX_MINUTE) continue
      if (ev.type === 'TURRET_PLATE_DESTROYED') {
        // Plates have killerId for the destroyer; teamId 100 vs 200 not on
        // the event itself. We tag "takenByPlayer" if the player is the
        // direct killer (we don't credit assist for plates here).
        if (ev.killerId === player.participantId) {
          plates.push({ minute: tsMin, takenByPlayer: true })
        } else {
          // Only count "lost" plates as opponent-side. Friendly-killed plates
          // (other allies) are dropped — they're not relevant to lane diff.
          const killer = participants.find((p) => p.participantId === ev.killerId)
          if (killer && killer.teamId !== player.teamId) {
            plates.push({ minute: tsMin, takenByPlayer: false })
          }
        }
      } else if (ev.type === 'CHAMPION_KILL') {
        const assists = (ev.assistingParticipantIds ?? []) as number[]
        const k = ev.killerId
        const v = ev.victimId

        // Kill-participation: count team kills + whether each laner took part
        // (as killer or assister) within the laning window.
        const killerTeam = teamOf.get(k)
        if (killerTeam === player.teamId) {
          playerTeamKills += 1
          if (k === player.participantId || assists.includes(player.participantId)) playerKP += 1
        } else if (killerTeam === opponent.teamId) {
          oppTeamKills += 1
          if (k === opponent.participantId || assists.includes(opponent.participantId)) oppKP += 1
        }

        // Solo trades — strictly 1v1 (no assists) between the two laners.
        if (assists.length === 0) {
          const playerVsOpp = (k === player.participantId && v === opponent.participantId)
          const oppVsPlayer = (k === opponent.participantId && v === player.participantId)
          if (playerVsOpp) soloEvents.push({ minute: tsMin, type: 'kill' })
          else if (oppVsPlayer) soloEvents.push({ minute: tsMin, type: 'death' })
        }
      }
    }
  }

  const last = framesByMinute[framesByMinute.length - 1] ?? null
  const csAt14 = last?.cs.diff ?? 0
  const goldAt14 = last?.gold.diff ?? 0
  const xpAt14 = last?.xp.diff ?? 0
  const soloKD = {
    k: soloEvents.filter((e) => e.type === 'kill').length,
    d: soloEvents.filter((e) => e.type === 'death').length,
  }
  const plateTotals = {
    taken: plates.filter((p) => p.takenByPlayer).length,
    lost: plates.filter((p) => !p.takenByPlayer).length,
  }

  const dmgAt14 = {
    player: last?.damageDealt.player ?? 0,
    opponent: last?.damageDealt.opponent ?? 0,
    diff: last?.damageDealt.diff ?? 0,
  }

  // Full-game objective damage (turrets/dragons/baron). Pulled from the
  // Match-V5 participant block — the timeline has no per-minute objective
  // damage, so this is the closest available comparison vs the opponent.
  const matchParticipants: MatchParticipantStats[] = match.info.participants ?? []
  const objDmgPlayer = matchParticipants.find((p) => p.participantId === player.participantId)?.damageDealtToObjectives ?? 0
  const objDmgOpp = matchParticipants.find((p) => p.participantId === opponent.participantId)?.damageDealtToObjectives ?? 0

  const scoreComponents: LanePhaseScoreComponents = {
    csAt14,
    goldAt14,
    xpAt14,
    soloKD,
    plates: plateTotals,
    dmgAt14,
    kp: {
      player: playerTeamKills > 0 ? playerKP / playerTeamKills : 0,
      opponent: oppTeamKills > 0 ? oppKP / oppTeamKills : 0,
    },
    objDmg: { player: objDmgPlayer, opponent: objDmgOpp },
    numericScore: 0,
  }
  scoreComponents.numericScore = computeNumericScore(scoreComponents)

  const report: LanePhaseReport = {
    schemaVersion: 2,
    player: {
      participantId: player.participantId,
      puuid: player.puuid,
      championName: player.championName,
      teamPosition: player.teamPosition,
    },
    opponent: {
      participantId: opponent.participantId,
      championName: opponent.championName,
      teamPosition: opponent.teamPosition,
    },
    framesByMinute,
    plates,
    soloEvents,
    grade: gradeFromScore(scoreComponents.numericScore),
    scoreComponents,
  }

  return {
    report,
    diag: {
      reason: 'ok',
      playerResolvedVia: resolved.via,
      frameCount: timeline.info.frames.length,
    },
  }
}
