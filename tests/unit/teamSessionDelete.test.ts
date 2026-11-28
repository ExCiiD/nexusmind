/**
 * Deleting team sessions (DECISIONS 28/11, migration 20261128150000_team_session_delete): who may, what the client
 * sends and reads back, and what the migration promises (staff only, server side, the players' games kept, one
 * result per session).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canDeleteTeamSessions, deleteTeamSessions, listTeamSessionHistory } from '../../src/lib/teamSessionHistoryCore'
import { TEAM_SESSION_DELETE_MAX } from '../../src/lib/teamSessionHistory'

type Result = { data: unknown; error: unknown }

/** A Supabase stub: tables answered with their rows filtered by .eq() / .in(), and an rpc handler. */
function fakeSupabase(tables: Record<string, any[]>, rpc?: (name: string, args: any) => Result) {
  const calls: Array<{ kind: 'from' | 'rpc'; name: string; args?: unknown }> = []
  const sb = {
    from(table: string) {
      calls.push({ kind: 'from', name: table })
      const filters: Array<(r: any) => boolean> = []
      const run = (): Result => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null })
      const q: any = {
        select: () => q,
        eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return q },
        in: (col: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[col])); return q },
        not: () => q,
        order: () => q,
        then: (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      }
      return q
    },
    rpc: (name: string, args: unknown) => {
      calls.push({ kind: 'rpc', name, args })
      return Promise.resolve(rpc ? rpc(name, args) : { data: [], error: null })
    },
  }
  return { sb: sb as never, calls }
}

/**
 * The server's rule, as public.delete_team_sessions applies it, over an in-memory group: used to drive the client
 * through realistic answers (staff accepted, player refused, games kept, mixed batch).
 */
function serverModel() {
  const db = {
    group_members: [
      { group_id: 'G', user_id: 'owner', role: 'owner', staff_roles: [] as string[] },
      { group_id: 'G', user_id: 'coach2', role: 'player', staff_roles: ['coach'] },
      { group_id: 'G', user_id: 'analyst', role: 'analyst', staff_roles: [] },
      { group_id: 'G', user_id: 'player', role: 'player', staff_roles: [] },
    ],
    team_sessions: [
      { id: 's1', group_id: 'G', status: 'ended' },
      { id: 's2', group_id: 'G', status: 'ended' },
      { id: 's3', group_id: 'G', status: 'live' },
      { id: 'sX', group_id: 'OTHER', status: 'ended' },
    ],
    team_session_games: [{ id: 'tg1', session_id: 's1', match_id: 'EUW1_1' }, { id: 'tg2', session_id: 's2', match_id: 'EUW1_2' }],
    // A player's own games (sync_records / local base): no foreign key to the team session tables.
    sync_records: [{ id: 'r1', owner: 'player', match_id: 'EUW1_1' }, { id: 'r2', owner: 'owner', match_id: 'EUW1_2' }],
  }
  const failOn = new Set<string>()
  const call = (uid: string) => (_name: string, args: { p_session_ids: string[] }): Result => {
    const rows = [...new Set(args.p_session_ids)].map((id) => {
      const s = db.team_sessions.find((x) => x.id === id)
      const me = s && db.group_members.find((m) => m.group_id === s.group_id && m.user_id === uid)
      if (!s || !me) return { session_id: id, status: 'not_found', reason: null }
      const staff = ['owner', 'coach', 'manager'].includes(me.role) || me.staff_roles.some((r) => ['owner', 'coach', 'manager'].includes(r))
      if (!staff) return { session_id: id, status: 'refused', reason: 'not_staff' }
      if (s.status !== 'ended') return { session_id: id, status: 'refused', reason: 'not_ended' }
      if (failOn.has(id)) return { session_id: id, status: 'refused', reason: 'error' }
      db.team_sessions = db.team_sessions.filter((x) => x.id !== id)
      db.team_session_games = db.team_session_games.filter((g) => g.session_id !== id) // on delete cascade
      return { session_id: id, status: 'deleted', reason: null }
    })
    return { data: rows, error: null }
  }
  return { db, call, failOn }
}

describe('who may delete', () => {
  it('owner, coach and manager, as main or extra staff role', () => {
    expect(canDeleteTeamSessions('owner')).toBe(true)
    expect(canDeleteTeamSessions('coach')).toBe(true)
    expect(canDeleteTeamSessions('manager')).toBe(true)
    expect(canDeleteTeamSessions('player', ['coach'])).toBe(true)
    expect(canDeleteTeamSessions('player', ['manager'])).toBe(true)
  })
  it('not a player, an analyst, a sub, or someone without a role', () => {
    expect(canDeleteTeamSessions('player')).toBe(false)
    expect(canDeleteTeamSessions('analyst')).toBe(false)
    expect(canDeleteTeamSessions('player', ['analyst'])).toBe(false)
    expect(canDeleteTeamSessions('sub')).toBe(false)
    expect(canDeleteTeamSessions(null)).toBe(false)
  })
  it('the history page says so (canDelete), captain alone included as no', async () => {
    const page = async (member: Record<string, unknown> | null) => {
      const { sb } = fakeSupabase({ group_members: member ? [{ group_id: 'G', user_id: 'me', staff_roles: [], is_captain: false, ...member }] : [], team_sessions: [] })
      return (await listTeamSessionHistory(sb, 'me', 'G', { kind: 'all', period: 'all' })).canDelete
    }
    expect(await page({ role: 'owner' })).toBe(true)
    expect(await page({ role: 'player', staff_roles: ['manager'] })).toBe(true)
    expect(await page({ role: 'player' })).toBe(false)
    expect(await page({ role: 'player', is_captain: true })).toBe(false)
    expect(await page(null)).toBe(false)
  })
})

describe('deleteTeamSessions', () => {
  it('staff: the sessions go, one call, the players\' games stay', async () => {
    const server = serverModel()
    const { sb, calls } = fakeSupabase({}, server.call('owner'))
    expect(await deleteTeamSessions(sb, ['s1', 's2'])).toEqual([
      { sessionId: 's1', status: 'deleted' }, { sessionId: 's2', status: 'deleted' },
    ])
    expect(calls).toEqual([{ kind: 'rpc', name: 'delete_team_sessions', args: { p_session_ids: ['s1', 's2'] } }])
    expect(server.db.team_sessions.map((s) => s.id)).toEqual(['s3', 'sX'])
    expect(server.db.team_session_games).toEqual([])
    expect(server.db.sync_records).toHaveLength(2) // the games of each player's solo history
  })
  it('an extra staff role (coach) is accepted', async () => {
    const server = serverModel()
    const { sb } = fakeSupabase({}, server.call('coach2'))
    expect(await deleteTeamSessions(sb, ['s1'])).toEqual([{ sessionId: 's1', status: 'deleted' }])
  })
  it('a player is refused and nothing goes', async () => {
    const server = serverModel()
    const { sb } = fakeSupabase({}, server.call('player'))
    expect(await deleteTeamSessions(sb, ['s1', 's2'])).toEqual([
      { sessionId: 's1', status: 'refused', reason: 'not_staff' }, { sessionId: 's2', status: 'refused', reason: 'not_staff' },
    ])
    expect(server.db.team_sessions).toHaveLength(4)
    expect(server.db.team_session_games).toHaveLength(2)
  })
  it('the analyst is refused too', async () => {
    const { sb } = fakeSupabase({}, serverModel().call('analyst'))
    expect((await deleteTeamSessions(sb, ['s1']))[0]).toEqual({ sessionId: 's1', status: 'refused', reason: 'not_staff' })
  })
  it('a mixed batch answers per session, in the order given, duplicates once', async () => {
    const server = serverModel()
    server.failOn.add('s2')
    const { sb } = fakeSupabase({}, server.call('owner'))
    expect(await deleteTeamSessions(sb, ['s3', 's1', 'nope', 's1', 'sX', 's2'])).toEqual([
      { sessionId: 's3', status: 'refused', reason: 'not_ended' },
      { sessionId: 's1', status: 'deleted' },
      { sessionId: 'nope', status: 'not_found' },
      { sessionId: 'sX', status: 'not_found' }, // another group: not revealed
      { sessionId: 's2', status: 'refused', reason: 'error' }, // its failure does not undo s1
    ])
    expect(server.db.team_sessions.map((s) => s.id)).toEqual(['s2', 's3', 'sX'])
  })
  it('an id the server did not answer for reads not_found; an unknown status reads refused / error', async () => {
    const { sb } = fakeSupabase({}, () => ({ data: [{ session_id: 'a', status: 'weird', reason: null }], error: null }))
    expect(await deleteTeamSessions(sb, ['a', 'b'])).toEqual([
      { sessionId: 'a', status: 'refused', reason: 'error' }, { sessionId: 'b', status: 'not_found' },
    ])
  })
  it('no id: no call', async () => {
    const { sb, calls } = fakeSupabase({})
    expect(await deleteTeamSessions(sb, [])).toEqual([])
    expect(calls).toEqual([])
  })
  it('too many ids is refused before any call', async () => {
    const { sb, calls } = fakeSupabase({})
    const ids = Array.from({ length: TEAM_SESSION_DELETE_MAX + 1 }, (_, i) => `id${i}`)
    await expect(deleteTeamSessions(sb, ids)).rejects.toThrow('TOO_MANY')
    expect(calls).toEqual([])
  })
  it('maps the server errors', async () => {
    const err = (error: unknown) => fakeSupabase({}, () => ({ data: null, error })).sb
    await expect(deleteTeamSessions(err({ code: 'PGRST202', message: 'Could not find the function' }), ['a'])).rejects.toThrow('NOT_AVAILABLE')
    await expect(deleteTeamSessions(err({ code: '42501', message: 'FORBIDDEN' }), ['a'])).rejects.toThrow('FORBIDDEN')
    await expect(deleteTeamSessions(err({ code: '22023', message: 'TOO_MANY' }), ['a'])).rejects.toThrow('TOO_MANY')
  })
})

// ── The migration's promises (static: no Postgres in the unit tests) ───────────────────────────────────────────
const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261128150000_team_session_delete.sql'), 'utf8')
const rollback = readFileSync(resolve(__dirname, '../../supabase/rollback/20261128150000_rollback.sql'), 'utf8')
const code = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
const fn = code(sql).slice(code(sql).indexOf('create or replace function public.delete_team_sessions'))

describe('migration 20261128150000_team_session_delete', () => {
  it('a security definer function with an empty search_path, for signed-in users only', () => {
    expect(fn).toMatch(/security definer\s+set search_path = ''/)
    expect(code(sql)).toContain('revoke all on function public.delete_team_sessions(uuid[]) from public, anon;')
    expect(code(sql)).toContain('grant execute on function public.delete_team_sessions(uuid[]) to authenticated;')
    expect(fn).toMatch(/if v_uid is null then\s+raise exception 'FORBIDDEN'/)
  })
  it('checks the role server side: owner, coach, manager only, and a non-member reads not_found', () => {
    expect(fn).toContain(`private.has_group_role(v_row.group_id, array['owner', 'coach', 'manager'], v_uid)`)
    expect(fn).not.toMatch(/is_captain|analyst|can_manage_session/)
    expect(fn).toMatch(/private\.group_role\(v_row\.group_id, v_uid\) is null then\s+status := 'not_found'/)
  })
  it('opens no direct DELETE on team_sessions (no policy added)', () => {
    expect(code(sql)).not.toMatch(/create policy/i)
    expect(code(sql)).not.toMatch(/grant\s+[^;]*\bdelete\b[^;]*\bon\s+(table\s+)?public\.team_sessions\b/i)
  })
  it('deletes only the session row: the rest goes by the session tables\' cascade, the players\' data is not touched', () => {
    const deletes = [...fn.matchAll(/delete from ([\w.]+)/g)].map((m) => m[1])
    expect(deletes).toEqual(['public.team_sessions'])
    expect(code(sql)).not.toMatch(/sync_records|calendar_events\s+(set|where)|drop|alter table/i)
  })
  it('only ended sessions, each in its own subtransaction, at most 100 ids', () => {
    expect(fn).toMatch(/v_row\.status <> 'ended' then\s+status := 'refused'; reason := 'not_ended'/)
    expect(fn).toMatch(/begin[\s\S]*exception when others then\s+[\s\S]*status := 'refused'; reason := 'error';\s+end;\s+v_row := null;\s+return next;/)
    expect(fn).toContain('cardinality(p_session_ids) > 100')
    expect(TEAM_SESSION_DELETE_MAX).toBe(100)
  })
  it('a deleted session does not come back when its slot is edited', () => {
    expect(fn).toContain('insert into private.team_session_deletions')
    expect(code(sql)).toMatch(/not exists \(select 1 from private\.team_session_deletions d where d\.event_id = new\.id\)/)
    expect(code(sql)).toContain('revoke all on private.team_session_deletions from public, anon, authenticated;')
  })
  it('the rollback drops the function and the table, and restores the trigger without the check', () => {
    expect(rollback).toContain('drop function if exists public.delete_team_sessions(uuid[]);')
    expect(rollback).toContain('drop table if exists private.team_session_deletions;')
    expect(code(rollback)).toContain('create or replace function private.team_session_follows_event()')
    expect(code(rollback)).not.toContain('team_session_deletions d')
  })
  it('the restored trigger is the migration\'s body minus the check (nothing else drifts)', () => {
    const body = (s: string) => {
      const c = code(s)
      const start = c.indexOf('create or replace function private.team_session_follows_event()')
      return c.slice(start, c.indexOf('$$;', start)).replace(/\s+and not exists \(select 1 from private\.team_session_deletions d where d\.event_id = new\.id\)/, '').replace(/\s+/g, ' ')
    }
    expect(body(sql)).toBe(body(rollback))
  })
})
