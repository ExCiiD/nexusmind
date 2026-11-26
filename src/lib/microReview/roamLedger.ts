/**
 * Roam ledger (docs/PLAN_MOTEUR_BILANS.md phases 1-2, docs/engine-reports/2026-11-20-bilan-des-roams-mid.md and
 * ...-tous-laners.md): for each roam of a laner, what it cost (CS, XP, plates, a death), what it created (takedowns,
 * objectives, an ally lane ahead, a fight won), and what the lane opponent made of it afterwards, all in one Δz scale
 * (winProbability.winZ):
 *
 *   net = Δz(gains) − Δz(cost) − Δz(follow-up)
 *
 * One calculation, set per role (ROAM_ROLE_SPEC): who pays for the absence (the roamer, the bot duo, the ADC of a roaming
 * support), which lane is left, which allies a visited lane has. Pure, deterministic, on the 60 s snapshots and the events
 * of a timeline: the state of the wave, the spells and the pressure that forced a Flash are not in it, so the ledger leans
 * to "neutral" rather than blame (a wrong card costs more trust than a missed one).
 *
 * What the data proves: position every 5 s (interpolated), takedowns, plates, towers and monsters at the millisecond,
 * CS / XP / gold / HP / mana per minute, the purchases that date a back, the LEVEL_UP events. What it does not: freeze
 * (only "freezeLikely", a hint), the state of a wave (the "wave crash" timer is a position hint, conditional wording), the
 * Teleport cast (a "probable TP" is a walk too fast for the time elapsed), which camp was taken, a ward's position.
 */
import { OBJECTIVE_RADIUS, OUTER_TURRETS, dist, inBaseBox, laneOf, tempoLineD, zoneOf, type Point, type TeamId } from './geometry'
import { OBJECTIVE_WEIGHT, objectiveKindOf, type ObjectiveKind } from './winProbability'
import { patchOf, type PatchTier } from './gameClock'
import {
  buildLedgerTrack, deltaZ, excursionsOf, killChains, killGold, mergeExcursions, plateGold, round2,
  type Excursion, type LedgerTrack,
} from './ledgerCore'

export type RoamVerdict = 'profitable' | 'neutral' | 'losing'

/**
 * Thresholds of the roam ledger. DETECTOR_SPEC.roam is this object plus the flags. Calibrated on the cached 16.x games
 * (docs/engine-reports/2026-11-26-calibrage-roam-mid.md for the mid, ...-calibrage-roams-roles.md for the others).
 */
export const ROAM_THRESHOLDS = {
  /** The window of the ledger: from 2:00 to the fall of our T1 of the lane / 20:00 (Baron). */
  fromSec: 120,
  untilSec: 1200,
  /** Mid: out of the lane = farther than this from the mid diagonal (map units), not in a base, alive. */
  minOffAxis: 2600,
  minAwaySec: 20,
  /** Longer out of the lane than this is a rotation of the whole team (grouping, a siege), not a roam: not read. */
  maxAwaySec: 180,
  sampleSec: 5,
  /** Two roams closer than this form one. */
  mergeGapSec: 60,
  /** A takedown made away from the lane proves a roam: from killLeadSec before it to killTailSec after. */
  killLeadSec: 15,
  killTailSec: 15,
  /** After a respawn the walk back from the fountain is not a roam. */
  respawnGraceSec: 45,
  /** A purchase within this time after the roam ends (alive) makes it "roam + reset": the cost stops at the back. */
  resetGraceSec: 30,
  /** The cost is read up to the first snapshot this long after the return. */
  costAfterBackSec: 60,
  /** Gains count until this long after the return. */
  tailSec: 30,
  /** What the opponent makes of the roam: this long after the return. */
  followUpSec: 180,
  /** Takedowns closer than this are one fight; a fight is this many takedowns. */
  sameFightSec: 10,
  fightMinKills: 3,
  /** A takedown or an objective counts for the roamer when they were within this of it. */
  objectiveRadius: OBJECTIVE_RADIUS,
  /** The opponent was out of lane too (a crossed roam) when out for this long during the roam. */
  crossOverlapSec: 20,
  /** A losing roam costs at least this many CS against the opponent. */
  minCsLost: 6,
  /** Δz scale of the mid: |net| below it is neutral. Set by the calibration of 26/11/2026. */
  netThreshold: 1.25,
  /** Same, for the other roles (calibrated per role: docs/engine-reports/2026-11-26-calibrage-roams-roles.md). */
  netThresholdTop: 1.5,
  netThresholdAdc: 1.25,
  netThresholdSupport: 1.25,
  /** Average gold of a lane minion, for the cost of lost CS. Measured on the cache. */
  minionGold: 20,
  /** Share of the gap that keeps widening after the return (b to b + 2 min) counted as the opponent's gain. */
  driftShare: 1,
  /** Freeze hint: in the minute after the return, under this share of the opponent's CS (opponent 4+), still on our side. */
  freezeShare: 0.5,
  freezeMinOppCs: 4,
  freezeTempoMax: 0.5,
  /** Cards per game, the costliest roams. */
  maxCards: 2,
  /** Duo roles: a roam is not one while the partner stays within this of the roamer for this share of it. */
  partnerRadius: 2500,
  partnerShare: 0.5,
  /** Support timers (docs/engine-reports/2026-11-20-bilan-des-roams-tous-laners.md § 3.2). */
  killTimerSec: 30,
  recallTimerSec: 40,
  crashRadius: 1500,
  crashLookbackSec: 15,
  badTimerHpPct: 50,
  /** An ADC under this HP share at the snapshot before the roam, and shopping during it, was forced back. */
  forcedBackHpPct: 35,
  /** Support tax (wiki Role Quests, read 20/11/2026): −25 % up to level 3 in 16.1-16.15, −33 % up to level 5 from 16.16. */
  taxLevelBefore1616: 3,
  taxLevelFrom1616: 5,
  /** A support's roam without a takedown, with wards laid and an ADC who lost less than this many CS, is neutral at worst. */
  wardsNeutralCs: 12,
  /** Top: a walk faster than this (units per second, over the elapsed time) to a takedown is a probable Teleport. */
  tpWalkSpeed: 345,
} as const
export type RoamThresholds = Record<keyof typeof ROAM_THRESHOLDS, number>

type Lane = 'TOP' | 'MID' | 'BOT'
interface RoamRoleSpec {
  /** Role of the lane opponent whose numbers the cost is measured against. */
  opponent: string
  /** The lane the roamer holds (its plates and T1 are what an absence costs). */
  home: Lane
  /** Who pays: the roamer, the bot duo (an ADC who leaves), the ADC (a support who leaves). */
  payer: 'self' | 'duo' | 'adc'
  /** The duo partner whose presence cancels a roam. */
  partner?: string
  /** Out of the lane, for this role. */
  isOffLane: (p: Point, T: RoamThresholds) => boolean
  /** Roles of the allies (and of the matching enemies) in each lane a roam can visit. */
  laneAllies: Partial<Record<Lane, readonly string[]>>
  /** Which threshold of RoamThresholds sets this role's verdict. */
  netKey: 'netThreshold' | 'netThresholdTop' | 'netThresholdAdc' | 'netThresholdSupport'
}

/** Per role, who the roamer is measured against and what counts as leaving the lane. */
export const ROAM_ROLE_SPEC: Record<string, RoamRoleSpec> = {
  MIDDLE: {
    opponent: 'MIDDLE', home: 'MID', payer: 'self', netKey: 'netThreshold',
    isOffLane: (p, T) => Math.abs(p.x - p.y) > T.minOffAxis,
    laneAllies: { TOP: ['TOP'], BOT: ['BOTTOM', 'UTILITY'] },
  },
  TOP: {
    opponent: 'TOP', home: 'TOP', payer: 'self', netKey: 'netThresholdTop',
    isOffLane: (p) => laneOf(p) !== 'TOP',
    laneAllies: { MID: ['MIDDLE'], BOT: ['BOTTOM', 'UTILITY'] },
  },
  BOTTOM: {
    opponent: 'BOTTOM', home: 'BOT', payer: 'duo', partner: 'UTILITY', netKey: 'netThresholdAdc',
    isOffLane: (p) => laneOf(p) !== 'BOT',
    laneAllies: { TOP: ['TOP'], MID: ['MIDDLE'] },
  },
  UTILITY: {
    opponent: 'UTILITY', home: 'BOT', payer: 'adc', partner: 'BOTTOM', netKey: 'netThresholdSupport',
    isOffLane: (p) => laneOf(p) !== 'BOT',
    laneAllies: { TOP: ['TOP'], MID: ['MIDDLE'] },
  },
}

/** The timer a support left on (explains the verdict, never changes the number). */
export type SupportTimer = 'after-kills' | 'after-recall' | 'adc-away' | 'enemy-duo-recall' | 'wave-crash-probable' | 'paid-window' | 'bad' | 'none'
const GOOD_TIMERS: readonly SupportTimer[] = ['after-kills', 'after-recall', 'adc-away', 'enemy-duo-recall', 'wave-crash-probable']

export interface RoamEntry {
  fromSec: number
  backSec: number
  /** The farthest point of the roam, and the side lane it went to. */
  at: { x: number; y: number } | null
  side: 'top' | 'bot'
  /** Seen only through a takedown made away from the lane (too short for the position samples). */
  shortProof: boolean
  /** The roam ended in a back: the cost stops at the first purchase. */
  reset: boolean
  /** The opponent left their lane too. */
  crossed: boolean
  died: boolean
  /** The CS / XP gap could not be read (the roam ends with the game, or a snapshot is missing): no cost measured. */
  costMeasured: boolean
  cost: { cs: number; xp: number; plates: number; towerLost: boolean; deathGold: number; z: number }
  gain: { kills: number; assists: number; killGold: number; objectives: ObjectiveKind[]; platesTaken: number; laneGold: number; laneXp: number; fightGold: number; z: number }
  followUp: { kills: number; killGold: number; objectives: ObjectiveKind[]; plates: number; towerLost: boolean; extraCs: number; extraXp: number; z: number }
  freezeLikely: boolean
  /** Δz of the whole ledger (positive = the roam paid). */
  net: number
  verdict: RoamVerdict
  // ── Phase 2 (all roles). Absent from entries stored with ANALYSIS_VERSION 15 of the mid. ──
  role?: string
  /** What the payer lost in gold against their rivals over the cost window (information: the verdict counts CS, XP and plates). */
  goldLost?: number
  /** Bot duo roles: the partner left alone (the ADC of a roaming support, the support of a roaming ADC). */
  partner?: { hpBefore: number | null; hpAfter: number | null; manaBefore: number | null; manaAfter: number | null; forcedBack: boolean; died: boolean; cs: number } | null
  /** Support: the timer the roam left on, and whether it counts as a good one. */
  timer?: SupportTimer
  goodTimer?: boolean
  /** Support: left before the level of the tax (−33 % of gold and XP of minions taken outside the bot lane from 16.16, −25 % before). */
  taxed?: boolean
  /** Top: a walk too fast for the time elapsed, with Teleport among the spells: probably a Teleport (text only). */
  tpLikely?: boolean
  /** Support: wards laid during the roam (no position in the timeline: only counted). */
  wards?: number
}

export interface RoamLedger {
  role: string
  /** The patch step the ledger was read with (the support tax and the role-quest budget change at 16.9 and 16.16). */
  tier: PatchTier
  entries: RoamEntry[]
}

const hpPct = (s: any): number | null => (s?.championStats && Number(s.championStats.healthMax) > 0 ? Math.round((Number(s.championStats.health) / Number(s.championStats.healthMax)) * 100) : null)
const manaPct = (s: any): number | null => (s?.championStats && Number(s.championStats.powerMax) > 200 ? Math.round((Number(s.championStats.power) / Number(s.championStats.powerMax)) * 100) : null)

export function roamLedger(match: any, timeline: any, pid: number, spec: RoamThresholds = ROAM_THRESHOLDS as RoamThresholds, trackIn?: LedgerTrack | null): RoamLedger | null {
  const T = spec
  const track = trackIn ?? buildLedgerTrack(match, timeline)
  if (!track) return null
  const { clock, kills, events, teamOf, posAt, deadAt, csOf, xpOf, goldOf, involves, pframe } = track
  const me = track.parts.find((p) => p.participantId === pid)
  if (!me) return null
  const role = track.positionOf(me)
  const roleSpec = ROAM_ROLE_SPEC[role]
  if (!roleSpec) return null
  const team: number = me.teamId
  const teamTag = (team === 200 ? 200 : 100) as TeamId
  const enemyTag = (team === 200 ? 100 : 200) as TeamId
  const idOf = (teamId: number, r: string): number | undefined => track.parts.find((p) => p.teamId === teamId && track.positionOf(p) === r)?.participantId
  const oppId = idOf(team === 100 ? 200 : 100, roleSpec.opponent)
  if (oppId == null) return null
  const partnerId = roleSpec.partner ? idOf(team, roleSpec.partner) : undefined
  // Who pays and who they are measured against: CS / gold sides, and the XP sides (the duo's, for a roaming support).
  const adcId = idOf(team, 'BOTTOM'), supId = idOf(team, 'UTILITY')
  const eAdcId = idOf(team === 100 ? 200 : 100, 'BOTTOM'), eSupId = idOf(team === 100 ? 200 : 100, 'UTILITY')
  const list = (...ids: Array<number | undefined>) => ids.filter((x): x is number => x != null)
  const csMine = roleSpec.payer === 'self' ? [pid] : roleSpec.payer === 'duo' ? list(adcId, supId) : list(adcId)
  const csTheirs = roleSpec.payer === 'self' ? [oppId] : roleSpec.payer === 'duo' ? list(eAdcId, eSupId) : list(eAdcId)
  const xpMine = roleSpec.payer === 'self' ? [pid] : list(adcId, supId)
  const xpTheirs = roleSpec.payer === 'self' ? [oppId] : list(eAdcId, eSupId)
  if (csMine.length === 0 || csTheirs.length === 0) return null
  const rivals = roleSpec.payer === 'self' ? [oppId] : list(eAdcId, eSupId)

  const laneName = `${roleSpec.home}_LANE`
  // The window ends when our T1 of the lane falls: the lane is then no longer one to hold.
  const t1Fall = events.find((e) => e.type === 'BUILDING_KILL' && e.buildingType === 'TOWER_BUILDING' && e.towerType === 'OUTER_TURRET' && e.laneType === laneName && e.teamId === team)?.timestamp
  const untilMs = Math.min(T.untilSec * 1000, clock.endMs, t1Fall ?? Infinity)
  const stepMs = T.sampleSec * 1000

  // ── Out of the lane: alive, outside a base, away from the lane, and not walking back from a respawn ──
  const outAt = (id: number, ms: number): boolean => {
    const p = posAt(id, ms)
    if (!p) return false
    const z = zoneOf(p, 100)
    if (z === 'own-base' || z === 'enemy-base') return false
    if (!roleSpec.isOffLane(p, T)) return false
    if (!deadAt(id, ms) && track.lives.get(id)?.some((d) => ms >= d.respawn && ms < d.respawn + T.respawnGraceSec * 1000)) return false
    return true
  }
  const sampled = excursionsOf((ms) => outAt(pid, ms), T.fromSec * 1000, untilMs, stepMs, T.minAwaySec * 1000, T.mergeGapSec * 1000)
  const proofs: Excursion[] = kills
    .filter((e) => involves(e, pid) && e.position && e.timestamp >= T.fromSec * 1000 && e.timestamp <= untilMs && roleSpec.isOffLane(e.position, T))
    .map((e) => ({ fromMs: e.timestamp - T.killLeadSec * 1000, toMs: e.timestamp + T.killTailSec * 1000, sampled: false, killProof: true }))
  /** The duo travelling together is a rotation of the duo, not a roam of one of them. */
  const withPartner = (r: Excursion): boolean => {
    if (partnerId == null) return false
    let n = 0, near = 0
    for (let t = r.fromMs; t <= r.toMs; t += stepMs) {
      const a = posAt(pid, t), b = posAt(partnerId, t)
      n++
      if (a && b && !deadAt(partnerId, t) && dist(a, b) <= T.partnerRadius) near++
    }
    return n > 0 && near / n >= T.partnerShare
  }
  const roams = mergeExcursions([...sampled, ...proofs], T.mergeGapSec * 1000).filter((r) => r.toMs - r.fromMs <= T.maxAwaySec * 1000 && !withPartner(r))

  const chains = killChains(kills, T.sameFightSec * 1000)
  const fightOf = new Map<any, any[]>()
  for (const c of chains) if (c.length >= T.fightMinKills && c.some((e) => involves(e, pid) || e.victimId === pid)) for (const e of c) fightOf.set(e, c)

  const sum = (ids: number[], f: (i: number, id: number) => number, i: number) => ids.reduce((s, id) => s + f(i, id), 0)
  const gapAt = (i: number) => ({
    cs: sum(csMine, csOf, i) - sum(csTheirs, csOf, i),
    gold: sum(csMine, goldOf, i) - sum(csTheirs, goldOf, i),
    xp: sum(xpMine, xpOf, i) - sum(xpTheirs, xpOf, i),
  })
  const sideOf = (p: Point): 'top' | 'bot' => (p.y > p.x ? 'top' : 'bot')
  const ours = (e: any): boolean => (e.type === 'ELITE_MONSTER_KILL' ? (e.killerTeamId ?? teamOf(e.killerId)) === team : e.teamId !== team)
  const near = (id: number, e: any): boolean => {
    const p = e.position as Point | undefined
    const q = p && !deadAt(id, e.timestamp) ? posAt(id, e.timestamp) : null
    return !!p && !!q && dist(p, q) <= T.objectiveRadius
  }
  const rivalInvolved = (e: any): boolean => rivals.some((r) => involves(e, r))
  const rivalNear = (e: any): boolean => rivals.some((r) => near(r, e))
  const homePlate = (e: any): boolean => e.type === 'TURRET_PLATE_DESTROYED' && e.teamId === team && e.laneType === laneName
  const homeOuterLost = (e: any): boolean => e.type === 'BUILDING_KILL' && e.buildingType === 'TOWER_BUILDING' && e.towerType === 'OUTER_TURRET' && e.laneType === laneName && e.teamId === team
  const patch = patchOf(match)
  const taxLevel = patch.tier === '16.16' ? T.taxLevelFrom1616 : T.taxLevelBefore1616
  const levelUps = events.filter((e) => e.type === 'LEVEL_UP')
  const levelAtMs = (id: number, ms: number): number => 1 + levelUps.filter((e) => e.participantId === id && e.timestamp <= ms).length
  const hasTeleport = me.summoner1Id === 12 || me.summoner2Id === 12

  const entries: RoamEntry[] = []
  for (const r of roams) {
    const tOut = r.fromMs
    const tBack = Math.min(r.toMs, clock.endMs)
    const minutes = tOut / 60000
    const myDeath = (track.lives.get(pid) ?? []).some((d) => d.ts >= tOut && d.ts <= tBack)
    // A partner left alone and killed by 2+ enemies during the absence is part of the cost (never one against a lone enemy).
    const partnerDeaths = partnerId == null ? [] : kills.filter((e) => e.victimId === partnerId && e.timestamp >= tOut && e.timestamp <= tBack &&
      ((typeof e.killerId === 'number' && e.killerId > 0 ? 1 : 0) + (e.assistingParticipantIds ?? []).length) >= 2)
    const died = myDeath
    // Back: a purchase while alive shortly after the return dates a recall. A death makes the respawn purchase a forced one.
    const purchase = died ? undefined : track.shopsOf(pid).find((t) => t > tOut && t <= tBack + T.resetGraceSec * 1000)
    const a = clock.indexAt(tOut)
    const bFull = Math.min(clock.last, Math.ceil((tBack + T.costAfterBackSec * 1000) / 60000))
    const b = purchase != null ? clock.indexAt(purchase) : bFull
    const costMeasured = b > a
    const tsEnd = clock.ts(b)

    // ── Cost ──
    const gapA = gapAt(a)
    const gapB = gapAt(Math.max(a, b))
    const csLost = costMeasured ? Math.max(0, gapA.cs - gapB.cs) : 0
    const xpLost = costMeasured ? Math.max(0, Math.round(gapA.xp - gapB.xp)) : 0
    const goldLost = costMeasured ? Math.max(0, Math.round(gapA.gold - gapB.gold)) : 0
    const costPlates = events.filter((e) => homePlate(e) && e.timestamp >= tOut && e.timestamp <= Math.max(tsEnd, tBack)).length
    const costTower = events.some((e) => homeOuterLost(e) && e.timestamp >= tOut && e.timestamp <= Math.max(tsEnd, tBack))
    let deathGold = 0
    let fightGold = 0
    const gainEnd = tBack + T.tailSec * 1000
    let kN = 0, aN = 0, kGold = 0
    for (const e of kills) {
      if (e.timestamp < tOut || e.timestamp > gainEnd) continue
      const g = killGold(e)
      const ourKill = typeof e.killerId === 'number' && e.killerId > 0 && teamOf(e.killerId) === team
      const ourDeath = teamOf(e.victimId) === team
      const fight = fightOf.get(e)
      if (ourKill) {
        if (involves(e, pid)) { if (e.killerId === pid) kN++; else aN++; kGold += g } else if (fight) fightGold += g
      } else if (ourDeath) {
        if (e.victimId === pid) deathGold += g
        else if (partnerDeaths.includes(e)) deathGold += g
        else if (fight) fightGold -= g
      }
    }
    const costZ = deltaZ(
      csLost * T.minionGold + costPlates * plateGold(minutes) + deathGold, xpLost, costTower ? OBJECTIVE_WEIGHT.tower : 0, minutes)

    // ── Gain: only what the roamer was part of ──
    const gainObjectives: ObjectiveKind[] = []
    let objW = 0
    let platesTaken = 0
    for (const e of events) {
      if (e.timestamp < tOut || e.timestamp > gainEnd) continue
      const kind = objectiveKindOf(e)
      if (kind && ours(e) && (involves(e, pid) || near(pid, e))) { gainObjectives.push(kind); objW += OBJECTIVE_WEIGHT[kind] }
      else if (e.type === 'TURRET_PLATE_DESTROYED' && e.teamId !== team && (e.killerId === pid || near(pid, e))) platesTaken++
    }
    // The lane visited: the allies' gold and XP against their opponents', only when a takedown of the roamer happened there.
    const far = r.sampled ? farthestOf(tOut, tBack, stepMs, (ms) => posAt(pid, ms), roleSpec, T) : null
    const killPos = kills.find((e) => involves(e, pid) && e.position && e.timestamp >= tOut && e.timestamp <= gainEnd)?.position as Point | undefined
    const at = far ?? killPos ?? null
    const side = at ? sideOf(at) : 'bot'
    let laneGold = 0, laneXp = 0
    const laneKey = at ? laneOf(at) : null
    const laneRoles = laneKey && laneKey !== 'JUNGLE' && laneKey !== roleSpec.home ? roleSpec.laneAllies[laneKey] : undefined
    if (laneRoles && costMeasured) {
      const takedownInLane = kills.some((e) => involves(e, pid) && e.position && e.timestamp >= tOut && e.timestamp <= gainEnd && laneOf(e.position) === laneKey)
      if (takedownInLane) {
        const inLane = track.parts.filter((p) => laneRoles.includes(track.positionOf(p)))
        const mine = inLane.filter((p) => p.teamId === team).map((p) => p.participantId as number)
        const theirs = inLane.filter((p) => p.teamId !== team).map((p) => p.participantId as number)
        const lead = (i: number, f: (i: number, id: number) => number) => sum(mine, f, i) - sum(theirs, f, i)
        // The takedown gold of the roamer's own kills is already a gain: take out what those allies were paid for.
        const credited = kills.filter((e) => involves(e, pid) && mine.includes(e.killerId) && e.timestamp >= tOut && e.timestamp <= tsEnd).reduce((s, e) => s + killGold(e), 0)
        laneGold = Math.max(0, lead(b, goldOf) - lead(a, goldOf) - credited)
        laneXp = Math.max(0, lead(b, xpOf) - lead(a, xpOf))
      }
    }
    const gainZ = deltaZ(kGold + fightGold + platesTaken * plateGold(minutes) + laneGold, laneXp, objW, minutes)

    // ── Follow-up: what the lane opponents drew from the roamer's absence, themselves involved ──
    const fuEnd = tBack + T.followUpSec * 1000
    const oppKills = kills.filter((e) => e.timestamp >= tBack && e.timestamp <= fuEnd && rivalInvolved(e) && teamOf(e.victimId) === team &&
      !(e.position && laneOf(e.position) === (roleSpec.home === 'MID' ? 'MID' : roleSpec.home)))
    const fuObjectives: ObjectiveKind[] = []
    let fuObjW = 0
    let fuPlates = 0
    let fuTower = false
    for (const e of events) {
      if (e.timestamp < tBack || e.timestamp > fuEnd) continue
      // The plates and T1 of the roamer's own lane count whoever took them, once, either in the cost or here.
      if (homePlate(e) || homeOuterLost(e)) {
        if (e.timestamp > Math.max(tsEnd, tBack)) {
          if (homePlate(e)) fuPlates++
          else { fuTower = true; fuObjW += OBJECTIVE_WEIGHT.tower }
        }
        continue
      }
      const kind = objectiveKindOf(e)
      if (kind && !ours(e) && (rivalInvolved(e) || rivalNear(e))) { fuObjectives.push(kind); fuObjW += OBJECTIVE_WEIGHT[kind] }
    }
    const b2 = Math.min(clock.last, Math.max(a, b) + 2)
    const gapB2 = gapAt(b2)
    const extraCs = b2 > b ? Math.max(0, gapB.cs - gapB2.cs) : 0
    const extraXp = b2 > b ? Math.max(0, Math.round(gapB.xp - gapB2.xp)) : 0
    const fuKillGold = oppKills.reduce((s, e) => s + killGold(e), 0)
    const followZ = deltaZ(fuKillGold + fuPlates * plateGold(minutes) + extraCs * T.minionGold * T.driftShare, extraXp * T.driftShare, fuObjW, minutes)

    // ── Freeze hint: the minute after the return, the payer takes under half of the opponent's CS and stays on their lane ──
    const f1 = clock.indexAt(tBack)
    const f2 = Math.min(clock.last, f1 + 1)
    const mineCs = sum(csMine, csOf, f2) - sum(csMine, csOf, f1)
    const oppCs = sum(csTheirs, csOf, f2) - sum(csTheirs, csOf, f1)
    const after = posAt(pid, clock.ts(f2))
    const freezeLikely = f2 > f1 && oppCs >= T.freezeMinOppCs && mineCs < oppCs * T.freezeShare && !!after &&
      (roleSpec.home === 'MID' ? laneOf(after) === 'MID' && tempoLineD(after, teamTag) < T.freezeTempoMax : laneOf(after) === roleSpec.home)

    // The opponent out of their lane too: the CS cost cancels by itself, so the roam is "crossed".
    let oppOut = 0
    for (let t = tOut; t <= tBack; t += stepMs) if (outAt(oppId, t)) oppOut += stepMs
    const crossed = oppOut >= T.crossOverlapSec * 1000

    // ── Role extras: the partner left alone, the support's timer, a top's probable Teleport, the wards laid ──
    let partner: RoamEntry['partner'] = null
    if (partnerId != null && roleSpec.payer !== 'self') {
      const sA = pframe(a, partnerId), sB = pframe(Math.min(clock.last, Math.ceil(tBack / 60000)), partnerId)
      const hpA = hpPct(sA)
      partner = {
        hpBefore: hpA, hpAfter: hpPct(sB), manaBefore: manaPct(sA), manaAfter: manaPct(sB),
        forcedBack: hpA != null && hpA < T.forcedBackHpPct && track.shopsOf(partnerId).some((t) => t > tOut && t <= tBack && !deadAt(partnerId, t)),
        died: partnerDeaths.length > 0, cs: csOf(Math.min(clock.last, Math.ceil(tBack / 60000)), partnerId) - csOf(a, partnerId),
      }
    }
    const wards = events.filter((e) => e.type === 'WARD_PLACED' && e.creatorId === pid && e.wardType !== 'UNDEFINED' && e.timestamp >= tOut && e.timestamp <= tBack).length
    let timer: SupportTimer | undefined
    let taxed: boolean | undefined
    if (role === 'UTILITY') {
      const enemyBot = list(eAdcId, eSupId)
      const tPrev = (ms: number) => ms - 5000
      const inBase = (id: number, ms: number) => inBaseBox(posAt(id, ms), enemyTag)
      const afterKills = enemyBot.some((id) => kills.some((e) => e.victimId === id && e.timestamp >= tOut - T.killTimerSec * 1000 && e.timestamp <= tOut) && deadAt(id, tOut))
      const afterRecall = track.shopsOf(pid).some((t) => t >= tOut - T.recallTimerSec * 1000 && t <= tOut)
      const adcAway = adcId != null && (deadAt(adcId, tOut) || inBaseBox(posAt(adcId, tOut), teamTag))
      const enemyRecall = enemyBot.length === 2 && enemyBot.every((id) => deadAt(id, tOut) || inBase(id, tOut))
      const crash = adcId != null && [pid, adcId].every((id) => { const q = posAt(id, tPrev(tOut)); return q != null && dist(q, OUTER_TURRETS[enemyTag].BOT) <= T.crashRadius }) ||
        events.some((e) => e.type === 'TURRET_PLATE_DESTROYED' && e.laneType === 'BOT_LANE' && e.teamId !== team && e.timestamp >= tOut - T.crashLookbackSec * 1000 && e.timestamp <= tOut)
      const lvl = levelAtMs(pid, tOut)
      timer = afterKills ? 'after-kills' : afterRecall ? 'after-recall' : adcAway ? 'adc-away' : enemyRecall ? 'enemy-duo-recall' : crash ? 'wave-crash-probable'
        : lvl < taxLevel ? 'paid-window' : (partner?.hpBefore != null && partner.hpBefore < T.badTimerHpPct) ? 'bad' : 'none'
      taxed = lvl < taxLevel
    }
    let tpLikely: boolean | undefined
    if (role === 'TOP') {
      const k = hasTeleport ? kills.find((e) => involves(e, pid) && e.position && e.timestamp >= tOut && e.timestamp <= gainEnd) : undefined
      const snap = pframe(a, pid)?.position as Point | undefined
      tpLikely = !!k && !!snap && dist(k.position, snap) > T.tpWalkSpeed * Math.max(1, (k.timestamp - clock.ts(a)) / 1000)
    }

    const net = gainZ - costZ - followZ
    const thr = T[roleSpec.netKey]
    let verdict: RoamVerdict = net >= thr ? 'profitable' : net <= -thr && csLost >= T.minCsLost ? 'losing' : 'neutral'
    // A support who laid wards, took nothing and cost the ADC little is never blamed: wards have no position in the timeline.
    if (verdict === 'losing' && role === 'UTILITY' && wards > 0 && kN + aN === 0 && csLost < T.wardsNeutralCs) verdict = 'neutral'
    entries.push({
      fromSec: Math.round(tOut / 1000), backSec: Math.round(tBack / 1000),
      at: at ? { x: Math.round(at.x), y: Math.round(at.y) } : null, side,
      shortProof: !r.sampled, reset: purchase != null, crossed, died, costMeasured,
      cost: { cs: csLost, xp: xpLost, plates: costPlates, towerLost: costTower, deathGold, z: round2(costZ) },
      gain: { kills: kN, assists: aN, killGold: kGold, objectives: gainObjectives, platesTaken, laneGold: Math.round(laneGold), laneXp: Math.round(laneXp), fightGold, z: round2(gainZ) },
      followUp: { kills: oppKills.length, killGold: fuKillGold, objectives: fuObjectives, plates: fuPlates, towerLost: fuTower, extraCs, extraXp, z: round2(followZ) },
      freezeLikely, net: round2(net), verdict,
      role, goldLost, partner, ...(timer ? { timer, goodTimer: GOOD_TIMERS.includes(timer) } : {}), ...(taxed != null ? { taxed } : {}),
      ...(tpLikely != null ? { tpLikely } : {}), ...(role === 'UTILITY' ? { wards } : {}),
    })
  }
  return { role, tier: patch.tier, entries }
}

/** The sample of [fromMs, toMs] farthest from the lane (the turning point of a roam). */
function farthestOf(fromMs: number, toMs: number, stepMs: number, posAt: (ms: number) => Point | null, spec: RoamRoleSpec, T: RoamThresholds): Point | null {
  let best: Point | null = null
  let bestD = -1
  const start = posAt(fromMs)
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const p = posAt(t)
    if (!p || !spec.isOffLane(p, T)) continue
    // Mid: distance to the diagonal. Side lanes: distance from where the roam started.
    const d = spec.home === 'MID' ? Math.abs(p.x - p.y) : start ? dist(p, start) : 0
    if (d > bestD) { bestD = d; best = p }
  }
  return best
}
