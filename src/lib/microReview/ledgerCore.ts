/**
 * Shared base of the bilan ledgers (docs/moteur/PLAN_MOTEUR_BILANS.md § 2.1): a pure, self-contained reading of a Match-V5 +
 * Timeline-V5 pair. Position at any millisecond (interpolated between the 60 s snapshots along what the events prove),
 * lives and deaths, per-minute counters, the excursions of a champion out of its lane, and the single Δz scale that puts
 * gold, XP and objectives on the same footing (winProbability.winZ). Nothing here is shown to the player.
 *
 * Resolution limits are those of the timeline (see anomalyDetector.ts): no minion wave, no spell, no ward position;
 * positions between two snapshots are estimates.
 */
import { FOUNTAIN, type Point, type TeamId } from './geometry'
import { deathTimerSec } from './gameClock'
import { frameClock, winZ, type FrameClock } from './winProbability'

/** One death of a champion: where and when it fell, when it is back. */
export interface LedgerLife { ts: number; pos: Point; respawn: number }

export interface LedgerTrack {
  frames: any[]
  clock: FrameClock
  /** Every timeline event, chronological. */
  events: any[]
  kills: any[]
  parts: any[]
  teamOf: (id: number) => number | undefined
  positionOf: (p: any) => string
  roleOfId: (id: number) => string
  lives: Map<number, LedgerLife[]>
  deadAt: (id: number, ms: number) => boolean
  /** Position at `ms` (snapshot, interpolated walk, or the place of the death while dead). */
  posAt: (id: number, ms: number) => Point | null
  pframe: (i: number, id: number) => any
  csOf: (i: number, id: number) => number
  xpOf: (i: number, id: number) => number
  goldOf: (i: number, id: number) => number
  /** Purchase times of a participant (the shop only sells in base). */
  shopsOf: (id: number) => number[]
  involves: (e: any, id: number) => boolean
}

export function buildLedgerTrack(match: any, timeline: any): LedgerTrack | null {
  const frames: any[] = timeline?.info?.frames ?? []
  const parts: any[] = match?.info?.participants ?? []
  if (frames.length < 2 || parts.length === 0) return null
  const teamById = new Map<number, number>(parts.map((p) => [p.participantId, p.teamId]))
  const teamOf = (id: number) => teamById.get(id)
  const positionOf = (p: any): string => p?.teamPosition || p?.individualPosition || ''
  const roleOfId = (id: number): string => positionOf(parts.find((p) => p.participantId === id))
  const clock = frameClock(frames)

  const events: any[] = []
  for (const f of frames) for (const ev of (f.events ?? []) as any[]) if (typeof ev.timestamp === 'number') events.push(ev)
  events.sort((a, b) => a.timestamp - b.timestamp)
  const kills = events.filter((e) => e.type === 'CHAMPION_KILL')
  const involves = (e: any, id: number): boolean => e.killerId === id || (e.assistingParticipantIds ?? []).includes(id)

  const pframe = (i: number, id: number) => frames[Math.max(0, Math.min(frames.length - 1, i))]?.participantFrames?.[String(id)]
  const csOf = (i: number, id: number) => (Number(pframe(i, id)?.minionsKilled) || 0) + (Number(pframe(i, id)?.jungleMinionsKilled) || 0)
  const xpOf = (i: number, id: number) => Number(pframe(i, id)?.xp) || 0
  const goldOf = (i: number, id: number) => Number(pframe(i, id)?.totalGold) || 0

  const lives = new Map<number, LedgerLife[]>()
  for (const e of kills) {
    const id = e.victimId
    const pos = e.position as Point | undefined
    if (typeof id !== 'number' || !pos) continue
    const level = Number(pframe(clock.indexAt(e.timestamp), id)?.level) || 1
    const list = lives.get(id) ?? []
    list.push({ ts: e.timestamp, pos, respawn: e.timestamp + deathTimerSec(level, e.timestamp / 60000) * 1000 })
    lives.set(id, list)
  }
  const deadAt = (id: number, ms: number): boolean => !!lives.get(id)?.some((d) => d.ts <= ms && ms < d.respawn)

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
      for (const d of own) if (d.respawn <= ms && d.respawn > t0) { t0 = d.respawn; p0 = FOUNTAIN[(teamOf(id) === 200 ? 200 : 100) as TeamId] }
      // Dies before the next snapshot: it is walking to where it falls.
      const next = own.find((d) => d.ts > ms && d.ts <= t1)
      if (next) { t1 = next.ts; p1 = next.pos }
    }
    if (!p0) return p1
    if (!p1 || t1 <= t0) return p0
    const t = Math.max(0, Math.min(1, (ms - t0) / (t1 - t0)))
    return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }
  }

  const shops = new Map<number, number[]>()
  for (const e of events) {
    if (e.type !== 'ITEM_PURCHASED' || typeof e.participantId !== 'number') continue
    shops.set(e.participantId, [...(shops.get(e.participantId) ?? []), e.timestamp])
  }
  return {
    frames, clock, events, kills, parts, teamOf, positionOf, roleOfId, lives, deadAt, posAt, pframe, csOf, xpOf, goldOf,
    shopsOf: (id) => shops.get(id) ?? [], involves,
  }
}

/** A stretch of time during which a champion stood out of its lane. */
export interface Excursion {
  fromMs: number
  toMs: number
  /** Seen on the 5 s position samples. */
  sampled: boolean
  /** Proven by a takedown made away from the lane (a roam too short for the position samples). */
  killProof: boolean
}

/**
 * Excursions of `isOut` over [fromMs, toMs], sampled every `stepMs`. A run lasts from its first out sample to the first
 * sample back in lane; it counts from `minMs`. Runs closer than `mergeGapMs` form one excursion.
 */
export function excursionsOf(isOut: (ms: number) => boolean, fromMs: number, toMs: number, stepMs: number, minMs: number, mergeGapMs: number): Excursion[] {
  const runs: Excursion[] = []
  let start: number | null = null
  for (let t = fromMs; t <= toMs; t += stepMs) {
    if (isOut(t)) { if (start == null) start = t } else if (start != null) { if (t - start >= minMs) runs.push({ fromMs: start, toMs: t, sampled: true, killProof: false }); start = null }
  }
  if (start != null && toMs - start >= minMs) runs.push({ fromMs: start, toMs, sampled: true, killProof: false })
  return mergeExcursions(runs, mergeGapMs)
}

/** Sorted excursions, two closer than `mergeGapMs` (or overlapping) merged into one. */
export function mergeExcursions(list: Excursion[], mergeGapMs: number): Excursion[] {
  const sorted = [...list].sort((a, b) => a.fromMs - b.fromMs)
  const out: Excursion[] = []
  for (const e of sorted) {
    const last = out[out.length - 1]
    if (last && e.fromMs - last.toMs < mergeGapMs) {
      last.toMs = Math.max(last.toMs, e.toMs)
      last.sampled = last.sampled || e.sampled
      last.killProof = last.killProof || e.killProof
    } else out.push({ ...e })
  }
  return out
}

/** Kill chains: takedowns less than `gapMs` apart form one fight (a lone kill is a chain of one). */
export function killChains(kills: any[], gapMs: number): any[][] {
  const chains: any[][] = []
  for (const e of kills) {
    const last = chains[chains.length - 1]
    if (last && e.timestamp - last[last.length - 1].timestamp <= gapMs) last.push(e)
    else chains.push([e])
  }
  return chains
}

/** Gold of a kill as the timeline gives it (bounty + shutdown bounty); 300 when a payload carries neither. */
export const killGold = (e: any): number => {
  const b = typeof e?.bounty === 'number' ? e.bounty : null
  const s = typeof e?.shutdownBounty === 'number' ? e.shutdownBounty : 0
  return b == null ? 300 : b + s
}

/**
 * Turret plate gold at `minutes` (League of Legends Wiki, read 20/11/2026): 120 g, −10 g per minute from 11:00, at least 80 g.
 * Plates stay on until the turret falls in 2026.
 */
export const plateGold = (minutes: number): number => (minutes < 11 ? 120 : Math.max(80, 120 - 10 * (minutes - 11)))

/** A Δz from gold, XP and weighted objectives, on the winProbability scale, at `minutes`. */
export const deltaZ = (gold: number, xp: number, obj: number, minutes: number): number => winZ(gold, xp, obj, minutes)

export const round2 = (v: number): number => Math.round(v * 100) / 100
