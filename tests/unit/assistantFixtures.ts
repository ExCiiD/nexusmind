import type { GameRecord, SessionRecord } from '../../electron/main/assistant/features'

export const NOW = Date.UTC(2026, 10, 13, 20, 0, 0)
const HOUR = 3600_000

let seq = 0

/** A plain mid-lane game; override what the test cares about. `ago` = hours before NOW. */
export function game(over: Partial<GameRecord> & { ago?: number } = {}): GameRecord {
  seq++
  const { ago = seq, ...rest } = over
  return {
    id: `g${seq}`,
    matchId: `EUW1_${seq}`,
    sessionId: 's1',
    endedAt: NOW - ago * HOUR,
    durationSec: 1800,
    win: seq % 2 === 0,
    kills: 4,
    deaths: 4,
    assists: 6,
    cs: 210, // 7.0 / min
    visionScore: 24, // 0.8 / min
    role: 'MIDDLE',
    champion: 'Ahri',
    objectiveIds: ['tempo'],
    reviewed: true,
    kpiScores: { death_regulation: 6 },
    objectiveRespected: null,
    lane: null,
    deathTimesSec: [900, 1300, 1500, 1700],
    killParticipation: 55,
    mistakes: [],
    recordingId: null,
    ...rest,
  }
}

/** n games, newest first (ago = 1..n hours). */
export function games(n: number, over: (i: number) => Partial<GameRecord> = () => ({})): GameRecord[] {
  return Array.from({ length: n }, (_, i) => game({ ago: i + 1, ...over(i) }))
}

export function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return { id: 's1', date: NOW - 48 * HOUR, status: 'completed', objectiveIds: ['tempo'], selectedKpiIds: [], ...over }
}
