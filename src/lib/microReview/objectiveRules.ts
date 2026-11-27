/**
 * Prio before an objective, crossmap when an objective is not contested, duo botlane attribution
 * (docs/moteur/engine-reports/2026-11-27-prio-crossmap-duo.md, phase 1: FIGURES ONLY, no Mistake Lab tag yet).
 *
 * Pure: reads a Match-V5 + Timeline-V5 pair through the shared ledger track (ledgerCore.ts), no Riot request, nothing
 * shown here. Every threshold lives in OBJECTIVE_RULES_SPEC so the calibration (scripts/calibrate-prio-crossmap.ts) can
 * move them without touching the code. The timeline holds no minion: the lane prio is READ from what proves it (a plate
 * or a tower, an opponent dead or in base) then from what suggests it (positions, CS); see `LaneRead.proof`.
 */
import {
  ALLY_RADIUS, BARON_PIT, DRAGON_PIT, PIT_FIGHT_RADIUS, PIT_INSIDE_RADIUS, TURRETS, dist, inBaseBox, laneOf, tempoLineD, territoryOf,
  type Point, type TeamId,
} from './geometry'
import { buildLedgerTrack, type LedgerTrack } from './ledgerCore'
import { GARBAGE_HIGH, GARBAGE_LOW, winProbAt, winProbabilityCurve } from './winProbability'
import { ROAM_THRESHOLDS, roamLedger, type RoamEntry, type RoamThresholds } from './roamLedger'

// ── Spec ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const OBJECTIVE_RULES_SPEC = {
  /** Bump when the output changes: stored blocks with an older version are computed again. */
  version: 1,
  /** The Mistake Lab tags stay off until the video review (phase 3). The figures are always computed. */
  tagsEnabled: { prio: false, crossmap: false, duo: false },
  prio: {
    /** Wave grid (wiki Minion, 26.1): first wave 0:30, every 30 s, 25 s from 14:00, 20 s from 30:00. */
    waveFirstSec: 30, waveStepSec: 30, waveStepLateSec: 25, lateFromSec: 840, waveStepVeryLateSec: 20, veryLateFromSec: 1800,
    /** Walk of a wave to the middle of the lane (estimated, ±5 s, to film). */
    waveTravelSec: 25, waveTravelLateSec: 30,
    /** A pushed wave reaches the enemy turret and crashes this long after the middle. */
    crashSec: 10,
    /** Climax window W = [S + travel − before, S + travel + after], cut at the reference time and at the take. */
    climaxBeforeSec: 5, climaxAfterSec: 20,
    /** After this delay the objective counts as played from the moment someone starts it, not from its spawn. */
    playDelaySec: 90,
    plateLookbackSec: 30,
    crashRadius: 1500,
    frontMargin: 1000,
    oppAwayMinSec: 15,
    csTieBreakAhead: 5, csTieBreakBehind: 2,
    sampleSec: 5,
    /** Side with the advantage: gap between the two sides and minimal edge, in gold + XP. */
    sideGap: 1500, sideMinEdge: 500, sideAbsentBonus: 1000, sidePrioBonus: 500,
    junglerEdgeGold: 1500, junglerEdgeLevels: 1,
    otherSideAvailSec: 60,
    engageSec: 90,
    /** The prio figures are read from this to 20:00 (after it, the late-game rules of the report take over, phase 2). */
    fromSec: 300, untilSec: 1200,
    supportHelpSec: 90,
    /** Strength a signal gives a side: 3 proven, 2 probable, 1 suggested. */
    strength: { P1: 3, P2: 3, P3: 2, P4: 1, P5: 1 },
  },
  crossmap: {
    contestBeforeSec: 60, contestAfterSec: 10, contestPitSec: 45,
    windowBeforeSec: 60, windowAfterSec: 60,
    plateRadius: 1500, numbersRadius: ALLY_RADIUS, numbersMinSamples: 2, invadeMinCs: 8, sampleSec: 5,
    /** Share of the window spent on the opposite half of the map for a player to count as having crossed. */
    presenceShare: { JUNGLE: 0.5, MIDDLE: 0.3, UTILITY: 0.3 } as Record<string, number>,
    /** Roles judged on an uncontested objective (top and ADC keep the 20/11 exemption before 14:00 in soloQ). */
    roles: ['JUNGLE', 'MIDDLE', 'UTILITY'] as readonly string[],
  },
  duo: {
    adcBehindGold: 1500, adcBehindLevels: 2,
    diveTowerRadius: 1100,
    absentDistance: 3000,
    regroupAllies: 2, regroupRadius: ALLY_RADIUS,
    minAttackers: 2,
    farmAdvanceMargin: 1000,
    killLookbackSec: 15,
    lookbackSec: 10,
    after14Sec: 840, sameFightSec: 20,
    advanceStepSec: 10, advanceMinSec: 10, advanceMergeSec: 30,
    crashLookbackSec: 60,
  },
  garbage: { low: GARBAGE_LOW, high: GARBAGE_HIGH },
} as const

type Widen<T> = T extends number ? number : T extends boolean ? boolean : T extends readonly string[] ? readonly string[] : T extends object ? { [K in keyof T]: Widen<T[K]> } : T
/** The spec with its numbers widened: a calibration (or a test) can pass its own values. */
export type ObjectiveRulesSpec = Widen<typeof OBJECTIVE_RULES_SPEC>

// ── Types (stored in TimelinePlayers.objectiveRules, read by the session and collective figures) ──────────────────

export type RuleKind = 'dragon' | 'elder' | 'grubs' | 'herald' | 'baron'
export type PrioState = 'ours' | 'theirs' | 'even' | 'unknown'
/** How the state is known: a plate / a tower / an empty lane (proven), a position at the turret (probable), positions or CS (suggested). */
export type PrioProof = 'proven' | 'probable' | 'suggested' | null
export type PrioSignal = 'P1' | 'P2' | 'P3' | 'P4' | 'P5'

export interface LaneRead { state: PrioState; proof: PrioProof; signal: PrioSignal | null }

export type BlockedReason = 'outnumbered' | 'jungle-away' | 'jungle-out' | 'garbage'

export type CrossVerdict = 'traded' | 'no-trade' | 'justified'
export interface CrossmapRead {
  verdict: CrossVerdict
  /** What was taken on the other side of the map. */
  resources: { objective: boolean; plates: number; towers: number; kills: number; invade: boolean; numbers: boolean }
  /** Our players that crossed (a resource, or enough time on the other half), whatever their role. */
  crossed: number[]
}

export interface ObjectiveRuleEntry {
  kind: RuleKind
  /** When it was taken, when it spawned, and the reference time the prio is read for (all in game seconds). */
  atSec: number
  spawnSec: number
  refSec: number
  ours: boolean
  side: 'top' | 'bot'
  /** The climax window the prio is read in (null when the objective went too fast to read one). */
  window: [number, number] | null
  /** Lane of the objective's side and the mid, seen from OUR side. */
  sideLane: LaneRead
  mid: LaneRead
  /** Gold + XP edge of each side of the map (ours minus theirs, bonuses included) and the side to play, when one stands out. */
  edge: { top: number; bot: number; favoured: 'top' | 'bot' | null; otherSideAvailable: boolean; junglerEdge: boolean }
  blocked: BlockedReason | null
  /** Our jungler started the objective (in the pit, or a fight of ours around it, or we took it). */
  engaged: boolean
  /** Our supports that were on the side lane or the mid in the 90 s before the objective. */
  helped: number[]
  /** Only for an objective taken by THEM: nobody of ours was around (null for ours). */
  contested: boolean | null
  /** Only for an objective taken by THEM and not contested. */
  crossmap: CrossmapRead | null
}

export type DuoFault = 'support' | 'adc' | 'shared' | 'none'
export type DuoReason =
  | 'adc-behind' | 'reset-after-crash' | 'solo-kill' | 'dive' | 'forced-advance' | 'out-of-tower' | 'adc-advanced'
  | 'support-advanced' | 'adc-left' | 'none'
export interface DuoDeath {
  tSec: number
  /** Who died (our ADC or our support) and who was away. */
  pid: number
  role: 'BOTTOM' | 'UTILITY'
  fault: DuoFault
  reason: DuoReason
  attackers: number
  after14: boolean
  /** The partner had left with a roam of the ledger (before 20:00); false = just away (dead, in base, farther than 3 000). */
  roam: boolean
}
export interface DuoAdvance { fromSec: number; toSec: number; died: boolean }

export interface ObjectiveRulesBlock {
  v: number
  roles: Array<{ pid: number; role: string }>
  objectives: ObjectiveRuleEntry[]
  duo: { deaths: DuoDeath[]; advances: DuoAdvance[] }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ROLE_OF_LANE = { TOP: ['TOP'], MID: ['MIDDLE'], BOT: ['BOTTOM', 'UTILITY'] } as const
type Lane = 'TOP' | 'MID' | 'BOT'
const LANE_TOWERS: Record<Lane, [number, number, number]> = { TOP: [0, 1, 2], MID: [3, 4, 5], BOT: [6, 7, 8] }
const enemyOf = (t: TeamId): TeamId => (t === 100 ? 200 : 100)
const asTeam = (n: number | undefined): TeamId | null => (n === 100 ? 100 : n === 200 ? 200 : null)
const pitOf = (kind: RuleKind): Point => (kind === 'dragon' || kind === 'elder' ? DRAGON_PIT : BARON_PIT)
const sideOf = (kind: RuleKind): 'top' | 'bot' => (kind === 'dragon' || kind === 'elder' ? 'bot' : 'top')
/** Half of the map a point is on (top-left or bottom-right of the diagonal). */
const halfOf = (p: Point): 'top' | 'bot' => (p.y > p.x ? 'top' : 'bot')
/** On the top or bottom half of the map and not in the mid corridor (a point of the mid lane is on neither side). */
const onSide = (p: Point, side: 'top' | 'bot'): boolean => halfOf(p) === side && laneOf(p) !== 'MID'
/** The lane each role holds: standing in it is not a trade. */
const HOME_LANE: Record<string, string> = { TOP: 'TOP', MIDDLE: 'MID', BOTTOM: 'BOT', UTILITY: 'BOT' }

function samples(fromMs: number, toMs: number, stepMs: number): number[] {
  const out: number[] = []
  for (let t = fromMs; t <= toMs; t += stepMs) out.push(t)
  return out
}

interface Ctx {
  tr: LedgerTrack
  us: TeamId
  them: TeamId
  pidOf: (team: TeamId, role: string) => number | undefined
  idsOf: (team: TeamId) => number[]
  /** Turret destroyed times by team and index in TURRETS[team]. */
  fell: Map<string, number>
  plates: Array<{ t: number; lane: Lane; by: TeamId; killer: number; assists: number[]; pos: Point | null }>
  towers: Array<{ t: number; lane: Lane | null; by: TeamId; killer: number; assists: number[]; pos: Point | null }>
  curve: number[]
}

function buildCtx(match: any, timeline: any, us: TeamId, trIn?: LedgerTrack | null): Ctx | null {
  const tr = trIn ?? buildLedgerTrack(match, timeline)
  if (!tr) return null
  const them = enemyOf(us)
  const pidOf = (team: TeamId, role: string) => tr.parts.find((p) => p.teamId === team && tr.positionOf(p) === role)?.participantId as number | undefined
  const idsOf = (team: TeamId) => tr.parts.filter((p) => p.teamId === team).map((p) => p.participantId as number)
  const fell = new Map<string, number>()
  const plates: Ctx['plates'] = []
  const towers: Ctx['towers'] = []
  const laneOfEvent = (e: any): Lane | null => {
    const l = String(e.laneType ?? '').replace(/_LANE$/, '')
    return l === 'TOP' || l === 'MID' || l === 'BOT' ? l : null
  }
  for (const e of tr.events) {
    if (e.type === 'BUILDING_KILL' && e.buildingType === 'TOWER_BUILDING') {
      const owner = asTeam(e.teamId)
      if (!owner) continue
      const pos = e.position as Point | undefined
      if (pos) {
        let best = -1, bd = 450
        TURRETS[owner].forEach((p, i) => { const d = dist(p, pos); if (d < bd) { bd = d; best = i } })
        if (best >= 0) fell.set(`${owner}:${best}`, e.timestamp)
      }
      const by = typeof e.killerId === 'number' && e.killerId > 0 ? asTeam(tr.teamOf(e.killerId)) : null
      towers.push({ t: e.timestamp, lane: laneOfEvent(e), by: by ?? enemyOf(owner), killer: e.killerId ?? 0, assists: e.assistingParticipantIds ?? [], pos: pos ?? null })
    } else if (e.type === 'TURRET_PLATE_DESTROYED') {
      const owner = asTeam(e.teamId)
      const lane = laneOfEvent(e)
      if (!owner || !lane) continue
      const by = typeof e.killerId === 'number' && e.killerId > 0 ? asTeam(tr.teamOf(e.killerId)) : null
      plates.push({ t: e.timestamp, lane, by: by ?? enemyOf(owner), killer: e.killerId ?? 0, assists: e.assistingParticipantIds ?? [], pos: (e.position as Point) ?? null })
    }
  }
  const curve = winProbabilityCurve(tr.frames, (pid) => tr.teamOf(pid), us)
  return { tr, us, them, pidOf, idsOf, fell, plates, towers, curve }
}

/** The turret still standing in a lane (outer, then inner, then the inhibitor one), or null. */
function standingTower(c: Ctx, team: TeamId, lane: Lane, ms: number): Point | null {
  for (const i of LANE_TOWERS[lane]) {
    const t = c.fell.get(`${team}:${i}`)
    if (t == null || t > ms) return TURRETS[team][i]
  }
  return null
}

const alive = (c: Ctx, pid: number, ms: number) => !c.tr.deadAt(pid, ms)
/** Alive and outside the base box. */
function active(c: Ctx, pid: number, ms: number): Point | null {
  if (!alive(c, pid, ms)) return null
  const p = c.tr.posAt(pid, ms)
  if (!p) return null
  const team = asTeam(c.tr.teamOf(pid))
  return team && inBaseBox(p, team) ? null : p
}

// ── Wave clock and the climax window ────────────────────────────────────────────────────────────────────────────

/** Spawn times of the waves (seconds), up to an hour. */
export function waveSpawns(spec: ObjectiveRulesSpec['prio'] = OBJECTIVE_RULES_SPEC.prio): number[] {
  const out: number[] = []
  for (let t = spec.waveFirstSec; t <= 3600; t += t < spec.lateFromSec ? spec.waveStepSec : t < spec.veryLateFromSec ? spec.waveStepLateSec : spec.waveStepVeryLateSec) out.push(t)
  return out
}

/**
 * The climax of the prio: the last wave that can still crash before the objective (spawn S with S + walk + crash ≤ refSec),
 * and the window it is read in. Cut at the reference time and at the take; null when nothing is left of it.
 */
export function climaxWindow(refSec: number, takenSec: number, spec: ObjectiveRulesSpec['prio'] = OBJECTIVE_RULES_SPEC.prio): { spawnSec: number; fromSec: number; toSec: number } | null {
  let best: { s: number; travel: number } | null = null
  for (const s of waveSpawns(spec)) {
    const travel = s < spec.lateFromSec ? spec.waveTravelSec : spec.waveTravelLateSec
    if (s + travel + spec.crashSec <= refSec) best = { s, travel }
    else break
  }
  if (!best) return null
  const fromSec = best.s + best.travel - spec.climaxBeforeSec
  const toSec = Math.min(best.s + best.travel + spec.climaxAfterSec, refSec, takenSec)
  return toSec > fromSec ? { spawnSec: best.s, fromSec, toSec } : null
}

// ── laneStateAt ─────────────────────────────────────────────────────────────────────────────────────────────────

interface Signal { level: number; signal: PrioSignal | null }

function teamSignal(c: Ctx, lane: Lane, team: TeamId, fromSec: number, toSec: number, P: ObjectiveRulesSpec['prio']): Signal {
  const foe = enemyOf(team)
  const mine = ROLE_OF_LANE[lane].map((r) => c.pidOf(team, r)).filter((x): x is number => x != null)
  const theirs = ROLE_OF_LANE[lane].map((r) => c.pidOf(foe, r)).filter((x): x is number => x != null)
  const fromMs = fromSec * 1000, toMs = toSec * 1000
  const best: Signal = { level: 0, signal: null }
  const raise = (signal: PrioSignal) => { const l = P.strength[signal]; if (l > best.level) { best.level = l; best.signal = signal } }

  // P1: a plate or a tower of the lane taken by this team in W or just before it.
  const lo = fromMs - P.plateLookbackSec * 1000
  if (c.plates.some((x) => x.lane === lane && x.by === team && x.t >= lo && x.t <= toMs)
    || c.towers.some((x) => x.lane === lane && x.by === team && x.t >= lo && x.t <= toMs)) raise('P1')

  const step = P.sampleSec * 1000
  const pts = samples(fromMs, toMs, step)
  // P2: every opponent of the lane dead or in base for at least oppAwayMinSec, one of ours alive and out of base.
  if (theirs.length) {
    let awayMs = 0
    for (const t of pts) {
      const away = theirs.every((id) => !active(c, id, t))
      if (away && mine.some((id) => active(c, id, t))) awayMs += step
    }
    if (awayMs >= P.oppAwayMinSec * 1000) raise('P2')
  }
  // P3: one of ours within crashRadius of the opponent's standing turret of the lane.
  const oppTower = standingTower(c, foe, lane, toMs)
  if (oppTower) {
    for (const t of pts) {
      if (mine.some((id) => { const p = active(c, id, t); return p ? dist(p, oppTower) <= P.crashRadius : false })) { raise('P3'); break }
    }
  }
  // P4: ours beyond the middle of the lane, the opponent behind it (at the middle of W).
  const ownTower = standingTower(c, team, lane, toMs)
  if (oppTower && ownTower) {
    const mid = (fromMs + toMs) / 2
    const front = mine.some((id) => { const p = active(c, id, mid); return p ? dist(p, oppTower) < dist(p, ownTower) - P.frontMargin : false })
    const oppBack = theirs.length === 0 || theirs.every((id) => { const p = c.tr.posAt(id, mid); return !p || dist(p, oppTower) >= dist(p, ownTower) })
    if (front && oppBack) raise('P4')
  }
  // P5: CS of the wave of the climax between the two snapshots around W (a tie-break).
  const i0 = Math.max(0, Math.floor(fromMs / 60000)), i1 = Math.min(c.tr.frames.length - 1, Math.ceil(toMs / 60000))
  if (i1 > i0 && mine.length && theirs.length) {
    const gain = (ids: number[]) => ids.reduce((s, id) => s + c.tr.csOf(i1, id) - c.tr.csOf(i0, id), 0)
    if (gain(mine) >= P.csTieBreakAhead && gain(theirs) <= P.csTieBreakBehind) raise('P5')
  }
  return best
}

const PROOF_OF: Record<number, PrioProof> = { 0: null, 1: 'suggested', 2: 'probable', 3: 'proven' }

/**
 * Who has the prio of `lane` over the window [fromSec, toSec], seen from `team`: the side with the stronger signal wins;
 * equal signals (or none) = even; unknown when nobody of either side stands in the lane and nothing proves a prio.
 */
export function laneStateAt(c: Ctx, lane: Lane, team: TeamId, fromSec: number, toSec: number, spec: ObjectiveRulesSpec['prio'] = OBJECTIVE_RULES_SPEC.prio): LaneRead {
  const a = teamSignal(c, lane, team, fromSec, toSec, spec)
  const b = teamSignal(c, lane, enemyOf(team), fromSec, toSec, spec)
  if (a.level === 0 && b.level === 0) {
    const stand = (t: TeamId) => ROLE_OF_LANE[lane].some((r) => {
      const id = c.pidOf(t, r)
      if (id == null) return false
      return [fromSec, toSec].some((s) => { const p = active(c, id, s * 1000); return p != null && laneOf(p) === lane })
    })
    return stand(team) || stand(enemyOf(team)) ? { state: 'even', proof: null, signal: null } : { state: 'unknown', proof: null, signal: null }
  }
  if (a.level === b.level) return { state: 'even', proof: PROOF_OF[a.level], signal: a.signal }
  return a.level > b.level
    ? { state: 'ours', proof: PROOF_OF[a.level], signal: a.signal }
    : { state: 'theirs', proof: PROOF_OF[b.level], signal: b.signal }
}

// ── The objectives of a game ────────────────────────────────────────────────────────────────────────────────────

interface RawObjective { kind: RuleKind; atSec: number; spawnSec: number; team: TeamId; killer: number; assists: number[] }

function rawObjectives(c: Ctx): RawObjective[] {
  const out: RawObjective[] = []
  const lastDragon = { t: 0 }, lastBaron = { t: 0 }
  for (const e of c.tr.events) {
    if (e.type !== 'ELITE_MONSTER_KILL') continue
    const team = asTeam(e.killerTeamId) ?? asTeam(c.tr.teamOf(e.killerId))
    if (!team) continue
    const atSec = Math.round(e.timestamp / 1000)
    const base = { team, killer: e.killerId ?? 0, assists: e.assistingParticipantIds ?? [] }
    if (e.monsterType === 'DRAGON') {
      const kind: RuleKind = e.monsterSubType === 'ELDER_DRAGON' ? 'elder' : 'dragon'
      const spawn = lastDragon.t ? lastDragon.t + (kind === 'elder' ? 360 : 300) : 300
      out.push({ kind, atSec, spawnSec: Math.min(spawn, atSec), ...base })
      lastDragon.t = atSec
    } else if (e.monsterType === 'BARON_NASHOR') {
      const spawn = lastBaron.t ? lastBaron.t + 360 : 1200
      out.push({ kind: 'baron', atSec, spawnSec: Math.min(spawn, atSec), ...base })
      lastBaron.t = atSec
    } else if (e.monsterType === 'RIFTHERALD') {
      out.push({ kind: 'herald', atSec, spawnSec: Math.min(900, atSec), ...base })
    } else if (e.monsterType === 'HORDE') {
      // The camp of grubs is killed grub by grub: one objective per take (same team, within 60 s).
      const last = [...out].reverse().find((x) => x.kind === 'grubs')
      if (last && last.team === team && atSec - last.atSec <= 60) { last.atSec = atSec; continue }
      out.push({ kind: 'grubs', atSec, spawnSec: Math.min(480, atSec), ...base })
    }
  }
  return out
}

/**
 * Reference time of the prio: the spawn when the objective is played within playDelaySec of it, else the moment someone
 * starts it (a champion in the pit, or a fight around it); the take itself when nothing is seen.
 */
function referenceSec(c: Ctx, o: RawObjective, P: ObjectiveRulesSpec['prio']): number {
  if (o.atSec - o.spawnSec <= P.playDelaySec) return o.spawnSec
  const pit = pitOf(o.kind)
  const fights = c.tr.kills.filter((k) => k.position && dist(k.position, pit) <= PIT_FIGHT_RADIUS).map((k) => k.timestamp)
  for (let s = o.spawnSec; s <= o.atSec; s += P.sampleSec) {
    const ms = s * 1000
    const inPit = c.tr.parts.some((p) => { const pos = active(c, p.participantId, ms); return pos != null && dist(pos, pit) <= PIT_INSIDE_RADIUS })
    if (inPit || fights.some((t) => Math.abs(t - ms) <= 5000)) return Math.max(s, o.spawnSec)
  }
  return o.atSec
}

function sideEdgeOf(c: Ctx, side: 'top' | 'bot', atSec: number, read: LaneRead, win: { from: number; to: number } | null, P: ObjectiveRulesSpec['prio']): number {
  const i = Math.max(0, Math.min(c.tr.frames.length - 1, Math.floor(atSec / 60)))
  const roles = side === 'top' ? ['TOP'] : ['BOTTOM', 'UTILITY']
  const sum = (team: TeamId) => roles.reduce((s, r) => { const id = c.pidOf(team, r); return id == null ? s : s + c.tr.goldOf(i, id) + c.tr.xpOf(i, id) }, 0)
  let edge = sum(c.us) - sum(c.them)
  if (win) {
    const mid = ((win.from + win.to) / 2) * 1000
    for (const r of roles) {
      const id = c.pidOf(c.them, r)
      if (id != null && !active(c, id, mid)) edge += P.sideAbsentBonus
      const mine = c.pidOf(c.us, r)
      if (mine != null && !active(c, mine, mid)) edge -= P.sideAbsentBonus
    }
  }
  if (read.proof && read.proof !== 'suggested') edge += read.state === 'ours' ? P.sidePrioBonus : read.state === 'theirs' ? -P.sidePrioBonus : 0
  return edge
}

function blockedReason(c: Ctx, o: RawObjective, refSec: number): BlockedReason | null {
  const ms = refSec * 1000
  const winP = winProbAt(c.curve, ms)
  if (winP != null && (winP < OBJECTIVE_RULES_SPEC.garbage.low || winP > OBJECTIVE_RULES_SPEC.garbage.high)) return 'garbage'
  const ours = c.idsOf(c.us).filter((id) => active(c, id, ms)).length
  const theirs = c.idsOf(c.them).filter((id) => active(c, id, ms)).length
  if (ours < theirs) return 'outnumbered'
  const jg = c.pidOf(c.us, 'JUNGLE')
  if (jg == null) return null
  if (!active(c, jg, ms)) return 'jungle-out'
  const p = c.tr.posAt(jg, ms - 30_000)
  if (p) {
    const here = pitOf(o.kind), other = here === DRAGON_PIT ? BARON_PIT : DRAGON_PIT
    if (dist(p, other) < dist(p, here)) return 'jungle-away'
  }
  return null
}

/** The jungler started the objective: in the pit, a fight of ours around it, or we took it. */
function junglerEngaged(c: Ctx, o: RawObjective, refSec: number, P: ObjectiveRulesSpec['prio']): boolean {
  if (o.team === c.us) return true
  const jg = c.pidOf(c.us, 'JUNGLE')
  if (jg == null) return false
  const pit = pitOf(o.kind)
  const to = Math.min(o.atSec, refSec + P.engageSec)
  for (let s = refSec; s <= to; s += P.sampleSec) {
    const p = active(c, jg, s * 1000)
    if (p && dist(p, pit) <= PIT_INSIDE_RADIUS) return true
  }
  return c.tr.kills.some((k) => k.position && k.timestamp >= refSec * 1000 && k.timestamp <= to * 1000 && dist(k.position, pit) <= PIT_FIGHT_RADIUS
    && (c.tr.teamOf(k.killerId) === c.us || (k.assistingParticipantIds ?? []).some((a: number) => c.tr.teamOf(a) === c.us)))
}

function supportsWhoHelped(c: Ctx, o: RawObjective, refSec: number, P: ObjectiveRulesSpec['prio']): number[] {
  const sup = c.pidOf(c.us, 'UTILITY')
  if (sup == null) return []
  const sideLane: Lane = sideOf(o.kind) === 'top' ? 'TOP' : 'BOT'
  for (let s = Math.max(0, refSec - P.supportHelpSec); s <= refSec; s += P.sampleSec) {
    const p = active(c, sup, s * 1000)
    if (!p) continue
    const l = laneOf(p)
    if (l === sideLane || l === 'MID') return [sup]
  }
  return []
}

// ── Crossmap ────────────────────────────────────────────────────────────────────────────────────────────────────

function wasContested(c: Ctx, o: RawObjective, X: ObjectiveRulesSpec['crossmap']): boolean {
  const pit = pitOf(o.kind)
  const tk = o.atSec * 1000
  const ours = c.idsOf(c.us)
  for (const id of ours) {
    const near = active(c, id, tk)
    if (near && dist(near, pit) <= PIT_FIGHT_RADIUS) return true
  }
  const inFight = c.tr.kills.some((k) => k.position && k.timestamp >= tk - X.contestBeforeSec * 1000 && k.timestamp <= tk + X.contestAfterSec * 1000
    && dist(k.position, pit) <= PIT_FIGHT_RADIUS
    && (c.tr.teamOf(k.killerId) === c.us || c.tr.teamOf(k.victimId) === c.us || (k.assistingParticipantIds ?? []).some((a: number) => c.tr.teamOf(a) === c.us)))
  if (inFight) return true
  for (let s = o.atSec - X.contestPitSec; s <= o.atSec; s += X.sampleSec) {
    if (ours.some((id) => { const p = active(c, id, s * 1000); return p != null && dist(p, pit) <= PIT_INSIDE_RADIUS })) return true
  }
  return false
}

function crossmapRead(c: Ctx, o: RawObjective, blocked: BlockedReason | null, X: ObjectiveRulesSpec['crossmap']): CrossmapRead {
  const opp = sideOf(o.kind) === 'bot' ? 'top' : 'bot'
  const from = (o.atSec - X.windowBeforeSec) * 1000, to = (o.atSec + X.windowAfterSec) * 1000
  const crossed = new Set<number>()
  const res = { objective: false, plates: 0, towers: 0, kills: 0, invade: false, numbers: false }
  const add = (...ids: number[]) => { for (const id of ids) if (c.tr.teamOf(id) === c.us && id > 0) crossed.add(id) }
  const oppLane: Lane = opp === 'top' ? 'TOP' : 'BOT'
  // An objective of the other pit taken by us.
  for (const x of rawObjectives(c)) {
    if (x.team === c.us && sideOf(x.kind) === opp && x.atSec * 1000 >= from && x.atSec * 1000 <= to) { res.objective = true; add(x.killer, ...x.assists) }
  }
  // Plates and towers of the other side (and the mid plates, which count for the mid).
  const near = (id: number, p: Point | null, t: number) => { const q = active(c, id, t); return !!q && !!p && dist(q, p) <= X.plateRadius }
  for (const pl of c.plates) {
    if (pl.by !== c.us || pl.t < from || pl.t > to || (pl.lane !== oppLane && pl.lane !== 'MID')) continue
    res.plates++
    add(pl.killer, ...pl.assists)
    for (const id of c.idsOf(c.us)) if (near(id, pl.pos, pl.t)) add(id)
  }
  for (const tw of c.towers) {
    if (tw.by !== c.us || tw.t < from || tw.t > to || tw.lane !== oppLane) continue
    res.towers++
    add(tw.killer, ...tw.assists)
  }
  // Takedowns on the other half of the map.
  for (const k of c.tr.kills) {
    if (k.timestamp < from || k.timestamp > to || !k.position || !onSide(k.position, opp) || c.tr.teamOf(k.killerId) !== c.us) continue
    res.kills++
    add(k.killerId, ...(k.assistingParticipantIds ?? []))
  }
  // The jungler invades: camps cleared on the other half, in the enemy jungle.
  const jg = c.pidOf(c.us, 'JUNGLE')
  const pts = samples(from, to, X.sampleSec * 1000)
  if (jg != null) {
    const i0 = Math.max(0, Math.floor(from / 60000)), i1 = Math.min(c.tr.frames.length - 1, Math.ceil(to / 60000))
    const cs = (i: number) => Number(c.tr.pframe(i, jg)?.jungleMinionsKilled) || 0
    const inEnemyJungle = pts.filter((t) => { const p = active(c, jg, t); return p != null && onSide(p, opp) && laneOf(p) === 'JUNGLE' && (c.us === 100 ? p.x + p.y > 15000 : p.x + p.y < 15000) }).length
    if (cs(i1) - cs(i0) >= X.invadeMinCs && inEnemyJungle >= 2) { res.invade = true; add(jg) }
  }
  // A numbers advantage on the other half: at least two of ours around a point where fewer of theirs stand (and one of them).
  let streak = 0
  for (const t of pts) {
    const mine = c.idsOf(c.us).map((id) => ({ id, p: active(c, id, t) })).filter((x): x is { id: number; p: Point } => !!x.p && onSide(x.p, opp) && territoryOf(x.p, c.us) === 'enemy')
    const foes = c.idsOf(c.them).map((id) => active(c, id, t)).filter((p): p is Point => !!p)
    let hit = false
    for (const m of mine) {
      const around = mine.filter((x) => dist(x.p, m.p) <= X.numbersRadius)
      const against = foes.filter((p) => dist(p, m.p) <= X.numbersRadius).length
      if (around.length >= 2 && against >= 1 && around.length > against) { if (streak + 1 >= X.numbersMinSamples) add(...around.map((x) => x.id)); hit = true }
    }
    streak = hit ? streak + 1 : 0
    if (streak >= X.numbersMinSamples) res.numbers = true
  }
  // Time spent on the other half, role by role.
  const span = Math.max(1, pts.length)
  for (const role of X.roles) {
    const id = c.pidOf(c.us, role)
    if (id == null) continue
    const there = pts.filter((t) => { const p = active(c, id, t); return p != null && onSide(p, opp) && laneOf(p) !== HOME_LANE[role] && dist(p, pitOf(o.kind)) > PIT_FIGHT_RADIUS }).length
    if (there / span >= (X.presenceShare[role] ?? 0.5)) crossed.add(id)
  }
  // The team verdict reads proven resources only; time spent on the other half is a per-player figure (`crossed`).
  const any = res.objective || res.plates > 0 || res.towers > 0 || res.kills > 0 || res.invade || res.numbers
  return { verdict: any ? 'traded' : blocked ? 'justified' : 'no-trade', resources: res, crossed: [...crossed].sort((a, b) => a - b) }
}

// ── Objectives ──────────────────────────────────────────────────────────────────────────────────────────────────

export function objectiveEntries(c: Ctx, spec: ObjectiveRulesSpec = OBJECTIVE_RULES_SPEC): ObjectiveRuleEntry[] {
  const P = spec.prio
  const raws = rawObjectives(c)
  const out: ObjectiveRuleEntry[] = []
  const unread: LaneRead = { state: 'unknown', proof: null, signal: null }
  for (const o of raws) {
    const refSec = referenceSec(c, o, P)
    const win = climaxWindow(refSec, o.atSec, P)
    const side = sideOf(o.kind)
    const read = (lane: Lane) => (win ? laneStateAt(c, lane, c.us, win.fromSec, win.toSec, P) : unread)
    const sideLane = read(side === 'top' ? 'TOP' : 'BOT')
    const mid = read('MID')
    const w = win ? { from: win.fromSec, to: win.toSec } : null
    const atEdge = win ? win.fromSec : refSec
    const topRead = side === 'top' ? sideLane : win ? laneStateAt(c, 'TOP', c.us, win.fromSec, win.toSec, P) : unread
    const botRead = side === 'bot' ? sideLane : win ? laneStateAt(c, 'BOT', c.us, win.fromSec, win.toSec, P) : unread
    const top = sideEdgeOf(c, 'top', atEdge, topRead, w, P)
    const bot = sideEdgeOf(c, 'bot', atEdge, botRead, w, P)
    const favoured = bot - top >= P.sideGap && bot >= P.sideMinEdge ? 'bot' : top - bot >= P.sideGap && top >= P.sideMinEdge ? 'top' : null
    const otherSide = side === 'top' ? 'bot' : 'top'
    const otherSideAvailable = raws.some((x) => x !== o && sideOf(x.kind) === otherSide && x.spawnSec <= refSec + P.otherSideAvailSec && x.atSec > refSec)
    const ji = Math.max(0, Math.min(c.tr.frames.length - 1, Math.floor(atEdge / 60)))
    const jg = c.pidOf(c.us, 'JUNGLE'), ejg = c.pidOf(c.them, 'JUNGLE')
    const lvl = (id: number) => Number(c.tr.pframe(ji, id)?.level) || 1
    const junglerEdge = jg != null && ejg != null && c.tr.goldOf(ji, jg) - c.tr.goldOf(ji, ejg) >= P.junglerEdgeGold && lvl(jg) - lvl(ejg) >= P.junglerEdgeLevels
    const blocked = blockedReason(c, o, refSec)
    const theirs = o.team !== c.us
    const contested = theirs ? wasContested(c, o, spec.crossmap) : null
    out.push({
      kind: o.kind, atSec: o.atSec, spawnSec: o.spawnSec, refSec, ours: !theirs, side,
      window: win ? [win.fromSec, win.toSec] : null, sideLane, mid,
      edge: { top: Math.round(top), bot: Math.round(bot), favoured, otherSideAvailable, junglerEdge },
      blocked, engaged: junglerEngaged(c, o, refSec, P), helped: supportsWhoHelped(c, o, refSec, P),
      contested, crossmap: theirs && contested === false ? crossmapRead(c, o, blocked, spec.crossmap) : null,
    })
  }
  return out
}

// ── Duo botlane ─────────────────────────────────────────────────────────────────────────────────────────────────

function roamEntries(c: Ctx, match: any, timeline: any, pid: number | undefined, T: RoamThresholds): RoamEntry[] {
  if (pid == null) return []
  return roamLedger(match, timeline, pid, T, c.tr)?.entries ?? []
}

/** Deaths of our ADC / support while the partner was away, with the fault read from the report's table (§ 3.2). */
export function duoDeaths(c: Ctx, match: any, timeline: any, spec: ObjectiveRulesSpec = OBJECTIVE_RULES_SPEC, T: RoamThresholds = ROAM_THRESHOLDS as RoamThresholds): DuoDeath[] {
  const D = spec.duo
  const adc = c.pidOf(c.us, 'BOTTOM'), sup = c.pidOf(c.us, 'UTILITY')
  const eAdc = c.pidOf(c.them, 'BOTTOM')
  if (adc == null || sup == null) return []
  const supRoams = roamEntries(c, match, timeline, sup, T)
  const adcRoams = roamEntries(c, match, timeline, adc, T)
  const out: DuoDeath[] = []
  const regrouped = (id: number, ms: number): boolean => {
    const p = c.tr.posAt(id, ms)
    if (!p) return false
    return c.idsOf(c.us).filter((x) => x !== id && x !== adc && x !== sup && active(c, x, ms)).filter((x) => { const q = c.tr.posAt(x, ms); return !!q && dist(q, p) <= D.regroupRadius }).length >= D.regroupAllies
  }
  const away = (partner: number, self: number, ms: number): boolean => {
    if (!active(c, partner, ms)) return !c.tr.lives.get(partner)?.some((d) => d.ts <= ms && d.ts >= ms - D.sameFightSec * 1000)
    const p = c.tr.posAt(partner, ms), s = c.tr.posAt(self, ms)
    if (!p || !s) return false
    return dist(p, s) > D.absentDistance && !regrouped(partner, ms)
  }

  for (const k of c.tr.kills) {
    const victim = k.victimId as number
    if ((victim !== adc && victim !== sup) || !k.position) continue
    const t = k.timestamp
    const sampleMs = t - D.lookbackSec * 1000
    const partner = victim === adc ? sup : adc
    if (!away(partner, victim, sampleMs)) continue
    const attackers = (k.killerId > 0 ? 1 : 0) + (k.assistingParticipantIds ?? []).length
    const pos: Point = k.position
    const at = Math.round(t / 1000)
    const after14 = at >= D.after14Sec
    const team = c.us
    const roamEntry = (victim === adc ? supRoams : adcRoams).find((e) => at >= e.fromSec && at <= e.backSec + 15)
    const tower = standingTower(c, team, 'BOT', t)
    const oppTower = standingTower(c, c.them, 'BOT', t)
    const dive = !!tower && (dist(pos, tower) <= D.diveTowerRadius || tempoLineD(pos, team) < tempoLineD(tower, team))
    const base = { tSec: at, pid: victim, role: (victim === adc ? 'BOTTOM' : 'UTILITY') as 'BOTTOM' | 'UTILITY', attackers, after14, roam: !!roamEntry }
    const done = (fault: DuoFault, reason: DuoReason): void => { out.push({ ...base, fault, reason }) }
    const fi = Math.max(0, Math.floor(t / 60000) - 1)
    const lvl = (id: number) => Number(c.tr.pframe(fi, id)?.level) || 1

    if (victim === adc) {
      const behind = eAdc != null && (c.tr.goldOf(fi, adc) - c.tr.goldOf(fi, eAdc) <= -D.adcBehindGold || lvl(eAdc) - lvl(adc) >= D.adcBehindLevels)
      if (behind) { done('none', 'adc-behind'); continue }
      if (roamEntry) {
        // Reset after a crash, ADC stayed: the ADC's fault when he dies out of his tower.
        const stayed = !c.tr.shopsOf(adc).some((s) => s >= (roamEntry.fromSec - D.crashLookbackSec) * 1000 && s <= t)
        if (roamEntry.timer === 'after-recall' && stayed) { done(dive ? 'none' : 'adc', 'reset-after-crash'); continue }
        if (attackers < D.minAttackers) { done('none', 'solo-kill'); continue }
        if (dive) { done('support', 'dive'); continue }
        const badTimer = roamEntry.timer === 'bad' || roamEntry.timer === 'none'
        const waveNotCrashed = !oppTower || (teamSignal(c, 'BOT', team, roamEntry.fromSec - 25, roamEntry.fromSec, spec.prio).level < 2)
        const farming = !!tower && !!oppTower && dist(pos, tower) <= dist(tower, oppTower) / 2 + D.farmAdvanceMargin
        const ownedKillOrPlate = c.tr.kills.some((x) => x.killerId === adc && x.timestamp >= t - D.killLookbackSec * 1000 && x.timestamp < t)
          || c.plates.some((x) => x.killer === adc && x.t >= t - D.killLookbackSec * 1000 && x.t <= t)
        if (badTimer && waveNotCrashed && farming && laneOf(pos) === 'BOT') { done(ownedKillOrPlate ? 'shared' : 'support', 'forced-advance'); continue }
        done('shared', 'out-of-tower'); continue
      }
      // No roam of the ledger: the support is dead, in base or elsewhere. The ADC who stood past the middle is at fault.
      if (attackers < 1) { done('none', 'none'); continue }
      const advanced = !!tower && !!oppTower && dist(pos, oppTower) < dist(pos, tower)
      done(advanced ? 'adc' : 'none', advanced ? 'adc-advanced' : 'none')
    } else {
      if (attackers < D.minAttackers) { done('none', 'solo-kill'); continue }
      const advanced = !!tower && !!oppTower && dist(pos, oppTower) < dist(pos, tower)
      if (advanced) { done('support', 'support-advanced'); continue }
      const adcActive = !!active(c, adc, sampleMs)
      done(adcActive || roamEntry ? 'adc' : 'none', adcActive || roamEntry ? 'adc-left' : 'none')
    }
  }
  return out
}

/** Stretches where the ADC stood past the middle of the lane with the support away (and whether he died in one). */
export function adcAdvances(c: Ctx, spec: ObjectiveRulesSpec = OBJECTIVE_RULES_SPEC): DuoAdvance[] {
  const D = spec.duo
  const adc = c.pidOf(c.us, 'BOTTOM'), sup = c.pidOf(c.us, 'UTILITY')
  if (adc == null || sup == null) return []
  const end = (c.tr.frames.length - 1) * 60_000
  const runs: DuoAdvance[] = []
  let start: number | null = null
  const stepMs = D.advanceStepSec * 1000
  const isOut = (ms: number): boolean => {
    const p = active(c, adc, ms)
    if (!p || laneOf(p) !== 'BOT') return false
    const tower = standingTower(c, c.us, 'BOT', ms), opp = standingTower(c, c.them, 'BOT', ms)
    if (!tower || !opp || dist(p, opp) >= dist(p, tower)) return false
    const sp = active(c, sup, ms)
    return !sp || dist(sp, p) > D.absentDistance
  }
  for (let t = 120_000; t <= end; t += stepMs) {
    if (isOut(t)) { if (start == null) start = t } else if (start != null) { if (t - start >= D.advanceMinSec * 1000) runs.push({ fromSec: start / 1000, toSec: t / 1000, died: false }); start = null }
  }
  if (start != null && end - start >= D.advanceMinSec * 1000) runs.push({ fromSec: start / 1000, toSec: end / 1000, died: false })
  const merged: DuoAdvance[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && r.fromSec - last.toSec < D.advanceMergeSec) last.toSec = r.toSec
    else merged.push({ ...r })
  }
  for (const r of merged) r.died = c.tr.kills.some((k) => k.victimId === adc && k.timestamp / 1000 >= r.fromSec && k.timestamp / 1000 <= r.toSec + D.lookbackSec)
  return merged
}

// ── Entry point ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The whole block for one game, seen from `ourTeamId`. Null when the pair cannot be read (no frames, no participants). */
export function objectiveRules(match: any, timeline: any, ourTeamId: TeamId, track?: LedgerTrack | null, spec: ObjectiveRulesSpec = OBJECTIVE_RULES_SPEC): ObjectiveRulesBlock | null {
  const c = buildCtx(match, timeline, ourTeamId, track)
  if (!c) return null
  return {
    v: spec.version,
    roles: c.tr.parts.filter((p) => p.teamId === ourTeamId).map((p) => ({ pid: p.participantId as number, role: c.tr.positionOf(p) })),
    objectives: objectiveEntries(c, spec),
    duo: { deaths: duoDeaths(c, match, timeline, spec), advances: adcAdvances(c, spec) },
  }
}

export const hasCurrentObjectiveRules = (b: unknown): b is ObjectiveRulesBlock =>
  !!b && typeof b === 'object' && (b as ObjectiveRulesBlock).v === OBJECTIVE_RULES_SPEC.version && Array.isArray((b as ObjectiveRulesBlock).objectives)
