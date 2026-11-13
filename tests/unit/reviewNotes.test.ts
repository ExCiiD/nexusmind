import { describe, it, expect } from 'vitest'
import { buildPrefilledNotes, MAX_NOTES, type MistakeForNotes } from '../../electron/main/reviewNotes'
import type { GameEvent } from '../../electron/main/eventExtractor'

const ev = (over: Partial<GameEvent>): GameEvent => ({ type: 'kill', gameTimeMs: 0, label: '', isPlayer: false, ...over })
const mistake = (over: Partial<MistakeForNotes> = {}): MistakeForNotes => ({ tagSlug: 'unused-gold', tagLabel: 'Unused gold', gameTimeSec: 900, severity: 3, ...over })

describe('buildPrefilledNotes', () => {
  it('includes the player\'s own deaths with a readable timestamp', () => {
    const notes = buildPrefilledNotes([ev({ type: 'death', gameTimeMs: 185_000, isPlayer: true, label: 'Death — killed by Zed', teamId: 100 })])
    expect(notes).toEqual([{ time: '3:05', note: 'Death — killed by Zed', auto: true }])
  })

  it('labels objectives taken vs lost from the player\'s own team', () => {
    const events = [
      ev({ type: 'death', gameTimeMs: 0, isPlayer: true, teamId: 100, label: 'Death' }), // establishes player's team = 100
      ev({ type: 'dragon', gameTimeMs: 600_000, teamId: 100, label: 'Drake (Infernal)' }),
      ev({ type: 'baron', gameTimeMs: 1_500_000, teamId: 200, label: 'Baron' }),
    ]
    const notes = buildPrefilledNotes(events)
    expect(notes.map((n) => n.note)).toEqual([
      'Death',
      'Objective taken: Drake (Infernal)',
      'Objective lost: Baron',
    ])
  })

  it('a turret killed by the enemy is "lost"; one killed by the player\'s team is not noted as lost', () => {
    const events = [
      ev({ type: 'death', gameTimeMs: 0, isPlayer: true, teamId: 100, label: 'Death' }), // player's team = 100
      ev({ type: 'turret', gameTimeMs: 400_000, teamId: 200, label: 'Turret (outer top)' }), // enemy destroyed OUR turret
      ev({ type: 'turret', gameTimeMs: 500_000, teamId: 100, label: 'Turret (outer bot)' }), // we destroyed THEIR turret
    ]
    const notes = buildPrefilledNotes(events)
    expect(notes.some((n) => n.note === 'Turret lost: Turret (outer top)')).toBe(true)
    expect(notes.some((n) => n.note.includes('outer bot'))).toBe(false)
  })

  it('collapses 2+ close player kills into one multi-kill note, but not kills far apart', () => {
    const close = buildPrefilledNotes([
      ev({ type: 'kill', gameTimeMs: 100_000, isPlayer: true, label: 'Kill' }),
      ev({ type: 'kill', gameTimeMs: 105_000, isPlayer: true, label: 'Kill' }),
      ev({ type: 'kill', gameTimeMs: 108_000, isPlayer: true, label: 'Kill' }),
    ])
    expect(close).toEqual([{ time: '1:40', note: '3-kill', auto: true }])

    const far = buildPrefilledNotes([
      ev({ type: 'kill', gameTimeMs: 100_000, isPlayer: true, label: 'Kill' }),
      ev({ type: 'kill', gameTimeMs: 200_000, isPlayer: true, label: 'Kill' }),
    ])
    expect(far).toEqual([])
  })

  it('does not note enemy kills or assists as multi-kills', () => {
    expect(buildPrefilledNotes([ev({ type: 'kill', gameTimeMs: 0, isPlayer: false, label: 'Zed → Ahri' })])).toEqual([])
    expect(buildPrefilledNotes([ev({ type: 'assist', gameTimeMs: 0, isPlayer: true, label: 'Assist' })])).toEqual([])
  })

  it('only includes severity-3 mistakes, not lower severities', () => {
    const notes = buildPrefilledNotes([], [mistake({ severity: 3, gameTimeSec: 900 }), mistake({ severity: 2, gameTimeSec: 1000, tagLabel: 'Minor' })])
    expect(notes).toEqual([{ time: '15:00', note: 'Mistake: Unused gold', auto: true }])
  })

  it('sorts everything by time and caps at MAX_NOTES', () => {
    const events = Array.from({ length: MAX_NOTES + 5 }, (_, i) =>
      ev({ type: 'death', gameTimeMs: (MAX_NOTES + 5 - i) * 10_000, isPlayer: true, teamId: 100, label: `Death ${i}` }))
    const notes = buildPrefilledNotes(events)
    expect(notes).toHaveLength(MAX_NOTES)
    const times = notes.map((n) => n.time)
    expect(times).toEqual([...times].sort((a, b) => {
      const [am, as] = a.split(':').map(Number)
      const [bm, bs] = b.split(':').map(Number)
      return am * 60 + as - (bm * 60 + bs)
    }))
  })

  it('returns nothing for an empty game', () => {
    expect(buildPrefilledNotes([])).toEqual([])
  })

  it('never marks an objective without a resolved player team', () => {
    // No kill/death/assist event for the player at all → myTeam unknown.
    const notes = buildPrefilledNotes([ev({ type: 'dragon', gameTimeMs: 100_000, teamId: 100, label: 'Drake' })])
    expect(notes).toEqual([])
  })
})
