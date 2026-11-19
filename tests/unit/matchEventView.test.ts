import { describe, it, expect } from 'vitest'
import {
  availableCount, draftFromDetail, emptyMatchDraft, emptyOpponents, endMinFor, isRiotIdShape, matchBadgeText,
  matchDraftErrors, opponentsFromMultiLink, toMatchInput, createLabelKey, isServerNotReadyError, matchErrorKey, opponentRoleChange, applyOpponentRoles,
} from '../../src/lib/matchEventView'
import type { MatchEventDetail } from '../../src/lib/matchEvent'

// #49: scrims in the Planning (docs/DESIGN_STATE.md § 13, docs/CONTRAT_SCRIMS_PLANNING.md).
describe('format and end time', () => {
  it('Bo1 1 h, Bo3 2 h 30, Bo5 4 h, capped at midnight', () => {
    expect(endMinFor(18 * 60, 'bo1')).toBe(19 * 60)
    expect(endMinFor(18 * 60, 'bo3')).toBe(20 * 60 + 30)
    expect(endMinFor(22 * 60, 'bo5')).toBe(1440)
  })
  it('create label per kind', () => {
    expect(createLabelKey('scrim')).toBe('planning.match.createScrim')
    expect(createLabelKey('tournament')).toBe('planning.match.createOfficial')
  })
})

describe('opponents', () => {
  it('a multi link fills the lines in order, keeping the roles, with the region', () => {
    const rows = opponentsFromMultiLink('https://www.op.gg/multisearch/euw?summoners=Alpha%23EUW,Beta%23EUW', emptyOpponents())
    expect(rows?.slice(0, 3).map((r) => [r.role, r.riotId])).toEqual([['TOP', 'Alpha#EUW'], ['JUNGLE', 'Beta#EUW'], ['MID', '']])
    expect(rows?.[0].region).toBeTruthy()
    expect(opponentsFromMultiLink('not a link', emptyOpponents())).toBeNull()
  })
  it('Riot ID shape', () => {
    expect(isRiotIdShape('Faker#KR1')).toBe(true)
    expect(isRiotIdShape('Faker')).toBe(false)
    expect(isRiotIdShape('ab#EUW')).toBe(false)
  })
})

describe('to and from the contract', () => {
  it('toMatchInput drops empty Riot IDs and a non-https link; no name, no opponent', () => {
    const d = { ...emptyMatchDraft([]), name: ' Karmine Academy ', tag: 'KCA', multiLink: 'op.gg/x', bo: 'bo5' as const }
    d.opponents[1] = { role: 'JUNGLE', riotId: 'Vex#EUW', region: 'EUW1', status: 'found' }
    expect(toMatchInput(d)).toEqual({
      boFormat: 'bo5',
      opponent: { name: 'Karmine Academy', tag: 'KCA', opggUrl: null, players: [{ role: 'JUNGLE', riotId: 'Vex#EUW', region: 'EUW1' }] },
    })
    expect(toMatchInput(emptyMatchDraft([])).opponent).toBeNull()
  })
  it('draftFromDetail fills the pop-up for an edit', () => {
    const detail = {
      boFormat: 'bo1',
      opponent: { key: 'kca', name: 'Karmine Academy', tag: 'KCA', opggUrl: 'https://op.gg/m', source: 'match', hasDossier: false,
        players: [{ role: 'MID', riotId: 'Ghost#EUW', region: 'EUW1', opggUrl: null }] },
    } as unknown as MatchEventDetail
    const d = draftFromDetail(detail, [])
    expect([d.bo, d.opponentMode, d.knownKey, d.name, d.tag, d.multiLink]).toEqual(['bo1', 'known', 'kca', 'Karmine Academy', 'KCA', 'https://op.gg/m'])
    expect(d.opponents.map((o) => o.riotId)).toEqual(['', '', 'Ghost#EUW', '', ''])
  })
})

describe('opponent roles in the panel (opponentRoles)', () => {
  const players = [
    { role: 'TOP' as const, riotId: 'Rook#EUW' },
    { role: 'MID' as const, riotId: 'Ghost#EUW' },
    { role: 'ADC' as const, riotId: null },
  ]
  it('a free role is one entry; a held role swaps both in one patch', () => {
    expect(opponentRoleChange(players, 'Rook#EUW', 'JUNGLE')).toEqual([{ riotId: 'Rook#EUW', role: 'JUNGLE' }])
    expect(opponentRoleChange(players, 'Rook#EUW', 'MID')).toEqual([{ riotId: 'Rook#EUW', role: 'MID' }, { riotId: 'Ghost#EUW', role: 'TOP' }])
  })
  it('nothing for the same role or an unknown player; a role held by a line without Riot ID is not swapped', () => {
    expect(opponentRoleChange(players, 'Rook#EUW', 'TOP')).toEqual([])
    expect(opponentRoleChange(players, 'Nobody#EUW', 'MID')).toEqual([])
    expect(opponentRoleChange(players, 'Ghost#EUW', 'ADC')).toEqual([{ riotId: 'Ghost#EUW', role: 'ADC' }])
  })
  it('applyOpponentRoles updates the detail, in role order', () => {
    const detail = { opponent: { players: players.map((p) => ({ ...p, region: null, opggUrl: null })) } } as unknown as MatchEventDetail
    const out = applyOpponentRoles(detail, [{ riotId: 'Rook#EUW', role: 'MID' }, { riotId: 'Ghost#EUW', role: 'TOP' }])
    expect(out.opponent?.players.map((p) => [p.role, p.riotId])).toEqual([['TOP', 'Ghost#EUW'], ['MID', 'Rook#EUW'], ['ADC', null]])
    expect(applyOpponentRoles(detail, [])).toBe(detail)
  })
})

describe('errors', () => {
  it('a server without the #49 migration reads as « prochaine mise à jour »', () => {
    expect(isServerNotReadyError({ code: 'PGRST202', message: 'Could not find the function public.save_match_event' })).toBe(true)
    expect(isServerNotReadyError(new Error('Error invoking remote method: function public.get_match_event(uuid) does not exist'))).toBe(true)
    expect(isServerNotReadyError(new Error('relation "public.scrim_opponents" does not exist'))).toBe(true)
    expect(isServerNotReadyError({ code: '42703', message: 'column scrims.calendar_event_id does not exist' })).toBe(true)
    expect(isServerNotReadyError(new Error('FORBIDDEN'))).toBe(false)
    expect(matchErrorKey({ code: 'PGRST205' })).toBe('planning.match.errors.notDeployed')
  })
  it('contract codes, else the fallback', () => {
    expect(matchErrorKey(new Error('INVALID_OPPONENT: bad tag'))).toBe('planning.match.errors.INVALID_OPPONENT')
    expect(matchErrorKey(new Error('boom'))).toBe('planning.match.errors.generic')
    expect(matchErrorKey(new Error('boom'), 'collab.x')).toBe('collab.x')
  })
})

describe('validation, roster, badge', () => {
  it('the name is required, the tag 2-5 characters', () => {
    expect(matchDraftErrors({ name: ' ', tag: '' })).toEqual({ name: 'required' })
    expect(matchDraftErrors({ name: 'KCA', tag: 'K' })).toEqual({ tag: 'length' })
    expect(matchDraftErrors({ name: 'Karmine Academy', tag: 'KCA' })).toEqual({})
  })
  it('counts the available starters', () => {
    expect(availableCount([
      { role: 'TOP', userId: 'a', name: 'A', available: true },
      { role: 'JUNGLE', userId: 'b', name: 'B', available: false },
      { role: 'MID', userId: null, name: null, available: null },
    ])).toBe(1)
  })
  it('« vs X · BO3 » from the event summary', () => {
    expect(matchBadgeText({ opponentName: 'Karmine Academy', boFormat: 'bo3' })).toBe('vs Karmine Academy · BO3')
    expect(matchBadgeText({ opponentName: null, boFormat: 'bo1' })).toBe('BO1')
    expect(matchBadgeText({ opponentName: null, boFormat: null })).toBeNull()
  })
})
