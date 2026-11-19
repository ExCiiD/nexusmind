import { describe, it, expect } from 'vitest'
import { riotIdIssues } from '../../src/lib/riotIdChecksCore'
import type { GroupMember } from '../../src/lib/collab'

// #38: the Riot ID check problems shown to the staff in Management → Groupes.
const m = (userId: string, extra: Partial<GroupMember> = {}): GroupMember => ({
  userId, role: 'player', isCaptain: false, displayName: userId, riotId: `${userId}#EUW`, joinedAt: 't', ...extra,
})

describe('riotIdIssues', () => {
  it('shows nothing for verified, unchecked, or before the migration (no field)', () => {
    expect(riotIdIssues([m('a'), m('b', { puuid: 'p', puuidStatus: 'verified' }), m('c', { puuid: null, puuidStatus: null })]))
      .toEqual({ conflicts: [], notFound: [] })
  })

  it('groups a conflict with the member already holding the puuid, once', () => {
    const holder = m('holder', { puuid: 'p1', puuidStatus: 'verified' })
    const claim = m('claim', { puuid: 'p1', puuidStatus: 'conflict' })
    const claim2 = m('claim2', { puuid: 'p1', puuidStatus: 'conflict' })
    const other = m('other', { puuid: 'p2', puuidStatus: 'verified' })
    const { conflicts } = riotIdIssues([holder, claim, other, claim2])
    expect(conflicts.map((g) => g.map((x) => x.userId))).toEqual([['holder', 'claim', 'claim2']])
  })

  it('keeps a conflict without a puuid on its own, and lists not_found', () => {
    const { conflicts, notFound } = riotIdIssues([m('x', { puuidStatus: 'conflict' }), m('y', { puuid: null, puuidStatus: 'not_found' })])
    expect(conflicts.map((g) => g.map((x) => x.userId))).toEqual([['x']])
    expect(notFound.map((x) => x.userId)).toEqual(['y'])
  })
})
