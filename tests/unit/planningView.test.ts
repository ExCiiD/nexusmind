import { describe, it, expect } from 'vitest'
import { availableCount, availableAnyTime, suggestTitle, completeTitle, userWindows } from '../../src/lib/planningView'
import type { AvailabilityException, AvailabilityRule } from '../../src/lib/calendar'
import type { GroupMember } from '../../src/lib/collab'

const rule = (userId: string, weekday: number, startTime: string, endTime: string): AvailabilityRule => ({ id: `${userId}${weekday}`, groupId: 'g', userId, weekday, startTime, endTime })
const ex = (userId: string, date: string, available: boolean, startTime: string | null = null, endTime: string | null = null): AvailabilityException => ({ id: `${userId}${date}`, groupId: 'g', userId, date, available, startTime, endTime, note: null })
const member = (userId: string, role: GroupMember['role'], name: string): GroupMember => ({ userId, role, isCaptain: false, displayName: name, riotId: null, joinedAt: '' })

// 2026-11-16 is a Monday (weekday 1).
const MON = '2026-11-16'

describe('availability', () => {
  const rules = [rule('a', 1, '18:00', '23:00'), rule('b', 1, '20:00', '23:00'), rule('c', 2, '18:00', '23:00')]
  it('counts users free for a whole span', () => {
    expect(availableCount(rules, [], ['a', 'b', 'c'], MON, 19 * 60, 20 * 60)).toBe(1)
    expect(availableCount(rules, [], ['a', 'b', 'c'], MON, 20 * 60, 21 * 60)).toBe(2)
  })
  it('lets a per-date exception override the recurring rule', () => {
    const exceptions = [ex('a', MON, false), ex('c', MON, true, '19:00', '22:00')]
    expect(userWindows(rules, exceptions, 'a', MON)).toEqual([])
    expect(availableCount(rules, exceptions, ['a', 'b', 'c'], MON, 20 * 60, 21 * 60)).toBe(2)
    expect(availableAnyTime(rules, exceptions, ['a', 'b', 'c'], MON)).toBe(2)
  })
})

describe('suggestTitle', () => {
  const members = [member('me', 'coach', 'Coach'), member('p1', 'player', 'Kai'), member('p2', 'player', 'Zed'), member('m', 'manager', 'Mgr')]
  it('2 people → 1:1 with the other person', () => {
    expect(suggestTitle('custom', ['me', 'p1'], members, 'me')).toMatchObject({ key: 'oneOnOne', name: 'Kai', kind: 'one_on_one' })
  })
  it('whole team (staff included) → team meeting', () => {
    expect(suggestTitle('whole_team', [], members, 'me').key).toBe('teamMeeting')
    expect(suggestTitle('custom', ['me', 'p1', 'p2', 'm'], members, 'me').key).toBe('teamMeeting')
  })
  it('players + coach → VOD review', () => {
    expect(suggestTitle('custom', ['me', 'p1', 'p2'], members, 'me')).toMatchObject({ key: 'vodReview', kind: 'team_review' })
  })
  it('staff only → staff meeting; players only → kind label', () => {
    expect(suggestTitle('all_staff', [], members, 'me').key).toBe('staffMeeting')
    expect(suggestTitle('all_players', [], members, 'me').key).toBe('kind')
  })
})

describe('completeTitle', () => {
  const s = ['SoloQ', 'Scrim BO3', 'Réunion d’équipe']
  it('completes accent- and case-insensitively', () => {
    expect(completeTitle('sol', s)).toBe('SoloQ')
    expect(completeTitle('reu', s)).toBe('Réunion d’équipe')
  })
  it('needs 2 characters and never "completes" an exact match', () => {
    expect(completeTitle('s', s)).toBeNull()
    expect(completeTitle('SoloQ', s)).toBeNull()
  })
})

describe('localDateKey', () => {
  it('uses the local calendar day, not the UTC one', async () => {
    const { localDateKey } = await import('../../src/lib/planningView')
    const d = new Date(2026, 10, 16, 0, 30) // local Monday 00:30
    expect(localDateKey(d)).toBe('2026-11-16')
  })
})
