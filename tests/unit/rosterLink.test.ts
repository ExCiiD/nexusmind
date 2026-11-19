/** #46 point 4: linking the published roster to the group's members (rosterLinkCore.linkRosterToMembers). */
import { describe, it, expect } from 'vitest'
import { linkRosterToMembers } from '../../src/lib/rosterLinkCore'

const m = (userId: string, riotId: string | null, puuid: string | null = null, verified = false) => ({ userId, riotId, puuid, puuidStatus: verified ? 'verified' : null })
const r = (ign: string | null, tagLine: string | null, puuid: string | null = null) => ({ ign, tagLine, puuid })

describe('linkRosterToMembers', () => {
  it('a renamed player linked by puuid takes the member\'s current Riot ID (the "ore wa ayura" case)', () => {
    expect(linkRosterToMembers([r('ORE WA AYURA', 'EUW', 'P1')], [m('u1', 'AYURA#1012', 'P1', true)]))
      .toEqual([{ userId: 'u1', puuid: 'P1', ign: 'AYURA', tagLine: '1012' }])
  })
  it('by Riot ID when the roster has no puuid: case, spaces and full-width ignored, the verified puuid filled in', () => {
    expect(linkRosterToMembers([r('Mid  Laner', 'euw')], [m('u2', 'midlaner#EUW', 'P2', true)]))
      .toEqual([{ userId: 'u2', puuid: 'P2' }])
  })
  it('a puuid the server did not verify is never published', () => {
    expect(linkRosterToMembers([r('A', 'EUW')], [m('u3', 'A#EUW', 'TYPED', false)])).toEqual([{ userId: 'u3', puuid: null }])
  })
  it('one member is linked to one row at most, an unmatched row is left as it is', () => {
    expect(linkRosterToMembers([r('A', 'EUW'), r('a', 'euw'), r('Nobody', 'X', 'PX')], [m('u4', 'A#EUW')]))
      .toEqual([{ userId: 'u4', puuid: null }, { userId: null, puuid: null }, { userId: null, puuid: 'PX' }])
  })
  it('no Riot ID change when the puuid match already has the current name', () => {
    expect(linkRosterToMembers([r('Same', 'TAG', 'P5')], [m('u5', 'same#tag', 'P5', true)])).toEqual([{ userId: 'u5', puuid: 'P5' }])
  })
})
