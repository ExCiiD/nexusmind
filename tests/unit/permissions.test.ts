import { describe, it, expect } from 'vitest'
import { isLegacyStaff, canEditCalendar, canManageSession, canChangeRoles, ASSIGNABLE_ROLES, effectiveRoles, canReadWellbeing, ASSIGNABLE_STAFF_ROLES } from '../../src/lib/permissions'
import type { GroupRole } from '../../src/lib/collab'

const ROLES: GroupRole[] = ['owner', 'coach', 'manager', 'analyst', 'player']

describe('isLegacyStaff', () => {
  it('is true for owner/coach/analyst, false for manager/player', () => {
    expect(ROLES.filter((r) => isLegacyStaff(r))).toEqual(['owner', 'coach', 'analyst'])
  })
})

describe('canEditCalendar', () => {
  it('is true for owner/coach/manager, false for analyst/player', () => {
    expect(ROLES.filter((r) => canEditCalendar(r))).toEqual(['owner', 'coach', 'manager'])
  })

  it('gives the captain the manager\'s hand, whatever their role', () => {
    expect(canEditCalendar('player', true)).toBe(true)
    expect(canEditCalendar('analyst', true)).toBe(true)
    expect(canEditCalendar('player', false)).toBe(false)
  })
})

describe('canChangeRoles', () => {
  it('is the owner\'s alone', () => {
    expect(ROLES.filter(canChangeRoles)).toEqual(['owner'])
    expect(ASSIGNABLE_ROLES).not.toContain('owner')
  })
})

describe('canManageSession', () => {
  it('is true for owner/coach/manager regardless of the captain flag', () => {
    for (const role of ['owner', 'coach', 'manager'] as const) {
      expect(canManageSession(role, false)).toBe(true)
      expect(canManageSession(role, true)).toBe(true)
    }
  })

  it('is false for analyst/player unless they are flagged captain', () => {
    expect(canManageSession('analyst', false)).toBe(false)
    expect(canManageSession('player', false)).toBe(false)
    expect(canManageSession('analyst', true)).toBe(true)
    expect(canManageSession('player', true)).toBe(true)
  })
})

describe('#39 extra staff roles', () => {
  it('effectiveRoles adds the staff roles once, after the main role', () => {
    expect(effectiveRoles('player', ['coach', 'manager'])).toEqual(['player', 'coach', 'manager'])
    expect(effectiveRoles('coach', ['coach', 'analyst'])).toEqual(['coach', 'analyst'])
    expect(effectiveRoles('player')).toEqual(['player'])
  })

  it('a player-coach is staff and manages sessions, a player-manager edits the calendar but is not staff', () => {
    expect(isLegacyStaff('player', ['coach'])).toBe(true)
    expect(canManageSession('player', false, ['coach'])).toBe(true)
    expect(isLegacyStaff('player', ['manager'])).toBe(false)
    expect(canEditCalendar('player', false, ['manager'])).toBe(true)
    expect(isLegacyStaff('player')).toBe(false)
    expect(canEditCalendar('player', false, [])).toBe(false)
  })

  it('wellbeing: a staff role AND a main role other than player', () => {
    expect(canReadWellbeing('coach')).toBe(true)
    expect(canReadWellbeing('owner')).toBe(true)
    expect(canReadWellbeing('manager', ['coach'])).toBe(true)
    expect(canReadWellbeing('player', ['coach'])).toBe(false)
    expect(canReadWellbeing('player', ['analyst', 'manager'])).toBe(false)
    expect(canReadWellbeing('manager')).toBe(false)
  })

  it('the owner can add coach, manager or analyst', () => {
    expect(ASSIGNABLE_STAFF_ROLES).toEqual(['coach', 'manager', 'analyst'])
  })
})
