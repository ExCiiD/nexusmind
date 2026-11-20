import { describe, it, expect, vi } from 'vitest'
import { respondToEvent } from '../../src/lib/calendarCore'
import { setMemberRole } from '../../src/lib/collabCore'
import { attendanceOf, canRespond, dayAvailability, planningPlayers, presenceOf, windowLabel } from '../../src/lib/planningView'
import { directMessageText, listPendingDirectNotifications, markDirectMessageSent } from '../../src/lib/discordBotCore'
import type { AvailabilityException, AvailabilityRule, CalendarEvent } from '../../src/lib/calendar'
import type { GroupMember } from '../../src/lib/collab'

function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'order']) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

const member = (userId: string, role: GroupMember['role'], isCaptain = false): GroupMember => ({ userId, role, isCaptain, displayName: userId, riotId: null, joinedAt: '' })

// Wednesday 18 November 2026, 20:00–22:00 local time.
const start = new Date(2026, 10, 18, 20, 0)
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', groupId: 'g1', kind: 'scrim', title: 'Scrim vs Aegis',
  startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
  notes: null, linkedScrimId: null, attendeeScope: 'custom', attendeeUserIds: ['p1', 'p2', 'p3'],
  responses: [], createdBy: 'o', createdAt: '', updatedAt: '', ...over,
})
const rule = (userId: string, weekday: number, startTime: string, endTime: string): AvailabilityRule => ({ id: `${userId}-${weekday}`, groupId: 'g1', userId, weekday, startTime, endTime })
const exception = (userId: string, date: string, available: boolean, note: string | null = null): AvailabilityException => ({ id: `${userId}-${date}`, groupId: 'g1', userId, date, available, startTime: null, endTime: null, note })

describe('planningPlayers', () => {
  const members = [member('o', 'owner'), member('p1', 'player'), member('p2', 'player', true), member('c', 'coach')]
  it('follows the published starters when they are linked', () => {
    expect(planningPlayers(['p1'], members)).toEqual({ ids: ['p1'], fromRoster: true })
  })
  it('falls back to every player of the group without a published roster', () => {
    expect(planningPlayers([], members)).toEqual({ ids: ['p1', 'p2'], fromRoster: false })
  })
})

describe('dayAvailability', () => {
  const rules = [rule('p1', 3, '18:00', '23:00')]
  it('reads the weekly rule, an "unavailable" day and an empty one', () => {
    expect(dayAvailability(rules, [], 'p1', '2026-11-18')).toEqual({ state: 'free', windows: [{ start: 18 * 60, end: 23 * 60 }] })
    expect(dayAvailability(rules, [exception('p1', '2026-11-18', false, 'Exam')], 'p1', '2026-11-18')).toEqual({ state: 'off', note: 'Exam' })
    expect(dayAvailability(rules, [], 'p1', '2026-11-19')).toEqual({ state: 'unknown' })
  })
  it('labels a window', () => {
    expect(windowLabel({ start: 18 * 60, end: 23 * 60 + 30 })).toBe('18:00–23:30')
  })
})

describe('presence at an event', () => {
  const rules = [rule('p1', 3, '18:00', '23:00')]
  it('puts an answer before the availability', () => {
    const e = event({ responses: [{ userId: 'p1', status: 'declined', note: 'Sick', respondedAt: '' }] })
    expect(presenceOf(e, 'p1', rules, [])).toEqual({ presence: 'declined', note: 'Sick' })
  })
  it('reads the availability when there is no answer', () => {
    expect(presenceOf(event(), 'p1', rules, []).presence).toBe('free')
    expect(presenceOf(event(), 'p2', rules, []).presence).toBe('unknown')
  })
  it('counts present and absent attendees for the card', () => {
    const e = event({ responses: [{ userId: 'p2', status: 'confirmed', note: null, respondedAt: '' }, { userId: 'p3', status: 'declined', note: null, respondedAt: '' }] })
    expect(attendanceOf(e, rules, [])).toEqual({ present: 2, declined: 1, total: 3 })
  })
  it('lets attendees answer until the event ends', () => {
    expect(canRespond(event(), 'p1', start.getTime())).toBe(true)
    expect(canRespond(event(), 'x', start.getTime())).toBe(false)
    expect(canRespond(event({ attendeeUserIds: [] }), 'x', start.getTime())).toBe(true)
    expect(canRespond(event(), 'p1', start.getTime() + 3 * 3_600_000)).toBe(false)
  })
})

describe('respondToEvent', () => {
  it('calls the RPC with the answer and its reason', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    await respondToEvent({ rpc } as never, 'e1', 'declined', 'Exam')
    expect(rpc).toHaveBeenCalledWith('respond_to_calendar_event', { p_event: 'e1', p_status: 'declined', p_note: 'Exam' })
  })
  it('keeps the server\'s reason for a refusal', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'NOT_CONCERNED', code: '42501' } })
    await expect(respondToEvent({ rpc } as never, 'e1', 'confirmed')).rejects.toThrow('NOT_CONCERNED')
  })
})

describe('setMemberRole', () => {
  it('calls the owner-only RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    await setMemberRole({ rpc } as never, 'g1', 'u2', 'manager')
    expect(rpc).toHaveBeenCalledWith('set_member_role', { p_group: 'g1', p_user: 'u2', p_role: 'manager' })
  })
  it('maps a refusal to FORBIDDEN', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'FORBIDDEN', code: '42501' } })
    await expect(setMemberRole({ rpc } as never, 'g1', 'u2', 'manager')).rejects.toThrow('FORBIDDEN')
  })
})

describe('Discord direct messages', () => {
  it('lists the notifications not sent yet, with the linked Discord accounts', async () => {
    const tables: Record<string, any> = {
      notifications: chain({ data: [
        { id: 'n1', type: 'event_declined', user_id: 'coach', data: { playerName: 'Nyra' }, created_at: 't1' },
        { id: 'n2', type: 'event_declined', user_id: 'manager', data: { playerName: 'Nyra' }, created_at: 't1' },
        { id: 'n3', type: 'event_confirmed', user_id: 'coach', data: { playerName: 'Kaito' }, created_at: 't2' },
      ], error: null }),
      discord_dm_sent: chain({ data: [{ notification_id: 'n3' }], error: null }),
      discord_user_links: chain({ data: [{ user_id: 'coach', discord_user_id: 'd-coach' }], error: null }),
    }
    const out = await listPendingDirectNotifications({ from: vi.fn((t: string) => tables[t]) } as never, 'since')
    expect(out.map((n) => [n.id, n.discordUserId])).toEqual([['n1', 'd-coach'], ['n2', null]])
  })

  it('claims a notification once', async () => {
    const insert = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate' } })
    const sb = { from: vi.fn(() => ({ insert })) } as never
    expect(await markDirectMessageSent(sb, 'n1')).toBe(true)
    expect(await markDirectMessageSent(sb, 'n1')).toBe(false)
  })

  it('writes the absence with its reason', () => {
    const text = directMessageText({ type: 'event_declined', data: { playerName: 'Nyra', eventTitle: 'Scrim vs Aegis', scheduledAt: '2026-11-18T19:00:00Z', note: 'Exam' } })
    expect(text).toContain('**Nyra** can\'t make it to "Scrim vs Aegis"')
    expect(text).toContain('UTC')
    expect(text).toContain('Reason: Exam')
    expect(directMessageText({ type: 'event_confirmed', data: { playerName: 'Nyra', eventTitle: 'Scrim' } })).toBe('✅ **Nyra** will be at "Scrim" after all.')
    expect(directMessageText({ type: 'event_response_reminder', data: { eventTitle: 'Scrim vs KCA', scheduledAt: '2026-11-24T19:00:00Z' } }))
      .toBe('⏰ Will you be at "Scrim vs KCA" — Tue, Nov 24, 07:00 PM UTC? Your team is waiting for your answer: open the Planning in Ascend to reply.')
  })
  it('makes what members typed inert: no link, no formatting, no mention, one line (CyberSecurity, beta.14)', () => {
    const text = directMessageText({ type: 'event_response_reminder', data: {
      eventTitle: '**Free RP** [claim here](https://evil.example/login)\n@everyone www.evil.example discord.gg/abc ||spoiler|| <@123>',
    } })
    expect(text).not.toMatch(/\*\*Free/)
    expect(text).not.toMatch(/\]\(https/)
    expect(text).not.toMatch(/https:\/\//)
    expect(text).not.toMatch(/www\.evil/)
    expect(text).not.toMatch(/discord\.gg/)
    expect(text).not.toMatch(/@everyone/)
    expect(text).not.toMatch(/<@123>/)
    expect(text).not.toMatch(/\|\|spoiler/)
    expect(text.split('\n')).toHaveLength(1)
    // The words are still there to read.
    expect(text).toContain('Free RP')
    expect(text).toContain('claim here')
    const declined = directMessageText({ type: 'event_declined', data: { playerName: '**Admin**', eventTitle: 'Scrim', note: 'see https://evil.example' } })
    expect(declined).not.toMatch(/\*\*\*\*Admin/)
    expect(declined).not.toMatch(/https:\/\//)
  })
  it('cuts a long title', () => {
    const text = directMessageText({ type: 'event_response_reminder', data: { eventTitle: 'x'.repeat(500) } })
    expect(text.length).toBeLessThan(250)
  })
})
