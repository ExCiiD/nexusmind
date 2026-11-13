import { describe, it, expect } from 'vitest'
import { pickPriorityGame, CLOSE_LOSS_GOLD, SEVERE_MISTAKE_COUNT } from '../../electron/main/assistant/reviewPriority'
import { computeGameFeatures, type GameFeatures, type GameRecord, type MistakeRecord } from '../../electron/main/assistant/features'

let seq = 0
const mk = (over: Partial<GameRecord> = {}): GameFeatures => {
  seq++
  return computeGameFeatures({
    id: `g${seq}`, matchId: `m${seq}`, sessionId: 's1', endedAt: Date.now() - seq * 1000,
    durationSec: 1800, win: true, kills: 4, deaths: 4, assists: 6, cs: 180, visionScore: 20,
    role: 'MIDDLE', champion: 'Ahri', objectiveIds: ['tempo'], reviewed: false,
    ...over,
  })
}
const severeMistake = (over: Partial<MistakeRecord> = {}): MistakeRecord => ({ id: `mk${Math.random()}`, tagSlug: 'bad-positioning', gameTimeSec: 900, severity: 3, ...over })

describe('pickPriorityGame', () => {
  it('returns null with no candidates', () => {
    expect(pickPriorityGame([])).toBeNull()
  })

  it('close loss (|final gold diff| < 3k) beats everything else', () => {
    const closeLoss = mk({ win: false, finalGoldDiff: -(CLOSE_LOSS_GOLD - 1) })
    const severe = mk({ mistakes: [severeMistake(), severeMistake()] })
    expect(pickPriorityGame([severe, closeLoss])).toEqual({ gameId: closeLoss.gameId, reason: 'close_loss' })
  })

  it('a loss with a known but large gold diff is not a "close loss"', () => {
    const notClose = mk({ win: false, finalGoldDiff: -(CLOSE_LOSS_GOLD + 500) })
    const severe = mk({ mistakes: [severeMistake(), severeMistake()] })
    expect(pickPriorityGame([notClose, severe])).toEqual({ gameId: severe.gameId, reason: 'severe_mistakes' })
  })

  it(`${SEVERE_MISTAKE_COUNT}+ severity-3 mistakes beats deviation and recency`, () => {
    const severe = mk({ mistakes: Array.from({ length: SEVERE_MISTAKE_COUNT }, () => severeMistake()) })
    const oneSevere = mk({ mistakes: [severeMistake()] }) // below the threshold
    expect(pickPriorityGame([oneSevere, severe])).toEqual({ gameId: severe.gameId, reason: 'severe_mistakes' })
  })

  it('falls back to the largest deviation from the personal perfIndex baseline', () => {
    const normal = Array.from({ length: 4 }, () => mk({ win: true, deaths: 2 }))
    const outlier = mk({ win: false, deaths: 10 })
    for (const g of [...normal, outlier]) g.values.perfIndex = g.gameId === outlier.gameId ? 10 : 50
    const priority = pickPriorityGame([outlier, ...normal.slice(0, 1)], [...normal, outlier])
    expect(priority).toEqual({ gameId: outlier.gameId, reason: 'deviation' })
  })

  it('falls back to the most recent game when nothing else applies', () => {
    const older = mk({ endedAt: 1000 })
    const newer = mk({ endedAt: 5000 })
    expect(pickPriorityGame([older, newer])).toEqual({ gameId: newer.gameId, reason: 'recency' })
  })

  it('ignores a close loss with no known gold diff (never fabricates a signal)', () => {
    const lossUnknownGold = mk({ win: false, finalGoldDiff: null, endedAt: 1000 })
    const newer = mk({ win: false, finalGoldDiff: null, endedAt: 5000 })
    expect(pickPriorityGame([lossUnknownGold, newer])).toEqual({ gameId: newer.gameId, reason: 'recency' })
  })
})
