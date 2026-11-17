import { describe, it, expect } from 'vitest'
import {
  championPool,
  winLossSplit,
  biggestLever,
  winrateByDuration,
  winrateByDaypart,
  tiltReport,
  type InsightGame,
} from '../../src/lib/statsInsights'

let n = 0
function game(p: Partial<InsightGame> & { at?: string } = {}): InsightGame {
  n++
  return {
    matchId: `m${n}`,
    champion: 'Ahri',
    kills: 5,
    deaths: 4,
    assists: 6,
    cs: 200,
    visionScore: 25,
    duration: 28 * 60,
    win: true,
    gameEndAt: p.at ?? new Date(2026, 10, 1, 20, 0).toISOString(),
    ...p,
  }
}

describe('championPool', () => {
  it('groups by champion, sorted by games played', () => {
    const rows = championPool([
      game({ champion: 'Vi', win: true }),
      game({ champion: 'Ahri', win: false }),
      game({ champion: 'Ahri', win: true }),
    ])
    expect(rows.map((r) => r.champion)).toEqual(['Ahri', 'Vi'])
    expect(rows[0]).toMatchObject({ games: 2, wins: 1, winrate: 50 })
  })

  it('computes KDA on totals and treats 0 deaths as K+A', () => {
    const [row] = championPool([game({ kills: 3, deaths: 0, assists: 4 })])
    expect(row.kda).toBe(7)
  })
})

describe('winLossSplit / biggestLever', () => {
  it('returns null below the minimum sample on either side', () => {
    expect(winLossSplit([game(), game(), game(), game({ win: false })])).toBeNull()
  })

  it('surfaces deaths as the lever when losses have far more deaths', () => {
    const games = [
      ...Array.from({ length: 3 }, () => game({ win: true, deaths: 2 })),
      ...Array.from({ length: 3 }, () => game({ win: false, deaths: 8 })),
    ]
    const split = winLossSplit(games)!
    const deaths = split.find((m) => m.key === 'deaths')!
    expect(deaths.wins).toBe(2)
    expect(deaths.losses).toBe(8)
    expect(biggestLever(split)?.key).toBe('deaths')
  })

  it('never picks a metric that is better in losses', () => {
    const games = [
      ...Array.from({ length: 3 }, () => game({ win: true, deaths: 6, cs: 200 })),
      ...Array.from({ length: 3 }, () => game({ win: false, deaths: 4, cs: 200 })),
    ]
    expect(biggestLever(winLossSplit(games))?.key).not.toBe('deaths')
  })
})

describe('buckets', () => {
  it('splits by game length', () => {
    const b = winrateByDuration([game({ duration: 20 * 60 }), game({ duration: 30 * 60 }), game({ duration: 40 * 60, win: false })])
    expect(b.map((x) => x.games)).toEqual([1, 1, 1])
    expect(b[2].winrate).toBe(0)
    expect(b.every((x) => !x.enough)).toBe(true)
  })

  it('splits by local daypart', () => {
    const b = winrateByDaypart([
      game({ at: new Date(2026, 10, 1, 9).toISOString() }),
      game({ at: new Date(2026, 10, 1, 23).toISOString() }),
      game({ at: new Date(2026, 10, 1, 3).toISOString() }),
    ])
    expect(Object.fromEntries(b.map((x) => [x.key, x.games]))).toEqual({ morning: 1, afternoon: 0, evening: 1, night: 1 })
  })
})

describe('tiltReport', () => {
  it('pairs back-to-back games and tracks the longest loss streak', () => {
    const t0 = new Date(2026, 10, 1, 18, 0).getTime()
    const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString()
    const r = tiltReport([
      game({ at: at(0), win: false }),
      game({ at: at(35), win: false }), // after loss → loss
      game({ at: at(70), win: true }), // after loss → win
      game({ at: at(105), win: true }), // after win → win
      game({ at: at(60 * 24), win: false }), // next day: not paired
    ])
    expect(r.afterLoss.games).toBe(2)
    expect(r.afterLoss.winrate).toBe(50)
    expect(r.afterWin.games).toBe(1)
    expect(r.longestLossStreak).toBe(2)
  })
})

describe('championLabel', () => {
  it('maps Data Dragon ids to display names', async () => {
    const { championLabel } = await import('../../src/lib/statsInsights')
    expect(championLabel('MonkeyKing')).toBe('Wukong')
    expect(championLabel('LeeSin')).toBe('Lee Sin')
    expect(championLabel('Khazix')).toBe("Kha'Zix")
    expect(championLabel('Ahri')).toBe('Ahri')
  })
})
