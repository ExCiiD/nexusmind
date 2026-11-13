/**
 * Mistake Library — additional business rules (M5–M13, see
 * docs/AUDIT_REGLES_METIER.md §3.1).
 *
 * Pure functions over Riot Match-V5 + Timeline-V5. Every rule only claims
 * what the data can prove and explains itself in `note`. Positions come
 * from per-minute frames, so proximity checks use the frame closest to the
 * event and generous radii.
 */

export type AdvancedTag =
  | 'death-before-objective'
  | 'no-ward-pre-obj'
  | 'forgot-trinket'
  | 'solo-baron-died'
  | 'caught-out'
  | 'bad-trade'
  | 'bad-positioning'
  | 'bad-lane-opening'
  | 'cs-deficit'
  | 'xp-deficit'
  | 'behind-on-levels-death'

export interface AdvancedCandidate {
  tagSlug: AdvancedTag
  gameTimeSec: number
  note: string
  severity: 1 | 2 | 3
}

export interface RuleParticipant {
  participantId: number
  teamId: 100 | 200
  championName: string
  /** TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY | '' */
  position: string
}

type Point = { x: number; y: number }

const MAJOR_OBJECTIVES: Record<string, string> = {
  DRAGON: 'Dragon',
  BARON_NASHOR: 'Baron',
  RIFTHERALD: 'Rift Herald',
  ATAKHAN: 'Atakhan',
  HORDE: 'Void Grubs',
}
/** Top-side pit (Baron / Herald / Grubs). */
const TOP_PIT: Point = { x: 5007, y: 10471 }

const LANERS = new Set(['TOP', 'MIDDLE', 'BOTTOM'])
const SEC = 1000
const MIN = 60 * SEC

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const isPoint = (p: any): p is Point => p && typeof p.x === 'number' && typeof p.y === 'number'
const mmss = (ms: number) => `${Math.floor(ms / MIN)}:${String(Math.floor((ms % MIN) / SEC)).padStart(2, '0')}`

export function detectAdvancedMistakes(timeline: any, match: any, player: RuleParticipant): AdvancedCandidate[] {
  const frames: any[] = timeline?.info?.frames ?? []
  if (frames.length === 0) return []

  const participants: RuleParticipant[] = (match?.info?.participants ?? []).map((p: any) => ({
    participantId: p.participantId,
    teamId: p.teamId,
    championName: p.championName,
    position: p.teamPosition ?? p.individualPosition ?? '',
  }))
  const pid = player.participantId
  const role = player.position
  const allies = participants.filter((p) => p.teamId === player.teamId && p.participantId !== pid)
  const opponent = LANERS.has(role)
    ? participants.find((p) => p.teamId !== player.teamId && p.position === role)
    : undefined
  const gameEndMs: number = (match?.info?.gameDuration ?? 0) * SEC || (frames[frames.length - 1]?.timestamp ?? 0)

  // ── event index ──────────────────────────────────────────────────────
  const kills: any[] = []
  const wardTimes: number[] = []
  const objectives: Array<{ ts: number; type: string; teamId: number }> = []
  for (const f of frames) {
    for (const ev of (f.events ?? []) as any[]) {
      if (typeof ev.timestamp !== 'number') continue
      if (ev.type === 'CHAMPION_KILL') kills.push(ev)
      else if (ev.type === 'WARD_PLACED' && ev.creatorId === pid && ev.wardType !== 'UNDEFINED') wardTimes.push(ev.timestamp)
      else if (ev.type === 'ELITE_MONSTER_KILL' && MAJOR_OBJECTIVES[ev.monsterType]) {
        objectives.push({ ts: ev.timestamp, type: ev.monsterType, teamId: ev.killerTeamId })
      }
    }
  }
  kills.sort((a, b) => a.timestamp - b.timestamp)
  wardTimes.sort((a, b) => a - b)
  const myDeaths = kills.filter((k) => k.victimId === pid)

  const frameNear = (ts: number) =>
    frames.reduce((best, f) => (Math.abs((f.timestamp ?? 0) - ts) < Math.abs((best.timestamp ?? 0) - ts) ? f : best), frames[0])
  const frameAtMinute = (m: number) => frames.find((f) => (f.timestamp ?? 0) >= m * MIN - 2 * SEC)
  const posOf = (f: any, id: number): Point | null => {
    const p = f?.participantFrames?.[String(id)]?.position
    return isPoint(p) ? p : null
  }
  const csOf = (f: any, id: number): number | null => {
    const pf = f?.participantFrames?.[String(id)]
    if (!pf || typeof pf.minionsKilled !== 'number') return null
    return pf.minionsKilled + (pf.jungleMinionsKilled ?? 0)
  }
  const goldOf = (f: any, id: number): number | null => {
    const g = f?.participantFrames?.[String(id)]?.totalGold
    return typeof g === 'number' ? g : null
  }
  const levelOf = (f: any, id: number): number | null => {
    const l = f?.participantFrames?.[String(id)]?.level
    return typeof l === 'number' ? l : null
  }
  const alliesWithin = (ts: number, center: Point, radius: number) => {
    const f = frameNear(ts)
    return allies.filter((a) => { const p = posOf(f, a.participantId); return p ? dist(p, center) <= radius : false }).length
  }
  const nearObjective = (ts: number, windowMs: number) => objectives.some((o) => Math.abs(o.ts - ts) <= windowMs)
  const champOf = (id: number) => participants.find((p) => p.participantId === id)?.championName ?? 'an enemy'

  const out: AdvancedCandidate[] = []

  // ── M5 death-before-objective ────────────────────────────────────────
  for (const d of myDeaths) {
    const lost = objectives.find((o) => o.teamId !== player.teamId && o.ts > d.timestamp && o.ts - d.timestamp <= 60 * SEC)
    if (!lost) continue
    let severity: 1 | 2 | 3 = lost.type === 'BARON_NASHOR' || lost.type === 'ATAKHAN' ? 3 : 2
    if (role === 'JUNGLE' && severity < 3) severity = 3
    out.push({
      tagSlug: 'death-before-objective',
      gameTimeSec: Math.floor(d.timestamp / SEC),
      note: `Died ${Math.round((lost.ts - d.timestamp) / SEC)}s before the enemy took ${MAJOR_OBJECTIVES[lost.type]}`,
      severity,
    })
  }

  // ── M6 no-ward-pre-obj ───────────────────────────────────────────────
  const visionRole = role === 'UTILITY' || role === 'JUNGLE'
  for (const o of objectives) {
    if (o.ts < 5 * MIN || o.type === 'HORDE') continue
    // Laners are only accountable for vision on objectives the team lost;
    // supports / junglers on every objective (it is their job).
    if (!visionRole && o.teamId === player.teamId) continue
    const from = o.ts - 90 * SEC
    if (myDeaths.some((d) => d.timestamp >= from - 20 * SEC && d.timestamp <= o.ts)) continue // dead: no chance to ward
    if (wardTimes.some((w) => w >= from && w <= o.ts)) continue
    out.push({
      tagSlug: 'no-ward-pre-obj',
      gameTimeSec: Math.floor(from / SEC),
      note: `No ward placed in the 90s before ${MAJOR_OBJECTIVES[o.type]} (${mmss(o.ts)}, ${o.teamId === player.teamId ? 'taken by your team' : 'lost'})`,
      severity: visionRole ? 2 : 1,
    })
  }

  // ── M7 forgot-trinket ────────────────────────────────────────────────
  {
    const limit = (role === 'UTILITY' ? 150 : 240) * SEC
    const start = 3 * MIN
    const points = [start, ...wardTimes.filter((w) => w > start), gameEndMs]
    let emitted = 0
    for (let i = 0; i + 1 < points.length && emitted < 3; i++) {
      const [a, b] = [points[i], points[i + 1]]
      const deathsInGap = myDeaths.filter((d) => d.timestamp > a && d.timestamp < b).length
      if (b - a > limit + deathsInGap * MIN) {
        out.push({
          tagSlug: 'forgot-trinket',
          gameTimeSec: Math.floor((a + limit) / SEC),
          note: `No ward placed for ${Math.round((b - a) / MIN)} min (from ${mmss(a)})`,
          severity: 1,
        })
        emitted++
      }
    }
  }

  // ── per-death rules: M8, M9, M10, M11 ────────────────────────────────
  for (const d of myDeaths) {
    const ts: number = d.timestamp
    const pos: Point | null = isPoint(d.position) ? d.position : posOf(frameNear(ts), pid)
    const involved = 1 + (Array.isArray(d.assistingParticipantIds) ? d.assistingParticipantIds.length : 0)
    let soloBaron = false

    // M8 solo-baron-died
    if (pos && dist(pos, TOP_PIT) <= 1800 && ts >= 8 * MIN) {
      const near = alliesWithin(ts, pos, 3000)
      if (near <= 1) {
        soloBaron = true
        out.push({
          tagSlug: 'solo-baron-died',
          gameTimeSec: Math.floor(ts / SEC),
          note: `Died at the top-side pit with ${near === 0 ? 'no ally' : 'only one ally'} nearby`,
          severity: 3,
        })
      }
    }

    // M9 caught-out
    if (!soloBaron && pos && ts >= 14 * MIN && !nearObjective(ts, 30 * SEC) && involved >= 2 && alliesWithin(ts, pos, 2500) === 0) {
      out.push({
        tagSlug: 'caught-out',
        gameTimeSec: Math.floor(ts / SEC),
        note: `Caught alone by ${involved} enemies, no ally within reach`,
        severity: 2,
      })
    }

    // M10 bad-trade
    if (opponent && ts < 14 * MIN && d.killerId === opponent.participantId && involved === 1) {
      out.push({
        tagSlug: 'bad-trade',
        gameTimeSec: Math.floor(ts / SEC),
        note: `Solo-killed by your lane opponent (${champOf(opponent.participantId)})`,
        severity: 2,
      })
    }

    // M11 bad-positioning — first to die in a teamfight
    const fight = kills.filter((k) => k.timestamp >= ts && k.timestamp <= ts + 15 * SEC)
    const diedFirst = !kills.some((k) => k.timestamp >= ts - 15 * SEC && k.timestamp < ts)
    if (fight.length >= 3 && diedFirst) {
      out.push({
        tagSlug: 'bad-positioning',
        gameTimeSec: Math.floor(ts / SEC),
        note: `First to die in a ${fight.length}-kill fight`,
        severity: role === 'BOTTOM' || role === 'MIDDLE' ? 2 : 1,
      })
    }
  }

  // ── M12 bad-lane-opening / M13 cs-deficit (laners vs direct opponent) ──
  if (opponent) {
    const f5 = frameAtMinute(5)
    const reasons: string[] = []
    const earlyDeath = myDeaths.find((d) => d.timestamp < 4 * MIN)
    if (earlyDeath) reasons.push(`died at ${mmss(earlyDeath.timestamp)}`)
    const cs5 = [csOf(f5, pid), csOf(f5, opponent.participantId)]
    if (cs5[0] != null && cs5[1] != null && cs5[0] - cs5[1] <= -8) reasons.push(`${cs5[0] - cs5[1]} CS at 5:00`)
    const g5 = [goldOf(f5, pid), goldOf(f5, opponent.participantId)]
    if (g5[0] != null && g5[1] != null && g5[0] - g5[1] <= -400) reasons.push(`${g5[0] - g5[1]} gold at 5:00`)
    if (reasons.length > 0 && f5) {
      out.push({
        tagSlug: 'bad-lane-opening',
        gameTimeSec: 300,
        note: `Rough lane opening vs ${opponent.championName}: ${reasons.join(' · ')}`,
        severity: reasons.length >= 2 ? 3 : 2,
      })
    }

    const f10 = frameAtMinute(10)
    const cs10 = [csOf(f10, pid), csOf(f10, opponent.participantId)]
    if (f10 && cs10[0] != null && cs10[1] != null && cs10[0] - cs10[1] <= -15) {
      const gap = cs10[0] - cs10[1]
      out.push({
        tagSlug: 'cs-deficit',
        gameTimeSec: 600,
        note: `${gap} CS behind ${opponent.championName} at 10:00 (${cs10[0]} vs ${cs10[1]})`,
        severity: gap <= -25 ? 3 : 2,
      })
    }

    // M14 xp-deficit — 2+ levels behind the direct opponent at 10:00 or 15:00.
    for (const [minute, ts] of [[10, 600], [15, 900]] as const) {
      const f = frameAtMinute(minute)
      const lv = [levelOf(f, pid), levelOf(f, opponent.participantId)]
      if (f && lv[0] != null && lv[1] != null && lv[0] - lv[1] <= -2) {
        out.push({
          tagSlug: 'xp-deficit',
          gameTimeSec: ts,
          note: `Level ${lv[0]} vs ${opponent.championName}'s level ${lv[1]} at ${minute}:00`,
          severity: lv[0] - lv[1] <= -3 ? 3 : 2,
        })
        break // one xp-deficit flag per game is enough signal
      }
    }
  }

  // ── M19 behind-on-levels-death ──────────────────────────────────────
  // Coaching reference: the level-2/3 transition fight (≈1:30–4:30) is won
  // by whoever hits it first — an avoidable death to someone already ahead
  // on level there is a provable, early signal, not just "got outplayed".
  // Laners + jungle only: supports don't race levels the same way.
  if (role === 'JUNGLE' || LANERS.has(role)) {
    for (const d of myDeaths) {
      const ts: number = d.timestamp
      if (ts < 90 * SEC || ts > 270 * SEC) continue
      const f = frameNear(ts)
      const myLevel = levelOf(f, pid)
      const killerLevel = typeof d.killerId === 'number' ? levelOf(f, d.killerId) : null
      if (myLevel == null || killerLevel == null) continue
      const gap = killerLevel - myLevel
      if (gap >= 1) {
        out.push({
          tagSlug: 'behind-on-levels-death',
          gameTimeSec: Math.floor(ts / SEC),
          note: `Died at level ${myLevel} to a level-${killerLevel} ${champOf(d.killerId)} during the early level race`,
          severity: gap >= 2 ? 3 : 2,
        })
      }
    }
  }

  return out
}
