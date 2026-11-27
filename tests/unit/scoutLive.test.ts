import { describe, expect, it } from 'vitest'
import type { ScoutEvent, ScoutPoolEntry, ScoutStats } from '@/lib/scoutEngine'
import { createScoutLive, estimateRemainingMs, failedGames, incompleteMemberIds, isSessionExpiredMessage, scoutErrorKind, reduceScoutEvent, scoutOutcome, totalGames, totalProcessed, type ScoutLive } from '@/store/scoutLive'

const pool = (key: string, games = 0): ScoutPoolEntry => ({ championKey: key, role: 'MID', games, wins: 0, winRate: games ? 50 : null, kda: null, masteryPoints: 1000, firstPlayedAt: null, lastPlayedAt: null, tier: 'comfort' })
const stats: ScoutStats = { members: 2, rawIds: 0, uniqueIds: 0, sharedIds: 0, fromCache: 0, downloaded: 0, failed: 0, firstPoolMs: 10, totalMs: 100 }
const start = () => createScoutLive({ scoutId: 'abcd', teamId: 't', members: [{ id: 'a', displayName: 'A' }, { id: 'b', displayName: 'B' }], now: 0 })
type EventBody = ScoutEvent extends infer E ? (E extends { scoutId: string } ? Omit<E, 'scoutId'> : never) : never
const run = (live: ScoutLive, evs: EventBody[], now = 0) => evs.reduce((l, e) => reduceScoutEvent(l, { scoutId: 'abcd', ...e } as ScoutEvent, now), live)

describe('scoutLive reducer', () => {
  it('ignores events of another scout', () => {
    const l = start()
    expect(reduceScoutEvent(l, { type: 'ids', scoutId: 'zzzz', memberId: 'a', total: 9 })).toBe(l)
  })

  it('replaces the pool: mastery first, then partial games, never mastery over games', () => {
    let l = run(start(), [{ type: 'mastery', memberId: 'a', pool: [pool('Ahri')] }])
    expect(l.members.a.status).toBe('mastery')
    l = run(l, [{ type: 'ids', memberId: 'a', total: 40 }, { type: 'chunk', memberId: 'a', processed: 10, total: 40, pool: [pool('Syndra', 10)], history: { from: 1, to: 2 } }])
    expect(l.members.a.pool.map((e) => e.championKey)).toEqual(['Syndra'])
    l = run(l, [{ type: 'mastery', memberId: 'a', pool: [pool('Ahri')] }])
    expect(l.members.a.poolSource).toBe('games')
    expect(totalProcessed(l)).toBe(10)
    expect(totalGames(l)).toBe(40)
  })

  it('never lets processed go down', () => {
    let l = run(start(), [{ type: 'chunk', memberId: 'a', processed: 20, total: 40, pool: [], history: { from: null, to: null } }])
    l = run(l, [{ type: 'chunk', memberId: 'a', processed: 15, total: 40, pool: [], history: { from: null, to: null } }])
    expect(l.members.a.processed).toBe(20)
  })

  it('estimates the remaining time only once lists are known and a rate is measured', () => {
    let l = run(start(), [{ type: 'ids', memberId: 'a', total: 100 }, { type: 'chunk', memberId: 'a', processed: 10, total: 100, pool: [], history: { from: null, to: null } }], 1000)
    expect(estimateRemainingMs(l, 20_000)).toBeNull() // b's list not read yet
    l = run(l, [{ type: 'ids', memberId: 'b', total: 100 }, { type: 'chunk', memberId: 'a', processed: 60, total: 100, pool: [], history: { from: null, to: null } }], 21_000)
    // firstChunk at 1000 with 0 processed before it; 60 done in 20 s, 140 left → 140/60*20000
    expect(estimateRemainingMs(l, 21_000)).toBe(Math.round((140 / 60) * 20_000))
  })

  it('classifies the end states', () => {
    const done = (extra: Partial<Extract<ScoutEvent, { type: 'done' }>> = {}) => ({ type: 'done' as const, cancelled: false, rateLimited: false, stats, ...extra })
    const member = (id: string, totalMatches: number) => ({ type: 'member-done' as const, memberId: id, upserted: totalMatches ? 3 : 0, totalMatches, sameRoleCount: totalMatches })
    expect(scoutOutcome(start())).toBe('running')
    expect(scoutOutcome(run(start(), [member('a', 40), member('b', 30), done()]))).toBe('done')
    expect(scoutOutcome(run(start(), [{ type: 'ids', memberId: 'a', total: 0 }, { type: 'ids', memberId: 'b', total: 0 }, member('a', 0), member('b', 0), done()]))).toBe('noGames')
    expect(scoutOutcome(run(start(), [member('a', 40), { type: 'member-error', memberId: 'b', code: 'CANCELLED', message: 'x' }, done({ cancelled: true })]))).toBe('cancelled')
    expect(scoutOutcome(run(start(), [{ type: 'member-error', memberId: 'a', code: 'RIOT_RATE_LIMITED', message: 'RIOT_RATE_LIMITED' }, member('b', 5), done({ rateLimited: true })]))).toBe('rateLimited')
    expect(scoutOutcome(run(start(), [{ type: 'member-error', memberId: 'a', code: 'FAILED', message: 'x' }, { type: 'member-error', memberId: 'b', code: 'FAILED', message: 'x' }, done()]))).toBe('error')
    expect(scoutOutcome({ ...start(), phase: 'finished', failure: 'boom' })).toBe('error')
  })

  it('keeps failed and unreadable games of each member (member-done)', () => {
    const l = run(start(), [
      { type: 'member-done', memberId: 'a', upserted: 3, totalMatches: 1482, sameRoleCount: 1000, failed: 20, unreadable: 18 },
      { type: 'member-done', memberId: 'b', upserted: 3, totalMatches: 10, sameRoleCount: 10 },
      { type: 'done', cancelled: false, rateLimited: false, stats },
    ])
    expect(failedGames(l)).toEqual({ failed: 20, unreadable: 18 })
    expect(scoutOutcome(l)).toBe('done')
  })

  it('a failed list or too many unreadable games is an error, never « no games »', () => {
    const l = run(start(), [
      { type: 'member-error', memberId: 'a', code: 'FAILED', message: '300 of 400 games could not be read' },
      { type: 'member-done', memberId: 'b', upserted: 0, totalMatches: 0, sameRoleCount: 0 },
      { type: 'done', cancelled: false, rateLimited: false, stats },
    ])
    expect(scoutOutcome(l)).toBe('error')
  })

  it('an expired session asks to sign in again', () => {
    expect(isSessionExpiredMessage('Your Ascend session expired — please sign in again.')).toBe(true)
    expect(isSessionExpiredMessage('boom')).toBe(false)
    const msg = 'Your Ascend session expired — please sign in again.'
    const l = run(start(), [
      { type: 'member-error', memberId: 'a', code: 'FAILED', message: msg },
      { type: 'member-error', memberId: 'b', code: 'FAILED', message: msg },
      { type: 'done', cancelled: false, rateLimited: false, stats },
    ])
    expect(scoutOutcome(l)).toBe('sessionExpired')
  })

  it('resume: only the members that did not finish restart, finished ones keep their result and the scope', () => {
    const first = createScoutLive({ scoutId: 'abcd', teamId: 't', members: [{ id: 'a', displayName: 'A' }, { id: 'b', displayName: 'B' }], scope: 'complete', now: 0 })
    const l = run(first, [
      { type: 'member-done', memberId: 'a', upserted: 3, totalMatches: 50, sameRoleCount: 50 },
      { type: 'member-error', memberId: 'b', code: 'FAILED', message: 'x' },
      { type: 'done', cancelled: false, rateLimited: false, stats },
    ])
    expect(incompleteMemberIds(l)).toEqual(['b'])
    const again = createScoutLive({ scoutId: 'efgh', teamId: 't', members: [{ id: 'b', displayName: 'B' }], previous: l, now: 5 })
    expect(again.scope).toBe('complete')
    expect(again.order).toEqual(['a', 'b'])
    expect(again.members.a.status).toBe('done')
    expect(again.members.b.status).toBe('waiting')
    expect(again.phase).toBe('running')
  })

  it('classes an error message so the screen never shows the raw text', () => {
    expect(scoutErrorKind('Too many members').kind).toBe('tooMany')
    expect(scoutErrorKind('300 of 400 games could not be read (network or Riot error): the pool was not updated, try again.')).toEqual({ kind: 'unreadable', bad: 300, of: 400 })
    expect(scoutErrorKind('The match list could not be read (solo/duo)').kind).toBe('list')
    expect(scoutErrorKind('RIOT_RATE_LIMITED: too many Riot requests').kind).toBe('rateLimited')
    expect(scoutErrorKind('Your Ascend session expired — please sign in again.').kind).toBe('session')
    expect(scoutErrorKind('fetch failed').kind).toBe('network')
    expect(scoutErrorKind('kaboom').kind).toBe('generic')
    expect(scoutErrorKind(null).kind).toBe('generic')
  })
  it('classes the web / 502 messages too (network, 1 to 20 members)', () => {
    expect(scoutErrorKind('Riot access is temporarily unavailable. Try again shortly.').kind).toBe('network')
    expect(scoutErrorKind('Ascend Riot service is temporarily unavailable. Please try again later.').kind).toBe('network')
    expect(scoutErrorKind('Riot API error 502').kind).toBe('network')
    expect(scoutErrorKind('A scout takes 1 to 20 members (got 25).').kind).toBe('tooMany')
    expect(scoutErrorKind('3 of 5023 games could not be read').kind).toBe('unreadable')
  })

  it('a call that failed with an expired session is « session expired », not a plain error', () => {
    const l = { ...start(), phase: 'finished' as const, failure: 'Your Ascend session expired — please sign in again.' }
    expect(scoutOutcome(l)).toBe('sessionExpired')
    expect(scoutOutcome({ ...l, failure: 'Too many members' })).toBe('error')
  })

  it('a member done with no game drops the mastery pool shown meanwhile', () => {
    let l = run(start(), [{ type: 'mastery', memberId: 'a', pool: [pool('Ahri')] }, { type: 'ids', memberId: 'a', total: 0 }])
    expect(l.members.a.poolSource).toBe('mastery')
    l = run(l, [{ type: 'member-done', memberId: 'a', upserted: 0, totalMatches: 0, sameRoleCount: 0 }])
    expect(l.members.a.pool).toEqual([])
    expect(l.members.a.poolSource).toBe('none')
  })

  it('a resumed scout counts the members already done (totals stay those of the whole team)', () => {
    const first = run(start(), [
      { type: 'ids', memberId: 'a', total: 40 }, { type: 'chunk', memberId: 'a', processed: 40, total: 40, pool: [pool('Ahri', 40)], history: { from: 1, to: 2 } },
      { type: 'member-done', memberId: 'a', upserted: 1, totalMatches: 40, sameRoleCount: 40 },
      { type: 'member-error', memberId: 'b', code: 'FAILED', message: 'x' },
      { type: 'done', cancelled: false, rateLimited: false, stats },
    ])
    const again = createScoutLive({ scoutId: 'zzzz', teamId: 't', members: [{ id: 'b', displayName: 'B' }], previous: first, now: 5 })
    expect(again.order).toEqual(['a', 'b'])
    expect(totalProcessed(again)).toBe(40)
    expect(totalGames(again)).toBe(40) // b's list is not read yet: the total grows when it is
    expect(incompleteMemberIds(again)).toEqual(['b'])
  })
})
