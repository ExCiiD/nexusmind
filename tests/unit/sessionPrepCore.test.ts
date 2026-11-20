import { describe, it, expect } from 'vitest'
import {
  attachDraft, attachSharedDraft, cleanDraft, prepReadyForEvents, cleanPlayerObjectives, draftInputFromLocal, getSessionPrep, removeDraft, reorderDrafts, setPlayerObjectives, setPrepMessage,
} from '../../src/lib/sessionPrepCore'

type Result = { data: unknown; error: unknown }
/** A Supabase stub: each table answers its rows (filtered by .eq), or an error; writes are recorded. */
function fakeSupabase(tables: Record<string, any[] | { error: unknown }>, o: { rpc?: Result; writeError?: unknown; writeData?: unknown } = {}) {
  const writes: Array<[string, string, unknown, unknown?]> = []
  const sb = {
    from(table: string) {
      const filters: Array<(r: any) => boolean> = []
      let write: [string, unknown, unknown?] | null = null
      const run = (): Result => {
        if (write) { writes.push([table, write[0], write[1], write[2]]); return { data: o.writeData ?? [{ id: 'new' }], error: o.writeError ?? null } }
        const t = tables[table]
        if (!t) return { data: [], error: null }
        if (!Array.isArray(t)) return { data: null, error: t.error }
        return { data: t.filter((r) => filters.every((f) => f(r))), error: null }
      }
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q },
        order: () => q,
        insert: (row: unknown) => { write = ['insert', row]; return q },
        upsert: (row: unknown, opts: unknown) => { write = ['upsert', row, opts]; return q },
        update: (row: unknown) => { write = ['update', row]; return q },
        delete: () => { write = ['delete', null]; return q },
        maybeSingle: () => { const r = run(); return Promise.resolve({ data: (r.data as any[] | null)?.[0] ?? null, error: r.error }) },
        single: () => { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error }) },
        then: (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return q
    },
    rpc: () => Promise.resolve(o.rpc ?? { data: true, error: null }),
  }
  return { sb: sb as never, writes }
}

describe('cleaning what the screen sends', () => {
  it('a player\'s objectives: trimmed, each once, at most 2, a note of 140 characters; nothing left removes them', () => {
    expect(cleanPlayerObjectives({ objectiveIds: [' vision ', 'vision', 'tempo'], kpiIds: ['k1'], note: '  Ward le pixel  ' }))
      .toEqual({ objectiveIds: ['vision', 'tempo'], kpiIds: ['k1'], note: 'Ward le pixel' })
    expect(cleanPlayerObjectives({ objectiveIds: [], kpiIds: [], note: '   ' })).toBeNull()
    expect(() => cleanPlayerObjectives({ objectiveIds: ['a', 'b', 'c'], kpiIds: [], note: null })).toThrow('INVALID')
    expect(() => cleanPlayerObjectives({ objectiveIds: ['a'], kpiIds: [], note: 'x'.repeat(141) })).toThrow('INVALID')
  })
  it('a draft: slots normalised (a champion alone is a slot of one), at most 5, a name', () => {
    const d = cleanDraft({ sourceId: 'local:1', name: ' Comp poke ', bluePicks: ['Jayce', ['Nidalee', 'Elise']], blueBans: [], redPicks: [], redBans: [''], myTeamSide: 'red', notes: '' })
    expect(d).toEqual({ sourceId: 'local:1', name: 'Comp poke', bluePicks: [['Jayce'], ['Nidalee', 'Elise']], blueBans: [], redPicks: [], redBans: [[]], myTeamSide: 'red', notes: null })
    expect(() => cleanDraft({ ...d, name: ' ' })).toThrow('INVALID')
    expect(() => cleanDraft({ ...d, bluePicks: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow('INVALID')
  })
  it('a local Draft Sim draft (JSON slots) becomes an input with its source', () => {
    expect(draftInputFromLocal({ id: 'p1', name: 'Dive', bluePicks: '[["Vi"],"Ahri"]', blueBans: 'oops', redPicks: '[]', redBans: '[]', myTeamSide: 'blue', notes: null }))
      .toEqual({ sourceId: 'local:p1', name: 'Dive', bluePicks: [['Vi'], 'Ahri'], blueBans: [], redPicks: [], redBans: [], myTeamSide: 'blue', notes: null })
  })
})

describe('getSessionPrep', () => {
  const tables = () => ({
    team_sessions: [{ id: 's1' }],
    team_session_objectives: [{ session_id: 's1', objective_ids: ['vision'], kpi_ids: [], set_by: 'c', set_at: 't' }],
    team_session_player_objectives: [{ session_id: 's1', player_id: 'p1', objective_ids: ['tempo'], kpi_ids: [], note: 'Ward', set_by: 'c', set_at: 't' }],
    team_session_prep_notes: [{ session_id: 's1', message: 'Focus tempo Herald', set_by: 'c', set_at: 't' }],
    team_session_drafts: [{ id: 'd1', session_id: 's1', source_id: 'local:1', name: 'Comp', blue_picks: [['Jayce']], blue_bans: [], red_picks: [], red_bans: [], my_team_side: 'blue', notes: null, position: 0, created_by: 'c', created_at: 't', updated_at: 't' }],
  })
  it('collective objectives, players\' objectives and drafts, and whether the reader may prepare', async () => {
    const { sb } = fakeSupabase(tables())
    expect(await getSessionPrep(sb, 's1')).toEqual({
      sessionId: 's1', available: true, canPrepare: true,
      objectives: { sessionId: 's1', objectiveIds: ['vision'], kpiIds: [], setBy: 'c', setAt: 't' },
      message: { text: 'Focus tempo Herald', setBy: 'c', setAt: 't' },
      playerObjectives: [{ playerId: 'p1', objectiveIds: ['tempo'], kpiIds: [], note: 'Ward', setBy: 'c', setAt: 't' }],
      drafts: [{ id: 'd1', sourceId: 'local:1', name: 'Comp', bluePicks: [['Jayce']], blueBans: [], redPicks: [], redBans: [], myTeamSide: 'blue', notes: null, position: 0, createdBy: 'c', createdAt: 't', updatedAt: 't' }],
    })
  })
  it('before the migration: empty lists, not available, nobody prepares', async () => {
    const missing = { error: { code: '42P01', message: 'relation does not exist' } }
    const { sb } = fakeSupabase({ ...tables(), team_session_player_objectives: missing, team_session_drafts: missing }, { rpc: { data: null, error: { code: 'PGRST202', message: 'no function' } } })
    expect(await getSessionPrep(sb, 's1')).toMatchObject({ available: false, canPrepare: false, message: null, playerObjectives: [], drafts: [], objectives: { objectiveIds: ['vision'] } })
  })
  it('NOT_FOUND for a session the reader cannot see', async () => {
    const { sb } = fakeSupabase({ ...tables(), team_sessions: [] })
    await expect(getSessionPrep(sb, 's1')).rejects.toThrow('NOT_FOUND')
  })
})

describe('the "prep ready" badge', () => {
  const tables = {
    team_sessions: [{ id: 's1', calendar_event_id: 'e1' }, { id: 's2', calendar_event_id: 'e2' }, { id: 's3', calendar_event_id: 'e3' }],
    team_session_objectives: [{ session_id: 's1', objective_ids: ['vision'] }, { session_id: 's2', objective_ids: [] }],
    team_session_player_objectives: [{ session_id: 's3' }],
  }
  it('the events whose session has a collective or an individual objective', async () => {
    const q = fakeSupabase(tables)
    expect((await prepReadyForEvents(q.sb, ['e1', 'e2', 'e3'])).sort()).toEqual(['e1', 'e3'])
    expect(await prepReadyForEvents(q.sb, [])).toEqual([])
  })
  it('before the migration, the collective objectives only', async () => {
    const q = fakeSupabase({ ...tables, team_session_player_objectives: { error: { code: '42P01', message: 'missing' } } })
    expect(await prepReadyForEvents(q.sb, ['e1', 'e3'])).toEqual(['e1'])
  })
})

describe('writes', () => {
  it('sets a player\'s objectives (upsert), removes them when nothing is left', async () => {
    const a = fakeSupabase({})
    await setPlayerObjectives(a.sb, 's1', 'p1', { objectiveIds: ['vision'], kpiIds: [], note: null })
    expect(a.writes[0]).toMatchObject(['team_session_player_objectives', 'upsert', { session_id: 's1', player_id: 'p1', objective_ids: ['vision'], kpi_ids: [], note: null }, { onConflict: 'session_id,player_id' }])
    const b = fakeSupabase({})
    await setPlayerObjectives(b.sb, 's1', 'p1', null)
    expect(b.writes[0].slice(0, 2)).toEqual(['team_session_player_objectives', 'delete'])
  })
  it('sets the coach\'s message (upsert, trimmed), removes it when blank, at most 280 characters', async () => {
    const a = fakeSupabase({})
    await setPrepMessage(a.sb, 's1', '  Focus tempo Herald  ')
    expect(a.writes[0]).toMatchObject(['team_session_prep_notes', 'upsert', { session_id: 's1', message: 'Focus tempo Herald' }, { onConflict: 'session_id' }])
    const b = fakeSupabase({})
    await setPrepMessage(b.sb, 's1', '   ')
    expect(b.writes[0].slice(0, 2)).toEqual(['team_session_prep_notes', 'delete'])
    await expect(setPrepMessage(fakeSupabase({}).sb, 's1', 'x'.repeat(281))).rejects.toThrow('INVALID')
  })
  it('maps the database\'s refusals', async () => {
    const err = (error: unknown) => fakeSupabase({}, { writeError: error }).sb
    await expect(setPlayerObjectives(err({ code: '42501', message: 'row-level security' }), 's', 'p', { objectiveIds: ['a'], kpiIds: [], note: null })).rejects.toThrow('FORBIDDEN')
    await expect(setPlayerObjectives(err({ code: '23514', message: 'check' }), 's', 'p', { objectiveIds: ['a'], kpiIds: [], note: null })).rejects.toThrow('INVALID')
    await expect(setPlayerObjectives(err({ code: '42P01', message: 'missing' }), 's', 'p', { objectiveIds: ['a'], kpiIds: [], note: null })).rejects.toThrow('NOT_AVAILABLE')
  })
  it('attaches a draft: a source replaces its copy (upsert), no source adds one (insert)', async () => {
    const draft = { sourceId: 'local:1', name: 'Comp', bluePicks: ['Jayce'], blueBans: [], redPicks: [], redBans: [], myTeamSide: 'blue' as const, notes: null }
    const a = fakeSupabase({}, { writeData: { id: 'd1' } })
    expect(await attachDraft(a.sb, 's1', draft)).toBe('d1')
    expect(a.writes[0]).toMatchObject(['team_session_drafts', 'upsert', { session_id: 's1', source_id: 'local:1', blue_picks: [['Jayce']] }, { onConflict: 'session_id,source_id' }])
    const b = fakeSupabase({}, { writeData: { id: 'd2' } })
    await attachDraft(b.sb, 's1', { ...draft, sourceId: null })
    expect(b.writes[0][1]).toBe('insert')
  })
  it('attaches a shared team draft by its id, as a copy marked with its source', async () => {
    const { sb, writes } = fakeSupabase({ team_sessions: [{ id: 's1', group_id: 'G' }], team_drafts: [{ id: 't1', group_id: 'G', name: 'Shared', blue_picks: [['Azir']], blue_bans: [], red_picks: [], red_bans: [], my_team_side: 'red', notes: 'n' }] }, { writeData: { id: 'd3' } })
    expect(await attachSharedDraft(sb, 's1', 't1')).toBe('d3')
    expect(writes[0][2]).toMatchObject({ source_id: 'team:t1', name: 'Shared', blue_picks: [['Azir']], my_team_side: 'red', notes: 'n' })
    await expect(attachSharedDraft(sb, 's1', 'missing')).rejects.toThrow('NOT_FOUND')
  })
  it('refuses a shared draft of another group (CyberSecurity)', async () => {
    const { sb, writes } = fakeSupabase({ team_sessions: [{ id: 's1', group_id: 'G' }], team_drafts: [{ id: 't2', group_id: 'G2', name: 'Elsewhere', blue_picks: [], blue_bans: [], red_picks: [], red_bans: [], my_team_side: 'blue', notes: null }] })
    await expect(attachSharedDraft(sb, 's1', 't2')).rejects.toThrow('FORBIDDEN')
    expect(writes).toEqual([])
  })
  it('removing a draft nobody may see is NOT_FOUND', async () => {
    await expect(removeDraft(fakeSupabase({}, { writeData: [] }).sb, 'd1')).rejects.toThrow('NOT_FOUND')
    await expect(removeDraft(fakeSupabase({}).sb, 'd1')).resolves.toBeUndefined()
  })
  it('reorders all the session\'s drafts, each once', async () => {
    const tables = { team_session_drafts: [{ id: 'a', session_id: 's1' }, { id: 'b', session_id: 's1' }] }
    const { sb, writes } = fakeSupabase(tables)
    await reorderDrafts(sb, 's1', ['b', 'a'])
    expect(writes.map((w) => w[2])).toEqual([{ position: 0 }, { position: 1 }])
    await expect(reorderDrafts(fakeSupabase(tables).sb, 's1', ['a'])).rejects.toThrow('INVALID')
    await expect(reorderDrafts(fakeSupabase(tables).sb, 's1', ['a', 'a'])).rejects.toThrow('INVALID')
  })
})
