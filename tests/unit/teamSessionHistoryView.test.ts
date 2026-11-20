import { describe, it, expect } from 'vitest'
import {
  formatClock, formatPlayed, groupByWeek, orderForGame, parseGameParam, parseTranscript, searchTranscript, selectGame, stampOf, summaryLines, weekStart,
} from '../../src/lib/teamSessionHistoryView'
import type { TeamSessionHistoryDetail } from '../../src/lib/teamSessionHistory'

// docs/DESIGN_STATE.md § 15: the team sessions history.
describe('the list', () => {
  it('weeks start on Monday; rows grouped newest week first', () => {
    expect(weekStart(new Date(2026, 10, 22, 21)).getDate()).toBe(16) // Sunday 22 Nov 2026 → Monday 16
    const now = new Date(2026, 10, 20, 12)
    const groups = groupByWeek([
      { startsAt: new Date(2026, 10, 20, 20).toISOString() },
      { startsAt: new Date(2026, 10, 18, 20).toISOString() },
      { startsAt: new Date(2026, 10, 12, 20).toISOString() },
    ], now)
    expect(groups.map((g) => [g.start.getDate(), g.end.getDate(), g.weeksAgo, g.rows.length])).toEqual([[16, 22, 0, 2], [9, 15, 1, 1]])
  })
  it('played time and game clock', () => {
    expect(formatPlayed(94 * 60)).toBe('1 h 34')
    expect(formatPlayed(48 * 60)).toBe('48 min')
    expect(formatPlayed(0)).toBeNull()
    expect(formatClock(32 * 60 + 4)).toBe('32:04')
    expect(formatClock(null)).toBeNull()
  })
})

const game = (index: number, stats: 'ready' | 'error') => ({
  gameId: `g${index}`, index, matchId: `m${index}`, stats, win: stats === 'ready' ? true : null, durationSec: 1800, enemyTeamName: null,
  team: stats === 'ready' ? { our: { kills: 20, deaths: 10, assists: 40, gold: 60000, damage: 90000, vision: 120 }, enemy: { kills: 10, deaths: 20, assists: 15, gold: 52000, damage: 70000, vision: 90 }, avgDurationSec: 1800, goldDiffAt15: 1500 } : null,
  players: [], enemyPlayers: [], duels: [], timeline: null,
})

describe('the session page', () => {
  const detail = {
    header: { sessionId: 's', calendarEventId: 'e', kind: 'scrim', title: 'vs KCA', opponent: 'KCA', startsAt: '', endsAt: '', format: 'bo3', wins: 2, losses: 1, responsibleUserIds: [], status: 'ended' },
    games: [game(1, 'ready'), game(2, 'error')],
    whole: { gamesCounted: 1, team: game(1, 'ready').team!, players: [], enemyPlayers: [], duels: [] },
    objectives: [{ objectiveId: 'wave', kpiIds: [], session: null, byGame: {}, held: true }],
  } as unknown as TeamSessionHistoryDetail
  it('?game= picks a game of the session, else the whole session', () => {
    expect(parseGameParam('2', detail.games)).toBe(2)
    expect(parseGameParam('7', detail.games)).toBeNull()
    expect(parseGameParam(null, detail.games)).toBeNull()
  })
  it('a game without stats shows nothing; the whole session its combined numbers', () => {
    expect(selectGame(detail, 2)).toMatchObject({ team: null, counted: 0 })
    expect(selectGame(detail, 1).counted).toBe(1)
    expect(selectGame(detail, null)).toMatchObject({ game: null, counted: 1 })
  })
  it('the picked game’s notes first, then the session’s', () => {
    expect(orderForGame([{ gameId: 'g1' }, { gameId: null }, { gameId: 'g2' }], 'g2').map((x) => x.gameId)).toEqual(['g2', null, 'g1'])
  })
  it('the exported summary', () => {
    const lines = summaryLines(detail, {
      date: 'Thu 20 Nov', kind: 'Scrim', game: (g) => `G${g.index}`, objective: (id) => id, held: (h) => (h ? 'met' : '—'), team: 'Team',
    })
    expect(lines).toEqual(['vs KCA — Scrim · BO3', 'Thu 20 Nov', '2 – 1', '', 'G1', 'G2', '', 'Team: 20/10/40 vs 10/20/15 · Gold @15 +1500', '', '- wave : met'])
  })
})

describe('meeting transcript', () => {
  it('timestamped lines become blocks with their time; others keep none', () => {
    expect(parseTranscript('[0:05] Bonjour\n\n[12:40] On reprend le drake\nsans horodatage\n[1:02:05] fin')).toEqual([
      { atSec: 5, text: 'Bonjour' }, { atSec: 760, text: 'On reprend le drake' }, { atSec: null, text: 'sans horodatage' }, { atSec: 3725, text: 'fin' },
    ])
    expect(stampOf(760)).toBe('12:40')
    expect(stampOf(3725)).toBe('1:02:05')
  })
  it('search ignores case and accents, and finds every occurrence in order', () => {
    const blocks = parseTranscript('[0:10] Le Drake est pris\n[0:40] drake, encore le DRAKE\n[1:00] Récupérer la vision')
    expect(searchTranscript(blocks, 'drake')).toEqual([{ block: 0, start: 3, end: 8 }, { block: 1, start: 0, end: 5 }, { block: 1, start: 17, end: 22 }])
    expect(searchTranscript(blocks, 'recuperer')).toEqual([{ block: 2, start: 0, end: 9 }])
    expect(searchTranscript(blocks, '  ')).toEqual([])
  })
})
