import { describe, it, expect } from 'vitest'
import { rosterLinkErrorKey } from '../../src/components/team/RosterLinkButton'

// #46.4: the « Relier à un membre » menu's errors.
describe('rosterLinkErrorKey', () => {
  it('the RPC codes', () => {
    expect(rosterLinkErrorKey(new Error('NOT_A_MEMBER'))).toBe('team.rosterLink.errors.NOT_A_MEMBER')
    expect(rosterLinkErrorKey(new Error('Error invoking remote method: Error: FORBIDDEN'))).toBe('team.rosterLink.errors.FORBIDDEN')
    expect(rosterLinkErrorKey(new Error('NOT_FOUND'))).toBe('team.rosterLink.errors.NOT_FOUND')
  })
  it('the RPC missing in production reads as « prochaine mise à jour »', () => {
    expect(rosterLinkErrorKey(new Error('Could not find the function public.link_roster_member(p_roster, p_user) in the schema cache')))
      .toBe('team.rosterLink.errors.notDeployed')
    expect(rosterLinkErrorKey({ code: 'PGRST202', message: '' })).toBe('team.rosterLink.errors.notDeployed')
  })
  it('anything else is generic', () => {
    expect(rosterLinkErrorKey(new Error('network down'))).toBe('team.rosterLink.errors.generic')
  })
})
