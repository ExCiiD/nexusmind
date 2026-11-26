/**
 * Gank ledger (docs/PLAN_MOTEUR_BILANS.md phase 3, docs/engine-reports/2026-11-20-bilan-des-ganks-jungle.md): for each gank
 * of the jungler, what it cost (camps not taken against the enemy jungler, camps stolen, gold and XP gap, a death), what it
 * created (takedowns, a laner forced back, plates, an objective chained, the ganked lane ahead), and what the enemy jungler
 * did on their side meanwhile, in the same Δz scale as the roam ledger (winProbability.winZ).
 *
 * Presence in a lane is proven four ways: the 5 s interpolated position (with an enemy laner close), a takedown / death /
 * plate of the jungler there, and lane minions taken (`minionsKilled` of the jungler rises between two snapshots while a
 * snapshot has them in the lane: checked present on every cached 16.x jungler frame, 2026-11-26-verifs-bilans.md). Data it
 * does not have: which camp was taken, spells, Flash, pressure without a takedown, Scuttle Crab. The ledger leans to
 * "neutral" (a trade) rather than blame.
 */
import { OBJECTIVE_RADIUS, dist, laneOf, territoryOf, zoneOf, type Point, type TeamId } from './geometry'
import { OBJECTIVE_WEIGHT, objectiveKindOf, type ObjectiveKind } from './winProbability'
import {
  buildLedgerTrack, deltaZ, excursionsOf, killChains, killGold, mergeExcursions, plateGold, round2,
  type Excursion, type LedgerTrack,
} from './ledgerCore'

export type GankVerdict = 'profitable' | 'neutral' | 'losing'
export type GankTimer = 'camps-taken' | 'window' | 'laner-low' | 'enemy-far' | 'camps-up' | 'enemy-close' | 'none'
const GOOD_GANK_TIMERS: readonly GankTimer[] = ['camps-taken', 'window', 'laner-low', 'enemy-far']

export const GANK_THRESHOLDS = {
  fromSec: 110,
  /** The lane phase: later takedowns in a lane are fights of the mid game, read by other detectors (calibration of 26/11/2026). */
  untilSec: 840,
  /** An enemy laner of the lane within this of the jungler. */
  enemyRadius: 2500,
  sampleSec: 5,
  minPresenceSec: 10,
  maxPresenceSec: 180,
  /** Two ganks of the same lane closer than this form one. */
  mergeGapSec: 45,
  /** A takedown, a death or a plate in a lane proves the presence from this long before to this long after. */
  proofLeadSec: 15,
  proofTailSec: 15,
  tailSec: 30,
  costAfterOutSec: 60,
  followUpSec: 180,
  /** An objective taken this long after the gank, the jungler present, is chained to it. */
  chainSec: 60,
  objectiveRadius: OBJECTIVE_RADIUS,
  sameFightSec: 10,
  fightMinKills: 3,
  /** A jungle camp is 4 jungle CS (measured: 2026-11-20 report, hops of 4 / 8 / 12 per minute). */
  campCs: 4,
  /** Value of a camp without the passive income, measured by regression on the cache (2026-11-26-calibrage-ganks.md). */
  campGold: 90,
  campXp: 200,
  minCampsLost: 2,
  /** Δz scale: |net| below it is a trade. Set by the calibration of 26/11/2026. */
  netThreshold: 2.5,
  driftShare: 1,
  /** A laner under this HP share at the snapshot before, shopping during the gank or 30 s after, was forced back (worth about a wave). */
  forcedBackHpPct: 35,
  forcedBackGold: 100,
  /** Timers at the start of the gank. */
  campsRecentSec: 135,
  laneLowHpPct: 50,
  enemyFarDist: 8000,
  enemyCloseDist: 3000,
  maxCards: 2,
} as const
export type GankThresholds = Record<keyof typeof GANK_THRESHOLDS, number>
/** The gank windows of DETECTOR_SPEC.gank (1:50-2:25, 2:40-3:50), kept here so the ledger needs no import of the detector. */
const GANK_WINDOWS: ReadonlyArray<readonly [number, number]> = [[110, 145], [160, 230]]

type Lane = 'TOP' | 'MID' | 'BOT'
const LANE_ENEMIES: Record<Lane, readonly string[]> = { TOP: ['TOP'], MID: ['MIDDLE'], BOT: ['BOTTOM', 'UTILITY'] }

export interface GankEntry {
  lane: Lane
  fromSec: number
  backSec: number
  at: { x: number; y: number } | null
  /** How the presence was proven. */
  proof: { position: boolean; takedown: boolean; minions: boolean }
  died: boolean
  costMeasured: boolean
  /** Jungle camps lost against the enemy jungler (their gain minus the player's, over the cost window), camps they took in our jungle. */
  campsLost: number
  campsStolen: number
  /** The gold / XP lead over the enemy jungler before and after (negative = behind). */
  gap: { goldBefore: number; goldAfter: number; xpBefore: number; xpAfter: number }
  cost: { deathGold: number; z: number }
  gain: { kills: number; assists: number; killGold: number; forcedBack: boolean; plates: number; objectives: ObjectiveKind[]; laneGold: number; laneXp: number; fightGold: number; z: number }
  followUp: { kills: number; killGold: number; objectives: ObjectiveKind[]; extraGold: number; extraXp: number; z: number }
  timer: GankTimer
  goodTimer: boolean
  net: number
  verdict: GankVerdict
}

export interface GankLedger { entries: GankEntry[] }

export function gankLedger(match: any, timeline: any, pid: number, spec: GankThresholds = GANK_THRESHOLDS as GankThresholds, trackIn?: LedgerTrack | null): GankLedger | null {
  const T = spec
  const track = trackIn ?? buildLedgerTrack(match, timeline)
  if (!track) return null
  const { clock, kills, events, teamOf, posAt, deadAt, goldOf, xpOf, involves, pframe } = track
  const me = track.parts.find((p) => p.participantId === pid)
  if (!me || track.positionOf(me) !== 'JUNGLE') return null
  const team: number = me.teamId
  const teamTag = (team === 200 ? 200 : 100) as TeamId
  const enemyJ = track.parts.find((p) => p.teamId !== team && track.positionOf(p) === 'JUNGLE')?.participantId as number | undefined
  if (enemyJ == null) return null
  const baseUntilMs = Math.min(T.untilSec * 1000, clock.endMs)
  const stepMs = T.sampleSec * 1000
  const jcs = (i: number, id: number) => Number(pframe(i, id)?.jungleMinionsKilled) || 0
  const lcs = (i: number, id: number) => Number(pframe(i, id)?.minionsKilled) || 0
  const enemiesOf = (lane: Lane) => track.parts.filter((p) => p.teamId !== team && LANE_ENEMIES[lane].includes(track.positionOf(p))).map((p) => p.participantId as number)
  const alliesOf = (lane: Lane) => track.parts.filter((p) => p.teamId === team && p.participantId !== pid && LANE_ENEMIES[lane].includes(track.positionOf(p))).map((p) => p.participantId as number)
  const inLaneAt = (lane: Lane, p: Point | null): boolean => {
    if (!p) return false
    const z = zoneOf(p, 100)
    return z !== 'own-base' && z !== 'enemy-base' && laneOf(p) === lane
  }
  const hpPct = (i: number, id: number): number | null => {
    const s = pframe(i, id)?.championStats
    return s && Number(s.healthMax) > 0 ? Math.round((Number(s.health) / Number(s.healthMax)) * 100) : null
  }
  const chains = killChains(kills, T.sameFightSec * 1000)
  const fightOf = new Map<any, any[]>()
  for (const c of chains) if (c.length >= T.fightMinKills && c.some((e) => involves(e, pid) || e.victimId === pid)) for (const e of c) fightOf.set(e, c)
  const ours = (e: any): boolean => (e.type === 'ELITE_MONSTER_KILL' ? (e.killerTeamId ?? teamOf(e.killerId)) === team : e.teamId !== team)
  const near = (id: number, e: any): boolean => {
    const p = e.position as Point | undefined
    const q = p && !deadAt(id, e.timestamp) ? posAt(id, e.timestamp) : null
    return !!p && !!q && dist(p, q) <= T.objectiveRadius
  }

  const entries: GankEntry[] = []
  for (const lane of ['TOP', 'MID', 'BOT'] as const) {
    const foes = enemiesOf(lane)
    if (foes.length === 0) continue
    // The gank window of a lane ends when the first outer turret of that lane falls.
    const t1Fall = events.find((e) => e.type === 'BUILDING_KILL' && e.buildingType === 'TOWER_BUILDING' && e.towerType === 'OUTER_TURRET' && e.laneType === `${lane}_LANE`)?.timestamp
    const untilMs = Math.min(baseUntilMs, t1Fall ?? Infinity)
    // Presence: in the lane with an enemy laner of it close, from the 5 s positions…
    const sampled = excursionsOf((ms) => {
      if (deadAt(pid, ms)) return false
      const p = posAt(pid, ms)
      return inLaneAt(lane, p) && foes.some((f) => !deadAt(f, ms) && (() => { const q = posAt(f, ms); return !!q && !!p && dist(p, q) <= T.enemyRadius })())
    }, T.fromSec * 1000, untilMs, stepMs, T.minPresenceSec * 1000, T.mergeGapSec * 1000)
    // …a takedown, a death or a plate of the jungler there…
    const proofs: Excursion[] = events
      .filter((e) => e.position && inLaneAt(lane, e.position) && e.timestamp >= T.fromSec * 1000 && e.timestamp <= untilMs && (
        (e.type === 'CHAMPION_KILL' && (involves(e, pid) || e.victimId === pid) && (foes.includes(e.victimId) || foes.includes(e.killerId) || (e.assistingParticipantIds ?? []).some((x: number) => foes.includes(x)))) || (e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === pid)))
      .map((e) => ({ fromMs: e.timestamp - T.proofLeadSec * 1000, toMs: e.timestamp + T.proofTailSec * 1000, sampled: false, killProof: true }))
    // …or lane minions taken: `minionsKilled` rises over a minute in which a snapshot has the jungler in the lane.
    const minionProofs: Excursion[] = []
    for (let k = 1; k < clock.last; k++) {
      if (k * 60_000 < T.fromSec * 1000 - 60_000 || (k + 1) * 60_000 > untilMs + 60_000) continue
      if (lcs(k + 1, pid) <= lcs(k, pid)) continue
      if (!inLaneAt(lane, pframe(k, pid)?.position ?? null) && !inLaneAt(lane, pframe(k + 1, pid)?.position ?? null)) continue
      minionProofs.push({ fromMs: Math.max(k * 60_000, T.fromSec * 1000), toMs: clock.ts(k + 1), sampled: false, killProof: false })
    }
    const merged = mergeExcursions([...sampled, ...proofs, ...minionProofs], T.mergeGapSec * 1000).filter((r) => r.toMs - r.fromMs <= T.maxPresenceSec * 1000)

    for (const r of merged) {
      const tIn = r.fromMs
      const tOut = Math.min(r.toMs, clock.endMs)
      const minutes = tIn / 60000
      const a = clock.indexAt(tIn)
      const b = Math.min(clock.last, Math.ceil((tOut + T.costAfterOutSec * 1000) / 60000))
      const costMeasured = b > a
      const tsEnd = clock.ts(b)
      const died = (track.lives.get(pid) ?? []).some((d) => d.ts >= tIn && d.ts <= tOut)

      // ── Cost ──
      const lead = (i: number, f: (i: number, id: number) => number) => f(i, pid) - f(i, enemyJ)
      const campsLost = costMeasured ? Math.max(0, ((jcs(Math.max(a, b), enemyJ) - jcs(Math.max(a, b), pid)) - (jcs(a, enemyJ) - jcs(a, pid))) / T.campCs) : 0
      let stolenCs = 0
      for (let k = a; k < b; k++) {
        const p0 = pframe(k, enemyJ)?.position as Point | undefined, p1 = pframe(k + 1, enemyJ)?.position as Point | undefined
        const ownJungle = (p: Point | undefined) => !!p && territoryOf(p, teamTag) === 'own' && laneOf(p) === 'JUNGLE'
        if (ownJungle(p0) && ownJungle(p1)) stolenCs += Math.max(0, jcs(k + 1, enemyJ) - jcs(k, enemyJ))
      }
      const campsStolen = Math.floor(stolenCs / T.campCs)
      const gapBefore = { gold: lead(a, goldOf), xp: lead(a, xpOf) }
      const gapAfter = { gold: lead(b, goldOf), xp: lead(b, xpOf) }

      let deathGold = 0, fightGold = 0, kN = 0, aN = 0, kGold = 0
      const gainEnd = tOut + T.tailSec * 1000
      for (const e of kills) {
        if (e.timestamp < tIn || e.timestamp > gainEnd) continue
        const g = killGold(e)
        const ourKill = typeof e.killerId === 'number' && e.killerId > 0 && teamOf(e.killerId) === team
        const fight = fightOf.get(e)
        if (ourKill) { if (involves(e, pid)) { if (e.killerId === pid) kN++; else aN++; kGold += g } else if (fight) fightGold += g }
        else if (teamOf(e.victimId) === team) { if (e.victimId === pid) deathGold += g; else if (fight) fightGold -= g }
      }
      const costZ = deltaZ((campsLost + campsStolen) * T.campGold + deathGold, campsLost * T.campXp, 0, minutes)

      // ── Gain ──
      const forcedBack = foes.some((f) => {
        const hp = hpPct(a, f)
        return hp != null && hp < T.forcedBackHpPct && track.shopsOf(f).some((t) => t >= tIn && t <= gainEnd && !deadAt(f, t))
      })
      let plates = 0, objW = 0
      const objectives: ObjectiveKind[] = []
      for (const e of events) {
        if (e.timestamp < tIn || e.timestamp > tOut + T.chainSec * 1000) continue
        const kind = objectiveKindOf(e)
        if (kind && ours(e) && e.type === 'ELITE_MONSTER_KILL' && (involves(e, pid) || near(pid, e))) { objectives.push(kind); objW += OBJECTIVE_WEIGHT[kind] }
        else if (e.timestamp <= gainEnd && e.type === 'TURRET_PLATE_DESTROYED' && e.teamId !== team && laneOf(e.position ?? { x: 7500, y: 7500 }) === lane && (e.killerId === pid || near(pid, e) || teamOf(e.killerId) === team)) plates++
      }
      let laneGold = 0, laneXp = 0
      const allies = alliesOf(lane)
      if (costMeasured && allies.length && (kN + aN > 0 || forcedBack)) {
        const sum = (ids: number[], f: (i: number, id: number) => number, i: number) => ids.reduce((s, id) => s + f(i, id), 0)
        const diff = (i: number, f: (i: number, id: number) => number) => sum(allies, f, i) - sum(foes, f, i)
        const credited = kills.filter((e) => involves(e, pid) && allies.includes(e.killerId) && e.timestamp >= tIn && e.timestamp <= tsEnd).reduce((s, e) => s + killGold(e), 0)
        laneGold = Math.max(0, diff(b, goldOf) - diff(a, goldOf) - credited)
        laneXp = Math.max(0, diff(b, xpOf) - diff(a, xpOf))
      }
      const gainZ = deltaZ(kGold + fightGold + (forcedBack ? T.forcedBackGold : 0) + plates * plateGold(minutes) + laneGold, laneXp, objW, minutes)

      // ── Follow-up: what the enemy jungler did on their side, themselves involved ──
      const fuEnd = tOut + T.followUpSec * 1000
      const oppKills = kills.filter((e) => e.timestamp >= tIn && e.timestamp <= fuEnd && involves(e, enemyJ) && teamOf(e.victimId) === team)
      const fuObj: ObjectiveKind[] = []
      let fuW = 0
      for (const e of events) {
        if (e.timestamp < tIn || e.timestamp > fuEnd) continue
        const kind = objectiveKindOf(e)
        if (kind && !ours(e) && (involves(e, enemyJ) || near(enemyJ, e))) { fuObj.push(kind); fuW += OBJECTIVE_WEIGHT[kind] }
      }
      const b2 = Math.min(clock.last, Math.max(a, b) + 2)
      const extraGold = b2 > b ? Math.max(0, lead(b, goldOf) - lead(b2, goldOf)) : 0
      const extraXp = b2 > b ? Math.max(0, lead(b, xpOf) - lead(b2, xpOf)) : 0
      const fuKillGold = oppKills.reduce((s, e) => s + killGold(e), 0)
      const followZ = deltaZ(fuKillGold + extraGold * T.driftShare, extraXp * T.driftShare, fuW, minutes)

      // ── Timer at the start (explains the verdict, never changes the number) ──
      const here = posAt(pid, tIn)
      const enemyHere = posAt(enemyJ, tIn)
      const campsRecent = jcs(a, pid) > jcs(Math.max(0, clock.indexAt(Math.max(0, tIn - T.campsRecentSec * 1000))), pid)
      const inWindow = GANK_WINDOWS.some(([x, y]) => tIn >= x * 1000 && tIn <= y * 1000)
      const foeLow = foes.some((f) => (hpPct(a, f) ?? 100) < T.laneLowHpPct)
      const enemyD = here && enemyHere ? dist(here, enemyHere) : null
      const timer: GankTimer = enemyD != null && enemyD < T.enemyCloseDist ? 'enemy-close' : !campsRecent && tIn > 3 * 60_000 ? 'camps-up'
        : foeLow ? 'laner-low' : inWindow ? 'window' : enemyD != null && enemyD > T.enemyFarDist ? 'enemy-far' : campsRecent ? 'camps-taken' : 'none'

      const net = gainZ - costZ - followZ
      const verdict: GankVerdict = net >= T.netThreshold ? 'profitable' : net <= -T.netThreshold && (campsLost >= T.minCampsLost || died) ? 'losing' : 'neutral'
      const farthest = here ?? null
      entries.push({
        lane, fromSec: Math.round(tIn / 1000), backSec: Math.round(tOut / 1000),
        at: farthest ? { x: Math.round(farthest.x), y: Math.round(farthest.y) } : null,
        proof: { position: r.sampled, takedown: r.killProof, minions: !r.sampled && !r.killProof }, died, costMeasured,
        campsLost: round2(campsLost), campsStolen,
        gap: { goldBefore: Math.round(gapBefore.gold), goldAfter: Math.round(gapAfter.gold), xpBefore: Math.round(gapBefore.xp), xpAfter: Math.round(gapAfter.xp) },
        cost: { deathGold, z: round2(costZ) },
        gain: { kills: kN, assists: aN, killGold: kGold, forcedBack, plates, objectives, laneGold: Math.round(laneGold), laneXp: Math.round(laneXp), fightGold, z: round2(gainZ) },
        followUp: { kills: oppKills.length, killGold: fuKillGold, objectives: fuObj, extraGold: Math.round(extraGold), extraXp: Math.round(extraXp), z: round2(followZ) },
        timer, goodTimer: GOOD_GANK_TIMERS.includes(timer), net: round2(net), verdict,
      })
    }
  }
  entries.sort((x, y) => x.fromSec - y.fromSec)
  return { entries }
}
