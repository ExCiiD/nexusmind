/**
 * Assistant — A4 "what matters for you": a local logistic regression between
 * per-game features and victory. Plain TypeScript, batch gradient descent
 * with L2 regularisation on standardised features. The output is a ranking
 * of fundamentals by how strongly they move this player's win probability.
 *
 * It is a correlation on a small sample, not causality — the UI says so.
 */

import { mean, stdDev, type GameFeatures, type Metric } from './features'

export interface LogisticModel {
  weights: number[]
  bias: number
}

export interface FitOptions {
  l2?: number
  learningRate?: number
  iterations?: number
}

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z))
  const e = Math.exp(z)
  return e / (1 + e)
}

export function predict(model: LogisticModel, x: number[]): number {
  let z = model.bias
  for (let j = 0; j < x.length; j++) z += model.weights[j] * x[j]
  return sigmoid(z)
}

/** Batch gradient descent on the L2-regularised log-loss. */
export function fitLogistic(X: number[][], y: number[], opts: FitOptions = {}): LogisticModel {
  const l2 = opts.l2 ?? 0.1
  const lr = opts.learningRate ?? 0.3
  const iterations = opts.iterations ?? 800
  const n = X.length
  const d = X[0]?.length ?? 0
  const w = new Array<number>(d).fill(0)
  let b = 0
  if (n === 0) return { weights: w, bias: b }
  for (let it = 0; it < iterations; it++) {
    const gw = new Array<number>(d).fill(0)
    let gb = 0
    for (let i = 0; i < n; i++) {
      let z = b
      for (let j = 0; j < d; j++) z += w[j] * X[i][j]
      const err = sigmoid(z) - y[i]
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j]
      gb += err
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j])
    b -= lr * (gb / n)
  }
  return { weights: w, bias: b }
}

/** Candidate features and the fundamental each one is evidence for. */
export const DRIVER_FEATURES: Array<{ metric: Metric; objectiveId: string }> = [
  { metric: 'csPerMin', objectiveId: 'csing_pathing' },
  { metric: 'visionPerMin', objectiveId: 'vision_control' },
  { metric: 'deaths', objectiveId: 'tempo' },
  { metric: 'deathsBefore10', objectiveId: 'trades' },
  { metric: 'kp', objectiveId: 'map_awareness' },
  { metric: 'goldDiff10', objectiveId: 'wave_management' },
  { metric: 'laneScore', objectiveId: 'matchup_knowledge' },
  { metric: 'objectiveRespected', objectiveId: 'decision_making' },
]

export interface WinDriver {
  metric: Metric
  objectiveId: string
  /** Standardised coefficient (log-odds per 1 sd). */
  coefficient: number
  /** Share of total |coefficient|, 0–1. */
  importance: number
  /** 'higher' = more of it goes with winning, 'lower' = less of it. */
  direction: 'higher' | 'lower'
}

export interface WinDrivers {
  games: number
  drivers: WinDriver[]
}

export const MIN_GAMES_FOR_DRIVERS = 15

/**
 * Fits the model on the player's games and ranks features. Missing values are
 * imputed with the feature mean (0 after standardisation); features with less
 * than 60 % coverage or no variance are skipped. Returns null with too little
 * data or when the player has (almost) only wins or only losses.
 */
export function rankWinDrivers(games: GameFeatures[], opts: FitOptions = {}): WinDrivers | null {
  if (games.length < MIN_GAMES_FOR_DRIVERS) return null
  const y = games.map((g) => g.values.win ?? 0)
  const wins = y.filter((v) => v === 1).length
  if (wins < 4 || games.length - wins < 4) return null

  const used: Array<{ metric: Metric; objectiveId: string; m: number; sd: number }> = []
  for (const f of DRIVER_FEATURES) {
    const xs = games.map((g) => g.values[f.metric]).filter((v): v is number => v != null)
    if (xs.length < games.length * 0.6) continue
    const m = mean(xs)
    const sd = stdDev(xs)
    if (m == null || sd == null || sd < 1e-9) continue
    used.push({ ...f, m, sd })
  }
  if (used.length === 0) return null

  const X = games.map((g) => used.map((u) => {
    const v = g.values[u.metric]
    return v == null ? 0 : (v - u.m) / u.sd
  }))
  const model = fitLogistic(X, y, opts)
  const total = model.weights.reduce((a, w) => a + Math.abs(w), 0) || 1
  const drivers = used
    .map((u, j) => ({
      metric: u.metric,
      objectiveId: u.objectiveId,
      coefficient: model.weights[j],
      importance: Math.abs(model.weights[j]) / total,
      direction: (model.weights[j] >= 0 ? 'higher' : 'lower') as 'higher' | 'lower',
    }))
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient))
  return { games: games.length, drivers }
}
