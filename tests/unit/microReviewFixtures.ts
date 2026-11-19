/** Synthetic Match-V5 + Timeline builder for the micro-review tests. */

export interface FixtureOptions {
  minutes?: number
  /** Player participantId (1–5 blue, 6–10 red). Default 2. */
  me?: number
  positions?: Record<number, string>
  /** championName per participantId (default `Champ<id>`). */
  champions?: Record<number, string>
  /** Per-frame overrides: (frameIndex, participantId) → partial participant frame. */
  frame?: (i: number, pid: number) => Record<string, unknown> | undefined
  events?: Array<Record<string, unknown> & { type: string; timestamp: number }>
  /**
   * Match-V5 gameVersion. Default 15.24: the suites written before the season-2026 clock keep testing the 2025 one
   * (tests/unit/microReviewSeason2026.test.ts covers 16.x games); null leaves the field out.
   */
  gameVersion?: string | null
}

const DEFAULT_POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

export function buildGame(opts: FixtureOptions = {}) {
  const minutes = opts.minutes ?? 30
  const participants = Array.from({ length: 10 }, (_, k) => {
    const id = k + 1
    return {
      participantId: id,
      puuid: `puuid-${id}`,
      championName: opts.champions?.[id] ?? `Champ${id}`,
      teamId: id <= 5 ? 100 : 200,
      teamPosition: opts.positions?.[id] ?? DEFAULT_POS[k % 5],
    }
  })
  const frames = Array.from({ length: minutes + 1 }, (_, i) => {
    const participantFrames: Record<string, any> = {}
    for (const p of participants) {
      participantFrames[String(p.participantId)] = {
        participantId: p.participantId,
        position: p.teamId === 100 ? { x: 3000, y: 3000 } : { x: 12000, y: 12000 },
        totalGold: 500 + i * 400,
        currentGold: 300,
        xp: i * 500,
        level: Math.min(18, 1 + Math.floor(i / 2)),
        minionsKilled: i * 7,
        jungleMinionsKilled: 0,
        ...(opts.frame?.(i, p.participantId) ?? {}),
      }
    }
    return { timestamp: i * 60_000, participantFrames, events: [] as any[] }
  })
  for (const ev of opts.events ?? []) {
    const idx = Math.min(frames.length - 1, Math.max(0, Math.ceil(ev.timestamp / 60_000)))
    frames[idx].events.push(ev)
  }
  return {
    match: { info: { ...(opts.gameVersion === null ? {} : { gameVersion: opts.gameVersion ?? '15.24.715.2077' }), participants, teams: [{ teamId: 100, win: false }, { teamId: 200, win: true }] } },
    timeline: { info: { frames } },
    selector: { puuids: [`puuid-${opts.me ?? 2}`] },
  }
}

export const at = (min: number, sec = 0) => (min * 60 + sec) * 1000
