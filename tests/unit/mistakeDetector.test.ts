import { describe, it, expect } from 'vitest'
import { detectMistakes } from '../../electron/main/mistakeDetector'

const PLAYER_PUUID = 'puuid-player'

const baseMatch = {
  info: {
    participants: [
      { participantId: 1, puuid: PLAYER_PUUID, championName: 'Renekton', teamId: 100 },
      { participantId: 2, puuid: 'jg-blue', championName: 'Vi', teamId: 100 },
      { participantId: 6, puuid: 'top-red', championName: 'Olaf', teamId: 200 },
      { participantId: 7, puuid: 'jg-red', championName: 'Khazix', teamId: 200 },
      { participantId: 8, puuid: 'mid-red', championName: 'Yasuo', teamId: 200 },
    ],
  },
}

function buildTimeline(framesByMinute: Array<{ playerGold?: number; playerPos?: { x: number; y: number }; events?: any[] }>): any {
  const frames: any[] = []
  for (let i = 0; i < framesByMinute.length; i++) {
    const f = framesByMinute[i]
    const participantFrames: Record<string, any> = {}
    for (let pid = 1; pid <= 10; pid++) participantFrames[String(pid)] = {}
    participantFrames['1'] = {
      currentGold: f.playerGold ?? 0,
      position: f.playerPos,
    }
    frames.push({
      timestamp: i * 60_000,
      participantFrames,
      events: f.events ?? [],
    })
  }
  return { info: { frames } }
}

describe('detectMistakes', () => {
  it('returns [] when player not resolved', () => {
    const tl = buildTimeline([{}])
    expect(detectMistakes(tl, baseMatch, { puuids: ['missing'] })).toEqual([])
  })

  it('emits unused-gold when player dies with > 1500g', () => {
    const tl = buildTimeline([
      { playerGold: 1800 },
      { playerGold: 1800, events: [{ type: 'CHAMPION_KILL', timestamp: 70_000, killerId: 6, victimId: 1 }] },
    ])
    const out = detectMistakes(tl, baseMatch, { puuids: [PLAYER_PUUID] })
    const unused = out.find((c) => c.tagSlug === 'unused-gold')
    expect(unused).toBeDefined()
    expect(unused!.gameTimeSec).toBe(70)
    expect(unused!.note).toMatch(/1800/)
  })

  it('does NOT emit unused-gold when player dies poor', () => {
    const tl = buildTimeline([
      { playerGold: 400 },
      { playerGold: 400, events: [{ type: 'CHAMPION_KILL', timestamp: 70_000, killerId: 6, victimId: 1 }] },
    ])
    const out = detectMistakes(tl, baseMatch, { puuids: [PLAYER_PUUID] })
    expect(out.find((c) => c.tagSlug === 'unused-gold')).toBeUndefined()
  })

  it('emits dove-tower when player dies near an enemy turret', () => {
    // Red side top outer turret is at (14029, 4564). Place death within 500u.
    const tl = buildTimeline([
      { playerGold: 200, events: [{ type: 'CHAMPION_KILL', timestamp: 20_000, killerId: 6, victimId: 1, position: { x: 14100, y: 4600 } }] },
    ])
    const out = detectMistakes(tl, baseMatch, { puuids: [PLAYER_PUUID] })
    const dove = out.find((c) => c.tagSlug === 'dove-tower')
    expect(dove).toBeDefined()
    expect(dove!.severity).toBe(3)
  })

  it('does NOT emit dove-tower when death is far from any tower', () => {
    const tl = buildTimeline([
      { playerGold: 200, events: [{ type: 'CHAMPION_KILL', timestamp: 20_000, killerId: 6, victimId: 1, position: { x: 7500, y: 7500 } }] },
    ])
    const out = detectMistakes(tl, baseMatch, { puuids: [PLAYER_PUUID] })
    expect(out.find((c) => c.tagSlug === 'dove-tower')).toBeUndefined()
  })

  it('emits overstay (greed) when the player dies deep in enemy territory outside an objective fight', () => {
    // Blue fountain (400,400) → red fountain (14400,14400). A death at
    // (13000,13000) is ~90% into enemy territory → "one more wave".
    const tl = buildTimeline([
      { events: [{ type: 'CHAMPION_KILL', timestamp: 30_000, killerId: 6, victimId: 1, position: { x: 13000, y: 13000 } }] },
    ])
    const out = detectMistakes(tl, baseMatch, { puuids: [PLAYER_PUUID] })
    const over = out.find((c) => c.tagSlug === 'overstay')
    expect(over).toBeDefined()
    expect(over!.note).toMatch(/enemy territory/)
  })

  it('emits overstay (greed) when the player took a plate just before dying', () => {
    // Death at a neutral position (~47% in) so the only greed signal is
    // the turret plate taken 15s earlier ("one more plate").
    const tl = buildTimeline([
      { events: [
        { type: 'TURRET_PLATE_DESTROYED', timestamp: 20_000, killerId: 1, teamId: 200 },
        { type: 'CHAMPION_KILL', timestamp: 35_000, killerId: 6, victimId: 1, position: { x: 7000, y: 7000 } },
      ] },
    ])
    const out = detectMistakes(tl, baseMatch, { puuids: [PLAYER_PUUID] })
    const over = out.find((c) => c.tagSlug === 'overstay')
    expect(over).toBeDefined()
    expect(over!.note).toMatch(/plate/)
  })

  it('does NOT emit overstay on a death in neutral/own territory with no plate', () => {
    const tl = buildTimeline([
      { events: [{ type: 'CHAMPION_KILL', timestamp: 30_000, killerId: 6, victimId: 1, position: { x: 7000, y: 7000 } }] },
    ])
    const out = detectMistakes(tl, baseMatch, { puuids: [PLAYER_PUUID] })
    expect(out.find((c) => c.tagSlug === 'overstay')).toBeUndefined()
  })

  it('does NOT emit overstay when a deep death happens within 30s of a Dragon kill', () => {
    const tl = buildTimeline([
      { events: [
        { type: 'ELITE_MONSTER_KILL', timestamp: 20_000, monsterType: 'DRAGON' },
        { type: 'CHAMPION_KILL', timestamp: 35_000, killerId: 6, victimId: 1, position: { x: 13000, y: 13000 } },
      ] },
    ])
    const out = detectMistakes(tl, baseMatch, { puuids: [PLAYER_PUUID] })
    expect(out.find((c) => c.tagSlug === 'overstay')).toBeUndefined()
  })

  it('emits late-back on recall to fountain with high gold and no recent purchase', () => {
    // Player teleports from mid-lane → blue fountain area at frame 5 (min 5)
    // with 2500g and no purchases since min 0.
    const tl = buildTimeline([
      { playerGold: 500,  playerPos: { x: 8000, y: 8000 } },  // m0 in lane
      { playerGold: 800,  playerPos: { x: 8000, y: 7500 } },  // m1
      { playerGold: 1200, playerPos: { x: 8000, y: 7000 } },  // m2
      { playerGold: 1800, playerPos: { x: 7500, y: 7000 } },  // m3
      { playerGold: 2200, playerPos: { x: 7000, y: 6000 } },  // m4
      { playerGold: 2500, playerPos: { x: 500, y: 500 } },    // m5 — in fountain
    ])
    const out = detectMistakes(tl, baseMatch, { puuids: [PLAYER_PUUID] })
    const lb = out.find((c) => c.tagSlug === 'late-back')
    expect(lb).toBeDefined()
    expect(lb!.gameTimeSec).toBe(300)
  })

  it('does NOT emit late-back when the player recalled after a recent purchase', () => {
    const tl = buildTimeline([
      { playerGold: 500,  playerPos: { x: 8000, y: 8000 } },
      { playerGold: 800,  playerPos: { x: 8000, y: 7500 }, events: [{ type: 'ITEM_PURCHASED', timestamp: 60_000, participantId: 1, itemId: 1001 }] },
      { playerGold: 1200, playerPos: { x: 8000, y: 7000 } },
      { playerGold: 2500, playerPos: { x: 500, y: 500 } },
    ])
    const out = detectMistakes(tl, baseMatch, { puuids: [PLAYER_PUUID] })
    expect(out.find((c) => c.tagSlug === 'late-back')).toBeUndefined()
  })

  it('handles JSON string inputs', () => {
    const tl = buildTimeline([
      { playerGold: 1800 },
      { playerGold: 1800, events: [{ type: 'CHAMPION_KILL', timestamp: 70_000, killerId: 6, victimId: 1 }] },
    ])
    const out = detectMistakes(JSON.stringify(tl), JSON.stringify(baseMatch), { puuids: [PLAYER_PUUID] })
    expect(out.some((c) => c.tagSlug === 'unused-gold')).toBe(true)
  })

  it('resolves player via championName when no puuid matches', () => {
    const tl = buildTimeline([
      { events: [{ type: 'CHAMPION_KILL', timestamp: 30_000, killerId: 6, victimId: 1, position: { x: 13000, y: 13000 } }] },
    ])
    const out = detectMistakes(tl, baseMatch, { championName: 'Renekton' })
    expect(out.some((c) => c.tagSlug === 'overstay')).toBe(true)
  })
})
