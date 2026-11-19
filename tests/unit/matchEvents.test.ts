/**
 * #49, scrims planned from the Planning, client side: the pure helpers (matchEvent.ts, opgg.ts), the calls
 * (matchEventCore.ts: what goes to the RPCs, how errors are mapped, how the detail is read), the grid badges
 * (calendarCore.listEvents), and the desktop's opponent import plan (opponentImportCore.ts). The database side is
 * checked by scripts/test-scrims-in-planning.mjs.
 */
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_MATCH_MINUTES, isMatchKind, matchKindOf, opponentOpggUrl, splitRiotIdInput, toOpponentPlayer } from '../../src/lib/matchEvent'
import { buildOpggMultiUrl } from '../../src/lib/opgg'
import { getMatchEvent, listKnownOpponents, saveMatchEvent, updateMatchDetail } from '../../src/lib/matchEventCore'
import { listEvents } from '../../src/lib/calendarCore'
import { planOpponentImport } from '../../src/lib/opponentImportCore'

const result = (data: unknown, error: unknown = null) => ({ data, error })

/** A fake client: every select of `table` resolves to tables[table] (or a function of the select). */
function client(tables: Record<string, unknown | ((cols: string) => unknown)>, rpc = vi.fn()) {
  const from = (table: string) => {
    let cols = ''
    const q: Record<string, unknown> = {}
    q.select = (c: string) => { cols = c; return q }
    for (const m of ['eq', 'in', 'gte', 'lt', 'order', 'limit', 'not']) q[m] = () => q
    const value = () => { const t = tables[table]; return typeof t === 'function' ? (t as (c: string) => unknown)(cols) : (t ?? result([])) }
    q.maybeSingle = () => Promise.resolve(value())
    q.then = (resolve: (v: unknown) => void) => resolve(value())
    return q
  }
  return { from, rpc } as never
}

describe('pure helpers', () => {
  it('CHOICE 1: "Officiel" is the tournament kind, nothing else is a match', () => {
    expect(matchKindOf('scrim')).toBe('scrim')
    expect(matchKindOf('tournament')).toBe('official')
    expect(matchKindOf('flex')).toBeNull()
    expect(isMatchKind('meeting')).toBe(false)
  })
  it('the mockup\'s default lengths', () => {
    expect(DEFAULT_MATCH_MINUTES).toEqual({ bo1: 60, bo3: 150, bo5: 240 })
  })
  it('splits a Riot ID at the last #', () => {
    expect(splitRiotIdInput(' Mr #Tag#EUW ')).toEqual(['Mr #Tag', 'EUW'])
    expect(splitRiotIdInput('NoTag')).toEqual(['NoTag', null])
    expect(splitRiotIdInput('  ')).toBeNull()
    expect(splitRiotIdInput('#EUW')).toBeNull()
  })
  it('an opponent player gets its OP.GG link only with a full Riot ID and a known region', () => {
    expect(toOpponentPlayer('TOP', 'Faker', 'KR1', 'KR').opggUrl).toBe('https://op.gg/lol/summoners/kr/Faker-KR1')
    expect(toOpponentPlayer('TOP', 'Faker', null, 'KR')).toMatchObject({ riotId: 'Faker', opggUrl: null })
  })
  it('the team link: the pasted one, else a multi-search of the full Riot IDs', () => {
    const players = [toOpponentPlayer('TOP', 'A b', 'EUW', 'EUW1'), toOpponentPlayer('MID', 'C', null, null)]
    expect(opponentOpggUrl('https://op.gg/x', players)).toBe('https://op.gg/x')
    expect(opponentOpggUrl(null, players)).toBe(`https://op.gg/multisearch/euw?summoners=${encodeURIComponent('A b#EUW')}`)
    expect(opponentOpggUrl(null, [])).toBeNull()
    expect(buildOpggMultiUrl([{ ign: 'A', tagLine: 'B' }], 'MOON')).toBeNull()
  })
})

describe('saveMatchEvent', () => {
  const event = { kind: 'scrim' as const, title: 'vs KCA', startsAt: '2026-11-21T18:00:00.000Z', endsAt: '2026-11-21T20:30:00.000Z', attendeeUserIds: ['u1'] }
  it('sends the slot and the match to the RPC and returns the slot id', async () => {
    const rpc = vi.fn().mockResolvedValue(result('e1'))
    const id = await saveMatchEvent(client({}, rpc), 'g1', event, { boFormat: 'bo3', opponent: { name: 'KCA', players: [{ role: 'TOP', riotId: 'A#EUW' }] } })
    expect(id).toBe('e1')
    expect(rpc).toHaveBeenCalledWith('save_match_event', {
      p_group: 'g1',
      p_event: { kind: 'scrim', title: 'vs KCA', startsAt: event.startsAt, endsAt: event.endsAt, notes: null, attendeeScope: 'custom', attendeeUserIds: ['u1'] },
      p_match: { boFormat: 'bo3', opponent: { name: 'KCA', tag: null, opggUrl: null, players: [{ role: 'TOP', riotId: 'A#EUW', region: null }] } },
    })
  })
  it('an edit without attendees does not send the key (the RPC keeps them)', async () => {
    const rpc = vi.fn().mockResolvedValue(result('e1'))
    const { attendeeUserIds: _a, ...rest } = event
    await saveMatchEvent(client({}, rpc), 'g1', { ...rest, id: 'e1' }, {})
    const p = rpc.mock.calls[0][1] as { p_event: Record<string, unknown>; p_match: Record<string, unknown> }
    expect(p.p_event.id).toBe('e1')
    expect('attendeeUserIds' in p.p_event).toBe(false)
    expect(p.p_match).toEqual({ boFormat: null, opponent: null })
  })
  it('maps the RPC codes the screens translate', async () => {
    for (const code of ['FORBIDDEN', 'INVALID_OPPONENT', 'INVALID_KIND', 'NOT_FOUND', 'INVALID_EVENT']) {
      const rpc = vi.fn().mockResolvedValue(result(null, { message: code, code: '22023' }))
      await expect(saveMatchEvent(client({}, rpc), 'g1', event, {})).rejects.toThrow(code)
    }
  })
})

describe('updateMatchDetail', () => {
  it('sends only the fields given, empty text for a cleared note', async () => {
    const rpc = vi.fn().mockResolvedValue(result(null))
    await updateMatchDetail(client({}, rpc), 's1', { prepNotes: null, status: 'done' })
    expect(rpc).toHaveBeenCalledWith('update_match_detail', { p_scrim: 's1', p_patch: { prepNotes: '', status: 'done' } })
  })
  it('sends the opponent roles as given (riotId + role only)', async () => {
    const rpc = vi.fn().mockResolvedValue(result(null))
    await updateMatchDetail(client({}, rpc), 's1', { opponentRoles: [{ riotId: 'A#EUW', role: 'MID' }, { riotId: 'B#EUW', role: 'TOP' }] })
    expect(rpc).toHaveBeenCalledWith('update_match_detail', { p_scrim: 's1', p_patch: { opponentRoles: [{ riotId: 'A#EUW', role: 'MID' }, { riotId: 'B#EUW', role: 'TOP' }] } })
  })
  it('maps INVALID_DETAIL', async () => {
    const rpc = vi.fn().mockResolvedValue(result(null, { message: 'INVALID_DETAIL' }))
    await expect(updateMatchDetail(client({}, rpc), 's1', { status: 'done' })).rejects.toThrow('INVALID_DETAIL')
  })
})

const EVENT_ROW = {
  id: 'e1', group_id: 'g1', kind: 'scrim', title: 'vs KCA', starts_at: '2026-11-21T18:00:00Z', ends_at: '2026-11-21T20:30:00Z',
  notes: null, linked_scrim_id: 's1', attendee_scope: 'custom', created_by: 'u0', created_at: 't', updated_at: 't',
}
const SCRIM_ROW = {
  id: 's1', calendar_event_id: 'e1', kind: 'scrim', bo_format: 'bo3', status: 'planned', opponent: 'Karmine Academy', opponent_key: 'karmine academy',
  opponent_scouting_id: 't1', prep_notes: 'Ban Azir', review_notes: null, checklist: [{ label: 'VOD', done: false }], draft_ids: ['d1'],
}

describe('getMatchEvent', () => {
  it('reads the slot, its scrim and its opponent by key, players in lane order, one per role', async () => {
    const sb = client({
      calendar_events: result(EVENT_ROW),
      calendar_event_attendees: result([{ event_id: 'e1', user_id: 'u1' }]),
      calendar_event_responses: result([]),
      scrims: (cols: string) => cols.includes('prep_notes') ? result(SCRIM_ROW) : result([SCRIM_ROW]),
      team_scouting: result([{ id: 't1', name: 'Karmine Academy', tag: 'KCA', opponent_key: 'karmine academy', opgg_url: null, source: 'match' }]),
      team_rosters: result([
        { scouting_id: 't1', role: 'MID', ign: 'Mid', tag_line: 'EUW', region: 'EUW1', created_at: '2' },
        { scouting_id: 't1', role: 'TOP', ign: null, tag_line: null, region: null, created_at: '1' },
        { scouting_id: 't1', role: 'TOP', ign: 'Top', tag_line: 'EUW', region: 'EUW1', created_at: '3' },
      ]),
      opponent_dossiers: result(null, { code: '42P01', message: 'relation does not exist' }),
    })
    const d = await getMatchEvent(sb, 'e1')
    expect(d).not.toBeNull()
    expect(d!.event.match).toMatchObject({ scrimId: 's1', opponentName: 'Karmine Academy', boFormat: 'bo3' })
    expect(d!).toMatchObject({ scrimId: 's1', kind: 'scrim', boFormat: 'bo3', status: 'planned', prepNotes: 'Ban Azir', draftIds: ['d1'] })
    expect(d!.opponent!.players.map((p) => `${p.role}:${p.riotId}`)).toEqual(['TOP:Top#EUW', 'MID:Mid#EUW'])
    expect(d!.opponent).toMatchObject({ key: 'karmine academy', tag: 'KCA', source: 'match', hasDossier: false })
    expect(d!.opponent!.opggUrl).toContain('https://op.gg/multisearch/euw?summoners=')
  })
  it('null for a slot that is not a match', async () => {
    const sb = client({ calendar_events: result({ ...EVENT_ROW, kind: 'flex' }), calendar_event_attendees: result([]), calendar_event_responses: result([]) })
    expect(await getMatchEvent(sb, 'e1')).toBeNull()
  })
})

describe('listKnownOpponents', () => {
  it('most recently played first, then by name', async () => {
    const sb = client({
      team_scouting: result([
        { id: 't1', name: 'Bravo', tag: null, opponent_key: 'bravo', opgg_url: null, source: 'publish' },
        { id: 't2', name: 'Alpha', tag: null, opponent_key: 'alpha', opgg_url: null, source: 'publish' },
        { id: 't3', name: 'Charlie', tag: 'C', opponent_key: 'charlie', opgg_url: 'https://op.gg/c', source: 'match' },
      ]),
      scrims: result([{ opponent_key: 'charlie', scheduled_at: '2026-11-10' }, { opponent_key: 'charlie', scheduled_at: '2026-11-15' }]),
      team_rosters: result([]),
    })
    const list = await listKnownOpponents(sb, 'g1')
    expect(list.map((o) => o.name)).toEqual(['Charlie', 'Alpha', 'Bravo'])
    expect(list[0]).toMatchObject({ lastMatchAt: '2026-11-15', opggUrl: 'https://op.gg/c' })
  })
})

describe('calendar grid badges', () => {
  it('a match slot carries its summary, other slots none', async () => {
    const sb = client({
      calendar_events: result([EVENT_ROW, { ...EVENT_ROW, id: 'e2', kind: 'flex', linked_scrim_id: null }]),
      calendar_event_attendees: result([]),
      calendar_event_responses: result([]),
      scrims: result([SCRIM_ROW]),
    })
    const events = await listEvents(sb, 'g1', 'a', 'b')
    expect(events[0].match).toEqual({ scrimId: 's1', kind: 'scrim', opponentName: 'Karmine Academy', opponentKey: 'karmine academy', boFormat: 'bo3', status: 'planned' })
    expect(events[1]).not.toHaveProperty('match')
  })
  it('before the migration (no calendar_event_id column): the planning without badges', async () => {
    const sb = client({
      calendar_events: result([EVENT_ROW]), calendar_event_attendees: result([]), calendar_event_responses: result([]),
      scrims: result(null, { code: '42703', message: 'column scrims.calendar_event_id does not exist' }),
    })
    const events = await listEvents(sb, 'g1', 'a', 'b')
    expect(events).toHaveLength(1)
    expect(events[0]).not.toHaveProperty('match')
  })
})

describe('planOpponentImport (desktop)', () => {
  const p = (role: 'TOP' | 'MID' | 'SUPPORT', ign: string | null) => ({ role, displayName: ign ?? '', ign, tagLine: 'EUW', region: 'EUW1', puuid: null })
  it('creates a missing opponent with its known players only', () => {
    const plan = planOpponentImport([{ name: 'Karmine Academy', tag: 'KCA', scoutNotes: null, players: [p('TOP', 'A'), p('MID', null)] }], [], new Set())
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0].players.map((x) => x.ign)).toEqual(['A'])
    expect(plan.fill).toEqual([])
  })
  it('an opponent known locally (key match) only gets its missing tag and roles, nothing replaced', () => {
    const plan = planOpponentImport(
      [{ name: ' karmine  ACADEMY', tag: 'KCA', scoutNotes: 'server notes', players: [p('TOP', 'Server'), p('SUPPORT', 'Sup')] }],
      [{ id: 'local1', name: 'Karmine Academy', tag: null, members: [{ role: 'TOP' }] }],
      new Set(),
    )
    expect(plan.create).toEqual([])
    expect(plan.fill).toEqual([{ teamId: 'local1', tag: 'KCA', addPlayers: [p('SUPPORT', 'Sup')] }])
  })
  it('nothing to do when the local copy is complete', () => {
    const plan = planOpponentImport([{ name: 'X', tag: 'X', scoutNotes: null, players: [p('TOP', 'A')] }], [{ id: 'l', name: 'x', tag: 'Y', members: [{ role: 'TOP' }] }], new Set())
    expect(plan).toEqual({ create: [], fill: [] })
  })
  it('an opponent the user deleted locally is not brought back', () => {
    const plan = planOpponentImport([{ name: 'Gone Team', tag: null, scoutNotes: null, players: [] }], [], new Set(['gone team']))
    expect(plan.create).toEqual([])
  })
})
