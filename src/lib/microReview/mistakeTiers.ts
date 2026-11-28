/**
 * Tiers of the Mistake Lab: fatal, critical, medium, trivial (docs/moteur/engine-reports/2026-11-28-tiers-erreurs.md).
 *
 * The tier of an occurrence is MEASURED (what the mistake cost in gold to the team and to the lane), not fixed by the rule
 * that detects it like the 1-3 severity. The cost is counted event by event in the "wake" of the mistake (the bounty of a
 * death, the farm lost while dead, what the enemy takes meanwhile minus what we take back), and the minute curves are
 * read only for the snowball. Pure: a Match-V5 + Timeline-V5 pair and the player's mistakes in, a tier and its reason out.
 * No Riot request. Every threshold lives in TIER_SPEC (calibrated by scripts/calibrate-tiers.ts).
 */
import { dist, inBaseBox, type Point, type TeamId } from './geometry'
import { buildLedgerTrack, killChains, killGold, plateGold, type LedgerTrack } from './ledgerCore'
import { GARBAGE_HIGH, GARBAGE_LOW, OBJECTIVE_WEIGHT, objectiveKindOf, winProbAt, winProbabilityCurve } from './winProbability'
import { objectiveRules, type ObjectiveRulesBlock } from './objectiveRules'

export const TIER_VERSION = 1

export type MistakeTier = 'fatal' | 'critical' | 'medium' | 'trivial'
export type TierReasonKind =
  | 'team-gap' | 'team-snowball' | 'lane-gap' | 'lane-snowball' | 'deficit' | 'after-fatal' | 'precedes' | 'garbage'
export interface TierReason {
  kind: TierReasonKind
  /** The amount in gold (team or lane), or the gap lost over the snowball. */
  gold: number
  /** Length of the window the amount was counted over, in minutes (wake or snowball). */
  minutes?: number
  /** Snowball: the gap before and after. */
  fromGold?: number
  toGold?: number
  /** after-fatal: game second of the player's fatal mistake. */
  afterSec?: number
  /** precedes: game second of the mistake this one caused. */
  atSec?: number
  /** precedes: the tier taken from the effect. */
  chainTier?: 'fatal' | 'critical'
  /** What the immediate cost is made of (gold). */
  parts?: { bounty: number; farm: number; plates: number; towers: number; objectives: number; kills: number; retaliation: number }
}
export interface TierResult {
  tier: MistakeTier
  reason: TierReason | null
  /** late back / unused gold and the mistake they caused share a chain: counted once in the "fatales de la partie". */
  chainId?: string
  chainRole?: 'cause' | 'effect'
}
export interface TierMistake { key: string; tagSlug: string; tSec: number; autoDetected: boolean }

// ── Spec ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TIER_SPEC = {
  /** T_fatal(t) in gold, piecewise linear: 700 until 5:00, 1 600 at 25:00 (+45 g/min), 3 000 at 35:00 (+140 g/min), flat after. */
  fatal: { early: 700, earlyUntilSec: 300, mid: 1600, midAtSec: 1500, late: 3000, lateAtSec: 2100 },
  /** Critical threshold = this share of the fatal one. */
  criticalShare: 0.71,
  /** XP counts less than gold, and not before 5:00. */
  xpWeight: 0.4, xpFromSec: 300, xpDeficitWeight: 0.53,
  minionGold: 21,
  /** Window of the farm rate that a death costs. */
  farmLookbackSec: 180,
  wakeAfterRespawnSec: 30, momentWakeSec: 60,
  towerGold: 300, inhibitorGold: 200,
  /** Kills of other allies at 4v5 count when this close to the mistake. */
  nearRadius: 3000, fightGapSec: 20,
  /** An objective taken after two allies were already dead is not imputed. */
  alreadyDeadAllies: 2,
  snowball: { steps: 3, preSlopePerMin: -50, shareOfFatal: 0.5, eligibleBeforeSec: 60, eligibleAfterSec: 60 },
  /** cs-deficit / xp-deficit: critical from this lane gap in gold, never fatal. */
  deficitCritical: 500,
  /** late back → mistake that follows, within this window and with no trip to base in between. */
  chainWindowSec: 90,
  /** Garbage time is judged from `fromSec` only: early on the P(win) estimate swings with a single kill. */
  garbage: { low: GARBAGE_LOW, high: GARBAGE_HIGH, fromSec: 1200 },
} as const
type Widen<T> = T extends number ? number : T extends object ? { [K in keyof T]: Widen<T[K]> } : T
export type TierSpec = Widen<typeof TIER_SPEC>

/** T_fatal at `sec`. */
export function fatalThreshold(sec: number, spec: TierSpec = TIER_SPEC): number {
  const F = spec.fatal
  if (sec <= F.earlyUntilSec) return F.early
  if (sec <= F.midAtSec) return F.early + ((F.mid - F.early) * (sec - F.earlyUntilSec)) / (F.midAtSec - F.earlyUntilSec)
  if (sec <= F.lateAtSec) return F.mid + ((F.late - F.mid) * (sec - F.midAtSec)) / (F.lateAtSec - F.midAtSec)
  return F.late
}
export const criticalThreshold = (sec: number, spec: TierSpec = TIER_SPEC): number => spec.criticalShare * fatalThreshold(sec, spec)

/** Gold equivalent of an objective on the winZ scale (≈ 37 × weight × minutes: Dragon at 10:00 ≈ 370, Baron at 25:00 ≈ 1 870). */
export const objectiveGoldEq = (weight: number, minutes: number): number => Math.round((0.28 * weight) / (0.0075 / Math.max(minutes, 5)))

// ── Context ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface Ctx {
  spec: TierSpec
  tr: LedgerTrack
  pid: number
  us: TeamId
  them: TeamId
  mine: number[]
  theirs: number[]
  teamGap: number[]
  laneGap: number[]
  curve: number[]
  rules: ObjectiveRulesBlock | null
  ourIds: number[]
  enemyIds: number[]
}

const minutesOf = (sec: number) => sec / 60

function buildCtx(match: any, timeline: any, pid: number, spec: TierSpec, trIn?: LedgerTrack | null): Ctx | null {
  const tr = trIn ?? buildLedgerTrack(match, timeline)
  if (!tr) return null
  const me = tr.parts.find((p) => p.participantId === pid)
  if (!me || (me.teamId !== 100 && me.teamId !== 200)) return null
  const us = me.teamId as TeamId
  const them: TeamId = us === 100 ? 200 : 100
  const role = tr.positionOf(me)
  const ids = (team: number, roles: string[]) => tr.parts.filter((p) => p.teamId === team && roles.includes(tr.positionOf(p))).map((p) => p.participantId as number)
  const group = role === 'BOTTOM' || role === 'UTILITY' ? ['BOTTOM', 'UTILITY'] : [role]
  const mine = ids(us, group)
  const theirs = ids(them, group)
  const ourIds = tr.parts.filter((p) => p.teamId === us).map((p) => p.participantId as number)
  const enemyIds = tr.parts.filter((p) => p.teamId === them).map((p) => p.participantId as number)
  // Value of a frame for a player: gold, plus XP at a lower weight from 5:00 (decision 1).
  const value = (i: number, id: number) => tr.goldOf(i, id) + (i * 60 >= spec.xpFromSec ? spec.xpWeight * tr.xpOf(i, id) : 0)
  const sum = (i: number, list: number[]) => list.reduce((s, id) => s + value(i, id), 0)
  const n = tr.frames.length
  const teamGap = Array.from({ length: n }, (_, i) => sum(i, ourIds) - sum(i, enemyIds))
  const laneGap = Array.from({ length: n }, (_, i) => sum(i, mine) - sum(i, theirs))
  let rules: ObjectiveRulesBlock | null = null
  try { rules = objectiveRules(match, timeline, us, tr) } catch { rules = null }
  return { spec, tr, pid, us, them, mine, theirs, teamGap, laneGap, curve: winProbabilityCurve(tr.frames, (id) => tr.teamOf(id), us), rules, ourIds, enemyIds }
}

/** Per-minute CS (lane + jungle) of a group over the lookback before `ms`. */
function csRate(c: Ctx, ids: number[], ms: number): number {
  const i1 = Math.max(0, Math.min(c.tr.frames.length - 1, Math.floor(ms / 60000)))
  const i0 = Math.max(0, i1 - Math.round(c.spec.farmLookbackSec / 60))
  if (i1 <= i0) return 0
  return ids.reduce((s, id) => s + (c.tr.csOf(i1, id) - c.tr.csOf(i0, id)), 0) / (i1 - i0)
}
function xpRate(c: Ctx, ids: number[], ms: number): number {
  const i1 = Math.max(0, Math.min(c.tr.frames.length - 1, Math.floor(ms / 60000)))
  const i0 = Math.max(0, i1 - Math.round(c.spec.farmLookbackSec / 60))
  if (i1 <= i0) return 0
  return ids.reduce((s, id) => s + (c.tr.xpOf(i1, id) - c.tr.xpOf(i0, id)), 0) / (i1 - i0)
}

const teamOfEv = (c: Ctx, e: any): number | undefined => (typeof e.killerId === 'number' && e.killerId > 0 ? c.tr.teamOf(e.killerId) : undefined)

/** Cost of an objective taken by the enemy: its value, capped by the real fall of the team curve, net of our cross-map. */
function objectiveCost(c: Ctx, e: any): number {
  const kind = objectiveKindOf(e)
  if (!kind || kind === 'tower' || kind === 'inhibitor') return 0
  const sec = e.timestamp / 1000
  const eq = objectiveGoldEq(OBJECTIVE_WEIGHT[kind], minutesOf(sec))
  let offset = 0
  const entry = c.rules?.objectives.find((o) => !o.ours && o.kind === kind && Math.abs(o.atSec - sec) <= (kind === 'grubs' ? 90 : 5))
  if (entry?.crossmap) {
    const r = entry.crossmap.resources
    offset = r.plates * plateGold(minutesOf(sec)) + r.towers * c.spec.towerGold + r.kills * 300 + (r.objective ? eq / 2 : 0)
  }
  const i0 = Math.max(0, Math.min(c.teamGap.length - 1, Math.floor(sec / 60)))
  const i3 = Math.min(c.teamGap.length - 1, i0 + c.spec.snowball.steps)
  const drop = Math.max(0, c.teamGap[i0] - c.teamGap[i3])
  return Math.max(0, Math.min(eq - offset, drop))
}

interface Cost { team: number; lane: number; parts: NonNullable<TierReason['parts']>; minutes: number }

/**
 * Immediate cost in the wake of a mistake at `tMs`. A death (`ev`) is counted from the kill to the respawn + 30 s, a
 * moment without a death 60 s from it. What comes from elsewhere is not imputed: a fight's net is shared between our
 * deaths of the fight (the first takes the 4v5), an independent death of an ally is out, an objective taken once two
 * allies were already dead is out.
 */
function wakeCost(c: Ctx, tMs: number, death: any | null): Cost {
  const S = c.spec
  const life = death ? c.tr.lives.get(c.pid)?.find((d) => Math.abs(d.ts - tMs) <= 1500) : undefined
  const endMs = death ? (life ? life.respawn : tMs + 30_000) + S.wakeAfterRespawnSec * 1000 : tMs + S.momentWakeSec * 1000
  const here: Point | null = death?.position ?? c.tr.posAt(c.pid, tMs)
  const near = (p: Point | undefined | null) => !!p && !!here && dist(p, here) <= S.nearRadius
  const parts = { bounty: 0, farm: 0, plates: 0, towers: 0, objectives: 0, kills: 0, retaliation: 0 }
  const durMin = death && life ? (life.respawn - life.ts) / 60000 : 0

  // The fight this death belongs to (kills less than 20 s apart, around the same place).
  let fightIds = new Set<any>()
  let fightNet = 0
  let first = true
  let laterBounty = 0
  if (death) {
    const chain = killChains(c.tr.kills, S.fightGapSec * 1000).find((ch) => ch.includes(death))
    if (chain) {
      const around = chain.filter((k) => !k.position || near(k.position))
      fightIds = new Set(around)
      const ourDeaths = around.filter((k) => c.tr.teamOf(k.victimId) === c.us)
      const theirDeaths = around.filter((k) => c.tr.teamOf(k.victimId) === c.them)
      fightNet = ourDeaths.reduce((s, k) => s + killGold(k), 0) - theirDeaths.reduce((s, k) => s + killGold(k), 0)
      first = ourDeaths[0] === death
      laterBounty = ourDeaths.filter((k) => k !== death).reduce((s, k) => s + killGold(k), 0)
    }
  }
  if (death) {
    parts.bounty = killGold(death)
    parts.farm = csRate(c, [c.pid], tMs) * durMin * S.minionGold
    if (fightIds.size > 1) {
      // The fight's NET loss is shared between our deaths of the fight: a won fight costs no bounty; in a lost one the first
      // death takes the 4v5 (the net minus what the later deaths cost), the later ones only their bounty.
      parts.bounty = fightNet <= 0 ? 0 : first ? Math.max(0, fightNet - laterBounty) : Math.min(parts.bounty, fightNet)
    }
  }

  const deadAlliesBefore = c.ourIds.filter((id) => id !== c.pid && c.tr.deadAt(id, tMs - 1)).length
  let ourBack = 0
  for (const e of c.tr.events) {
    if (e.timestamp <= tMs || e.timestamp > endMs) continue
    if (e.type === 'TURRET_PLATE_DESTROYED') {
      const by = teamOfEv(c, e) ?? (e.teamId === c.us ? c.them : c.us)
      if (by === c.them) parts.plates += plateGold(minutesOf(e.timestamp / 1000)); else ourBack += plateGold(minutesOf(e.timestamp / 1000))
    } else if (e.type === 'BUILDING_KILL') {
      const gold = e.buildingType === 'INHIBITOR_BUILDING' ? S.inhibitorGold : e.buildingType === 'TOWER_BUILDING' ? S.towerGold : 0
      if (!gold) continue
      if (e.teamId === c.us) parts.towers += gold; else ourBack += gold
    } else if (e.type === 'ELITE_MONSTER_KILL') {
      const by = e.killerTeamId ?? teamOfEv(c, e)
      if (by === c.them) { if (deadAlliesBefore < S.alreadyDeadAllies) parts.objectives += objectiveCost(c, e) }
      else if (by === c.us) ourBack += objectiveGoldEq(OBJECTIVE_WEIGHT[objectiveKindOf(e) ?? 'dragon'], minutesOf(e.timestamp / 1000)) / 2
    } else if (e.type === 'CHAMPION_KILL' && !fightIds.has(e)) {
      if (!near(e.position)) continue
      const victimTeam = c.tr.teamOf(e.victimId)
      if (victimTeam === c.us && e.victimId !== c.pid) parts.kills += killGold(e)
      else if (victimTeam === c.them) ourBack += killGold(e)
    }
  }
  parts.retaliation = Math.min(ourBack, parts.plates + parts.towers + parts.objectives + parts.kills)
  const team = Math.max(0, parts.bounty + parts.farm + parts.plates + parts.towers + parts.objectives + parts.kills - parts.retaliation)

  // Lane: the gap the lane opponent gains meanwhile (bounty, farm and XP of the dead, plates of the lane).
  let lane = 0
  if (death) {
    lane = parts.bounty + parts.farm
    lane += csRate(c, c.theirs, tMs) * durMin * S.minionGold
    if (tMs >= S.xpFromSec * 1000) lane += S.xpWeight * xpRate(c, c.theirs, tMs) * durMin
  }
  for (const e of c.tr.events) {
    if (e.type !== 'TURRET_PLATE_DESTROYED' || e.timestamp <= tMs || e.timestamp > endMs) continue
    if (c.theirs.includes(e.killerId)) lane += plateGold(minutesOf(e.timestamp / 1000))
  }
  return { team, lane, parts, minutes: (endMs - tMs) / 60000 }
}

// ── Falls of the curves (snowball) ──────────────────────────────────────────────────────────────────────────────

interface Fall { startSec: number; loss: number; from: number; to: number }

function falls(curve: number[], threshold: (sec: number) => number, spec: TierSpec): Fall[] {
  const S = spec.snowball
  const out: Fall[] = []
  for (let i = 0; i + S.steps < curve.length; i++) {
    let dropping = true
    for (let k = 0; k < S.steps; k++) if (!(curve[i + k + 1] < curve[i + k])) { dropping = false; break }
    if (!dropping) continue
    const pre = i >= 2 ? (curve[i] - curve[i - 2]) / 2 : 0
    if (pre < S.preSlopePerMin) continue // already falling: the fall is not new
    const loss = curve[i] - curve[i + S.steps]
    if (loss >= S.shareOfFatal * threshold(i * 60)) {
      out.push({ startSec: i * 60, loss, from: curve[i], to: curve[i + S.steps] })
      i += S.steps - 1 // one fall at a time
    }
  }
  return out
}

// ── Tiers ────────────────────────────────────────────────────────────────────────────────────────────────────────

const DEFICIT = new Set(['cs-deficit', 'xp-deficit'])
const rounded = (n: number) => Math.round(n)

interface Raw { m: TierMistake; death: any | null; team: number; lane: number; parts: Cost['parts']; minutes: number; tier: MistakeTier; reason: TierReason | null }

function tierFromCost(c: Ctx, sec: number, team: number, lane: number, minutes: number, parts: Cost['parts']): { tier: MistakeTier; reason: TierReason | null } {
  const tf = fatalThreshold(sec, c.spec), tc = criticalThreshold(sec, c.spec)
  const mins = Math.max(1, Math.round(minutes))
  if (team >= tf) return { tier: 'fatal', reason: { kind: 'team-gap', gold: rounded(team), minutes: mins, parts } }
  if (lane >= tc) return { tier: 'critical', reason: { kind: 'lane-gap', gold: rounded(lane), minutes: mins, parts } }
  return { tier: 'medium', reason: null }
}

/**
 * Tiers of one player's mistakes in one game. `pid` = the player's participant id. Null when the pair cannot be read
 * (the caller shows "unknown tier"). Garbage time makes an error trivial; a medium error after the player's OWN fatal
 * one is trivial until the end of the game.
 */
export function computeTiers(match: any, timeline: any, pid: number, mistakes: TierMistake[], spec: TierSpec = TIER_SPEC, track?: LedgerTrack | null): Map<string, TierResult> | null {
  const c = buildCtx(match, timeline, pid, spec, track)
  if (!c) return null
  const out = new Map<string, TierResult>()
  const dated = [...mistakes].sort((a, b) => a.tSec - b.tSec)
  const deaths = c.tr.kills.filter((k) => k.victimId === pid)
  const deathNear = (sec: number) => deaths.find((k) => Math.abs(k.timestamp / 1000 - sec) <= 3) ?? null

  const rawOf = new Map<string, Raw>()
  const evaluate = (m: TierMistake): Raw => {
    const cached = rawOf.get(m.key)
    if (cached) return cached
    const death = deathNear(m.tSec)
    const tMs = death ? death.timestamp : m.tSec * 1000
    let r: Raw
    if (!m.autoDetected && m.tSec <= 0) {
      r = { m, death: null, team: 0, lane: 0, parts: { bounty: 0, farm: 0, plates: 0, towers: 0, objectives: 0, kills: 0, retaliation: 0 }, minutes: 0, tier: 'medium', reason: null }
    } else if (DEFICIT.has(m.tagSlug)) {
      const i = Math.max(0, Math.min(c.laneGap.length - 1, Math.floor(m.tSec / 60)))
      const csDiff = c.mine.reduce((s, id) => s + c.tr.csOf(i, id), 0) - c.theirs.reduce((s, id) => s + c.tr.csOf(i, id), 0)
      const xpDiff = c.mine.reduce((s, id) => s + c.tr.xpOf(i, id), 0) - c.theirs.reduce((s, id) => s + c.tr.xpOf(i, id), 0)
      const behind = -(csDiff * c.spec.minionGold + (i * 60 >= c.spec.xpFromSec ? xpDiff * c.spec.xpDeficitWeight : 0))
      r = { m, death: null, team: 0, lane: behind, parts: { bounty: 0, farm: 0, plates: 0, towers: 0, objectives: 0, kills: 0, retaliation: 0 }, minutes: 0,
        tier: behind >= c.spec.deficitCritical ? 'critical' : 'medium',
        reason: behind >= c.spec.deficitCritical ? { kind: 'deficit', gold: rounded(behind), minutes: Math.max(1, Math.round(m.tSec / 60)) } : null }
    } else {
      const w = wakeCost(c, tMs, death)
      const t = tierFromCost(c, m.tSec, w.team, w.lane, w.minutes, w.parts)
      r = { m, death, team: w.team, lane: w.lane, parts: w.parts, minutes: w.minutes, tier: t.tier, reason: t.reason }
    }
    rawOf.set(m.key, r)
    return r
  }

  // 1. Immediate cost of every mistake.
  const economy = (m: TierMistake) => m.tagSlug === 'late-back' || m.tagSlug === 'unused-gold'
  for (const m of dated) if (!economy(m)) evaluate(m)

  // 2. Snowball: to the FIRST mistake of the player around the start of each fall of the curve.
  const teamFalls = falls(c.teamGap, (s) => fatalThreshold(s, c.spec), c.spec)
  const laneFalls = falls(c.laneGap, (s) => criticalThreshold(s, c.spec), c.spec)
  const E = c.spec.snowball
  const eligible = (f: Fall) => dated.filter((m) => !economy(m) && !DEFICIT.has(m.tagSlug) && (m.autoDetected || m.tSec > 0) && m.tSec >= f.startSec - E.eligibleBeforeSec && m.tSec < f.startSec + E.eligibleAfterSec)[0]
  for (const f of teamFalls) {
    const m = eligible(f)
    if (!m) continue
    const r = rawOf.get(m.key)!
    if (r.tier !== 'fatal') { r.tier = 'fatal'; r.reason = { kind: 'team-snowball', gold: rounded(f.loss), minutes: E.steps, fromGold: rounded(f.from), toGold: rounded(f.to) } }
  }
  for (const f of laneFalls) {
    const m = eligible(f)
    if (!m) continue
    const r = rawOf.get(m.key)!
    if (r.tier === 'medium') { r.tier = 'critical'; r.reason = { kind: 'lane-snowball', gold: rounded(f.loss), minutes: E.steps, fromGold: rounded(f.from), toGold: rounded(f.to) } }
  }

  // 3. Late back / unused gold take the tier of what they caused.
  const baseVisit = (fromMs: number, toMs: number): boolean => {
    if (c.tr.shopsOf(pid).some((s) => s > fromMs && s < toMs)) return true
    for (let t = fromMs; t < toMs; t += 5000) { const p = c.tr.posAt(pid, t); const team = c.us; if (p && inBaseBox(p, team)) return true }
    return false
  }
  const timeline_ = dated.filter((m) => !economy(m))
  for (const m of dated) {
    if (!economy(m)) continue
    if (m.tagSlug === 'unused-gold') {
      const death = deathNear(m.tSec)
      const effect = death ? timeline_.find((x) => Math.abs(x.tSec - m.tSec) <= 3) : null
      let tier: MistakeTier = 'medium', reason: TierReason | null = null, chain: string | undefined
      if (effect) {
        const r = rawOf.get(effect.key)!
        if (r.tier === 'fatal' || r.tier === 'critical') { tier = r.tier; reason = { kind: 'precedes', gold: r.reason?.gold ?? 0, atSec: effect.tSec, chainTier: r.tier }; chain = `chain:${effect.key}` }
      } else if (death) {
        const w = wakeCost(c, death.timestamp, death)
        const t = tierFromCost(c, m.tSec, w.team, w.lane, w.minutes, w.parts)
        if (t.tier === 'fatal' || t.tier === 'critical') { tier = t.tier; reason = t.reason; chain = `chain:death:${rounded(death.timestamp / 1000)}` }
      }
      out.set(m.key, { tier, reason, ...(chain ? { chainId: chain, chainRole: 'cause' as const } : {}) })
    } else {
      // late-back: the first death or dated mistake in the next 90 s with no trip to base in between.
      const tMs = m.tSec * 1000
      const linkedDeath = deaths.find((k) => k.timestamp > tMs && k.timestamp <= tMs + c.spec.chainWindowSec * 1000)
      const linkedMistake = timeline_.find((x) => x.tSec > m.tSec && x.tSec <= m.tSec + c.spec.chainWindowSec)
      const cand = [linkedDeath ? { ms: linkedDeath.timestamp, death: linkedDeath, mk: null as TierMistake | null } : null, linkedMistake ? { ms: linkedMistake.tSec * 1000, death: null, mk: linkedMistake } : null]
        .filter((x): x is { ms: number; death: any; mk: TierMistake | null } => !!x).sort((a, b) => a.ms - b.ms)[0]
      let res: TierResult = { tier: 'medium', reason: null }
      if (cand && !baseVisit(tMs + 1000, cand.ms)) {
        const r = cand.mk ? rawOf.get(cand.mk.key)! : (() => { const w = wakeCost(c, cand.ms, cand.death); const t = tierFromCost(c, cand.ms / 1000, w.team, w.lane, w.minutes, w.parts); return { tier: t.tier, reason: t.reason } as { tier: MistakeTier; reason: TierReason | null } })()
        if (r.tier === 'fatal' || r.tier === 'critical') {
          const at = Math.round(cand.ms / 1000)
          res = { tier: r.tier, reason: { kind: 'precedes', gold: r.reason?.gold ?? 0, atSec: at, chainTier: r.tier }, chainId: cand.mk ? `chain:${cand.mk.key}` : `chain:death:${at}`, chainRole: 'cause' }
        }
      }
      out.set(m.key, res)
    }
  }
  // The effect shares the chain of its cause.
  for (const [key, r] of out) {
    if (r.chainRole !== 'cause' || !r.chainId) continue
    const effectKey = r.chainId.startsWith('chain:death:') ? null : r.chainId.slice('chain:'.length)
    const eff = effectKey ? rawOf.get(effectKey) : null
    if (eff && !out.has(effectKey!)) out.set(effectKey!, { tier: eff.tier, reason: eff.reason, chainId: r.chainId, chainRole: 'effect' })
    void key
  }
  for (const [k, r] of rawOf) if (!out.has(k)) out.set(k, { tier: r.tier, reason: r.reason })

  // 4. Garbage time: trivial, never fatal or critical.
  for (const m of dated) {
    const p = winProbAt(c.curve, m.tSec * 1000)
    const r = out.get(m.key)
    if (r && p != null && m.tSec >= c.spec.garbage.fromSec && (p < c.spec.garbage.low || p > c.spec.garbage.high) && (m.autoDetected || m.tSec > 0)) {
      out.set(m.key, { tier: 'trivial', reason: { kind: 'garbage', gold: 0 } })
    }
  }

  // 5. After the player's OWN fatal mistake, the medium ones are trivial until the end of the game.
  const firstFatal = dated.map((m) => ({ m, r: out.get(m.key)! })).filter((x) => x.r && x.r.tier === 'fatal').sort((a, b) => a.m.tSec - b.m.tSec)[0]
  if (firstFatal) {
    for (const m of dated) {
      const r = out.get(m.key)
      if (r && r.tier === 'medium' && m.tSec > firstFatal.m.tSec) out.set(m.key, { tier: 'trivial', reason: { kind: 'after-fatal', gold: 0, afterSec: firstFatal.m.tSec } })
    }
  }
  return out
}

/** Counts per tier; a chain counts once. `unknown` = the tier could not be computed (no timeline). */
export function countTiers(results: Array<TierResult | null | undefined>): Record<MistakeTier | 'unknown', number> {
  const n = { fatal: 0, critical: 0, medium: 0, trivial: 0, unknown: 0 }
  const seen = new Set<string>()
  for (const r of results) {
    if (!r) { n.unknown++; continue }
    if (r.chainId && (r.tier === 'fatal' || r.tier === 'critical')) {
      if (seen.has(r.chainId)) continue
      seen.add(r.chainId)
    }
    n[r.tier]++
  }
  return n
}
