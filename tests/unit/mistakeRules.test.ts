import { describe, it, expect } from 'vitest'
import { detectAdvancedMistakes, type RuleParticipant } from '../../electron/main/mistakeRules'

/**
 * Player = participant 1, MIDDLE, blue team. Lane opponent = 6 (red MIDDLE).
 * Allies 2-5, enemies 6-10.
 */
const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const PLAYER: RuleParticipant = { participantId: 1, teamId: 100, championName: 'Ahri', position: 'MIDDLE' }

function match(playerRole = 'MIDDLE', duration = 1800) {
  const participants = []
  // blue: player is 1 with playerRole; allies take the remaining roles
  const blueRoles = [playerRole, ...ROLES.filter((r) => r !== playerRole)]
  for (let i = 0; i < 5; i++) participants.push({ participantId: i + 1, teamId: 100, championName: `Blue${i + 1}`, teamPosition: blueRoles[i] })
  const redRoles = [playerRole, ...ROLES.filter((r) => r !== playerRole)]
  for (let i = 0; i < 5; i++) participants.push({ participantId: i + 6, teamId: 200, championName: `Red${i + 6}`, teamPosition: redRoles[i] })
  return { info: { gameDuration: duration, participants } }
}

type Frame = { minute: number; pos?: Record<number, { x: number; y: number }>; cs?: Record<number, number>; gold?: Record<number, number>; level?: Record<number, number>; events?: any[] }

function timeline(frames: Frame[], minutes = 30) {
  const out = []
  for (let m = 0; m <= minutes; m++) {
    const f = frames.find((x) => x.minute === m)
    const participantFrames: Record<string, any> = {}
    for (let id = 1; id <= 10; id++) {
      const pf: Record<string, any> = {
        position: f?.pos?.[id] ?? { x: 7000 + id * 10, y: 7000 },
        minionsKilled: f?.cs?.[id] ?? m * 7,
        jungleMinionsKilled: 0,
        totalGold: f?.gold?.[id] ?? 500 + m * 350,
      }
      // Only set when a test cares — M5-M13 never read it, so this never affects them.
      if (f?.level?.[id] != null) pf.level = f.level[id]
      participantFrames[String(id)] = pf
    }
    out.push({ timestamp: m * 60_000, participantFrames, events: f?.events ?? [] })
  }
  return { info: { frames: out } }
}

/** Wards every 90s so vision rules stay quiet unless a test wants them. */
const steadyWards = (until = 30) =>
  Array.from({ length: Math.floor((until * 60) / 90) }, (_, i) => ({ type: 'WARD_PLACED', creatorId: 1, wardType: 'YELLOW_TRINKET', timestamp: 120_000 + i * 90_000 }))

const tags = (out: { tagSlug: string }[]) => out.map((o) => o.tagSlug)

describe('mistake rules M5–M13', () => {
  it('M5: death shortly before an objective the enemy takes', () => {
    const tl = timeline([{ minute: 20, events: [
      { type: 'CHAMPION_KILL', timestamp: 20 * 60_000, victimId: 1, killerId: 7, assistingParticipantIds: [8], position: { x: 7000, y: 7000 } },
      { type: 'ELITE_MONSTER_KILL', timestamp: 20 * 60_000 + 40_000, monsterType: 'BARON_NASHOR', killerTeamId: 200 },
      ...steadyWards(),
    ] }])
    const out = detectAdvancedMistakes(tl, match(), PLAYER)
    const m = out.find((o) => o.tagSlug === 'death-before-objective')
    expect(m?.severity).toBe(3)
    expect(m?.note).toMatch(/40s before .*Baron/)
  })

  it('M5: no flag when our team takes the objective', () => {
    const tl = timeline([{ minute: 20, events: [
      { type: 'CHAMPION_KILL', timestamp: 20 * 60_000, victimId: 1, killerId: 7, position: { x: 7000, y: 7000 } },
      { type: 'ELITE_MONSTER_KILL', timestamp: 20 * 60_000 + 40_000, monsterType: 'DRAGON', killerTeamId: 100 },
    ] }])
    expect(tags(detectAdvancedMistakes(tl, match(), PLAYER))).not.toContain('death-before-objective')
  })

  it('M6: no ward in the 90s before an objective; support gets a higher severity', () => {
    const tl = timeline([{ minute: 15, events: [{ type: 'ELITE_MONSTER_KILL', timestamp: 15 * 60_000, monsterType: 'DRAGON', killerTeamId: 200 }] }])
    const mid = detectAdvancedMistakes(tl, match(), PLAYER).find((o) => o.tagSlug === 'no-ward-pre-obj')
    expect(mid?.severity).toBe(1)
    const sup = detectAdvancedMistakes(tl, match('UTILITY'), { ...PLAYER, position: 'UTILITY' }).find((o) => o.tagSlug === 'no-ward-pre-obj')
    expect(sup?.severity).toBe(2)
  })

  it('M6: a ward before the objective clears it', () => {
    const tl = timeline([{ minute: 15, events: [
      { type: 'WARD_PLACED', creatorId: 1, wardType: 'YELLOW_TRINKET', timestamp: 15 * 60_000 - 30_000 },
      { type: 'ELITE_MONSTER_KILL', timestamp: 15 * 60_000, monsterType: 'DRAGON', killerTeamId: 200 },
    ] }])
    expect(tags(detectAdvancedMistakes(tl, match(), PLAYER))).not.toContain('no-ward-pre-obj')
  })

  it('M7: long stretch without any ward, at most 3 per game', () => {
    const none = detectAdvancedMistakes(timeline([]), match(), PLAYER).filter((o) => o.tagSlug === 'forgot-trinket')
    expect(none.length).toBeGreaterThan(0)
    expect(none.length).toBeLessThanOrEqual(3)
    const steady = detectAdvancedMistakes(timeline([{ minute: 0, events: steadyWards() }]), match(), PLAYER)
    expect(tags(steady)).not.toContain('forgot-trinket')
  })

  it('M8: dying at the Baron pit almost alone; not when the team is there', () => {
    const pit = { x: 5007, y: 10471 }
    const death = { type: 'CHAMPION_KILL', timestamp: 25 * 60_000, victimId: 1, killerId: 7, assistingParticipantIds: [8], position: pit }
    const alone = timeline([{ minute: 25, events: [death, ...steadyWards()] }])
    expect(tags(detectAdvancedMistakes(alone, match(), PLAYER))).toContain('solo-baron-died')
    const grouped = timeline([{ minute: 25, events: [death, ...steadyWards()], pos: { 2: pit, 3: pit, 4: pit } }])
    expect(tags(detectAdvancedMistakes(grouped, match(), PLAYER))).not.toContain('solo-baron-died')
  })

  it('M9: caught alone by several enemies after 14:00', () => {
    const far = { x: 12000, y: 3000 }
    const tl = timeline([{ minute: 22, pos: { 1: far }, events: [
      { type: 'CHAMPION_KILL', timestamp: 22 * 60_000, victimId: 1, killerId: 7, assistingParticipantIds: [8, 9], position: far },
      ...steadyWards(),
    ] }])
    expect(tags(detectAdvancedMistakes(tl, match(), PLAYER))).toContain('caught-out')
  })

  it('M10: solo-killed by the lane opponent before 14:00 — not when the jungler helped', () => {
    const solo = timeline([{ minute: 6, events: [{ type: 'CHAMPION_KILL', timestamp: 6 * 60_000, victimId: 1, killerId: 6, assistingParticipantIds: [] }, ...steadyWards()] }])
    expect(tags(detectAdvancedMistakes(solo, match(), PLAYER))).toContain('bad-trade')
    const gank = timeline([{ minute: 6, events: [{ type: 'CHAMPION_KILL', timestamp: 6 * 60_000, victimId: 1, killerId: 6, assistingParticipantIds: [7] }, ...steadyWards()] }])
    expect(tags(detectAdvancedMistakes(gank, match(), PLAYER))).not.toContain('bad-trade')
  })

  it('M11: first to die in a teamfight', () => {
    const t = 18 * 60_000
    const tl = timeline([{ minute: 18, events: [
      { type: 'CHAMPION_KILL', timestamp: t, victimId: 1, killerId: 7 },
      { type: 'CHAMPION_KILL', timestamp: t + 4000, victimId: 2, killerId: 8 },
      { type: 'CHAMPION_KILL', timestamp: t + 9000, victimId: 9, killerId: 3 },
      ...steadyWards(),
    ] }])
    const m = detectAdvancedMistakes(tl, match(), PLAYER).find((o) => o.tagSlug === 'bad-positioning')
    expect(m?.severity).toBe(2)
    expect(m?.note).toMatch(/3-kill fight/)
  })

  it('M12: rough lane opening (CS and gold behind at 5:00) → severity 3', () => {
    const tl = timeline([{ minute: 5, cs: { 1: 25, 6: 38 }, gold: { 1: 1500, 6: 2100 }, events: steadyWards() }])
    const m = detectAdvancedMistakes(tl, match(), PLAYER).find((o) => o.tagSlug === 'bad-lane-opening')
    expect(m?.severity).toBe(3)
    expect(m?.note).toMatch(/-13 CS/)
  })

  it('M13: CS deficit at 10:00 only against the direct opponent', () => {
    const tl = timeline([{ minute: 10, cs: { 1: 50, 6: 80 }, events: steadyWards() }])
    const m = detectAdvancedMistakes(tl, match(), PLAYER).find((o) => o.tagSlug === 'cs-deficit')
    expect(m?.severity).toBe(3)
    // Junglers have no direct lane opponent → no lane rules.
    const jg = detectAdvancedMistakes(tl, match('JUNGLE'), { ...PLAYER, position: 'JUNGLE' })
    expect(tags(jg)).not.toContain('cs-deficit')
  })

  it('M14: 2+ levels behind the direct opponent at 10:00 → severity 2, 3+ levels → severity 3', () => {
    const tl = timeline([{ minute: 10, level: { 1: 7, 6: 9 }, events: steadyWards() }])
    const m = detectAdvancedMistakes(tl, match(), PLAYER).find((o) => o.tagSlug === 'xp-deficit')
    expect(m).toMatchObject({ severity: 2, gameTimeSec: 600 })
    expect(m?.note).toMatch(/Level 7/)

    const tl3 = timeline([{ minute: 10, level: { 1: 6, 6: 9 }, events: steadyWards() }])
    expect(detectAdvancedMistakes(tl3, match(), PLAYER).find((o) => o.tagSlug === 'xp-deficit')?.severity).toBe(3)
  })

  it('M14: no flag under a 2-level gap, and checks 15:00 when 10:00 is fine', () => {
    const even = timeline([{ minute: 10, level: { 1: 8, 6: 9 }, events: steadyWards() }])
    expect(tags(detectAdvancedMistakes(even, match(), PLAYER))).not.toContain('xp-deficit')

    const laterGap = timeline([
      { minute: 10, level: { 1: 8, 6: 9 }, events: steadyWards() },
      { minute: 15, level: { 1: 9, 6: 11 }, events: steadyWards() },
    ])
    const m = detectAdvancedMistakes(laterGap, match(), PLAYER).find((o) => o.tagSlug === 'xp-deficit')
    expect(m).toMatchObject({ gameTimeSec: 900 })
  })

  // M19: coaching-video reference (the level-2/3 transition fight, ~1:30-4:30)
  it('M19: died to an opponent 1 level ahead during the early level race → severity 2, 2+ levels → severity 3', () => {
    const death = { type: 'CHAMPION_KILL', timestamp: 3 * 60_000, victimId: 1, killerId: 6 }
    const oneUp = timeline([{ minute: 3, level: { 1: 1, 6: 2 }, events: [death, ...steadyWards()] }])
    const m = detectAdvancedMistakes(oneUp, match(), PLAYER).find((o) => o.tagSlug === 'behind-on-levels-death')
    expect(m?.severity).toBe(2)
    expect(m?.note).toMatch(/level 1 to a level-2/)

    const twoUp = timeline([{ minute: 3, level: { 1: 1, 6: 3 }, events: [death, ...steadyWards()] }])
    expect(detectAdvancedMistakes(twoUp, match(), PLAYER).find((o) => o.tagSlug === 'behind-on-levels-death')?.severity).toBe(3)
  })

  it('M19: no flag outside the early window, on an even level, or for supports', () => {
    const even = timeline([{ minute: 3, level: { 1: 2, 6: 2 }, events: [{ type: 'CHAMPION_KILL', timestamp: 3 * 60_000, victimId: 1, killerId: 6 }, ...steadyWards()] }])
    expect(tags(detectAdvancedMistakes(even, match(), PLAYER))).not.toContain('behind-on-levels-death')

    const late = timeline([{ minute: 10, level: { 1: 6, 6: 8 }, events: [{ type: 'CHAMPION_KILL', timestamp: 10 * 60_000, victimId: 1, killerId: 6 }, ...steadyWards()] }])
    expect(tags(detectAdvancedMistakes(late, match(), PLAYER))).not.toContain('behind-on-levels-death')

    const supportTl = timeline([{ minute: 3, level: { 1: 1, 6: 2 }, events: [{ type: 'CHAMPION_KILL', timestamp: 3 * 60_000, victimId: 1, killerId: 6 }, ...steadyWards()] }])
    const support = detectAdvancedMistakes(supportTl, match('UTILITY'), { ...PLAYER, position: 'UTILITY' })
    expect(tags(support)).not.toContain('behind-on-levels-death')
  })

  it('M19: the level race runs 0:55–3:55 on 16.x games (minions at 0:30), 1:30–4:30 on 15.x', () => {
    const at = (sec: number, version?: string) => {
      // Levels on the snapshots either side of the death (the rule reads the nearest one).
      const level = { 1: 1, 6: 2 }
      const death = { type: 'CHAMPION_KILL', timestamp: sec * 1000, victimId: 1, killerId: 6 }
      const tl = timeline([{ minute: Math.floor(sec / 60), level, events: [death, ...steadyWards()] }, { minute: Math.floor(sec / 60) + 1, level }])
      const m = { info: { ...match().info, ...(version ? { gameVersion: version } : {}) } }
      return tags(detectAdvancedMistakes(tl, m, PLAYER)).includes('behind-on-levels-death')
    }
    for (const v of [undefined, '16.1.732.4020']) {
      expect([at(54.999, v), at(55, v), at(235, v), at(235.001, v)], v).toEqual([false, true, true, false])
    }
    expect([at(89.999, '15.24.1'), at(90, '15.24.1'), at(270, '15.24.1'), at(270.001, '15.24.1')]).toEqual([false, true, true, false])
  })

  it('M12: "died before 4:00" is 3:25 on 16.x games (35 s earlier), 4:00 on 15.x', () => {
    // CS and gold level at 5:00: only the early death can make the lane opening rough.
    const opening = (sec: number, version?: string) => {
      const death = { type: 'CHAMPION_KILL', timestamp: sec * 1000, victimId: 1, killerId: 6 }
      const tl = timeline([{ minute: Math.floor(sec / 60), events: [death, ...steadyWards()] }, { minute: 5, cs: { 1: 30, 6: 30 }, gold: { 1: 1800, 6: 1800 } }])
      const m = { info: { ...match().info, ...(version ? { gameVersion: version } : {}) } }
      return detectAdvancedMistakes(tl, m, PLAYER).find((o) => o.tagSlug === 'bad-lane-opening')?.note ?? null
    }
    for (const v of [undefined, '16.1.732.4020']) {
      expect(opening(204.999, v), v).toMatch(/died at 3:24/)
      expect(opening(205, v), v).toBeNull()
    }
    expect(opening(205, '15.24.1')).toMatch(/died at 3:25/)
    expect(opening(239.999, '15.24.1')).toMatch(/died at 3:59/)
    expect(opening(240, '15.24.1')).toBeNull()
  })
})

describe('mistake rule M15 — still dead when the enemy takes an objective', () => {
  // Level 18 (17 LEVEL_UP events) dying at 50:00: 52.5 s × (1 + 21.75 % + 10 × 1.45 %) = 71.53 s of respawn.
  const DEATH = 50 * 60_000
  const RESPAWN_MS = 52.5 * (1 + 0.2175 + 10 * 0.0145) * 1000
  const ups = Array.from({ length: 17 }, (_, k) => ({ type: 'LEVEL_UP', timestamp: 60_000 + k * 60_000, participantId: 1, level: k + 2 }))
  const game = (o: { after: number; team?: number; monster?: string; subType?: string; levels?: boolean; extra?: any[] }) => {
    const tl = timeline([{ minute: 50, events: [
      ...(o.levels === false ? [] : ups),
      { type: 'CHAMPION_KILL', timestamp: DEATH, victimId: 1, killerId: 7, assistingParticipantIds: [8], position: { x: 7000, y: 7000 } },
      { type: 'ELITE_MONSTER_KILL', timestamp: DEATH + o.after, monsterType: o.monster ?? 'BARON_NASHOR', ...(o.subType ? { monsterSubType: o.subType } : {}), killerTeamId: o.team ?? 200 },
      ...steadyWards(60).filter((w) => w.timestamp < DEATH - 30_000),
      ...(o.extra ?? []),
    ] }], 55)
    return detectAdvancedMistakes(tl, match('MIDDLE', 3300), PLAYER)
  }
  const m15 = (out: ReturnType<typeof game>) => out.find((o) => o.tagSlug === 'dead-during-objective')

  it('more than 60 s after the death (M5 covers the minute before) and before the respawn, with a 2 s margin', () => {
    expect(m15(game({ after: 60_000 }))).toBeUndefined()
    expect(tags(game({ after: 60_000 }))).toContain('death-before-objective')
    expect(m15(game({ after: 60_001 }))).toMatchObject({ gameTimeSec: 3000, severity: 3 })
    expect(m15(game({ after: 65_000 }))!.note).toBe('Still dead (7s left) when the enemy took Baron at 51:05')
    expect(m15(game({ after: Math.floor(RESPAWN_MS) - 2000 }))).toBeDefined()
    expect(m15(game({ after: Math.ceil(RESPAWN_MS) - 2000 }))).toBeUndefined()
  })
  it('Baron and Elder at severity 3, the other objectives at 2; only objectives the enemy took', () => {
    expect(m15(game({ after: 65_000, monster: 'DRAGON', subType: 'ELDER_DRAGON' }))).toMatchObject({ severity: 3, note: expect.stringMatching(/Elder Dragon/) })
    expect(m15(game({ after: 65_000, monster: 'DRAGON', subType: 'FIRE_DRAGON' }))).toMatchObject({ severity: 2, note: expect.stringMatching(/took Dragon/) })
    expect(m15(game({ after: 65_000, team: 100 }))).toBeUndefined()
  })
  it('the level comes from the LEVEL_UP events: a level-1 respawn (10 s) never lasts a minute', () => {
    expect(m15(game({ after: 65_000, levels: false }))).toBeUndefined()
  })
  it('a ward or a kill of the player after the death means they were back (a revive): silent', () => {
    expect(m15(game({ after: 65_000, extra: [{ type: 'WARD_PLACED', creatorId: 1, wardType: 'YELLOW_TRINKET', timestamp: DEATH + 30_000 }] }))).toBeUndefined()
    expect(m15(game({ after: 65_000, extra: [{ type: 'CHAMPION_KILL', timestamp: DEATH + 30_000, victimId: 8, killerId: 1 }] }))).toBeUndefined()
  })
})
