/**
 * Objective participation of the player sheet (REGLES_OBJECTIFS_PRIO_CROSSMAP.md §1, 27/11/2026).
 * The real-game fixture is the timeline summary (positions, kills, objectives; no names) of a ranked game whose raw
 * ELITE_MONSTER_KILL / BUILDING_KILL events were counted by hand from the stored timeline.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildObjectiveParticipation, involvementOf, sumObjectives, pitOf, DRAGON_PIT, BARON_PIT, OBJECTIVE_NEARBY_DISTANCE,
  type TimelinePlayers, type TimelineObjectiveEvent, type TimelineKillEvent,
} from '../../src/lib/playerSessionStatsCore'

const real: TimelinePlayers = JSON.parse(readFileSync(new URL('./fixtures/objectives-real-game.json', import.meta.url), 'utf8'))
const line = (o: ReturnType<typeof buildObjectiveParticipation>, kind: string) => o!.byKind.find((l) => l.kind === kind)!

describe('real game (our team = blue, participants 1-5): the figures match the raw timeline', () => {
  it('taken by us / by them add up to what really happened, whoever the player is', () => {
    // Counted from the raw events: dragons 4 for us (10:38, 17:37, 22:55, 34:42) and 1 for them (28:44); grubs 1 / 2;
    // herald 1 / 0; baron 2 / 0 (our team won this game, killerTeamId agrees with the killer's side on every event).
    for (const pid of [1, 2, 3, 4, 5]) {
      const o = buildObjectiveParticipation(real, pid, 100)!
      expect(line(o, 'dragon')).toMatchObject({ ours: 4, theirs: 1 })
      expect(line(o, 'grubs')).toMatchObject({ ours: 1, theirs: 2 })
      expect(line(o, 'herald')).toMatchObject({ ours: 1, theirs: 0 })
      expect(line(o, 'baron')).toMatchObject({ ours: 2, theirs: 0 })
    }
  })

  it('the top laner (participant 1) really took part in none of the 4 dragons: 0 is true, not a mapping bug', () => {
    const o = buildObjectiveParticipation(real, 1, 100)!
    expect(line(o, 'dragon')).toMatchObject({ ours: 4, participated: 0, theirsPresent: 0 })
    expect(real.objectives!.filter((e) => e.kind === 'dragon' && e.teamId === 100).every((e) => e.killer !== 1 && !e.assists.includes(1))).toBe(true)
    expect(line(o, 'baron')).toMatchObject({ participated: 1, byReason: { kill: 0, assist: 1, nearby: 0, fight: 0 } })
  })

  it('a fight around the pit counts even without touching the objective (herald taken by us)', () => {
    const o = buildObjectiveParticipation(real, 1, 100)!
    expect(line(o, 'herald')).toMatchObject({ ours: 1, participated: 1, byReason: { fight: 1 } })
    const ev = o.events.find((e) => e.kind === 'herald')!
    expect(ev).toMatchObject({ ours: true, involved: true, reason: 'fight', participated: true, killed: false })
  })

  it('the killer of the dragons has them as kills, the participation never exceeds what the team took', () => {
    const o = buildObjectiveParticipation(real, 2, 100)!
    expect(line(o, 'dragon')).toMatchObject({ participated: 4, byReason: { kill: 4 } })
    for (const pid of [1, 2, 3, 4, 5]) for (const l of buildObjectiveParticipation(real, pid, 100)!.byKind) {
      expect(l.participated).toBeLessThanOrEqual(l.ours)
      expect(Object.values(l.byReason).reduce((a, b) => a + b, 0)).toBe(l.participated)
    }
  })

  it('the pits are where the real events happen: its killer stood 119 units from the baron pit in the frame before the kill', () => {
    const e = real.objectives!.find((x) => x.kind === 'herald')!
    const killer = real.players.find((p) => p.pid === e.killer)!
    const f = Math.floor(e.t / 60_000) // the last minute frame before the kill
    expect(Math.hypot(killer.x![f] - BARON_PIT.x, killer.y![f] - BARON_PIT.y)).toBeLessThan(600)
  })

  it('towers: kill / assist only, no "present" count', () => {
    const o = buildObjectiveParticipation(real, 4, 100)!
    expect(line(o, 'tower')).toMatchObject({ ours: 10, theirs: 10, theirsPresent: null })
    expect(line(o, 'tower').byReason.nearby + line(o, 'tower').byReason.fight).toBe(0)
  })
})

describe('involvementOf (synthetic)', () => {
  const players = (pos: Record<number, [number, number]>) => Array.from({ length: 10 }, (_, i) => ({
    pid: i + 1, teamId: (i < 5 ? 100 : 200) as 100 | 200, xp: [], gold: [],
    ...(i < 5 && pos[i + 1] ? { x: [pos[i + 1][0], pos[i + 1][0]], y: [pos[i + 1][1], pos[i + 1][1]] } : {}),
  }))
  const dragon = (t: number, team: 100 | 200, killer = 2, assists: number[] = []): TimelineObjectiveEvent => ({ t, kind: 'dragon', teamId: team, killer, assists })
  const kill = (t: number, killer: number, victim: number, x: number, y: number, assists: number[] = []): TimelineKillEvent => ({ t, killer, victim, assists, x, y })
  const tp = (pos: Record<number, [number, number]>, kills: TimelineKillEvent[] = []): TimelinePlayers => ({ v: 2, players: players(pos), kills, objectives: [] })

  it('killer and assist come first', () => {
    expect(involvementOf(tp({}), 2, dragon(60_000, 100, 2), 100)).toBe('kill')
    expect(involvementOf(tp({}), 3, dragon(60_000, 100, 2, [3]), 100)).toBe('assist')
  })

  it('alive and within the distance of the pit in the last minute frame: nearby, for ours and for theirs', () => {
    const near: Record<number, [number, number]> = { 3: [DRAGON_PIT.x + OBJECTIVE_NEARBY_DISTANCE - 10, DRAGON_PIT.y] }
    expect(involvementOf(tp(near), 3, dragon(90_000, 100), 100)).toBe('nearby')
    expect(involvementOf(tp(near), 3, dragon(90_000, 200), 100)).toBe('nearby') // the enemy took it and you were there
    expect(involvementOf(tp({ 3: [DRAGON_PIT.x + OBJECTIVE_NEARBY_DISTANCE + 10, DRAGON_PIT.y] }), 3, dragon(90_000, 100), 100)).toBeNull()
  })

  it('a player who is dead at that moment is not nearby', () => {
    const near: Record<number, [number, number]> = { 3: [DRAGON_PIT.x, DRAGON_PIT.y] }
    expect(involvementOf(tp(near, [kill(80_000, 6, 3, DRAGON_PIT.x, DRAGON_PIT.y)]), 3, dragon(90_000, 100), 100)).not.toBe('nearby')
  })

  it('a champion kill (as killer, assist or victim) within 20 s and the fight distance of the pit is a fight', () => {
    const far = { 3: [1000, 1000] as [number, number] }
    const at = (dx: number) => [kill(100_000, 7, 3, DRAGON_PIT.x + dx, DRAGON_PIT.y)]
    expect(involvementOf(tp(far, at(500)), 3, dragon(110_000, 100), 100)).toBe('fight') // died there
    expect(involvementOf(tp(far, [kill(100_000, 3, 7, DRAGON_PIT.x, DRAGON_PIT.y)]), 3, dragon(110_000, 100), 100)).toBe('fight')
    expect(involvementOf(tp(far, [kill(100_000, 4, 7, DRAGON_PIT.x, DRAGON_PIT.y, [3])]), 3, dragon(110_000, 200), 100)).toBe('fight') // theirs: you were around
    expect(involvementOf(tp(far, at(5000)), 3, dragon(110_000, 100), 100)).toBeNull() // too far from the pit
    expect(involvementOf(tp(far, at(500)), 3, dragon(140_000, 100), 100)).toBeNull() // more than 20 s apart
  })

  it('without positions of the player only the kill record and the fights can judge (never a crash)', () => {
    expect(involvementOf(tp({}), 3, dragon(60_000, 100), 100)).toBeNull()
  })

  it('pits: dragon and elder in the dragon pit, the others in the baron pit, none for a tower', () => {
    expect(pitOf('elder')).toEqual(DRAGON_PIT)
    expect(pitOf('grubs')).toEqual(BARON_PIT)
    expect(pitOf('tower')).toBeNull()
  })
})

describe('sumObjectives', () => {
  it('sums the new fields over the games; theirsPresent is null as soon as one game cannot judge it', () => {
    const a = buildObjectiveParticipation(real, 2, 100)!, b = buildObjectiveParticipation(real, 1, 100)!
    const total = sumObjectives([a, b, null])!
    const dragon = total.find((l) => l.kind === 'dragon')!
    expect(dragon).toMatchObject({ ours: 8, participated: 4, theirs: 2 })
    expect(dragon.byReason.kill).toBe(4)
    expect(total.find((l) => l.kind === 'tower')!.theirsPresent).toBeNull()
    expect(sumObjectives([null])).toBeNull()
  })
})
