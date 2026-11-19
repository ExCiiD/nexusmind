import { describe, expect, it } from 'vitest'
import { parseRiotIdInput, planGroupTeamSync, splitRiotId } from '@/lib/groupTeamSyncCore'

const player = (riotId: string | null, displayName: string | null = null, role = 'player') => ({ role, riotId, displayName })

describe('planGroupTeamSync', () => {
  it('adds every player of an empty team on the free lanes, in order', () => {
    const plan = planGroupTeamSync([player('A#EUW', 'Alpha'), player('B#EUW'), player('Coachy#1', null, 'coach')], [])
    expect(plan.remove).toEqual([])
    expect(plan.add).toEqual([
      { displayName: 'Alpha', ign: 'A', tagLine: 'EUW', role: 'TOP' },
      { displayName: 'B', ign: 'B', tagLine: 'EUW', role: 'JUNGLE' },
    ])
  })

  it('skips members without a Riot account and non-players', () => {
    const plan = planGroupTeamSync([player(null, 'Ghost'), player('S#1', null, 'analyst')], [])
    expect(plan.add).toEqual([])
  })

  it('keeps matching members (case/space-insensitive) and their lanes, removes the rest', () => {
    const plan = planGroupTeamSync(
      [player('Big Name#EUW'), player('New#EUW')],
      [
        { id: 'm1', ign: 'bigname', tagLine: 'euw', role: 'TOP' },
        { id: 'old', ign: 'Jade', tagLine: 'EUW', role: 'MID' },
        { id: 'manual', ign: null, tagLine: null, role: 'ADC' },
      ],
    )
    expect(plan.remove).toEqual(['old', 'manual'])
    expect(plan.add).toEqual([{ displayName: 'New', ign: 'New', tagLine: 'EUW', role: 'JUNGLE' }])
  })

  it('uses the published lane when it is free, else the first free one', () => {
    const lanes: Record<string, string> = { 'a#euw': 'SUPPORT', 'b#euw': 'SUPPORT' }
    const plan = planGroupTeamSync([player('A#EUW'), player('B#EUW')], [], (k) => lanes[k])
    expect(plan.add.map((a) => a.role)).toEqual(['SUPPORT', 'TOP'])
  })

  it('removes a duplicate of the same player', () => {
    const plan = planGroupTeamSync([player('A#EUW')], [
      { id: 'x', ign: 'A', tagLine: 'EUW', role: 'TOP' },
      { id: 'y', ign: 'A', tagLine: 'EUW', role: 'MID' },
    ])
    expect(plan).toEqual({ add: [], remove: ['y'], update: [] })
  })
})

describe('Riot ID helpers', () => {
  it('splits at the last #', () => {
    expect(splitRiotId('a#b#EUW')).toEqual(['a#b', 'EUW'])
    expect(splitRiotId('Solo')).toEqual(['Solo', undefined])
  })
  it('validates typed Riot IDs', () => {
    expect(parseRiotIdInput('  ExCiiD#AIGRI ')).toBe('ExCiiD#AIGRI')
    expect(parseRiotIdInput('ExCiiD')).toBeNull()
    expect(parseRiotIdInput('#EUW')).toBeNull()
    expect(parseRiotIdInput('Ab#E')).toBeNull()
  })
})

// #38 (19/11/2026): "ore wa ayura" renamed; the group lost his lane, champions and rank (matched on the Riot ID).
describe('planGroupTeamSync: renamed players (#38)', () => {
  const withPuuid = (riotId: string, puuid: string, displayName: string | null = null) => ({ role: 'player', riotId, displayName, puuid })
  const member = (id: string, ign: string, tagLine: string, role: string, puuid?: string, displayName?: string) =>
    ({ id, ign, tagLine, role, puuid: puuid ?? null, displayName: displayName ?? ign })

  it('a puuid match under a new Riot ID updates the same member (lane kept), nothing added or removed', () => {
    const plan = planGroupTeamSync([withPuuid('Ayura#EUW', 'P1')], [member('m1', 'ore wa ayura', 'EUW', 'ADC', 'P1')])
    expect(plan.remove).toEqual([])
    expect(plan.add).toEqual([])
    expect(plan.update).toEqual([{ id: 'm1', ign: 'Ayura', tagLine: 'EUW', displayName: 'Ayura', previousRiotId: 'ore wa ayura#EUW' }])
  })
  it('a name the staff typed is kept on a rename', () => {
    const plan = planGroupTeamSync([withPuuid('Ayura#EUW', 'P1')], [member('m1', 'ore wa ayura', 'EUW', 'ADC', 'P1', 'Our ADC')])
    expect(plan.update).toEqual([{ id: 'm1', ign: 'Ayura', tagLine: 'EUW', previousRiotId: 'ore wa ayura#EUW' }])
  })
  it('a Riot ID match fills a missing puuid, so the next rename is caught', () => {
    const plan = planGroupTeamSync([withPuuid('Ayura#EUW', 'P1')], [member('m1', 'Ayura', 'EUW', 'ADC')])
    expect(plan.update).toEqual([{ id: 'm1', puuid: 'P1' }])
    expect(plan.remove).toEqual([])
  })
  it('a new player is added with their puuid', () => {
    const plan = planGroupTeamSync([withPuuid('Ayura#EUW', 'P1')], [])
    expect(plan.add).toEqual([{ displayName: 'Ayura', ign: 'Ayura', tagLine: 'EUW', role: 'TOP', puuid: 'P1' }])
  })
  it('the same name with another puuid is another account: replaced, not merged', () => {
    const plan = planGroupTeamSync([withPuuid('Ayura#EUW', 'P2')], [member('m1', 'Ayura', 'EUW', 'ADC', 'P1')])
    expect(plan.remove).toEqual(['m1'])
    expect(plan.add.map((a) => a.puuid)).toEqual(['P2'])
  })
  it('members without a puuid on either side still match on the Riot ID (before the migration)', () => {
    const plan = planGroupTeamSync([player('Ayura#EUW')], [member('m1', 'Ayura', 'EUW', 'ADC')])
    expect(plan).toEqual({ add: [], remove: [], update: [] })
  })
})
