import { describe, it, expect } from 'vitest'
import { listEventReminders, listPublishedDossiers, remindEventResponses } from '../../src/lib/organisationCore'
import { soloPoolFromGames, soloRole } from '../../src/lib/lftCore'

type Result = { data: unknown; error: unknown }
function fakeSupabase(tables: Record<string, any[] | { error: unknown }>, rpc?: (name: string, args: unknown) => Result) {
  const calls: unknown[] = []
  const sb = {
    from(table: string) {
      const filters: Array<(r: any) => boolean> = []
      const run = (): Result => {
        const t = tables[table]
        if (!t) return { data: [], error: null }
        if (!Array.isArray(t)) return { data: null, error: t.error }
        return { data: t.filter((r) => filters.every((f) => f(r))), error: null }
      }
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q },
        not: (c: string, op: string, v: unknown) => { if (op === 'is' && v === null) filters.push((r) => r[c] != null); return q },
        order: () => q,
        then: (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return q
    },
    rpc: (name: string, args: unknown) => { calls.push([name, args]); return Promise.resolve(rpc ? rpc(name, args) : { data: null, error: null }) },
  }
  return { sb: sb as never, calls }
}

describe('"Relancer"', () => {
  it('calls the RPC (all the members without an answer, or the ones chosen) and returns who was reminded or skipped', async () => {
    const { sb, calls } = fakeSupabase({}, () => ({ data: { reminded: ['p1'], skipped: [{ userId: 'p2', nextAt: 't' }] }, error: null }))
    expect(await remindEventResponses(sb, 'e1')).toEqual({ reminded: ['p1'], skipped: [{ userId: 'p2', nextAt: 't' }] })
    await remindEventResponses(sb, 'e1', ['p1'])
    expect(calls).toEqual([['remind_event_responses', { p_event: 'e1', p_user_ids: null }], ['remind_event_responses', { p_event: 'e1', p_user_ids: ['p1'] }]])
  })
  it('maps the refusals, and NOT_AVAILABLE before the migration', async () => {
    const err = (error: unknown) => fakeSupabase({}, () => ({ data: null, error })).sb
    await expect(remindEventResponses(err({ code: '42501', message: 'FORBIDDEN' }), 'e')).rejects.toThrow('FORBIDDEN')
    await expect(remindEventResponses(err({ code: '22023', message: 'EVENT_PAST' }), 'e')).rejects.toThrow('EVENT_PAST')
    await expect(remindEventResponses(err({ code: 'P0002', message: 'NOT_FOUND' }), 'e')).rejects.toThrow('NOT_FOUND')
    await expect(remindEventResponses(err({ code: 'PGRST202', message: 'no function' }), 'e')).rejects.toThrow('NOT_AVAILABLE')
  })
  it('lists the last reminders of the events, empty before the migration', async () => {
    const { sb } = fakeSupabase({ event_response_reminders: [{ event_id: 'e1', user_id: 'p1', sent_by: 'm', sent_at: 't' }, { event_id: 'e9', user_id: 'p1', sent_by: 'm', sent_at: 't' }] })
    expect(await listEventReminders(sb, ['e1'])).toEqual([{ eventId: 'e1', userId: 'p1', sentBy: 'm', sentAt: 't' }])
    expect(await listEventReminders(fakeSupabase({ event_response_reminders: { error: { code: '42P01', message: 'missing' } } }).sb, ['e1'])).toEqual([])
    expect(await listEventReminders(sb, [])).toEqual([])
  })
})

describe('the published dossiers (§ 18.4)', () => {
  it('newest first, with the tag, who published it, and our record against them', async () => {
    const { sb } = fakeSupabase({
      opponent_dossiers: [
        { group_id: 'G', opponent_key: 'karmine academy', opponent_name: 'Karmine Academy', status: 'published', published_at: '2026-11-19', updated_by: 'c' },
        { group_id: 'G', opponent_key: 'aegis', opponent_name: 'Aegis', status: 'draft', published_at: null, updated_by: 'c' },
        { group_id: 'G2', opponent_key: 'other', opponent_name: 'Other', status: 'published', published_at: '2026-11-18', updated_by: 'x' },
      ],
      team_scouting: [{ group_id: 'G', opponent_key: 'karmine academy', tag: 'KCA' }],
      group_members: [{ group_id: 'G', user_id: 'c', display_name: 'Coach Sora' }],
      team_sessions: [{ id: 's1', group_id: 'G' }],
      team_session_games: [
        { session_id: 's1', enemy_team_name: '  Karmine   Academy ', our_team_id: 100, teams: [{ teamId: 100, win: true }] },
        { session_id: 's1', enemy_team_name: 'Karmine Academy', our_team_id: 200, teams: [{ teamId: 200, win: false }] },
        { session_id: 's1', enemy_team_name: 'Karmine Academy', our_team_id: null, teams: null },
        { session_id: 's1', enemy_team_name: null, our_team_id: 100, teams: [{ teamId: 100, win: true }] },
      ],
    })
    expect(await listPublishedDossiers(sb, 'G')).toEqual([{
      opponentKey: 'karmine academy', name: 'Karmine Academy', tag: 'KCA', publishedAt: '2026-11-19',
      publishedBy: 'c', publishedByName: 'Coach Sora', record: { wins: 1, losses: 1 },
    }])
  })
  it('empty when nothing is published', async () => {
    expect(await listPublishedDossiers(fakeSupabase({ opponent_dossiers: [] }).sb, 'G')).toEqual([])
  })
})

describe('solo LFT (§ 18.2)', () => {
  const games = [
    { champion: 'Ahri', role: 'MIDDLE', win: true }, { champion: 'Ahri', role: 'MIDDLE', win: false }, { champion: 'Ahri', role: 'MIDDLE', win: true },
    { champion: 'Syndra', role: 'MIDDLE', win: true }, { champion: 'Jayce', role: 'TOP', win: false }, { champion: 'Teemo', role: '', win: true },
  ]
  it('a pool from the player\'s own games, most played first, in the roster pool\'s shape', () => {
    expect(soloPoolFromGames(games)).toEqual([
      { id: 'me:Ahri:MID', memberId: 'me', championKey: 'Ahri', role: 'MID', tier: 'comfort', playRate: 3, winRate: 66.7 },
      { id: 'me:Syndra:MID', memberId: 'me', championKey: 'Syndra', role: 'MID', tier: 'comfort', playRate: 1, winRate: 100 },
      { id: 'me:Jayce:TOP', memberId: 'me', championKey: 'Jayce', role: 'TOP', tier: 'comfort', playRate: 1, winRate: 0 },
    ])
  })
  it('the role: the main role when set, else the most played', () => {
    expect(soloRole('BOTTOM', games)).toBe('ADC')
    expect(soloRole(null, games)).toBe('MID')
    expect(soloRole(null, [])).toBeNull()
  })
})
