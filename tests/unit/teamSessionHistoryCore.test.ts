import { describe, it, expect } from 'vitest'
import {
  buildHistoryGame, buildObjectives, buildWholeSession, countObjectives, getTeamSessionHistoryDetail, listTeamSessionHistory, meetingConcerned, meetingPeople,
  mergePlayerStats, objectiveHeld, ourWinOf, periodStartMs, seesAllSessions, sessionKindOf, setObjectiveResult, summarizeHistory,
} from '../../src/lib/teamSessionHistoryCore'
import type { TeamSessionHistoryRow } from '../../src/lib/teamSessionHistory'

// ── Fixtures ─────────────────────────────────────────────────────────────
const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const NAMES = ['Kaito', 'Nyra', 'Orel', 'Vex', 'Mira']
function match(o: { ourWin?: boolean; duration?: number; ourKills?: number; queueId?: number; start?: number } = {}) {
  const ourWin = o.ourWin ?? true
  const participants = [100, 200].flatMap((teamId) => ROLES.map((pos, i) => ({
    puuid: `${teamId}-${i}`, teamId, teamPosition: pos, championName: `Champ${i}`,
    kills: teamId === 100 ? (o.ourKills ?? 2) : 1, deaths: teamId === 100 ? 1 : 2, assists: 3, win: teamId === 100 ? ourWin : !ourWin,
    totalMinionsKilled: 180, neutralMinionsKilled: 0, totalDamageDealtToChampions: 15000, goldEarned: 10000, visionScore: 20,
    riotIdGameName: teamId === 100 ? NAMES[i] : `Enemy${i}`,
  })))
  return { info: { gameDuration: o.duration ?? 1800, queueId: o.queueId ?? 0, gameStartTimestamp: o.start ?? 1_700_000_000_000, participants, teams: [{ teamId: 100, win: ourWin }, { teamId: 200, win: !ourWin }] } }
}
const MEMBERS = NAMES.map((n, i) => ({ userId: `u${i}`, riotId: `${n}#EUW`, displayName: n }))
const timeline = (gold15: number) => ({ version: 1, gameId: 'g', matchId: 'm', playedAt: '', durationSec: 1800, source: 'scrim', side: 'blue', win: true, opponentName: null, patch: '16.22', grubsAvailable: 3, events: [], goldDiffByMinute: Array.from({ length: 31 }, (_, m) => (m === 15 ? gold15 : 0)) })
const game = (id: string, o: Parameters<typeof match>[0] & { json?: unknown; ourTeamId?: 100 | 200 | null; status?: 'pending_fetch' | 'fetched' | 'error'; tl?: unknown } = {}) => ({
  id, matchId: `EUW1_${id}`, status: o.status ?? 'fetched', matchJson: 'json' in o ? o.json : match(o), ourTeamId: o.ourTeamId === undefined ? 100 : o.ourTeamId,
  enemyTeamName: 'Aegis', timelineSummary: o.tl ?? null,
})

describe('the session kind', () => {
  it('is the calendar slot\'s, else the games\' queue, else other', () => {
    expect(sessionKindOf('scrim', [440])).toBe('scrim')
    expect(sessionKindOf('flex', [])).toBe('flex')
    expect(sessionKindOf('tournament', [])).toBe('tournament')
    expect(sessionKindOf('team_review', [700])).toBe('tournament')
    expect(sessionKindOf(null, [0, 440])).toBe('flex')
    expect(sessionKindOf('meeting', [0])).toBe('meeting')
    expect(sessionKindOf('rest', [0])).toBe('other')
  })
})

describe('the period', () => {
  const now = Date.UTC(2026, 10, 20, 12)
  it('30 days back, the season from 1 January, or everything', () => {
    expect(periodStartMs('30d', now)).toBe(now - 30 * 86_400_000)
    expect(periodStartMs('season', now)).toBe(Date.UTC(2026, 0, 1))
    expect(periodStartMs('all', now)).toBe(-Infinity)
  })
})

describe('our result', () => {
  it('from info.teams, else the participants, null without our side', () => {
    expect(ourWinOf([{ teamId: 100, win: false }, { teamId: 200, win: true }], 100)).toBe(false)
    expect(ourWinOf(null, 200, [{ teamId: 200, win: true }])).toBe(true)
    expect(ourWinOf([{ teamId: 100, win: true }], null)).toBeNull()
    expect(ourWinOf(undefined, 100)).toBeNull()
  })
})

describe('an objective held', () => {
  it('the session verdict first, else more than half of the games judged, else unknown', () => {
    expect(objectiveHeld(false, { a: true, b: true })).toBe(false)
    expect(objectiveHeld(null, { a: true, b: true, c: false })).toBe(true)
    expect(objectiveHeld(null, { a: true, b: false })).toBe(false)
    expect(objectiveHeld(null, {})).toBeNull()
  })
  it('builds and counts the session\'s objectives', () => {
    const objectives = buildObjectives(['vision', 'tempo', 'waves'], [
      { objectiveId: 'vision', gameId: 'g1', met: true }, { objectiveId: 'vision', gameId: 'g2', met: true },
      { objectiveId: 'tempo', gameId: null, met: false },
      { objectiveId: 'other', gameId: null, met: true },
    ])
    expect(objectives).toEqual([
      { objectiveId: 'vision', session: null, byGame: { g1: true, g2: true }, held: true },
      { objectiveId: 'tempo', session: false, byGame: {}, held: false },
      { objectiveId: 'waves', session: null, byGame: {}, held: null },
    ])
    expect(countObjectives(objectives)).toEqual({ total: 3, held: 1, judged: 2 })
  })
})

describe('who sees every session', () => {
  it('the staff and the captain; a player only theirs', () => {
    expect(seesAllSessions('owner', false)).toBe(true)
    expect(seesAllSessions('analyst', false)).toBe(true)
    expect(seesAllSessions('player', true)).toBe(true)
    expect(seesAllSessions('player', false, ['coach'])).toBe(true)
    expect(seesAllSessions('player', false)).toBe(false)
  })
})

describe('one game of the page', () => {
  it('our five matched to the members, the opponents, the duels and the team totals', () => {
    const g = buildHistoryGame(game('g1', { ourKills: 4, tl: timeline(1200) }), 1, MEMBERS)
    expect(g).toMatchObject({ gameId: 'g1', index: 1, stats: 'ready', win: true, durationSec: 1800, enemyTeamName: 'Aegis' })
    expect(g.players.map((p) => p.memberId)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4'])
    expect(g.enemyPlayers.map((p) => p.memberId)).toEqual(['Enemy0', 'Enemy1', 'Enemy2', 'Enemy3', 'Enemy4'])
    expect(g.duels.map((d) => [d.role, d.our?.memberId, d.enemy?.memberId])).toEqual([
      ['TOP', 'u0', 'Enemy0'], ['JUNGLE', 'u1', 'Enemy1'], ['MID', 'u2', 'Enemy2'], ['ADC', 'u3', 'Enemy3'], ['SUPPORT', 'u4', 'Enemy4'],
    ])
    expect(g.team).toEqual({
      our: { kills: 20, deaths: 5, assists: 15, gold: 50000, damage: 75000, vision: 100 },
      enemy: { kills: 5, deaths: 10, assists: 15, gold: 50000, damage: 75000, vision: 100 },
      avgDurationSec: 1800, goldDiffAt15: 1200,
    })
    expect(g.players[0].averages.csPerMin).toBe(6)
  })
  it('resolves our side from the Riot IDs when it is not stored yet', () => {
    expect(buildHistoryGame(game('g1', { ourTeamId: null }), 1, MEMBERS)).toMatchObject({ stats: 'ready', win: true })
    expect(buildHistoryGame(game('g1', { ourTeamId: null }), 1, [])).toMatchObject({ stats: 'no-side', durationSec: 1800, players: [] })
  })
  it('a game without its match: not fetched, or an error at Riot; no timeline cached is null', () => {
    expect(buildHistoryGame(game('g1', { json: null, status: 'pending_fetch' }), 2, MEMBERS)).toMatchObject({ stats: 'not-fetched', win: null, timeline: null, team: null })
    expect(buildHistoryGame(game('g1', { json: null, status: 'error' }), 2, MEMBERS)).toMatchObject({ stats: 'error' })
    expect(buildHistoryGame(game('g1'), 1, MEMBERS).team!.goldDiffAt15).toBeNull()
  })
})

describe('the whole session', () => {
  it('adds the ready games, averages the players per game and pairs the duels', () => {
    const games = [
      buildHistoryGame(game('g1', { ourWin: true, duration: 1800, ourKills: 2, tl: timeline(1000) }), 1, MEMBERS),
      buildHistoryGame(game('g2', { ourWin: false, duration: 2400, ourKills: 4, tl: timeline(-600) }), 2, MEMBERS),
      buildHistoryGame(game('g3', { json: null, status: 'pending_fetch' }), 3, MEMBERS),
    ]
    const whole = buildWholeSession(games)!
    expect(whole.gamesCounted).toBe(2)
    expect(whole.team).toMatchObject({ avgDurationSec: 2100, goldDiffAt15: 200 })
    expect(whole.team.our.kills).toBe(30)
    const top = whole.players.find((p) => p.memberId === 'u0')!
    expect(top).toMatchObject({ gamesPlayed: 2, wins: 1, winRate: 50, role: 'TOP' })
    expect(top.averages.kills).toBe(3)
    // KDA over both games: (2 + 4 kills + 6 assists) / 2 deaths.
    expect(top.averages.kda).toBe(6)
    expect(whole.enemyPlayers.map((p) => p.memberId)).toEqual(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'])
    expect(whole.duels[0]).toMatchObject({ role: 'TOP', our: { memberId: 'u0' }, enemy: { memberId: 'TOP' } })
  })
  it('null without a ready game', () => {
    expect(buildWholeSession([])).toBeNull()
    expect(buildWholeSession([buildHistoryGame(game('g', { json: null }), 1, MEMBERS)])).toBeNull()
  })
  it('a player who changed champion keeps one row, with both champions', () => {
    const a = buildHistoryGame(game('g1'), 1, MEMBERS).players
    const b = buildHistoryGame(game('g2'), 2, MEMBERS).players.map((p) => ({ ...p, byChampion: [{ championKey: 'Other', games: 1, wins: 1, winRate: 100 }] }))
    const merged = mergePlayerStats([a, b], (p) => p.memberId)
    expect(merged).toHaveLength(5)
    expect(merged[0].byChampion.map((c) => c.championKey).sort()).toEqual(['Champ0', 'Other'])
  })
})

describe('the summary of the list', () => {
  const row = (o: Partial<TeamSessionHistoryRow>): TeamSessionHistoryRow => ({
    sessionId: 's', calendarEventId: 'e', kind: 'scrim', title: '', opponent: null, startsAt: '', endsAt: '', format: null,
    games: [], wins: 0, losses: 0, playedSec: 0, objectives: { total: 0, held: 0, judged: 0 }, hasNotes: false, review: 'none', ...o,
  })
  it('sessions by kind, games, winrate, objectives held, reviews done', () => {
    expect(summarizeHistory([
      row({ kind: 'scrim', games: [{ gameId: 'a', win: true, durationSec: 1 }, { gameId: 'b', win: false, durationSec: 1 }], wins: 1, losses: 1, objectives: { total: 3, held: 2, judged: 3 }, review: 'done' }),
      row({ kind: 'tournament', games: [{ gameId: 'c', win: true, durationSec: 1 }], wins: 1, objectives: { total: 2, held: 0, judged: 0 }, review: 'pending' }),
      row({ kind: 'flex' }),
    ])).toEqual({
      sessions: 3, byKind: { flex: 1, scrim: 1, tournament: 1, meeting: 0, other: 0 }, games: 3, wins: 2, losses: 1, winRate: 66.7,
      objectivesHeld: 2, objectivesTotal: 5, reviewed: 1, withoutReview: 2,
      meetings: { count: 0, averageAttendancePct: null, summariesDone: 0, recordedSec: null },
    })
    expect(summarizeHistory([]).winRate).toBeNull()
  })
})

// ── Reads, on a Supabase stub ────────────────────────────────────────────
type Result = { data: unknown; error: unknown }
/** Answers each table with its rows, filtered by the .eq() / .in() calls made on it. */
/** `missingColumns` ("table.column"): selecting one of them answers 42703, as a database without the migration that adds it. */
function fakeSupabase(tables: Record<string, any[] | { error: unknown }>, rpc?: (name: string, args: unknown) => Result, missingColumns: string[] = []) {
  const calls: Array<[string, string, unknown]> = []
  const sb = {
    from(table: string) {
      const filters: Array<(r: any) => boolean> = []
      let selected = ''
      const run = (): Result => {
        if (missingColumns.some((c) => c.split('.')[0] === table && selected.split(/,\s*/).includes(c.split('.')[1]))) return { data: null, error: { code: '42703', message: 'column does not exist' } }
        const t = tables[table]
        if (!t) return { data: [], error: null }
        if (!Array.isArray(t)) return { data: null, error: t.error }
        return { data: t.filter((r) => filters.every((f) => f(r))), error: null }
      }
      const q: any = {
        select: (cols: string) => { selected = cols; calls.push([table, 'select', cols]); return q },
        eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return q },
        in: (col: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[col])); return q },
        order: () => q,
        not: (col: string, op: string, v: unknown) => { if (op === 'is' && v === null) filters.push((r) => r[col] !== null && r[col] !== undefined); return q },
        maybeSingle: () => { const r = run(); return Promise.resolve({ data: (r.data as any[] | null)?.[0] ?? null, error: r.error }) },
        then: (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return q
    },
    rpc: (name: string, args: unknown) => Promise.resolve(rpc ? rpc(name, args) : { data: null, error: null }),
  }
  return { sb: sb as never, calls }
}

const NOW = Date.UTC(2026, 10, 20, 12)
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString()
function groupTables(o: { role?: string; captain?: boolean; results?: any[] | { error: unknown } } = {}) {
  const sessions = [
    { id: 's1', group_id: 'G', calendar_event_id: 'e1', status: 'ended', started_at: iso(2), ended_at: iso(2), created_at: iso(3) },
    { id: 's2', group_id: 'G', calendar_event_id: 'e2', status: 'ended', started_at: iso(10), ended_at: iso(10), created_at: iso(11) },
    { id: 's3', group_id: 'G', calendar_event_id: 'e3', status: 'ended', started_at: iso(60), ended_at: iso(60), created_at: iso(61) },
    { id: 's4', group_id: 'G', calendar_event_id: 'e4', status: 'live', started_at: iso(0), ended_at: null, created_at: iso(0) },
  ]
  return {
    group_members: [{ group_id: 'G', user_id: 'me', role: o.role ?? 'owner', is_captain: o.captain ?? false, staff_roles: [] }],
    team_sessions: sessions,
    calendar_events: [
      { id: 'e1', kind: 'scrim', title: 'vs Aegis', starts_at: iso(2), ends_at: iso(2), attendee_scope: 'custom' },
      { id: 'e2', kind: 'flex', title: 'Soirée flex', starts_at: iso(10), ends_at: iso(10), attendee_scope: 'whole_team' },
      { id: 'e3', kind: 'tournament', title: 'Cup', starts_at: iso(60), ends_at: iso(60), attendee_scope: 'custom' },
    ],
    team_session_games: [
      { id: 'g1', session_id: 's1', created_at: iso(2), reported_by: 'x', our_team_id: 100, enemy_team_name: 'Aegis', queue: 0, duration: 1800, teams: [{ teamId: 100, win: true }], start: 1 },
      { id: 'g2', session_id: 's1', created_at: iso(2), reported_by: 'x', our_team_id: 100, enemy_team_name: 'Aegis', queue: 0, duration: 2000, teams: [{ teamId: 100, win: false }], start: 2 },
      { id: 'g3', session_id: 's2', created_at: iso(10), reported_by: 'x', our_team_id: null, enemy_team_name: null, queue: 440, duration: 1500, teams: null, start: 3 },
    ],
    scrims: [{ calendar_event_id: 'e1', bo_format: 'bo3', opponent: 'Aegis', prep_notes: 'Ban Azir', review_notes: null }],
    team_session_reviews: [{ session_id: 's1', status: 'done' }, { session_id: 's2', status: 'pending' }],
    team_session_feedback: [],
    team_session_objectives: [{ session_id: 's1', objective_ids: ['vision', 'tempo'] }],
    team_session_objective_results: o.results ?? [{ session_id: 's1', objective_id: 'vision', game_id: null, met: true }],
    calendar_event_attendees: [],
    team_session_attendance: [],
  }
}

describe('listTeamSessionHistory', () => {
  it('the finished sessions of the period, newest first, with their games, objectives, notes and review', async () => {
    const { sb } = fakeSupabase(groupTables())
    const page = await listTeamSessionHistory(sb, 'me', 'G', { kind: 'all', period: '30d' }, NOW)
    expect(page.sessions.map((s) => s.sessionId)).toEqual(['s1', 's2'])
    expect(page.sessions[0]).toMatchObject({
      kind: 'scrim', title: 'vs Aegis', opponent: 'Aegis', format: 'bo3', wins: 1, losses: 1, playedSec: 3800,
      objectives: { total: 2, held: 1, judged: 1 }, hasNotes: true, review: 'done',
      games: [{ gameId: 'g1', win: true, durationSec: 1800 }, { gameId: 'g2', win: false, durationSec: 2000 }],
    })
    expect(page.sessions[1]).toMatchObject({ kind: 'flex', games: [{ gameId: 'g3', win: null }], review: 'pending', hasNotes: false })
    expect(page.summary).toMatchObject({ sessions: 2, games: 3, wins: 1, losses: 1, winRate: 50 })
    expect(page.hasMore).toBe(false)
  })
  it('filters by kind and period, and pages with before', async () => {
    const { sb } = fakeSupabase(groupTables())
    expect((await listTeamSessionHistory(sb, 'me', 'G', { kind: 'tournament', period: 'all' }, NOW)).sessions.map((s) => s.sessionId)).toEqual(['s3'])
    expect((await listTeamSessionHistory(sb, 'me', 'G', { kind: 'tournament', period: '30d' }, NOW)).sessions).toEqual([])
    const first = await listTeamSessionHistory(sb, 'me', 'G', { kind: 'all', period: 'all', limit: 1 }, NOW)
    expect([first.sessions.map((s) => s.sessionId), first.hasMore, first.summary.sessions]).toEqual([['s1'], true, 3])
    const next = await listTeamSessionHistory(sb, 'me', 'G', { kind: 'all', period: 'all', limit: 1, before: first.sessions[0].startsAt }, NOW)
    expect(next.sessions.map((s) => s.sessionId)).toEqual(['s2'])
  })
  it('a player sees only the sessions they were part of', async () => {
    const { sb } = fakeSupabase(groupTables({ role: 'player' }))
    // s2 is a whole-team slot; s1 and s3 are custom slots without them.
    expect((await listTeamSessionHistory(sb, 'me', 'G', { kind: 'all', period: 'all' }, NOW)).sessions.map((s) => s.sessionId)).toEqual(['s2'])
    const captain = fakeSupabase(groupTables({ role: 'player', captain: true }))
    expect((await listTeamSessionHistory(captain.sb, 'me', 'G', { kind: 'all', period: 'all' }, NOW)).sessions).toHaveLength(3)
  })
  it('before the verdicts migration, objectives are simply not judged', async () => {
    const { sb } = fakeSupabase(groupTables({ results: { error: { code: '42P01', message: 'relation does not exist' } } }))
    const page = await listTeamSessionHistory(sb, 'me', 'G', { kind: 'all', period: '30d' }, NOW)
    expect(page.sessions[0].objectives).toEqual({ total: 2, held: 0, judged: 0 })
  })
  it('nothing for someone outside the group', async () => {
    const { sb } = fakeSupabase({ ...groupTables(), group_members: [] })
    expect(await listTeamSessionHistory(sb, 'me', 'G', { kind: 'all', period: 'all' }, NOW)).toMatchObject({ sessions: [], hasMore: false, summary: { sessions: 0 } })
  })
  it('reads only small pieces of the cached match for the list', async () => {
    const { sb, calls } = fakeSupabase(groupTables())
    await listTeamSessionHistory(sb, 'me', 'G', { kind: 'all', period: 'all' }, NOW)
    const gameSelect = calls.find(([t]) => t === 'team_session_games')![2] as string
    expect(gameSelect).not.toMatch(/(^|, )match_json(,|$)/)
    expect(gameSelect).toMatch(/match_json->info->teams/)
  })
})

describe('getTeamSessionHistoryDetail', () => {
  const tables = () => ({
    team_sessions: [{ id: 's1', group_id: 'G', calendar_event_id: 'e1', status: 'ended', responsible_user_ids: ['u0'], started_at: iso(2), ended_at: iso(2), created_at: iso(3) }],
    calendar_events: [{ id: 'e1', kind: 'scrim', title: 'vs Aegis', starts_at: iso(2), ends_at: iso(2) }],
    scrims: [{ calendar_event_id: 'e1', bo_format: 'bo3', opponent: 'Aegis', prep_notes: 'Ban Azir', review_notes: 'Vision ok', checklist: [{ label: 'Wards', done: true }, { nope: 1 }], status: 'done' }],
    team_session_games: [
      { id: 'g2', session_id: 's1', match_id: 'EUW1_2', status: 'fetched', created_at: iso(2), match_json: match({ ourWin: false, start: 2 }), our_team_id: 100, enemy_team_name: 'Aegis', timeline_summary: null },
      { id: 'g1', session_id: 's1', match_id: 'EUW1_1', status: 'fetched', created_at: iso(2), match_json: match({ ourWin: true, start: 1 }), our_team_id: 100, enemy_team_name: 'Aegis', timeline_summary: timeline(800) },
    ],
    group_members: MEMBERS.map((m) => ({ group_id: 'G', user_id: m.userId, riot_id: m.riotId, display_name: m.displayName })),
    team_session_reviews: [{ id: 'r1', session_id: 's1', game_id: null, scope: 'session', recorded_by: 'u0', recording_local_path: null, youtube_url: 'https://youtu.be/x', youtube_visibility: 'unlisted', transcript: null, summary: 'Bien', status: 'done', created_at: iso(1), updated_at: iso(1) }],
    team_session_feedback: [{ session_id: 's1', user_id: 'u1', body: 'Bon scrim', transcript: null, created_at: iso(1) }],
    team_session_attendance: [{ session_id: 's1', user_id: 'u1', present: true }],
    team_session_objectives: [{ session_id: 's1', objective_ids: ['vision'], kpi_ids: ['ward_timing'], set_by: 'u0', set_at: iso(3) }],
    team_session_objective_results: [{ session_id: 's1', objective_id: 'vision', game_id: 'g1', met: true }],
  })
  it('the header, the games in the order played, the whole session, objectives, reviews, feedback, scrim notes, attendance', async () => {
    const { sb } = fakeSupabase(tables())
    const d = await getTeamSessionHistoryDetail(sb, 's1')
    expect(d.header).toMatchObject({ kind: 'scrim', title: 'vs Aegis', opponent: 'Aegis', format: 'bo3', wins: 1, losses: 1, responsibleUserIds: ['u0'], status: 'ended' })
    expect(d.games.map((g) => [g.index, g.gameId, g.win])).toEqual([[1, 'g1', true], [2, 'g2', false]])
    expect(d.games[0].timeline?.goldDiffByMinute[15]).toBe(800)
    expect(d.whole).toMatchObject({ gamesCounted: 2, team: { goldDiffAt15: 800 } })
    expect(d.objectives).toEqual([{ objectiveId: 'vision', session: null, byGame: { g1: true }, held: true }])
    expect(d.kpiIds).toEqual(['ward_timing'])
    expect(d.reviews.map((r) => r.summary)).toEqual(['Bien'])
    expect(d.feedback.map((f) => f.body)).toEqual(['Bon scrim'])
    expect(d.scrimNotes).toEqual({ prepNotes: 'Ban Azir', reviewNotes: 'Vision ok', checklist: [{ label: 'Wards', done: true }], status: 'done' })
    expect(d.attendance).toEqual({ u1: true })
  })
  it('NOT_FOUND for a session that does not exist or is not readable', async () => {
    const { sb } = fakeSupabase({ ...tables(), team_sessions: [] })
    await expect(getTeamSessionHistoryDetail(sb, 's1')).rejects.toThrow('NOT_FOUND')
  })
  it('a session without games: no games, no whole', async () => {
    const { sb } = fakeSupabase({ ...tables(), team_session_games: [] })
    expect(await getTeamSessionHistoryDetail(sb, 's1')).toMatchObject({ games: [], whole: null, header: { wins: 0, losses: 0 } })
  })
})

describe('setObjectiveResult', () => {
  it('calls the RPC with the verdict', async () => {
    let seen: unknown
    const { sb } = fakeSupabase({}, (name, args) => { seen = [name, args]; return { data: null, error: null } })
    await setObjectiveResult(sb, 's1', 'vision', null, true)
    expect(seen).toEqual(['set_team_session_objective_result', { p_session: 's1', p_objective: 'vision', p_game: null, p_met: true }])
  })
  it('FORBIDDEN, NOT_FOUND, and NOT_AVAILABLE before the migration', async () => {
    const err = (error: unknown) => fakeSupabase({}, () => ({ data: null, error })).sb
    await expect(setObjectiveResult(err({ code: '42501', message: 'FORBIDDEN' }), 's', 'o', null, true)).rejects.toThrow('FORBIDDEN')
    await expect(setObjectiveResult(err({ code: 'P0002', message: 'NOT_FOUND' }), 's', 'o', 'g', true)).rejects.toThrow('NOT_FOUND')
    await expect(setObjectiveResult(err({ code: 'PGRST202', message: 'Could not find the function' }), 's', 'o', null, true)).rejects.toThrow('NOT_AVAILABLE')
  })
})

// ── Meetings and kept sessions (migration 20261120160000) ────────────────
const MM = (userId: string, role: string, o: { staff?: string[]; plays?: boolean } = {}) => ({ userId, role, staffRoles: o.staff ?? [], alsoPlays: o.plays ?? false })

describe('the people a meeting concerns', () => {
  const members = [MM('o', 'owner', { plays: true }), MM('c', 'coach'), MM('p1', 'player'), MM('p2', 'player', { staff: ['analyst'] })]
  it('the whole team, the players (and an owner who plays), the staff, or the invitees', () => {
    expect(meetingConcerned('whole_team', members, []).map((m) => m.userId)).toEqual(['o', 'c', 'p1', 'p2'])
    expect(meetingConcerned('all_players', members, []).map((m) => m.userId)).toEqual(['o', 'p1', 'p2'])
    expect(meetingConcerned('all_staff', members, []).map((m) => m.userId)).toEqual(['o', 'c', 'p2'])
    expect(meetingConcerned('custom', members, ['p1']).map((m) => m.userId)).toEqual(['p1'])
  })
  it('presence: the mark first, else a declined answer with its note, else no answer', () => {
    expect(meetingPeople([MM('a', 'player'), MM('b', 'player'), MM('c', 'player'), MM('d', 'coach')], { a: true, b: false }, [
      { userId: 'b', status: 'confirmed', note: null }, { userId: 'c', status: 'declined', note: 'Examen' }, { userId: 'd', status: 'confirmed', note: null },
    ])).toEqual([
      { userId: 'a', role: 'player', status: 'present', absenceNote: null },
      { userId: 'b', role: 'player', status: 'absent', absenceNote: null },
      { userId: 'c', role: 'player', status: 'absent', absenceNote: 'Examen' },
      { userId: 'd', role: 'coach', status: 'no-answer', absenceNote: null },
    ])
  })
})

function meetingTables() {
  const t = groupTables()
  return {
    ...t,
    group_members: [
      { group_id: 'G', user_id: 'me', role: 'owner', is_captain: false, staff_roles: [], also_plays: false, riot_id: null, display_name: 'Me' },
      { group_id: 'G', user_id: 'p1', role: 'player', is_captain: false, staff_roles: [], also_plays: false, riot_id: null, display_name: 'P1' },
      { group_id: 'G', user_id: 'p2', role: 'player', is_captain: false, staff_roles: [], also_plays: false, riot_id: null, display_name: 'P2' },
    ],
    team_sessions: [
      ...t.team_sessions,
      { id: 'm1', group_id: 'G', calendar_event_id: 'em', status: 'ended', responsible_user_ids: ['me'], started_at: iso(1), ended_at: iso(1), created_at: iso(1) },
      // Kept after its slot was deleted: read from its copy of the slot.
      { id: 'k1', group_id: 'G', calendar_event_id: null, status: 'ended', responsible_user_ids: ['me'], started_at: iso(4), ended_at: iso(4), created_at: iso(4),
        event_id: 'gone', event_kind: 'scrim', event_title: 'vs Gone', event_starts_at: iso(4), event_ends_at: iso(4) },
    ],
    calendar_events: [
      ...t.calendar_events,
      { id: 'em', kind: 'meeting', title: 'Débrief du bloc', starts_at: new Date(NOW - 86_400_000).toISOString(), ends_at: new Date(NOW - 86_400_000 + 45 * 60_000).toISOString(), attendee_scope: 'all_players', created_by: 'me', notes: 'Après les scrims' },
    ],
    team_session_reviews: [
      ...t.team_session_reviews,
      { id: 'rm', session_id: 'm1', game_id: null, scope: 'meeting', recorded_by: 'me', recording_local_path: 'C:/rec/m1.webm', youtube_url: null, youtube_visibility: 'private', transcript: '12:40 On commence', summary: 'Wards à revoir', status: 'done', created_at: iso(1), updated_at: iso(1) },
    ],
    team_session_attendance: [{ session_id: 'm1', user_id: 'p1', present: true }, { session_id: 'm1', user_id: 'p2', present: false }],
    calendar_event_responses: [{ event_id: 'em', user_id: 'p2', status: 'declined', note: 'Malade' }],
    team_session_games: [...t.team_session_games, { id: 'gk', session_id: 'k1', created_at: iso(4), reported_by: 'x', our_team_id: 100, enemy_team_name: null, queue: 0, duration: 1600, teams: [{ teamId: 100, win: true }], start: 9, match_id: 'EUW1_K', status: 'fetched', match_json: null, timeline_summary: null }],
  }
}

describe('meetings in the history', () => {
  it('a meeting row: presence, people concerned, recording, transcript and summary', async () => {
    const { sb } = fakeSupabase(meetingTables())
    const page = await listTeamSessionHistory(sb, 'me', 'G', { kind: 'meeting', period: '30d' }, NOW)
    expect(page.sessions.map((s) => s.sessionId)).toEqual(['m1'])
    expect(page.sessions[0]).toMatchObject({
      kind: 'meeting', title: 'Débrief du bloc', games: [],
      meeting: {
        present: 1, concerned: 2, scope: 'all_players', durationSec: 2700, recorded: true, transcript: true, summary: 'done',
        people: [{ userId: 'p1', name: 'P1', status: 'present' }, { userId: 'p2', name: 'P2', status: 'absent' }],
      },
    })
    expect(page.summary.meetings).toEqual({ count: 1, averageAttendancePct: 50, summariesDone: 1, recordedSec: null })
  })
  it('in "all", meetings mix with the game sessions by date; the game tiles count the game sessions only', async () => {
    const { sb } = fakeSupabase(meetingTables())
    const page = await listTeamSessionHistory(sb, 'me', 'G', { kind: 'all', period: '30d' }, NOW)
    expect(page.sessions.map((s) => s.sessionId)).toEqual(['m1', 's1', 'k1', 's2'])
    expect(page.summary).toMatchObject({ sessions: 4, byKind: { meeting: 1, scrim: 2, flex: 1 }, reviewed: 1, withoutReview: 2 })
  })
  it('the page of a meeting: reason, notes, organizer, people with their presence, recording, summary, transcript', async () => {
    const { sb } = fakeSupabase({ ...meetingTables(), team_session_objectives: [], team_session_feedback: [] })
    const d = await getTeamSessionHistoryDetail(sb, 'm1')
    expect(d.header).toMatchObject({ kind: 'meeting', title: 'Débrief du bloc' })
    expect(d.games).toEqual([])
    expect(d.meeting).toEqual({
      reason: 'Débrief du bloc', notes: 'Après les scrims', organizerId: 'me', scope: 'all_players',
      people: [
        { userId: 'p1', role: 'player', status: 'present', absenceNote: null },
        { userId: 'p2', role: 'player', status: 'absent', absenceNote: 'Malade' },
      ],
      present: 1, concerned: 2,
      recording: { localPath: 'C:/rec/m1.webm', youtubeUrl: null, youtubeVisibility: 'private', recordedBy: 'me', recordedAt: iso(1) },
      summary: 'Wards à revoir', transcript: '12:40 On commence', reviewId: 'rm', reviewStatus: 'done',
    })
  })
  it('a game session has no meeting block', async () => {
    const { sb } = fakeSupabase(meetingTables())
    expect((await getTeamSessionHistoryDetail(sb, 's1')).meeting).toBeUndefined()
  })
})

describe('a session kept after its slot was deleted', () => {
  it('reads from its copy of the slot, in the list and on its page', async () => {
    const { sb } = fakeSupabase(meetingTables())
    const row = (await listTeamSessionHistory(sb, 'me', 'G', { kind: 'scrim', period: '30d' }, NOW)).sessions.find((s) => s.sessionId === 'k1')!
    expect(row).toMatchObject({ calendarEventId: 'gone', title: 'vs Gone', kind: 'scrim', eventDeleted: true, wins: 1 })
    const d = await getTeamSessionHistoryDetail(sb, 'k1')
    expect(d.header).toMatchObject({ calendarEventId: 'gone', title: 'vs Gone', kind: 'scrim', eventDeleted: true })
  })
  it('before the migration (no copy columns), the sessions are read without them', async () => {
    const t = groupTables()
    const { sb, calls } = fakeSupabase(t, undefined, ['team_sessions.event_id'])
    const page = await listTeamSessionHistory(sb, 'me', 'G', { kind: 'all', period: '30d' }, NOW)
    expect(page.sessions.map((s) => s.sessionId)).toEqual(['s1', 's2'])
    expect(calls.filter(([table]) => table === 'team_sessions')).toHaveLength(2)
    expect((await getTeamSessionHistoryDetail(sb, 's1')).header.title).toBe('vs Aegis')
  })
})
