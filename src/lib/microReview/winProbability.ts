/**
 * Light, deterministic win-probability estimate per timeline frame.
 *
 * Only used to discard garbage-time events (a death at 85 % or 18 % win
 * probability rarely changes the game, so it should not drive coaching nor
 * the Mistake Lab win-rate ratios). It is never shown as a rating — no
 * alternative MMR, analysis after the game only (Riot policy).
 *
 *   z = 0.0075·ΔGold/t + 0.004·ΔXP/t + 0.28·ΔObj,  t = max(minutes, 5)
 *   P(win) = 1 / (1 + e^(−z))
 *
 * ΔGold/t and ΔXP/t: per-minute lead, so the same 3k lead weighs more at
 * 15 min than at 35. ΔObj: weighted objectives taken so far (team − enemy).
 */

export const GARBAGE_LOW = 0.18
export const GARBAGE_HIGH = 0.85

export const OBJECTIVE_WEIGHT = {
  tower: 1,
  inhibitor: 1.5,
  dragon: 1,
  elder: 2.5,
  herald: 0.5,
  grubs: 0.3,
  baron: 2,
} as const
export type ObjectiveKind = keyof typeof OBJECTIVE_WEIGHT

const W_GOLD = 0.0075
const W_XP = 0.004
const W_OBJ = 0.28

export function winProbability(goldDiff: number, xpDiff: number, objDiff: number, minutes: number): number {
  const t = Math.max(minutes, 5)
  const z = (W_GOLD * goldDiff) / t + (W_XP * xpDiff) / t + W_OBJ * objDiff
  return 1 / (1 + Math.exp(-z))
}

export const isGarbageTime = (p: number | null | undefined): boolean =>
  p != null && (p < GARBAGE_LOW || p > GARBAGE_HIGH)

/** Kind of an ELITE_MONSTER_KILL / BUILDING_KILL timeline event, null for anything else. */
export function objectiveKindOf(ev: { type?: string; monsterType?: string; monsterSubType?: string; buildingType?: string }): ObjectiveKind | null {
  if (ev.type === 'ELITE_MONSTER_KILL') {
    switch (ev.monsterType) {
      case 'DRAGON': return ev.monsterSubType === 'ELDER_DRAGON' ? 'elder' : 'dragon'
      case 'BARON_NASHOR': return 'baron'
      case 'RIFTHERALD': return 'herald'
      case 'HORDE': return 'grubs'
      default: return null
    }
  }
  if (ev.type === 'BUILDING_KILL') {
    if (ev.buildingType === 'TOWER_BUILDING') return 'tower'
    if (ev.buildingType === 'INHIBITOR_BUILDING') return 'inhibitor'
  }
  return null
}

/**
 * Clock of a timeline. Frame i is the snapshot of minute i — Riot's own
 * timestamps drift by a few milliseconds — except the last one, which is
 * taken when the game ends (30:23 → frame 31 at 30:23, not 31:00).
 */
export interface FrameClock {
  /** Index of the last frame. */
  last: number
  /** Game time of the last frame (ms). */
  endMs: number
  /** Game time of frame i (ms). */
  ts(i: number): number
  /** Last frame at or before `ms`. */
  indexAt(ms: number): number
}

export function frameClock(frames: any[]): FrameClock {
  const last = Math.max(0, frames.length - 1)
  const real = Number(frames[last]?.timestamp)
  const endMs = Number.isFinite(real) && real > (last - 1) * 60000 && real < last * 60000 ? real : last * 60000
  return {
    last,
    endMs,
    ts: (i) => (i >= last ? endMs : Math.max(0, i) * 60000),
    indexAt: (ms) => (ms >= endMs ? last : Math.max(0, Math.min(last - 1, Math.floor(ms / 60000)))),
  }
}

export interface WinProbTrack {
  /** P(win) at every frame snapshot, rounded to 3 decimals — what is stored with the analysis. */
  curve: number[]
  /**
   * Unrounded P(win) just before an action at `ms`: gold and XP of the last
   * snapshot at or before it (they only exist per minute), objectives counted
   * strictly before `ms` — the action itself is not in.
   */
  before(ms: number): number | null
  /** Unrounded P(win) at `ms`: same snapshot rule, objectives counted up to and including `ms`. */
  at(ms: number): number | null
}

/**
 * Win probability of `team` over a game. `frames` is the Riot
 * Match-Timeline-V5 `info.frames` array; `teamOf` maps a participantId to
 * its team. Objectives carry exact timestamps, so the estimate between two
 * snapshots moves with them; gold and XP only move at the snapshots.
 */
export function winProbabilityTrack(frames: any[], teamOf: (pid: number) => number | undefined, team: number): WinProbTrack {
  const clock = frameClock(frames)
  const snaps: { gold: number; xp: number; minutes: number }[] = []
  const swings: { ts: number; delta: number }[] = []
  const curve: number[] = []
  let objDiff = 0
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    let gold = 0
    let xp = 0
    const pfs = f?.participantFrames ?? {}
    for (const key of Object.keys(pfs)) {
      const pf = pfs[key]
      const side = teamOf(Number(pf?.participantId ?? key)) === team ? 1 : -1
      gold += side * (Number(pf?.totalGold) || 0)
      xp += side * (Number(pf?.xp) || 0)
    }
    // Riot puts in frame i the events of the minute that ENDS at its snapshot,
    // so they count before that snapshot's estimate.
    for (const ev of (f?.events ?? []) as any[]) {
      const kind = objectiveKindOf(ev)
      if (!kind) continue
      const w = OBJECTIVE_WEIGHT[kind]
      // BUILDING_KILL.teamId is the team that LOST the building.
      const ours = ev.type === 'ELITE_MONSTER_KILL' ? (ev.killerTeamId ?? teamOf(ev.killerId)) === team : ev.teamId !== team
      const delta = ours ? w : -w
      objDiff += delta
      swings.push({ ts: typeof ev.timestamp === 'number' ? ev.timestamp : clock.ts(i), delta })
    }
    const minutes = (Number(f?.timestamp) || 0) / 60000
    snaps.push({ gold, xp, minutes })
    curve.push(round3(winProbability(gold, xp, objDiff, minutes)))
  }
  swings.sort((a, b) => a.ts - b.ts)
  const estimate = (ms: number, inclusive: boolean): number | null => {
    if (snaps.length === 0) return null
    const snap = snaps[clock.indexAt(ms)]
    let obj = 0
    for (const w of swings) {
      if (inclusive ? w.ts > ms : w.ts >= ms) break
      obj += w.delta
    }
    return winProbability(snap.gold, snap.xp, obj, snap.minutes)
  }
  return { curve, before: (ms) => estimate(ms, false), at: (ms) => estimate(ms, true) }
}

/**
 * Win probability of `team` at every frame snapshot (3 decimals). `curve[i]`
 * is the state at frame i (minute i), so `curve[floor(t / 60 s)]` is the last
 * snapshot estimate before an action at t.
 */
export function winProbabilityCurve(frames: any[], teamOf: (pid: number) => number | undefined, team: number): number[] {
  return winProbabilityTrack(frames, teamOf, team).curve
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** Snapshot P(win) "before the action" at `gameTimeMs`: the last frame at or before it. */
export function winProbAt(curve: number[], gameTimeMs: number): number | null {
  if (curve.length === 0) return null
  const i = Math.min(curve.length - 1, Math.max(0, Math.floor(gameTimeMs / 60000)))
  return curve[i]
}
