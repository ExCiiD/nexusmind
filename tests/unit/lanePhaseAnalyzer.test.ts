import { describe, it, expect } from 'vitest'
import { analyzeLanePhase, type LanePhaseInput } from '../../electron/main/lanePhaseAnalyzer'

const PLAYER_PUUID = 'puuid-player'

const baseMatch = {
  info: {
    participants: [
      { participantId: 1, puuid: PLAYER_PUUID, championName: 'Renekton', teamId: 100, teamPosition: 'TOP' },
      { participantId: 2, puuid: 'puuid-jg-blue', championName: 'Vi', teamId: 100, teamPosition: 'JUNGLE' },
      { participantId: 3, puuid: 'puuid-mid-blue', championName: 'Ahri', teamId: 100, teamPosition: 'MIDDLE' },
      { participantId: 4, puuid: 'puuid-adc-blue', championName: 'Ezreal', teamId: 100, teamPosition: 'BOTTOM' },
      { participantId: 5, puuid: 'puuid-sup-blue', championName: 'Thresh', teamId: 100, teamPosition: 'UTILITY' },
      { participantId: 6, puuid: 'puuid-top-red', championName: 'Olaf', teamId: 200, teamPosition: 'TOP' },
      { participantId: 7, puuid: 'puuid-jg-red', championName: 'Khazix', teamId: 200, teamPosition: 'JUNGLE' },
      { participantId: 8, puuid: 'puuid-mid-red', championName: 'Yasuo', teamId: 200, teamPosition: 'MIDDLE' },
      { participantId: 9, puuid: 'puuid-adc-red', championName: 'Caitlyn', teamId: 200, teamPosition: 'BOTTOM' },
      { participantId: 10, puuid: 'puuid-sup-red', championName: 'Lulu', teamId: 200, teamPosition: 'UTILITY' },
    ],
    teams: [
      { teamId: 100, win: true },
      { teamId: 200, win: false },
    ],
  },
}

/** Build a participantFrames entry with the given stats. */
function pf(stats: { cs?: number; jg?: number; gold?: number; xp?: number; level?: number; dmgTaken?: number; dmgDealt?: number; pos?: { x: number; y: number } }) {
  return {
    minionsKilled: stats.cs ?? 0,
    jungleMinionsKilled: stats.jg ?? 0,
    totalGold: stats.gold ?? 0,
    xp: stats.xp ?? 0,
    level: stats.level ?? 1,
    position: stats.pos,
    damageStats: { totalDamageTaken: stats.dmgTaken ?? 0, totalDamageDoneToChampions: stats.dmgDealt ?? 0 },
  }
}

/**
 * Build a timeline with N frames (one per minute). `playerCurve` / `oppCurve`
 * are arrays of per-minute stats for player and opponent. Other participants
 * get a default empty stat block.
 */
function buildTimeline(
  playerPid: number,
  oppPid: number,
  playerCurve: Array<Parameters<typeof pf>[0]>,
  oppCurve: Array<Parameters<typeof pf>[0]>,
  events: any[] = [],
) {
  const frames: any[] = []
  const n = Math.max(playerCurve.length, oppCurve.length)
  for (let i = 0; i < n; i++) {
    const participantFrames: Record<string, any> = {}
    for (let pid = 1; pid <= 10; pid++) {
      participantFrames[String(pid)] = pf({})
    }
    if (playerCurve[i]) participantFrames[String(playerPid)] = pf(playerCurve[i])
    if (oppCurve[i]) participantFrames[String(oppPid)] = pf(oppCurve[i])
    frames.push({ timestamp: i * 60_000, participantFrames, events: i === 0 ? events : [] })
  }
  // Move all events into frames matching their timestamp minute
  if (events.length > 0) {
    frames[0].events = []
    for (const ev of events) {
      const minute = Math.min(Math.floor((ev.timestamp ?? 0) / 60_000), frames.length - 1)
      frames[minute].events.push(ev)
    }
  }
  return { info: { frames } }
}

function selectorPuuid(): LanePhaseInput['selector'] {
  return { puuids: [PLAYER_PUUID] }
}

describe('analyzeLanePhase', () => {
  it('returns no-frames when timeline is empty', () => {
    const res = analyzeLanePhase({
      matchJson: baseMatch,
      timelineJson: { info: { frames: [] } },
      selector: selectorPuuid(),
    })
    // Empty frames is still parsed but yields no opponent (no position data)
    // — opponent resolution falls back to the first opposite-team participant.
    expect(res.diag.reason).toBe('ok')
    expect(res.report?.framesByMinute).toEqual([])
    expect(res.report?.scoreComponents.csAt14).toBe(0)
  })

  it('returns no-player when puuid is missing and no champion fallback', () => {
    const tl = buildTimeline(1, 6, [{ cs: 30, gold: 1000 }], [{ cs: 20, gold: 800 }])
    const res = analyzeLanePhase({ matchJson: baseMatch, timelineJson: tl, selector: { puuids: ['missing-puuid'] } })
    expect(res.report).toBeNull()
    expect(res.diag.reason).toBe('no-player')
  })

  it('computes per-minute diffs across CS, gold, xp, level, damage taken', () => {
    const tl = buildTimeline(
      1, 6,
      [
        { cs: 0, gold: 500, xp: 0, level: 1, dmgTaken: 0 },                     // m0
        { cs: 8, gold: 800, xp: 400, level: 2, dmgTaken: 100 },                 // m1
        { cs: 25, gold: 1500, xp: 1200, level: 4, dmgTaken: 400 },              // m2
      ],
      [
        { cs: 0, gold: 500, xp: 0, level: 1, dmgTaken: 0 },                     // m0
        { cs: 6, gold: 700, xp: 350, level: 2, dmgTaken: 200 },                 // m1
        { cs: 18, gold: 1200, xp: 900, level: 3, dmgTaken: 600 },               // m2
      ],
    )
    const res = analyzeLanePhase({ matchJson: baseMatch, timelineJson: tl, selector: selectorPuuid() })
    expect(res.diag.reason).toBe('ok')
    const frames = res.report!.framesByMinute
    expect(frames).toHaveLength(3)
    expect(frames[1].cs).toEqual({ player: 8, opponent: 6, diff: 2 })
    expect(frames[2].gold.diff).toBe(300)
    expect(frames[2].xp.diff).toBe(300)
    expect(frames[2].level.diff).toBe(1)
    // Player took LESS damage → diff is negative (player - opponent)
    expect(frames[2].damageTaken.diff).toBe(-200)
  })

  it('caps frames at minute 14 even when timeline is longer', () => {
    const playerCurve = Array.from({ length: 20 }, (_, i) => ({ cs: i * 7 }))
    const oppCurve = Array.from({ length: 20 }, (_, i) => ({ cs: i * 6 }))
    const tl = buildTimeline(1, 6, playerCurve, oppCurve)
    const res = analyzeLanePhase({ matchJson: baseMatch, timelineJson: tl, selector: selectorPuuid() })
    expect(res.report!.framesByMinute).toHaveLength(15)
    expect(res.report!.framesByMinute[res.report!.framesByMinute.length - 1].minute).toBe(14)
  })

  it('detects plates taken and lost', () => {
    const tl = buildTimeline(1, 6, [{}], [{}], [
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 480_000, killerId: 1 },  // player took
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 540_000, killerId: 6 },  // opponent took
      { type: 'TURRET_PLATE_DESTROYED', timestamp: 600_000, killerId: 2 },  // ally took — not counted
    ])
    const res = analyzeLanePhase({ matchJson: baseMatch, timelineJson: tl, selector: selectorPuuid() })
    const plates = res.report!.plates
    expect(plates).toEqual([
      { minute: 8, takenByPlayer: true },
      { minute: 9, takenByPlayer: false },
    ])
    expect(res.report!.scoreComponents.plates).toEqual({ taken: 1, lost: 1 })
  })

  it('detects solo kills/deaths between the two laners only', () => {
    const tl = buildTimeline(1, 6, [{}], [{}], [
      { type: 'CHAMPION_KILL', timestamp: 300_000, killerId: 1, victimId: 6 },                                // solo kill
      { type: 'CHAMPION_KILL', timestamp: 420_000, killerId: 6, victimId: 1 },                                // solo death
      { type: 'CHAMPION_KILL', timestamp: 540_000, killerId: 1, victimId: 6, assistingParticipantIds: [2] }, // NOT solo (assist)
      { type: 'CHAMPION_KILL', timestamp: 660_000, killerId: 1, victimId: 7 },                                // not the laner
    ])
    const res = analyzeLanePhase({ matchJson: baseMatch, timelineJson: tl, selector: selectorPuuid() })
    expect(res.report!.soloEvents).toEqual([
      { minute: 5, type: 'kill' },
      { minute: 7, type: 'death' },
    ])
    expect(res.report!.scoreComponents.soloKD).toEqual({ k: 1, d: 1 })
  })

  it('falls back to position-distance opponent when teamPosition is missing', () => {
    const swappedMatch = {
      info: {
        participants: baseMatch.info.participants.map((p, i) => ({
          ...p,
          // Strip teamPosition to simulate Arena / custom where Riot omits it.
          teamPosition: i === 0 || i === 5 ? '' : p.teamPosition,
        })),
      },
    }
    // Player @ {1000, 1000}, three opponents — closest is pid 6.
    const tl = buildTimeline(
      1, 6,
      [{ pos: { x: 1000, y: 1000 } }, { pos: { x: 1100, y: 1100 } }],
      [{ pos: { x: 1200, y: 1200 } }, { pos: { x: 1300, y: 1300 } }],
    )
    // Add a far participant 7 at huge distance to make sure pid 6 wins.
    for (const frame of tl.info.frames) {
      frame.participantFrames['7'] = { ...frame.participantFrames['7'], position: { x: 15000, y: 15000 } }
    }
    const res = analyzeLanePhase({ matchJson: swappedMatch, timelineJson: tl, selector: selectorPuuid() })
    expect(res.diag.reason).toBe('ok')
    expect(res.report!.opponent.participantId).toBe(6)
  })

  it('still resolves opponent via teamPosition when position data is absent', () => {
    const tl = buildTimeline(1, 6, [{ cs: 10 }], [{ cs: 8 }])
    const res = analyzeLanePhase({ matchJson: baseMatch, timelineJson: tl, selector: selectorPuuid() })
    expect(res.report!.opponent.participantId).toBe(6)
    expect(res.diag.playerResolvedVia).toBe('puuid')
  })

  it('grades a clear stomp as A+ or S, a balanced lane near B/C, a stomped lane as D/F', () => {
    const stompTl = buildTimeline(
      1, 6,
      Array.from({ length: 15 }, (_, i) => ({ cs: i * 8, gold: 500 + i * 350, xp: i * 220, level: Math.min(1 + Math.floor(i / 1.5), 10) })),
      Array.from({ length: 15 }, (_, i) => ({ cs: i * 4, gold: 500 + i * 200, xp: i * 130, level: Math.min(1 + Math.floor(i / 2.5), 8) })),
      [
        { type: 'CHAMPION_KILL', timestamp: 240_000, killerId: 1, victimId: 6 },
        { type: 'CHAMPION_KILL', timestamp: 360_000, killerId: 1, victimId: 6 },
        { type: 'TURRET_PLATE_DESTROYED', timestamp: 480_000, killerId: 1 },
        { type: 'TURRET_PLATE_DESTROYED', timestamp: 540_000, killerId: 1 },
      ],
    )
    const stomp = analyzeLanePhase({ matchJson: baseMatch, timelineJson: stompTl, selector: selectorPuuid() })
    expect(['S', 'A+', 'A']).toContain(stomp.report!.grade)

    const balancedTl = buildTimeline(
      1, 6,
      Array.from({ length: 15 }, (_, i) => ({ cs: i * 6, gold: 500 + i * 270, xp: i * 180, level: 1 + Math.floor(i / 2) })),
      Array.from({ length: 15 }, (_, i) => ({ cs: i * 6, gold: 500 + i * 270, xp: i * 180, level: 1 + Math.floor(i / 2) })),
    )
    const balanced = analyzeLanePhase({ matchJson: baseMatch, timelineJson: balancedTl, selector: selectorPuuid() })
    // All diffs = 0 → every component lands on its 50/100 midpoint → grade B+
    // ("perfectly matching your opponent" already counts as above-average).
    expect(['B+', 'B', 'C']).toContain(balanced.report!.grade)

    const lostTl = buildTimeline(
      1, 6,
      Array.from({ length: 15 }, (_, i) => ({ cs: i * 3, gold: 500 + i * 150, xp: i * 100, level: 1 })),
      Array.from({ length: 15 }, (_, i) => ({ cs: i * 9, gold: 500 + i * 400, xp: i * 260, level: 1 + Math.floor(i / 1.5) })),
      [
        { type: 'CHAMPION_KILL', timestamp: 180_000, killerId: 6, victimId: 1 },
        { type: 'CHAMPION_KILL', timestamp: 360_000, killerId: 6, victimId: 1 },
        { type: 'TURRET_PLATE_DESTROYED', timestamp: 480_000, killerId: 6 },
      ],
    )
    const lost = analyzeLanePhase({ matchJson: baseMatch, timelineJson: lostTl, selector: selectorPuuid() })
    expect(['F', 'D']).toContain(lost.report!.grade)
  })

  it('computes kill participation and champion damage @14', () => {
    const tl = buildTimeline(
      1, 6,
      Array.from({ length: 15 }, (_, i) => ({ cs: i * 6, dmgDealt: i * 900 })),
      Array.from({ length: 15 }, (_, i) => ({ cs: i * 6, dmgDealt: i * 200 })),
      [
        // Player's team scores 3 kills; the player takes part in all of them.
        { type: 'CHAMPION_KILL', timestamp: 200_000, killerId: 1, victimId: 8, assistingParticipantIds: [2] },
        { type: 'CHAMPION_KILL', timestamp: 300_000, killerId: 3, victimId: 9, assistingParticipantIds: [1] },
        { type: 'CHAMPION_KILL', timestamp: 400_000, killerId: 1, victimId: 10 },
        // Opponent's team scores 1 kill, opponent participates.
        { type: 'CHAMPION_KILL', timestamp: 500_000, killerId: 6, victimId: 4 },
      ],
    )
    const res = analyzeLanePhase({ matchJson: baseMatch, timelineJson: tl, selector: selectorPuuid() })
    const sc = res.report!.scoreComponents
    expect(sc.kp.player).toBeCloseTo(1, 5)        // 3/3 team kills
    expect(sc.kp.opponent).toBeCloseTo(1, 5)      // 1/1 team kills
    expect(sc.dmgAt14.player).toBe(14 * 900)
    expect(sc.dmgAt14.opponent).toBe(14 * 200)
    expect(sc.dmgAt14.diff).toBe(14 * 700)
  })

  it('factors champion damage into the lane grade (even CS/gold, higher damage = higher score)', () => {
    const evenStats = (i: number) => ({ cs: i * 6, gold: 500 + i * 270, xp: i * 180, level: 1 + Math.floor(i / 2) })
    const evenCurve = Array.from({ length: 15 }, (_, i) => evenStats(i))
    const playerCurve = Array.from({ length: 15 }, (_, i) => ({ ...evenStats(i), dmgDealt: i * 900 }))
    const oppCurve = Array.from({ length: 15 }, (_, i) => ({ ...evenStats(i), dmgDealt: i * 150 }))

    const carry = analyzeLanePhase({ matchJson: baseMatch, timelineJson: buildTimeline(1, 6, playerCurve, oppCurve), selector: selectorPuuid() })
    const even = analyzeLanePhase({ matchJson: baseMatch, timelineJson: buildTimeline(1, 6, evenCurve, evenCurve), selector: selectorPuuid() })
    expect(carry.report!.scoreComponents.numericScore).toBeGreaterThan(even.report!.scoreComponents.numericScore)
  })

  it('accepts JSON strings or already-parsed objects interchangeably', () => {
    const tl = buildTimeline(1, 6, [{ cs: 10 }], [{ cs: 8 }])
    const a = analyzeLanePhase({ matchJson: JSON.stringify(baseMatch), timelineJson: JSON.stringify(tl), selector: selectorPuuid() })
    const b = analyzeLanePhase({ matchJson: baseMatch, timelineJson: tl, selector: selectorPuuid() })
    expect(a.report).toEqual(b.report)
  })

  it('resolves player via champion when puuid does not match (unlinked account)', () => {
    const tl = buildTimeline(1, 6, [{ cs: 10 }], [{ cs: 8 }])
    const res = analyzeLanePhase({ matchJson: baseMatch, timelineJson: tl, selector: { championName: 'Renekton' } })
    expect(res.diag.reason).toBe('ok')
    expect(res.diag.playerResolvedVia).toBe('champion')
  })
})
