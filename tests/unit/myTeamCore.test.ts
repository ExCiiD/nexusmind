import { describe, it, expect } from 'vitest'
import { eventConcerns, getMyNextEvent, listMyOpenTasks, listMySessionObjectives, listMyVodActionItems } from '../../src/lib/myTeamCore'

type Result = { data: unknown; error: unknown }
/** A Supabase stub: each table answers its rows filtered by eq / in / gt / neq, ordered by order(), cut by limit(). */
function fakeSupabase(tables: Record<string, any[] | { error: unknown }>) {
  return {
    from(table: string) {
      const filters: Array<(r: any) => boolean> = []
      let orderBy: string | null = null
      let max = Infinity
      const run = (): Result => {
        const t = tables[table]
        if (!t) return { data: [], error: null }
        if (!Array.isArray(t)) return { data: null, error: t.error }
        let rows = t.filter((r) => filters.every((f) => f(r)))
        if (orderBy) rows = [...rows].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])))
        return { data: rows.slice(0, max), error: null }
      }
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
        neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q },
        gt: (c: string, v: string) => { filters.push((r) => String(r[c]) > v); return q },
        order: (c: string) => { orderBy = c; return q },
        limit: (n: number) => { max = n; return q },
        maybeSingle: () => { const r = run(); return Promise.resolve({ data: (r.data as any[] | null)?.[0] ?? null, error: r.error }) },
        then: (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return q
    },
  } as never
}

const NOW = Date.UTC(2026, 10, 20, 12)
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString()
const membership = (o: Partial<{ group_id: string; role: string; staff_roles: string[]; also_plays: boolean }> = {}) =>
  ({ group_id: 'G', user_id: 'me', role: 'player', staff_roles: [], also_plays: false, ...o })

describe('an event concerns me', () => {
  const me = { userId: 'me', groupId: 'G', role: 'player', staffRoles: [], alsoPlays: false }
  it('by its scope or as an invitee', () => {
    expect(eventConcerns('whole_team', me, [])).toBe(true)
    expect(eventConcerns('all_players', me, [])).toBe(true)
    expect(eventConcerns('all_staff', me, [])).toBe(false)
    expect(eventConcerns('custom', me, [])).toBe(false)
    expect(eventConcerns('custom', me, ['me'])).toBe(true)
    expect(eventConcerns('all_staff', { ...me, role: 'coach' }, [])).toBe(true)
  })
})

describe('my next event (L5)', () => {
  const tables = () => ({
    group_members: [membership(), membership({ group_id: 'G2' })],
    groups: [{ id: 'G', name: 'Ascend' }, { id: 'G2', name: 'Other' }],
    calendar_events: [
      { id: 'past', group_id: 'G', kind: 'scrim', title: 'Hier', starts_at: at(-30), ends_at: at(-28), attendee_scope: 'whole_team' },
      { id: 'rest', group_id: 'G', kind: 'rest', title: 'Repos', starts_at: at(1), ends_at: at(5), attendee_scope: 'whole_team' },
      { id: 'staff', group_id: 'G', kind: 'meeting', title: 'Staff', starts_at: at(2), ends_at: at(3), attendee_scope: 'all_staff' },
      { id: 'scrim', group_id: 'G', kind: 'scrim', title: 'vs KCA', starts_at: at(6), ends_at: at(8), attendee_scope: 'all_players' },
      { id: 'later', group_id: 'G2', kind: 'flex', title: 'Flex', starts_at: at(30), ends_at: at(32), attendee_scope: 'whole_team' },
    ],
    calendar_event_attendees: [],
    calendar_event_responses: [{ event_id: 'scrim', user_id: 'me', status: 'confirmed' }],
    team_sessions: [{ id: 's1', calendar_event_id: 'scrim' }],
    team_session_objectives: [{ session_id: 's1', objective_ids: ['vision'] }],
    team_session_player_objectives: [],
  })
  it('the first coming event that concerns me (not a rest slot, not a staff meeting), with my answer and its prep', async () => {
    expect(await getMyNextEvent(fakeSupabase(tables()), 'me', NOW)).toEqual({
      eventId: 'scrim', groupId: 'G', groupName: 'Ascend', kind: 'scrim', title: 'vs KCA', startsAt: at(6), endsAt: at(8),
      myResponse: 'confirmed', sessionId: 's1', prepReady: true,
    })
  })
  it('a custom event counts when I am invited', async () => {
    const t = tables()
    t.calendar_events.push({ id: 'oneone', group_id: 'G', kind: 'one_on_one', title: '1:1', starts_at: at(4), ends_at: at(5), attendee_scope: 'custom' })
    ;(t.calendar_event_attendees as any[]).push({ event_id: 'oneone', user_id: 'me' })
    expect(await getMyNextEvent(fakeSupabase(t), 'me', NOW)).toMatchObject({ eventId: 'oneone', myResponse: null, sessionId: null, prepReady: false })
  })
  it('nothing without a group or without a coming event', async () => {
    expect(await getMyNextEvent(fakeSupabase({ ...tables(), group_members: [] }), 'me', NOW)).toBeNull()
    expect(await getMyNextEvent(fakeSupabase({ ...tables(), calendar_events: [] }), 'me', NOW)).toBeNull()
  })
})

describe('my open tasks (L4)', () => {
  it('the open tasks given to me, soonest due first, overdue marked', async () => {
    const sb = fakeSupabase({
      groups: [{ id: 'G', name: 'Ascend' }],
      tasks: [
        { id: 't1', group_id: 'G', title: 'Revoir la VOD', due_date: null, status: 'open', assignee_id: 'me' },
        { id: 't2', group_id: 'G', title: 'Pool ADC', due_date: '2026-11-19', status: 'open', assignee_id: 'me' },
        { id: 't3', group_id: 'G', title: 'Fait', due_date: '2026-11-18', status: 'done', assignee_id: 'me' },
        { id: 't4', group_id: 'G', title: 'Pas à moi', due_date: '2026-11-18', status: 'open', assignee_id: 'other' },
        { id: 't5', group_id: 'G', title: 'Aujourd\'hui', due_date: '2026-11-20', status: 'open', assignee_id: 'me' },
      ],
    })
    expect(await listMyOpenTasks(sb, 'me', NOW)).toEqual([
      { id: 't2', groupId: 'G', groupName: 'Ascend', title: 'Pool ADC', dueDate: '2026-11-19', overdue: true },
      { id: 't5', groupId: 'G', groupName: 'Ascend', title: 'Aujourd\'hui', dueDate: '2026-11-20', overdue: false },
      { id: 't1', groupId: 'G', groupName: 'Ascend', title: 'Revoir la VOD', dueDate: null, overdue: false },
    ])
  })
})

describe('my session objectives (L2)', () => {
  it('my objectives for the sessions not ended, soonest first', async () => {
    const sb = fakeSupabase({
      team_session_player_objectives: [
        { session_id: 's1', player_id: 'me', objective_ids: ['tempo'], kpi_ids: [], note: '0 mort avant 4:00' },
        { session_id: 's2', player_id: 'me', objective_ids: ['vision'], kpi_ids: ['k'], note: null },
        { session_id: 's3', player_id: 'me', objective_ids: ['old'], kpi_ids: [], note: null },
        { session_id: 's1', player_id: 'mate', objective_ids: ['x'], kpi_ids: [], note: null },
      ],
      team_sessions: [
        { id: 's1', group_id: 'G', calendar_event_id: 'e1', status: 'scheduled' },
        { id: 's2', group_id: 'G', calendar_event_id: 'e2', status: 'live' },
        { id: 's3', group_id: 'G', calendar_event_id: 'e3', status: 'ended' },
      ],
      calendar_events: [{ id: 'e1', title: 'vs KCA', starts_at: at(6) }, { id: 'e2', title: 'Flex', starts_at: at(-1) }],
    })
    expect(await listMySessionObjectives(sb, 'me')).toEqual([
      { sessionId: 's2', calendarEventId: 'e2', groupId: 'G', title: 'Flex', startsAt: at(-1), status: 'live', objectiveIds: ['vision'], kpiIds: ['k'], note: null },
      { sessionId: 's1', calendarEventId: 'e1', groupId: 'G', title: 'vs KCA', startsAt: at(6), status: 'scheduled', objectiveIds: ['tempo'], kpiIds: [], note: '0 mort avant 4:00' },
    ])
  })
  it('empty before the migration', async () => {
    expect(await listMySessionObjectives(fakeSupabase({ team_session_player_objectives: { error: { code: '42P01', message: 'missing' } } }), 'me')).toEqual([])
  })
})

describe('my VOD actions (L6)', () => {
  const tables = {
    vod_review_assignments: [{ session_id: 'v1', player_id: 'me' }, { session_id: 'v1', player_id: 'me' }, { session_id: 'v2', player_id: 'other' }],
    vod_review_sessions: [{ id: 'v1', group_id: 'G', title: 'Scrim vs KCA' }, { id: 'v2', group_id: 'G', title: 'Autre' }],
    vod_review_action_items: [
      { id: 'a1', session_id: 'v1', text: 'Ward le pixel avant 3:00', done: false, created_at: '1' },
      { id: 'a2', session_id: 'v1', text: 'Reset avec le jungler', done: true, created_at: '2' },
      { id: 'a3', session_id: 'v2', text: 'Pas pour moi', done: false, created_at: '3' },
    ],
  }
  it('the open actions of the reviews I am assigned to, or all of them', async () => {
    expect(await listMyVodActionItems(fakeSupabase(tables), 'me')).toEqual([
      { id: 'a1', vodSessionId: 'v1', groupId: 'G', vodTitle: 'Scrim vs KCA', text: 'Ward le pixel avant 3:00', done: false, createdAt: '1' },
    ])
    expect((await listMyVodActionItems(fakeSupabase(tables), 'me', true)).map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(await listMyVodActionItems(fakeSupabase({ ...tables, vod_review_assignments: [] }), 'me')).toEqual([])
  })
})
