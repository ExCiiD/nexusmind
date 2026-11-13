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

type Frame = { minute: number; pos?: Record<number, { x: number; y: number }>; cs?: Record<number, number>; gold?: Record<number, number>; events?: any[] }

function timeline(frames: Frame[], minutes = 30) {
  const out = []
  for (let m = 0; m <= minutes; m++) {
    const f = frames.find((x) => x.minute === m)
    const participantFrames: Record<string, any> = {}
    for (let id = 1; id <= 10; id++) {
      participantFrames[String(id)] = {
        position: f?.pos?.[id] ?? { x: 7000 + id * 10, y: 7000 },
        minionsKilled: f?.cs?.[id] ?? m * 7,
        jungleMinionsKilled: 0,
        totalGold: f?.gold?.[id] ?? 500 + m * 350,
      }
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
})
