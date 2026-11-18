import { describe, it, expect } from 'vitest'
import { isLegacyStaff, canEditCalendar, canManageSession, canChangeRoles, ASSIGNABLE_ROLES } from '../../src/lib/permissions'
import type { GroupRole } from '../../src/lib/collab'

const ROLES: GroupRole[] = ['owner', 'coach', 'manager', 'analyst', 'player']

describe('isLegacyStaff', () => {
  it('is true for owner/coach/analyst, false for manager/player', () => {
    expect(ROLES.filter(isLegacyStaff)).toEqual(['owner', 'coach', 'analyst'])
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
