import { describe, it, expect } from 'vitest'
import {
  LOW_ENERGY_CODEX_ID, LOW_ENERGY_LOSS_STREAK, LOW_ENERGY_WINRATE,
  gameLowEnergy, lowEnergyActivation, lowEnergySignal, protocolActive, riskyDayparts, sittingLossStreak, trailingLosses, underLowEnergyWinrate,
} from '../../src/lib/microReview/lowEnergy'
import { codexById } from '../../src/lib/microReview/codex'
import { daypartOf, winrateByDaypart, MIN_SAMPLE, SAME_SESSION_MS, type InsightGame } from '../../src/lib/statsInsights'

let n = 0
/** A game that ENDED at local time (day, hour:minute) — local constructor, so the tests do not depend on the machine's time zone. */
function game(day: number, hour: number, win: boolean, minute = 0, durationMin = 30): InsightGame {
  n++
  return {
    matchId: `m${n}`, champion: 'Ahri', kills: 3, deaths: 3, assists: 3, cs: 180, visionScore: 20,
    duration: durationMin * 60, win, gameEndAt: new Date(2026, 10, day, hour, minute).toISOString(),
  }
}
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)
const NL = String.fromCharCode(10)

describe('thresholds (spec)', () => {
  it('2 consecutive losses, win rate strictly under 45 %', () => {
    expect(LOW_ENERGY_LOSS_STREAK).toBe(2)
    expect(LOW_ENERGY_WINRATE).toBe(45)
  })
  it('uses the same dayparts as the "Selon l\'heure" panel', () => {
    expect(daypartOf(at(1, 0))).toBe('night')
    expect(daypartOf(at(1, 5, 59))).toBe('night')
    expect(daypartOf(at(1, 6))).toBe('morning')
    expect(daypartOf(at(1, 11, 59))).toBe('morning')
    expect(daypartOf(at(1, 12))).toBe('afternoon')
    expect(daypartOf(at(1, 17, 59))).toBe('afternoon')
    expect(daypartOf(at(1, 18))).toBe('evening')
    expect(daypartOf(at(1, 23, 59))).toBe('evening')
  })
})

describe('trailingLosses', () => {
  it('counts the losses at the end of a session', () => {
    expect(trailingLosses([])).toBe(0)
    expect(trailingLosses([true])).toBe(0)
    expect(trailingLosses([true, false])).toBe(1)
    expect(trailingLosses([false, true, false, false])).toBe(2)
    expect(trailingLosses([false, false, false])).toBe(3)
  })
})

describe('riskyDayparts', () => {
  it('flags a daypart under 45 % with at least MIN_SAMPLE games', () => {
    // Evening: 4 wins / 9 = 44 % → risky. Afternoon: 9 / 20 = 45 % → not risky (strict). Night: 0 / 2 → not enough games.
    const history = [
      ...Array.from({ length: 9 }, (_, i) => game(1 + i, 21, i < 4)),
      ...Array.from({ length: 20 }, (_, i) => game(1 + (i % 20), 14, i < 9)),
      game(2, 2, false), game(3, 2, false),
    ]
    const buckets = winrateByDaypart(history)
    expect(buckets.find((b) => b.key === 'evening')).toMatchObject({ games: 9, wins: 4, winrate: 44 })
    expect(buckets.find((b) => b.key === 'afternoon')).toMatchObject({ games: 20, wins: 9, winrate: 45 })
    expect(MIN_SAMPLE).toBe(3)
    expect(riskyDayparts(history)).toEqual([{ key: 'evening', games: 9, winrate: 44 }])
  })
  it('compares the exact ratio with 45 %, not the rounded percentage of the panel', () => {
    expect(underLowEnergyWinrate(9, 20)).toBe(false) // exactly 45 %
    expect(underLowEnergyWinrate(13, 29)).toBe(true) // 44.83 %, shown as "45 %" by the panel
    expect(underLowEnergyWinrate(0, 0)).toBe(false)
    // 13 wins in 29 evening games: the panel rounds to 45, the slot is still under the threshold — and is shown as 44, never as "45 % < 45 %".
    const history = Array.from({ length: 29 }, (_, i) => game(1 + (i % 28), 21, i < 13))
    expect(winrateByDaypart(history).find((b) => b.key === 'evening')).toMatchObject({ games: 29, wins: 13, winrate: 45 })
    expect(riskyDayparts(history)).toEqual([{ key: 'evening', games: 29, winrate: 44 }])
    const signal = lowEnergySignal({ now: at(29, 21, 30), history, sessionResults: null })
    expect(signal).toMatchObject({ reasons: ['bad-hour'], daypart: 'evening', daypartWinrate: 44, daypartGames: 29 })
  })
})

describe('sittingLossStreak (before a session is launched)', () => {
  it('counts back-to-back losses of a sitting that just ended', () => {
    const history = [game(10, 19, true), game(10, 19, false, 40), game(10, 20, false, 20)]
    expect(sittingLossStreak(history, at(10, 20, 45))).toBe(2)
  })
  it('is 0 when the last game ended more than 90 minutes ago', () => {
    const history = [game(10, 19, false), game(10, 19, false, 40)]
    expect(SAME_SESSION_MS).toBe(90 * 60 * 1000)
    expect(sittingLossStreak(history, at(10, 21, 10))).toBe(2) // exactly 90 min: still warm
    expect(sittingLossStreak(history, at(10, 21, 11))).toBe(0)
  })
  it('stops at a win and at a gap between sittings', () => {
    // 15:00 loss, then 19:30 and 20:10 losses: the 15:00 game is another sitting.
    const split = [game(10, 15, false), game(10, 19, false, 30), game(10, 20, false, 10)]
    expect(sittingLossStreak(split, at(10, 20, 30))).toBe(2)
    const win = [game(10, 19, true, 30), game(10, 20, false, 10)]
    expect(sittingLossStreak(win, at(10, 20, 30))).toBe(1)
    expect(sittingLossStreak([], at(10, 20))).toBe(0)
  })
})

describe('lowEnergySignal', () => {
  const calm = Array.from({ length: 10 }, (_, i) => game(1 + i, 21, i % 2 === 0)) // evening 50 %

  it('is quiet with one loss and a healthy daypart', () => {
    const s = lowEnergySignal({ now: at(12, 21), history: calm, sessionResults: [true, false] })
    expect(s).toMatchObject({ active: false, reasons: [], lossStreak: 1, daypart: 'evening', daypartWinrate: 50, daypartGames: 10 })
  })
  it('raises on 2 consecutive losses in the running session', () => {
    const s = lowEnergySignal({ now: at(12, 21), history: calm, sessionResults: [true, false, false] })
    expect(s).toMatchObject({ active: true, reasons: ['loss-streak'], lossStreak: 2 })
  })
  it('raises when the current daypart is under 45 %', () => {
    const history = [...Array.from({ length: 9 }, (_, i) => game(1 + i, 21, i < 4)), ...Array.from({ length: 6 }, (_, i) => game(1 + i, 14, true))]
    expect(lowEnergySignal({ now: at(12, 22), history, sessionResults: null })).toMatchObject({ active: true, reasons: ['bad-hour'], daypart: 'evening', daypartWinrate: 44 })
    // Same history, in the afternoon (100 %): nothing.
    expect(lowEnergySignal({ now: at(12, 15), history, sessionResults: null }).active).toBe(false)
  })
  it('does not judge a daypart without enough games', () => {
    const s = lowEnergySignal({ now: at(12, 3), history: [game(1, 2, false), game(2, 2, false)], sessionResults: null })
    expect(s).toMatchObject({ active: false, daypart: 'night', daypartWinrate: null, daypartGames: 2 })
  })
  it('before a session, falls back on the sitting that just ended', () => {
    const history = [...calm, game(12, 19, false, 40), game(12, 20, false, 20)]
    expect(lowEnergySignal({ now: at(12, 20, 40), history, sessionResults: null })).toMatchObject({ active: true, lossStreak: 2 })
    // A running session with no game yet behaves the same.
    expect(lowEnergySignal({ now: at(12, 20, 40), history, sessionResults: [] }).reasons).toContain('loss-streak')
  })
  it('can raise both reasons at once', () => {
    const history = Array.from({ length: 9 }, (_, i) => game(1 + i, 21, i < 4))
    expect(lowEnergySignal({ now: at(12, 21), history, sessionResults: [false, false] }).reasons).toEqual(['loss-streak', 'bad-hour'])
  })
})

describe('gameLowEnergy (micro-review context of a finished game)', () => {
  it('flags the third game after two losses, a night game, and a weak daypart', () => {
    expect(gameLowEnergy({ gameEndAt: at(12, 15), resultsBefore: [true, false, false], history: [] })).toEqual({ active: true, reasons: ['loss-streak'] })
    expect(gameLowEnergy({ gameEndAt: at(12, 2), resultsBefore: [], history: [] })).toEqual({ active: true, reasons: ['late-night'] })
    const weakEvening = Array.from({ length: 9 }, (_, i) => game(1 + i, 21, i < 4))
    expect(gameLowEnergy({ gameEndAt: at(12, 21).toISOString(), resultsBefore: [true], history: weakEvening })).toEqual({ active: true, reasons: ['bad-hour'] })
  })
  it('is quiet for an ordinary afternoon game', () => {
    expect(gameLowEnergy({ gameEndAt: at(12, 15), resultsBefore: [false, true], history: [] })).toEqual({ active: false, reasons: [] })
  })
})

describe('lowEnergyActivation — protocol as the session objective', () => {
  const name = 'Protocole basse énergie'
  const kpis = ['k1', 'k2']
  const entry = codexById(LOW_ENERGY_CODEX_ID)!

  it('targets the resilience fundamental with the protocol note', () => {
    expect(entry.fundamentalId).toBe('resilience')
    const a = lowEnergyActivation({ name, lang: 'fr', protocolKpiIds: kpis })!
    expect(a.objectiveIds).toEqual(['resilience'])
    expect(a.selectedKpiIds).toEqual([])
    expect(a.customNote).toBe(`${name} — ${entry.drillObjective.fr}`)
    expect(a.codexId).toBe(LOW_ENERGY_CODEX_ID)
  })
  it('keeps the running session objectives (3 max) and extends an explicit KPI selection', () => {
    const a = lowEnergyActivation({ name, lang: 'fr', protocolKpiIds: kpis, current: { objectiveIds: ['wave_management', 'vision_control', 'tempo'], selectedKpiIds: ['a', 'k1'], customNote: 'Slow push avant chaque back' } })!
    expect(a.objectiveIds).toEqual(['resilience', 'wave_management', 'vision_control'])
    expect(a.selectedKpiIds).toEqual(['a', 'k1', 'k2'])
    expect(a.customNote.split('\n')).toEqual([`${name} — ${entry.drillObjective.fr}`, 'Slow push avant chaque back'])
  })
  it('leaves an empty KPI selection empty (= all KPIs) and is idempotent', () => {
    const first = lowEnergyActivation({ name, lang: 'en', protocolKpiIds: kpis, current: { objectiveIds: ['tempo'], selectedKpiIds: [], customNote: null } })!
    expect(first.selectedKpiIds).toEqual([])
    const again = lowEnergyActivation({ name, lang: 'en', protocolKpiIds: kpis, current: first })!
    expect(again.objectiveIds).toEqual(['resilience', 'tempo'])
    expect(again.customNote).toBe(first.customNote)
  })
  it("never drops the player's own note, however often the protocol is activated", () => {
    const line = `${name} — ${entry.drillObjective.fr}`
    const mine = 'Ma note perso'
    const withNote = lowEnergyActivation({ name, lang: 'fr', protocolKpiIds: kpis, current: { objectiveIds: ['tempo'], selectedKpiIds: [], customNote: mine } })!
    expect(withNote.customNote.split(NL)).toEqual([line, mine])
    // The player then put another objective first: the protocol is not "active" any more, the note still holds both lines.
    const moved = { objectiveIds: ['tempo', 'resilience'], selectedKpiIds: [], customNote: withNote.customNote }
    expect(protocolActive(moved, name)).toBe(false)
    const again = lowEnergyActivation({ name, lang: 'fr', protocolKpiIds: kpis, current: moved })!
    expect(again.objectiveIds).toEqual(['resilience', 'tempo'])
    expect(again.customNote.split(NL)).toEqual([line, mine])
    expect(protocolActive(again, name)).toBe(true)
  })
  it('recognises a session already running the protocol', () => {
    const a = lowEnergyActivation({ name, lang: 'fr', protocolKpiIds: kpis, current: { objectiveIds: ['tempo'], selectedKpiIds: [] } })!
    expect(protocolActive(a, name)).toBe(true)
    expect(protocolActive({ objectiveIds: ['tempo'], customNote: null }, name)).toBe(false)
    expect(protocolActive({ objectiveIds: ['resilience'], customNote: 'autre chose' }, name)).toBe(false)
    expect(protocolActive(null, name)).toBe(false)
  })
})
