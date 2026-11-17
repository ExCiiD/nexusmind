/**
 * AnomalyDetector — picks at most 3 critical moments of a game for the
 * 45-second micro-review (docs/PLAN_MICRO_REVIEW.md).
 *
 * Pure and deterministic: Match-V5 + Match-Timeline-V5 in, structured facts
 * out (no strings — the QCM generator and the UI turn facts into text).
 * Runs once per game after it ended; never during a game (Riot policy).
 * Summoner's Rift, classic mode only: the geometry and the timers mean
 * nothing anywhere else.
 *
 * Three triggers (the only values stored with an answer):
 *   critical-death     the player dies, then within 90 s the team loses win
 *                      probability or a neutral objective / building — or
 *                      the death matches one of the patterns below;
 *   absent-objective   the enemy takes an epic monster while the player is
 *                      alive, without a ward of theirs near the pit in the
 *                      previous 90 s and without a cross-map trade;
 *   early-deficit      at 10:00, csDiff < −15 or xpDiff < −400 against the
 *                      direct opponent, with fewer than 2 takedowns.
 * Every candidate is dropped when P(win) just before it is < 0.18 or > 0.85.
 *
 * Patterns (facts.pattern) refine a trigger without a new trigger name:
 *   on critical-death    gank-timer, pit-chokepoint, fed-carry-first,
 *                        tempo-front-isolated
 *   on absent-objective  tempo-hesitation, tempo-late-recall, pit-chokepoint
 *   on early-deficit     jungle-overchase, jungle-counter-tempo,
 *                        jungle-passive-clear, jungle-window-unpunished,
 *                        bad-rotation, mid-roam-plates
 * Every threshold lives in DETECTOR_SPEC and is asserted, on both sides of
 * its boundary, by tests/unit/anomalyDetectorMath*.test.ts.
 *
 * Resolution limits, by construction of Riot's timeline:
 *   - participant positions, gold, XP, CS and HP are 60 s snapshots.
 *     Positions in between are interpolated along what the events prove: a
 *     champion walks from its last snapshot to where it dies, stays there
 *     until it respawns, then leaves its fountain toward the next snapshot.
 *     A detour inside one minute that no event marks cannot be seen;
 *   - jungle camps are a per-minute counter: a camp taken in the same minute
 *     as a chase (before it, or after a respawn) cancels the overchase;
 *   - WARD_PLACED has no coordinates (the player's position is used);
 *   - there is no recall, damage or minion-wave event; bounties are
 *     estimated from the kill streak.
 * When the data cannot prove a pattern, the detector stays silent.
 */

import {
  ALLY_RADIUS, FOUNTAIN, OBJECTIVE_RADIUS, WARD_RADIUS, PIT_FIGHT_RADIUS, PIT_INSIDE_RADIUS,
  dist, laneOf, nearestPit, pitCenter, tempoLineD, territoryOf, zoneOf,
  type LaneBucket, type Pit, type Point, type TeamId, type Territory, type Zone,
} from './geometry'
import {
  OBJECTIVE_WEIGHT, frameClock, isGarbageTime, objectiveKindOf, winProbabilityTrack,
  type ObjectiveKind,
} from './winProbability'
import { isControlMage } from './championClasses'

export type MomentTrigger = 'critical-death' | 'absent-objective' | 'early-deficit'

export type MomentPattern =
  | 'tempo-hesitation' | 'jungle-overchase' | 'jungle-counter-tempo' | 'jungle-passive-clear'
  | 'tempo-late-recall' | 'tempo-front-isolated' | 'gank-timer' | 'fed-carry-first'
  | 'jungle-window-unpunished' | 'bad-rotation' | 'pit-chokepoint' | 'mid-roam-plates'

/** Every numeric rule of the detector (seconds, map units, gold, ratios). */
export const DETECTOR_SPEC = {
  maxMoments: 3,
  minSpacingSec: 25,
  death: { windowSec: 90, wpDrop: 0.05, allyRadius: ALLY_RADIUS, sameFightSec: 10, wardLookbackSec: 60, ownPlaySec: 35, hpSnapshotMinAgeSec: 10 },
  absent: { wardRadius: WARD_RADIUS, wardLookbackSec: 90, crossMapSec: 60, deadBeforeSec: 110, accountableFromSec: 300 },
  early: { atSec: 600, csDiff: -15, xpDiff: -400, takedowns: 2 },
  hesitation: { notInPitSec: 30, moveFromSec: 25, approachMin: 1200, crossMapBeforeSec: 40, crossMapAfterSec: 15, towerGreedSec: 75 },
  jungle: { fromSec: 150, toSec: 480, overchaseSec: 20, sampleSec: 5, counterTempoXp: 150, riverPlaySec: [195, 255], backAtSec: 300, passiveBotLead: 250 },
  tempoLine: { fromSec: 900, alliesHigh: 0.55, userBase: 0.15, userFront: 0.65, alliesHome: 0.30, minAllies: 3, goldBefore: 1500, goldLookbackSec: 30, fightWindowSec: 30, aliveBeforeSec: 60 },
  gank: { window1: [145, 180], window2: [195, 265], deepWardLifetimeSec: 150 },
  tempoWindow: { fromSec: 150, untilSec: 720, distance: 8000, windowSec: 45, respawnGraceSec: 20 },
  carry: { bounty: 450, kda: 4, goldShare: 0.25, enemies: 3, fightRadius: 2500, lostWithinSec: 60, firstDeathSec: 10 },
  rotation: { untilSec: 840, awaySec: 30, cs: 8, xp: 350, deathGuardSec: 45 },
  pit: { fromSec: 840, fightRadius: PIT_FIGHT_RADIUS, insideRadius: PIT_INSIDE_RADIUS, beforeSec: 15, fightGapSec: 20 },
  midRoam: { untilSec: 840, plates: 1, cs: 10, minOffAxis: 2600 },
} as const

export interface MomentFacts {
  // critical-death
  assisters?: number
  /** Killer (if a champion) + assisters. */
  enemiesInvolved?: number
  /** Allies within 2500 units, alive or fallen in the same fight (the 10 s before). */
  alliesNearby?: number
  goldInPocket?: number
  wardedLast60s?: boolean
  /** Seconds since the player's last kill / takedown / tower or plate, null when none in the last 35 s. */
  secondsSinceOwnPlay?: number | null
  nearestPit?: Pit
  pitDistance?: number
  nearObjective?: boolean
  objectiveLost?: ObjectiveKind | null
  objectiveLostAfterSec?: number | null
  /** The player's team had Baron (ally Baron kill in the 3 min before). */
  alliedBaron?: boolean
  /** Levels behind the killer at the last snapshot (only when ≥ 1). */
  levelDeficit?: number
  /** HP (percent) at the last snapshot before the death, when that snapshot is 10–60 s old. */
  hpPct?: number
  hpSnapshotAgeSec?: number
  // absent-objective
  objective?: ObjectiveKind
  playerDistance?: number | null
  wardsElsewhere?: number
  /** The player did place a ward near the pit in the 90 s before (the miss is then not a vision one). */
  playerWarded?: boolean
  // early-deficit
  csDiff10?: number
  xpDiff10?: number
  takedownsBefore10?: number
  opponentChampion?: string | null
  // patterns (see header)
  pattern?: MomentPattern
  /** tempo-hesitation: units walked toward the pit in the last 25 s. */
  approachedBy?: number
  /** tempo-hesitation: the player took a side-lane tower / plate in the 75 s before instead of setting up. */
  towerGreed?: boolean
  /** jungle patterns: XP vs the enemy jungler after the play. */
  xpDiffJungle?: number
  /** jungle-passive-clear: bot duo gold lead at 3:00. */
  botGoldLead?: number
  /** tempo lines: forward allies who died in the fight / allies still home. */
  alliesHigh?: number
  alliesHome?: number
  /** gank-timer: which window (1 = 2:25–3:00, 2 = 3:15–4:25); wards are best effort (no coordinates in the timeline). */
  gankWindow?: 1 | 2
  deepWard?: boolean
  wardedRecently?: boolean
  /** fed-carry-first: share of team gold (percent), kill streak and estimated bounty. */
  goldSharePct?: number
  killStreak?: number
  bountyGold?: number
  /** bad-rotation / mid-roam-plates: CS and XP lost against the lane opponent during the roam. */
  csLost?: number
  xpLost?: number
  /** mid-roam-plates: mid plates lost, side of the roam, enemy holding the Voidgrubs. */
  platesLost?: number
  roamSide?: 'top' | 'bot'
  enemyGrubs?: boolean
  /** pit-chokepoint: allies who died in the pit fight. */
  alliesDown?: number
}

export interface CriticalMoment {
  /** Stable id within the game: `${trigger}@${gameTimeSec}`. */
  key: string
  trigger: MomentTrigger
  gameTimeSec: number
  /** Ranking score (bigger = costlier). */
  severity: number
  position: Point | null
  zone: Zone | null
  lane: LaneBucket | null
  territory: Territory | null
  /** P(win) just before the action / at the end of its window (3 decimals; never shown as a rating). */
  winProbBefore: number | null
  winProbAfter: number | null
  facts: MomentFacts
}

export interface ContestedObjective {
  gameTimeSec: number
  kind: ObjectiveKind
  takenBy: 'ally' | 'enemy'
  /** The player placed at least one ward within WARD_RADIUS of the pit in the 90 s before. */
  playerWarded: boolean
  /**
   * The vision of this objective was the player's to provide — same rule as
   * the auto-detected `no-ward-pre-obj` tag: supports and junglers on every
   * objective, laners on the ones their team lost; never when the player was
   * dead in the 110 s before, before 5:00, nor for the Voidgrubs.
   */
  accountable: boolean
}

export interface GameAnalysis {
  participantId: number
  teamId: TeamId
  champion: string
  /** Riot teamPosition (TOP / JUNGLE / MIDDLE / BOTTOM / UTILITY / ''). */
  position: string
  /** P(win) at every frame snapshot (3 decimals). */
  winProb: number[]
  /** ≤ 3 moments, chronological. */
  moments: CriticalMoment[]
  /** Every epic monster of the game (dragon, Baron, Herald, grubs, Atakhan), for objective checks. */
  contested: ContestedObjective[]
  /** Candidates discarded as garbage time (kept out of the Mistake Lab ratios). */
  garbageDiscarded: number
  /** Lane numbers at 10:00 vs the direct opponent (laners only), for objective checks. */
  laneAt10: { csDiff: number; xpDiff: number } | null
}

export interface DetectorSelector {
  puuids?: string[]
  championName?: string
}

export const MAX_MOMENTS = DETECTOR_SPEC.maxMoments
export const SUMMONERS_RIFT_MAP_ID = 11
const EPIC: ObjectiveKind[] = ['dragon', 'elder', 'baron', 'herald', 'grubs', 'atakhan']
const HESITATION_KINDS: ObjectiveKind[] = ['dragon', 'elder', 'baron', 'grubs']
const PATTERN_BONUS = 0.12
/** Baron buff duration (the 3 min powerplay). */
const BARON_BUFF_MS = 180_000
/** Outer mid turrets, to tell whose plate fell. */
const MID_OUTER_TURRET: Record<TeamId, Point> = { 100: { x: 5846, y: 6396 }, 200: { x: 9164, y: 8609 } }
/** Float noise allowed on a threshold computed from unrounded probabilities. */
const EPS = 1e-9

/** Base respawn wait by level (s). */
const BRW = [6, 6, 8, 8, 10, 12, 16, 21, 26, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5]
/** Share added to the base wait as the game goes on: 0 before 15:00, then per 30 s step, capped at 50 % from 55:00. */
export function respawnTimeFactor(minutes: number): number {
  if (minutes < 15) return 0
  if (minutes < 30) return Math.ceil(2 * (minutes - 15)) * 0.00425
  if (minutes < 45) return 0.1275 + Math.ceil(2 * (minutes - 30)) * 0.003
  if (minutes < 55) return Math.min(0.5, 0.2175 + Math.ceil(2 * (minutes - 45)) * 0.0145)
  return 0.5
}
/** Respawn timer (s) of a champion of `level` dying at `minutes`. */
export function deathTimerSec(level: number, minutes: number): number {
  const base = BRW[Math.min(BRW.length, Math.max(1, Math.round(level))) - 1]
  return base * (1 + respawnTimeFactor(minutes))
}

/** Kill gold of a champion on an n-kill streak (classic table: 2 kills → 450 g … 7+ → 1000 g). Estimate: the live bounty also depends on farm leads. */
const BOUNTY_BY_STREAK = [300, 300, 450, 600, 700, 800, 900, 1000]
export function bountyGold(killStreak: number): number {
  return BOUNTY_BY_STREAK[Math.max(0, Math.min(BOUNTY_BY_STREAK.length - 1, Math.floor(killStreak)))]
}

/** Summoner's Rift in classic mode (fields absent from a payload are not held against it). */
export function isSupportedGame(match: any): boolean {
  const info = match?.info ?? {}
  if (info.mapId != null && info.mapId !== SUMMONERS_RIFT_MAP_ID) return false
  if (info.gameMode != null && info.gameMode !== 'CLASSIC') return false
  return true
}

function resolveParticipant(match: any, sel: DetectorSelector): any | null {
  const parts: any[] = match?.info?.participants ?? []
  if (sel.puuids?.length) {
    const hit = parts.find((p) => p.puuid && sel.puuids!.includes(p.puuid))
    if (hit) return hit
  }
  if (sel.championName) {
    const c = sel.championName.toLowerCase()
    const same = parts.filter((p) => String(p.championName ?? '').toLowerCase() === c)
    if (same.length === 1) return same[0]
  }
  return null
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d
const within = (p: Point | null | undefined, q: Point, r: number): boolean => p != null && dist(p, q) <= r

/** One death of a champion: where and when it fell, when it is back. */
interface Life { ts: number; pos: Point; respawn: number }

export function analyzeGame(match: any, timeline: any, selector: DetectorSelector): GameAnalysis | null {
  const frames: any[] = timeline?.info?.frames ?? []
  const me = resolveParticipant(match, selector)
  if (!me || frames.length < 2 || !isSupportedGame(match)) return null
  const S = DETECTOR_SPEC
  const pid: number = me.participantId
  const team = (me.teamId === 200 ? 200 : 100) as TeamId
  const parts: any[] = match.info.participants
  const teamById = new Map<number, number>(parts.map((p) => [p.participantId, p.teamId]))
  const teamOf = (id: number) => teamById.get(id)
  const positionOf = (p: any): string => p?.teamPosition || p?.individualPosition || ''
  const role = positionOf(me)
  const allies = parts.filter((p) => p.teamId === team && p.participantId !== pid).map((p) => p.participantId as number)
  const enemies = parts.filter((p) => p.teamId !== team).map((p) => p.participantId as number)
  const enemyJungler = parts.find((p) => p.teamId !== team && positionOf(p) === 'JUNGLE')?.participantId as number | undefined
  const laneOpponent = ['TOP', 'MIDDLE', 'BOTTOM'].includes(role) ? parts.find((p) => p.teamId !== team && positionOf(p) === role) : undefined
  const isLaner = ['TOP', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(role)
  /** Roles whose job is the vision of every objective (same split as the auto-detector). */
  const visionRole = role === 'UTILITY' || role === 'JUNGLE'

  const clock = frameClock(frames)
  const track = winProbabilityTrack(frames, teamOf, team)
  /** Would-be moments dropped because P(win) just before them was garbage time. */
  let garbageDiscarded = 0

  // Flatten events once (chronological).
  const events: any[] = []
  for (const f of frames) for (const ev of (f.events ?? []) as any[]) if (typeof ev.timestamp === 'number') events.push(ev)
  events.sort((a, b) => a.timestamp - b.timestamp)
  const kills = events.filter((e) => e.type === 'CHAMPION_KILL')
  const involves = (e: any, id: number): boolean => e.killerId === id || (e.assistingParticipantIds ?? []).includes(id)

  const pframe = (i: number, id: number) => frames[Math.max(0, Math.min(frames.length - 1, i))]?.participantFrames?.[String(id)]
  /** The participant's last snapshot at or before `ms`. */
  const snapshotAt = (id: number, ms: number) => pframe(clock.indexAt(ms), id)
  const goldOf = (i: number, id: number) => Number(pframe(i, id)?.totalGold) || 0
  const csOf = (i: number, id: number) => (Number(pframe(i, id)?.minionsKilled) || 0) + (Number(pframe(i, id)?.jungleMinionsKilled) || 0)
  const xpOf = (i: number, id: number) => Number(pframe(i, id)?.xp) || 0

  // ── Lives: where every champion fell, and when it came back ───────────
  const lives = new Map<number, Life[]>()
  for (const e of kills) {
    const id = e.victimId
    const pos = e.position as Point | undefined
    if (typeof id !== 'number' || !pos) continue
    const level = Number(snapshotAt(id, e.timestamp)?.level) || 1
    const list = lives.get(id) ?? []
    list.push({ ts: e.timestamp, pos, respawn: e.timestamp + deathTimerSec(level, e.timestamp / 60000) * 1000 })
    lives.set(id, list)
  }
  /** Dead at `ms` (between a death and its respawn). */
  const deadAt = (id: number, ms: number): boolean => !!lives.get(id)?.some((d) => d.ts <= ms && ms < d.respawn)
  /** Dead at some point of [from, to], or back for less than `graceMs` at `from`. */
  const downIn = (id: number, from: number, to: number, graceMs = 0): boolean => !!lives.get(id)?.some((d) => d.ts <= to && d.respawn + graceMs > from)

  /**
   * Position at `ms`. Snapshots are 60 s apart; in between, the champion
   * walks straight from one known point to the next — the known points being
   * the snapshots, the place it dies and its fountain when it respawns. Dead,
   * it is where it fell.
   */
  const posAt = (id: number, ms: number): Point | null => {
    const own = lives.get(id)
    const dead = own?.find((d) => d.ts <= ms && ms < d.respawn)
    if (dead) return dead.pos
    const i = clock.indexAt(ms)
    let t0 = clock.ts(i)
    let p0: Point | null = pframe(i, id)?.position ?? null
    let t1 = clock.ts(i + 1)
    let p1: Point | null = i < clock.last ? pframe(i + 1, id)?.position ?? null : null
    if (own) {
      // Respawned since the last snapshot (which may have been taken while dead): it restarts from the fountain.
      for (const d of own) if (d.respawn <= ms && d.respawn > t0) { t0 = d.respawn; p0 = FOUNTAIN[teamOf(id) === 200 ? 200 : 100] }
      // Dies before the next snapshot: it is walking to where it falls.
      const next = own.find((d) => d.ts > ms && d.ts <= t1)
      if (next) { t1 = next.ts; p1 = next.pos }
    }
    if (!p0) return p1
    if (!p1 || t1 <= t0) return p0
    const t = Math.max(0, Math.min(1, (ms - t0) / (t1 - t0)))
    return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }
  }
  const tempoD = (p: Point | null): number | null => (p ? tempoLineD(p, team) : null)

  const myWards = events.filter((e) => e.type === 'WARD_PLACED' && e.creatorId === pid && e.wardType !== 'UNDEFINED')
    .map((e) => ({ ts: e.timestamp as number, pos: posAt(pid, e.timestamp) }))
  const myDeaths = kills.filter((e) => e.victimId === pid)
  const allyDeaths = kills.filter((e) => allies.includes(e.victimId))
  const enemyDeaths = kills.filter((e) => enemies.includes(e.victimId))
  const takedownIn = (from: number, to: number): boolean => kills.some((e) => e.timestamp >= from && e.timestamp <= to && involves(e, pid))
  const ownPlays = events.filter((e) =>
    ((e.type === 'CHAMPION_KILL' || e.type === 'BUILDING_KILL') && involves(e, pid)) ||
    (e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === pid)).map((e) => e.timestamp as number)

  // Objectives (ours = taken by our team / an enemy building destroyed).
  const objectives = events.map((e) => {
    const kind = objectiveKindOf(e)
    if (!kind) return null
    const ours = e.type === 'ELITE_MONSTER_KILL' ? (e.killerTeamId ?? teamOf(e.killerId)) === team : e.teamId !== team
    return { ts: e.timestamp as number, kind, ours, pos: (e.position as Point | undefined) ?? null }
  }).filter((o): o is NonNullable<typeof o> => o != null)

  const candidates: CriticalMoment[] = []
  /**
   * Registers a candidate unless P(win) just before the action is garbage
   * time (then it is only counted). `gateMs`: the action itself, when the
   * moment is anchored a few seconds earlier for the VOD.
   */
  const add = (trigger: MomentTrigger, ms: number, pos: Point | null, severity: number, facts: MomentFacts, winProbAfter: number | null = null, gateMs = ms): boolean => {
    const before = track.before(gateMs)
    if (isGarbageTime(before)) {
      garbageDiscarded++
      return false
    }
    candidates.push({
      key: `${trigger}@${Math.round(ms / 1000)}`,
      trigger,
      gameTimeSec: Math.round(ms / 1000),
      severity: round(severity),
      position: pos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : null,
      zone: pos ? zoneOf(pos, team) : null,
      lane: pos ? laneOf(pos) : null,
      territory: pos ? territoryOf(pos, team) : null,
      winProbBefore: before != null ? round(before) : null,
      winProbAfter: winProbAfter != null ? round(winProbAfter) : null,
      facts,
    })
    return true
  }

  /** KDA and kill streak of the player just before `ts`. */
  const statsBefore = (ts: number) => {
    let k = 0, dth = 0, a = 0, streak = 0
    for (const e of kills) {
      if (e.timestamp >= ts) break
      if (e.killerId === pid) { k++; streak++ }
      else if ((e.assistingParticipantIds ?? []).includes(pid)) a++
      if (e.victimId === pid) { dth++; streak = 0 }
    }
    return { kda: (k + a) / Math.max(1, dth), streak }
  }

  // ── Pit fights (V4): clusters of kills around a pit, from the mid game ──
  interface PitFight { pit: Pit; start: number; end: number; allyDeaths: number; enemyDeaths: number }
  const pitFights: PitFight[] = []
  for (const pit of ['baron', 'dragon'] as const) {
    const center = pitCenter(pit)
    let cluster: any[] = []
    const flush = () => {
      if (cluster.length >= 2) {
        pitFights.push({
          pit, start: cluster[0].timestamp, end: cluster[cluster.length - 1].timestamp,
          allyDeaths: cluster.filter((e) => teamOf(e.victimId) === team).length,
          enemyDeaths: cluster.filter((e) => teamOf(e.victimId) !== team).length,
        })
      }
      cluster = []
    }
    for (const e of kills) {
      if (e.timestamp < S.pit.fromSec * 1000 || !e.position || dist(e.position, center) >= S.pit.fightRadius) continue
      if (cluster.length && e.timestamp - cluster[cluster.length - 1].timestamp > S.pit.fightGapSec * 1000) flush()
      cluster.push(e)
    }
    flush()
  }
  /** The pit fight a death belongs to: during it, and within the fight radius of that pit. */
  const pitFightOf = (d: any): PitFight | undefined => {
    const p = d.position as Point | undefined
    return p ? pitFights.find((f) => d.timestamp >= f.start && d.timestamp <= f.end && dist(p, pitCenter(f.pit)) < S.pit.fightRadius) : undefined
  }
  /** Support, or a control mage in the mid lane: their job at an objective is zoning. */
  const isZoner = role === 'UTILITY' || (role === 'MIDDLE' && isControlMage(me.championName))
  /** Inside the pit (d < 900 of its centre) for the whole 15 s before the fight broke out. */
  const insidePitBefore = (f: PitFight): boolean => [1, 2 / 3, 1 / 3, 0].every((k) => {
    const p = posAt(pid, f.start - k * S.pit.beforeSec * 1000)
    return p != null && dist(p, pitCenter(f.pit)) < S.pit.insideRadius
  })

  // ── 1. Critical deaths ────────────────────────────────────────────────
  for (const d of myDeaths) {
    const ts: number = d.timestamp
    // P(win) just before the death (objectives up to it) against P(win) 90 s
    // later (objectives up to then, gold and XP of the last snapshot inside
    // the window): nothing that happened before the death or after the
    // window can make it critical.
    const before = track.before(ts)
    const after = track.at(ts + S.death.windowSec * 1000)
    const drop = before != null && after != null ? before - after : 0
    const lost = objectives
      .filter((o) => !o.ours && o.ts > ts && o.ts <= ts + S.death.windowSec * 1000)
      .sort((a, b) => OBJECTIVE_WEIGHT[b.kind] - OBJECTIVE_WEIGHT[a.kind] || a.ts - b.ts)[0] ?? null

    const pos: Point | null = d.position ?? posAt(pid, ts)
    const fi = clock.indexAt(ts)
    const assisters: number[] = d.assistingParticipantIds ?? []
    const killerIsChamp = typeof d.killerId === 'number' && d.killerId > 0 && teamOf(d.killerId) !== team
    const involved: number[] = [...(killerIsChamp ? [d.killerId as number] : []), ...assisters]
    // In the fight: alive, or fallen in the 10 s before (a corpse from an earlier fight is nobody).
    const inFight = (id: number) => !deadAt(id, ts) || !!lives.get(id)?.some((l) => l.ts <= ts && ts - l.ts <= S.death.sameFightSec * 1000)
    const alliesNearby = pos ? allies.filter((a) => inFight(a) && within(posAt(a, ts), pos, S.death.allyRadius)).length : 0
    const sec = ts / 1000

    // Patterns: each makes the death worth reviewing even without a win-probability swing.
    let pattern: MomentPattern | undefined
    const extra: Partial<MomentFacts> = {}

    // Gank on a predictable jungle timer (laners): 2:25–3:00, or 3:15–4:25 without a deep ward.
    if (isLaner && enemyJungler != null && involved.includes(enemyJungler)) {
      const w1 = sec >= S.gank.window1[0] && sec <= S.gank.window1[1]
      const w2 = sec >= S.gank.window2[0] && sec <= S.gank.window2[1]
      if (w1 || w2) {
        const recent = myWards.filter((w) => w.ts <= ts && ts - w.ts <= S.gank.deepWardLifetimeSec * 1000)
        const deepWard = recent.some((w) => w.pos != null && zoneOf(w.pos, team) === 'enemy-jungle')
        if (w1 || !deepWard) {
          pattern = 'gank-timer'
          Object.assign(extra, { gankWindow: w1 ? 1 : 2, deepWard, wardedRecently: recent.length > 0 })
        }
      }
    }

    // Support / control mage standing in the pit instead of holding a choke point (the death is part of the pit fight).
    if (!pattern && isZoner) {
      const fight = pitFightOf(d)
      if (fight && insidePitBefore(fight)) {
        pattern = 'pit-chokepoint'
        Object.assign(extra, { alliesDown: fight.allyDeaths })
      }
    }

    // The fed carry is the first to die in a teamfight that is then lost.
    if (!pattern) {
      const myGold = goldOf(fi, pid)
      const teamGold = allies.reduce((s, a) => s + goldOf(fi, a), myGold)
      const share = teamGold > 0 ? myGold / teamGold : 0
      const topGold = allies.every((a) => goldOf(fi, a) <= myGold)
      const { kda, streak } = statsBefore(ts)
      const bounty = bountyGold(streak)
      if (topGold && (bounty >= S.carry.bounty || (kda > S.carry.kda && share > S.carry.goldShare))) {
        const firstDeath = !kills.some((e) => e.timestamp >= ts - S.carry.firstDeathSec * 1000 && e.timestamp < ts)
        // Enemies present: those credited on the kill plus those alive within the fight radius.
        const enemiesPresent = new Set([...involved, ...(pos ? enemies.filter((e) => !deadAt(e, ts) && within(posAt(e, ts), pos, S.carry.fightRadius)) : [])]).size
        const until = ts + S.carry.lostWithinSec * 1000
        const alliesLost = 1 + allyDeaths.filter((e) => e.timestamp > ts && e.timestamp <= until).length
        const enemiesLost = enemyDeaths.filter((e) => e.timestamp > ts && e.timestamp <= until).length
        const objectiveLost = objectives.some((o) => !o.ours && o.ts > ts && o.ts <= until)
        if (firstDeath && enemiesPresent >= S.carry.enemies && (alliesLost > enemiesLost || objectiveLost)) {
          pattern = 'fed-carry-first'
          Object.assign(extra, { goldSharePct: Math.round(share * 100), killStreak: streak, bountyGold: bounty })
        }
      }
    }

    // Alone high on the tempo line (D > 0.65) while 3+ allies, alive, are still home (D < 0.30).
    if (!pattern && ts > S.tempoLine.fromSec * 1000 && pos) {
      const home = allies.filter((a) => {
        if (deadAt(a, ts)) return false
        const v = tempoD(posAt(a, ts))
        return v != null && v < S.tempoLine.alliesHome
      }).length
      if (tempoLineD(pos, team) > S.tempoLine.userFront && alliesNearby === 0 && home >= S.tempoLine.minAllies) {
        pattern = 'tempo-front-isolated'
        Object.assign(extra, { alliesHome: home })
      }
    }

    if (drop < S.death.wpDrop - EPS && !lost && !pattern) continue

    const pit = pos ? nearestPit(pos) : null
    const lastPlay = [...ownPlays].reverse().find((t) => t <= ts && ts - t < S.death.ownPlaySec * 1000)
    const myLevel = Number(pframe(fi, pid)?.level) || 0
    const killerLevel = killerIsChamp ? Number(pframe(fi, d.killerId)?.level) || 0 : 0
    const levelDeficit = myLevel > 0 && killerLevel > myLevel ? killerLevel - myLevel : 0
    const snapshotAgeSec = Math.round((ts - clock.ts(fi)) / 1000)
    const stats = pframe(fi, pid)?.championStats
    const hpPct = stats && Number(stats.healthMax) > 0 && snapshotAgeSec >= S.death.hpSnapshotMinAgeSec
      ? Math.round((Number(stats.health) / Number(stats.healthMax)) * 100) : null
    const alliedBaron = objectives.some((o) => o.ours && o.kind === 'baron' && o.ts <= ts && ts - o.ts <= BARON_BUFF_MS)
    const facts: MomentFacts = {
      assisters: assisters.length,
      enemiesInvolved: involved.length,
      alliesNearby,
      goldInPocket: Math.round(Number(pframe(fi, pid)?.currentGold) || 0),
      wardedLast60s: myWards.some((w) => w.ts <= ts && ts - w.ts <= S.death.wardLookbackSec * 1000),
      secondsSinceOwnPlay: lastPlay != null ? Math.round((ts - lastPlay) / 1000) : null,
      nearestPit: pit?.pit,
      pitDistance: pit ? Math.round(pit.distance) : undefined,
      nearObjective: pit ? pit.distance <= OBJECTIVE_RADIUS : false,
      objectiveLost: lost?.kind ?? null,
      objectiveLostAfterSec: lost ? Math.round((lost.ts - ts) / 1000) : null,
      ...(alliedBaron ? { alliedBaron: true } : {}),
      ...(levelDeficit > 0 ? { levelDeficit } : {}),
      ...(hpPct != null ? { hpPct, hpSnapshotAgeSec: snapshotAgeSec } : {}),
      ...(pattern ? { pattern, ...extra } : {}),
    }
    const severity = Math.max(0, drop) + (lost ? 0.08 * OBJECTIVE_WEIGHT[lost.kind] : 0) + (facts.nearObjective ? 0.05 : 0) + (pattern ? PATTERN_BONUS : 0)
    add('critical-death', ts, pos, severity, facts, after)
  }

  // ── 2. Enemy epic objectives: hesitation / absent ─────────────────────
  const contested: ContestedObjective[] = []
  /** Enemy epic kills this section turned into a moment (the jungle tempo window must not report them twice). */
  const claimed = new Set<number>()
  const lastEpic = new Map<string, number>()
  for (const o of objectives) {
    if (!EPIC.includes(o.kind)) continue
    // Voidgrubs come as one event per grub: one contest per pack and per side.
    const slot = `${o.kind}:${o.ours ? 'ally' : 'enemy'}`
    const previous = lastEpic.get(slot)
    if (previous != null && o.ts - previous < 60_000) continue
    lastEpic.set(slot, o.ts)
    const pitName: Pit = o.kind === 'dragon' || o.kind === 'elder' ? 'dragon' : 'baron'
    const pitPos: Point = o.pos ?? pitCenter(pitName)
    const lookback = S.absent.wardLookbackSec * 1000
    const wardsNear = myWards.filter((w) => w.ts <= o.ts && o.ts - w.ts <= lookback && w.pos != null && dist(w.pos, pitPos) <= S.absent.wardRadius).length
    const diedBefore = (sec: number) => deadAt(pid, o.ts) || myDeaths.some((d) => d.timestamp <= o.ts && o.ts - d.timestamp <= sec * 1000)
    contested.push({
      gameTimeSec: Math.round(o.ts / 1000), kind: o.kind, takenBy: o.ours ? 'ally' : 'enemy', playerWarded: wardsNear > 0,
      accountable: (visionRole || !o.ours) && !diedBefore(S.absent.deadBeforeSec) && o.ts >= S.absent.accountableFromSec * 1000 && o.kind !== 'grubs',
    })
    if (o.ours) continue

    // Alive? A death shortly before is trigger 1's business.
    if (diedBefore(S.death.windowSec)) continue

    const before = track.before(o.ts)
    const after = track.at(o.ts + 60_000)
    const drop = before != null && after != null ? Math.max(0, before - after) : 0
    const pAtKill = posAt(pid, o.ts)

    // Tempo hesitation: out of tempo at T−30 s, yet neither set up nor cross-mapped (the player lived the whole window).
    const H = S.hesitation
    if (HESITATION_KINDS.includes(o.kind) && !downIn(pid, o.ts - H.crossMapBeforeSec * 1000, o.ts)) {
      const p30 = posAt(pid, o.ts - H.notInPitSec * 1000)
      const p25 = posAt(pid, o.ts - H.moveFromSec * 1000)
      const from = o.ts - H.crossMapBeforeSec * 1000
      const to = o.ts + H.crossMapAfterSec * 1000
      // The player's own side-lane tower / plate right before the objective is greed, not a team cross-map…
      const towerGreed = events.some((e) => e.timestamp >= o.ts - H.towerGreedSec * 1000 && e.timestamp <= o.ts &&
        ((e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === pid) || (e.type === 'BUILDING_KILL' && e.teamId !== team && involves(e, pid))))
      // …a cross-map is the team taking something else (an epic monster, or a building without the player).
      const teamCrossMap = objectives.some((x) => x.ours && EPIC.includes(x.kind) && x.ts >= from && x.ts <= to) ||
        events.some((e) => e.type === 'BUILDING_KILL' && e.teamId !== team && !involves(e, pid) && e.timestamp >= from && e.timestamp <= to)
      if (p30 && p25 && pAtKill && dist(p30, pitPos) > OBJECTIVE_RADIUS && !teamCrossMap) {
        const approachedBy = dist(p25, pitPos) - dist(pAtKill, pitPos)
        // "Stays in neutral ground": in the river and off the lanes from T−25 s to T, without ever reaching the pit.
        const neutral = (p: Point | null) => p != null && territoryOf(p, team) === 'river' && laneOf(p) === 'JUNGLE'
        const idleInRiver = [p25, posAt(pid, o.ts - H.moveFromSec * 500), pAtKill].every(neutral) && dist(pAtKill, pitPos) > OBJECTIVE_RADIUS
        if (towerGreed || approachedBy >= H.approachMin || idleInRiver) {
          claimed.add(o.ts)
          add('absent-objective', o.ts - H.moveFromSec * 1000, p25, 0.06 * OBJECTIVE_WEIGHT[o.kind] + drop + 0.05, {
            objective: o.kind, pattern: 'tempo-hesitation', approachedBy: Math.round(Math.max(0, approachedBy)),
            ...(towerGreed ? { towerGreed: true } : {}),
            ...(wardsNear > 0 ? { playerWarded: true } : {}),
            playerDistance: Math.round(dist(pAtKill, pitPos)), nearestPit: pitName, nearObjective: false,
          }, after, o.ts)
          continue
        }
      }
    }

    // Absent: no ward of the player near the pit, and no cross-map trade by the team.
    if (wardsNear > 0) continue
    if (objectives.some((x) => x.ours && Math.abs(x.ts - o.ts) <= S.absent.crossMapSec * 1000)) continue
    claimed.add(o.ts)
    // Anchor the VOD on the player, 20 s before the objective falls.
    add('absent-objective', o.ts - 20_000, pAtKill, 0.06 * OBJECTIVE_WEIGHT[o.kind] + drop + 0.02, {
      objective: o.kind,
      playerDistance: pAtKill ? Math.round(dist(pAtKill, pitPos)) : null,
      wardsElsewhere: myWards.filter((w) => w.ts <= o.ts && o.ts - w.ts <= lookback).length,
      nearestPit: pitName,
      nearObjective: pAtKill ? dist(pAtKill, pitPos) <= OBJECTIVE_RADIUS : false,
    }, after, o.ts)
  }

  // ── 3. Early deficit at 10:00 (laners with a direct opponent) ─────────
  let laneAt10: GameAnalysis['laneAt10'] = null
  const atFrame = S.early.atSec / 60
  if (laneOpponent && frames.length > atFrame) {
    const mine = pframe(atFrame, pid)
    const theirs = pframe(atFrame, laneOpponent.participantId)
    if (mine && theirs) {
      const csDiff = csOf(atFrame, pid) - csOf(atFrame, laneOpponent.participantId)
      const xpDiff = Math.round(xpOf(atFrame, pid) - xpOf(atFrame, laneOpponent.participantId))
      laneAt10 = { csDiff, xpDiff }
      const takedowns = kills.filter((e) => e.timestamp <= S.early.atSec * 1000 && involves(e, pid)).length
      if ((csDiff < S.early.csDiff || xpDiff < S.early.xpDiff) && takedowns < S.early.takedowns) {
        const severity = Math.min(0.3, Math.abs(Math.min(0, csDiff)) / 100 + Math.abs(Math.min(0, xpDiff)) / 4000)
        add('early-deficit', S.early.atSec * 1000, mine.position ?? null, severity, {
          csDiff10: csDiff, xpDiff10: xpDiff, takedownsBefore10: takedowns, opponentChampion: laneOpponent.championName ?? null,
        })
      }
    }
  }

  // ── 4. Jungle (2:30–8:00): overchase, passive clear, counter-tempo ────
  if (role === 'JUNGLE') {
    const J = S.jungle
    const xpDiffAt = (i: number): number | null => {
      if (enemyJungler == null || i >= frames.length) return null
      const a = pframe(i, pid)
      const b = pframe(i, enemyJungler)
      return a && b ? (Number(a.xp) || 0) - (Number(b.xp) || 0) : null
    }
    const camps = (i: number) => Number(pframe(i, pid)?.jungleMinionsKilled) || 0
    const away = (p: Point | null | undefined): p is Point => p != null && territoryOf(p, team) !== 'own'
    const jungle = (ms: number, pos: Point | null, pattern: MomentPattern, severity: number, facts: MomentFacts) =>
      add('early-deficit', ms, pos, severity, { pattern, ...facts })

    // A — overchase ending in a death: the 20 s before it across the river or in the enemy jungle, with no takedown and no camp…
    let chased = false
    for (const d of myDeaths) {
      const ts: number = d.timestamp
      if (ts < J.fromSec * 1000 || ts > J.toSec * 1000) continue
      const start = ts - J.overchaseSec * 1000
      const pos: Point | null = d.position ?? posAt(pid, ts)
      const posStart = posAt(pid, start)
      const path = Array.from({ length: J.overchaseSec / J.sampleSec }, (_, n) => posAt(pid, start + n * J.sampleSec * 1000))
      if (!away(pos) || !path.every(away)) continue
      if (takedownIn(start, ts)) continue
      // Camps are a per-minute counter: any camp between the snapshot before the chase and the one after the death cancels it.
      if (camps(clock.indexAt(ts) + 1) > camps(clock.indexAt(start))) continue
      chased = true
      jungle(start, posStart, 'jungle-overchase', 0.22, { xpDiffJungle: xpDiffAt(clock.indexAt(ts) + 1) ?? undefined })
    }
    // …or in the XP lead over the enemy jungler lost on the next frame (alive all along: a death is case A's business).
    if (!chased) {
      for (let k = Math.ceil(J.fromSec / 60); (k + 1) * 60 <= J.toSec && k + 1 < frames.length; k++) {
        const here = xpDiffAt(k)
        const next = xpDiffAt(k + 1)
        if (here == null || next == null || here <= 0 || next >= 0) continue
        const p = posAt(pid, k * 60_000)
        if (!away(p) || downIn(pid, k * 60_000, (k + 1) * 60_000)) continue
        if (takedownIn(k * 60_000, (k + 1) * 60_000) || camps(k + 1) > camps(k)) continue
        jungle(k * 60_000, p, 'jungle-overchase', 0.18, { xpDiffJungle: next })
        chased = true
        break
      }
    }

    // Passive full clear while bot (and mid) had priority: the 3-camp invade was there.
    const laneLead = (pos: string, i: number) => parts.filter((p) => positionOf(p) === pos)
      .reduce((s, p) => s + (p.teamId === team ? 1 : -1) * goldOf(i, p.participantId), 0)
    const botLead = laneLead('BOTTOM', 3) + laneLead('UTILITY', 3)
    const midLead = laneLead('MIDDLE', 3)
    const stayedHome = [120_000, 180_000, 210_000, 240_000].every((ms) => { const p = posAt(pid, ms); return p != null && territoryOf(p, team) === 'own' })
    const xp6 = xpDiffAt(6)
    if (!chased && botLead >= J.passiveBotLead && midLead >= 0 && stayedHome && !takedownIn(0, 240_000) && xp6 != null && xp6 <= 0) {
      jungle(195_000, posAt(pid, 195_000), 'jungle-passive-clear', 0.12, { botGoldLead: Math.round(botLead), xpDiffJungle: xp6 })
    }

    // B — counter-tempo: a river play around 3:15–4:15, then back to the starting quadrant, behind in XP at 6:00.
    const start = posAt(pid, 120_000)
    const riverPlay = [195, 210, 225, 240, 255].map((s) => posAt(pid, s * 1000)).some((p) => p != null && territoryOf(p, team) === 'river')
    const back = posAt(pid, J.backAtSec * 1000)
    if (start && riverPlay && back && territoryOf(start, team) === 'own' && territoryOf(back, team) === 'own' &&
        (start.y > start.x) === (back.y > back.x) && xp6 != null && xp6 < -J.counterTempoXp) {
      jungle(270_000, back, 'jungle-counter-tempo', 0.15 + Math.min(0.1, -xp6 / 4000), { xpDiffJungle: xp6 })
    }

    // Tempo window not punished (2:30–12:00): the enemy jungler shows far away, nothing is taken in the next 45 s.
    if (enemyJungler != null) {
      const W = S.tempoWindow
      for (const e of events) {
        if (e.timestamp < W.fromSec * 1000) continue
        if (e.timestamp >= W.untilSec * 1000) break
        const shows = (e.type === 'CHAMPION_KILL' || e.type === 'ELITE_MONSTER_KILL') && involves(e, enemyJungler)
        if (!shows || !e.position) continue
        // An enemy epic that trigger 2 already reports is one moment, not two.
        if (e.type === 'ELITE_MONSTER_KILL' && claimed.has(e.timestamp)) continue
        const end = e.timestamp + W.windowSec * 1000
        // Dead, or barely out of the fountain: there was no window to use.
        if (downIn(pid, e.timestamp, end, W.respawnGraceSec * 1000)) continue
        const mine = posAt(pid, e.timestamp)
        if (!mine || dist(mine, e.position) <= W.distance) continue
        const cashed = events.some((x) => x.timestamp > e.timestamp && x.timestamp <= end && (
          ((x.type === 'CHAMPION_KILL' || x.type === 'BUILDING_KILL' || x.type === 'ELITE_MONSTER_KILL') && involves(x, pid)) ||
          (x.type === 'ELITE_MONSTER_KILL' && (x.killerTeamId ?? teamOf(x.killerId)) === team && within(posAt(pid, x.timestamp), x.position ?? mine, 3000)) ||
          (x.type === 'TURRET_PLATE_DESTROYED' && x.killerId === pid)))
        const stayedOwnSide = [0, 1 / 3, 2 / 3, 1].every((k) => { const p = posAt(pid, e.timestamp + k * W.windowSec * 1000); return p != null && territoryOf(p, team) === 'own' })
        if (cashed || !stayedOwnSide) continue
        if (jungle(e.timestamp, mine, 'jungle-window-unpunished', 0.14, { playerDistance: Math.round(dist(mine, e.position)) })) break
      }
    }
  }

  // ── 5. Tempo line (> 15 min): the forward group dies while the player recalled late ──
  {
    const T = S.tempoLine
    let lastFight = -Infinity
    for (const d0 of allyDeaths) {
      const ts: number = d0.timestamp
      if (ts <= T.fromSec * 1000 || ts - lastFight < T.fightWindowSec * 1000) continue
      const high = allyDeaths.filter((e) => e.timestamp >= ts && e.timestamp <= ts + T.fightWindowSec * 1000 &&
        e.position && tempoLineD(e.position, team) > T.alliesHigh)
      if (high.length < T.minAllies) continue
      lastFight = ts
      const at = ts - T.goldLookbackSec * 1000
      const dNow = tempoD(posAt(pid, ts))
      const dBefore = tempoD(posAt(pid, at))
      const goldBefore = Number(snapshotAt(pid, at)?.currentGold) || 0
      // In base because of a recall, not of a death: alive for the whole minute before and during the fight.
      const died = downIn(pid, ts - T.aliveBeforeSec * 1000, ts + T.fightWindowSec * 1000)
      if (dNow == null || dBefore == null || dNow >= T.userBase || dBefore < T.userBase || goldBefore <= T.goldBefore || died) continue
      const before = track.before(ts)
      const after = track.at(ts + 60_000)
      add('absent-objective', at, posAt(pid, at), 0.1 + high.length * 0.04 + (before != null && after != null ? Math.max(0, before - after) : 0),
        { pattern: 'tempo-late-recall', alliesHigh: high.length, goldInPocket: Math.round(goldBefore) }, after, ts)
    }
  }

  // ── 6. Roams (< 14 min): a mid roam that costs plates, then any lane rotation that costs waves ──
  if (laneOpponent) {
    const opp: number = laneOpponent.participantId
    const csGap = (i: number) => csOf(i, pid) - csOf(i, opp)
    const xpGap = (i: number) => xpOf(i, pid) - xpOf(i, opp)
    const roamFrames = new Set<number>()
    /** The player left the lane alive at minute k — not walking back from a death. */
    const leftAlive = (k: number) => !myDeaths.some((d) => d.timestamp >= k * 60_000 - S.rotation.deathGuardSec * 1000 && d.timestamp <= k * 60_000 + 20_000)

    if (role === 'MIDDLE') {
      const ourMidPlates = events.filter((e) => {
        if (e.type !== 'TURRET_PLATE_DESTROYED') return false
        if (e.position) return dist(e.position, MID_OUTER_TURRET[team]) < 1500
        return e.laneType === 'MID_LANE' && typeof e.killerId === 'number' && e.killerId > 0 && teamOf(e.killerId) !== team
      })
      for (let k = 2; k * 60 < S.midRoam.untilSec && k + 2 < frames.length; k++) {
        const p0 = posAt(pid, k * 60_000)
        const p1 = posAt(pid, (k + 1) * 60_000)
        if (!p0 || !p1 || zoneOf(p0, team) !== 'mid-lane' || !leftAlive(k)) continue
        const z1 = zoneOf(p1, team)
        if (z1 === 'mid-lane' || z1 === 'own-base' || z1 === 'enemy-base') continue
        // A real excursion toward a side lane — not a step into the brush next to the lane.
        if (Math.abs(p1.x - p1.y) < S.midRoam.minOffAxis) continue
        const from = k * 60_000
        const to = (k + 2) * 60_000
        if (takedownIn(from, to)) continue
        const platesLost = ourMidPlates.filter((e) => e.timestamp >= from && e.timestamp <= to).length
        const csLost = csGap(k) - csGap(k + 2)
        if (platesLost < S.midRoam.plates || csLost < S.midRoam.cs) continue
        const t0 = from + 30_000
        roamFrames.add(k)
        const added = add('early-deficit', t0, posAt(pid, t0), 0.14 + Math.min(0.12, platesLost * 0.04 + csLost / 200), {
          pattern: 'mid-roam-plates', platesLost, csLost, xpLost: Math.round(xpGap(k) - xpGap(k + 2)), roamSide: p1.y > p1.x ? 'top' : 'bot',
          ...(objectives.some((o) => !o.ours && o.kind === 'grubs' && o.ts <= to) ? { enemyGrubs: true } : {}),
        })
        if (added) break
      }
    }

    const myLane: LaneBucket = role === 'TOP' ? 'TOP' : role === 'MIDDLE' ? 'MID' : 'BOT'
    const R = S.rotation
    const offLane = (p: Point | null) => p != null && laneOf(p) === 'JUNGLE' && zoneOf(p, team) !== 'own-base'
    for (let k = 2; k * 60 < R.untilSec && k + 2 < frames.length; k++) {
      if (roamFrames.has(k)) continue
      const atLane = posAt(pid, k * 60_000)
      if (!atLane || laneOf(atLane) !== myLane || zoneOf(atLane, team) === 'own-base' || !leftAlive(k)) continue
      // Off lane, in the river / jungle, at two points 30 s apart — and still off lane at the next snapshot:
      // two interpolated points alone would also "leave" an L-shaped side lane by cutting its corner.
      const t0 = k * 60_000 + 20_000
      if (![t0, t0 + R.awaySec * 1000, (k + 1) * 60_000].every((ms) => offLane(posAt(pid, ms)))) continue
      if (takedownIn(k * 60_000, (k + 2) * 60_000)) continue
      const csLost = csGap(k) - csGap(k + 2)
      const xpLost = Math.round(xpGap(k) - xpGap(k + 2))
      if (csLost <= R.cs || xpLost <= R.xp) continue
      if (add('early-deficit', t0, posAt(pid, t0), 0.1 + Math.min(0.15, csLost / 100), { pattern: 'bad-rotation', csLost, xpLost })) break
    }
  }

  // ── 7. Pit fights the zoner survived: in the pit instead of on a choke point, fight lost ──
  if (isZoner) {
    for (const f of pitFights) {
      if (myDeaths.some((d) => pitFightOf(d) === f)) continue // died in it: handled as a critical death
      const objectiveLost = objectives.some((o) => !o.ours && EPIC.includes(o.kind) && o.ts >= f.start && o.ts <= f.end + 60_000)
      if (f.allyDeaths <= f.enemyDeaths && !objectiveLost) continue
      if (!insidePitBefore(f)) continue
      const at = f.start - S.pit.beforeSec * 1000
      const pos = posAt(pid, at)
      add('absent-objective', at, pos, 0.12 + f.allyDeaths * 0.03 + (objectiveLost ? 0.08 : 0), {
        pattern: 'pit-chokepoint', alliesDown: f.allyDeaths, nearestPit: f.pit,
        pitDistance: pos ? Math.round(dist(pos, pitCenter(f.pit))) : undefined, nearObjective: true,
      }, track.at(f.start + 60_000), f.start)
    }
  }

  return {
    participantId: pid,
    teamId: team,
    champion: me.championName ?? '',
    position: role,
    winProb: track.curve,
    moments: pickMoments(candidates),
    contested,
    garbageDiscarded,
    laneAt10,
  }
}

/** The costliest moments, at least 25 s apart, then in game order. */
export function pickMoments(candidates: CriticalMoment[], max: number = MAX_MOMENTS): CriticalMoment[] {
  const kept: CriticalMoment[] = []
  for (const c of [...candidates].sort((a, b) => b.severity - a.severity || a.gameTimeSec - b.gameTimeSec)) {
    if (kept.some((k) => Math.abs(k.gameTimeSec - c.gameTimeSec) < DETECTOR_SPEC.minSpacingSec)) continue
    kept.push(c)
    if (kept.length >= max) break
  }
  return kept.sort((a, b) => a.gameTimeSec - b.gameTimeSec)
}
