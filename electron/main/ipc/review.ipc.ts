import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { tryUnlockBadge } from '../badgeUnlock'
import { extractDetailedStats, getMatch, getMatchTimeline } from '../riotClient'
export function registerReviewHandlers() {
  ipcMain.handle(
    'review:save',
    async (
      _event,
      data: {
        gameId: string
        timelineNotes: Array<{ time: string; note: string }>
        kpiScores: Record<string, number>
        freeText?: string
        objectiveRespected: boolean
      },
    ) => {
      const prisma = getPrisma()
      const existingReview = await prisma.review.findUnique({
        where: { gameId: data.gameId },
      })

      const review = await prisma.review.upsert({
        where: { gameId: data.gameId },
        create: {
          gameId: data.gameId,
          timelineNotes: JSON.stringify(data.timelineNotes),
          kpiScores: JSON.stringify(data.kpiScores),
          freeText: data.freeText,
          objectiveRespected: data.objectiveRespected,
        },
        update: {
          timelineNotes: JSON.stringify(data.timelineNotes),
          kpiScores: JSON.stringify(data.kpiScores),
          freeText: data.freeText,
          objectiveRespected: data.objectiveRespected,
        },
      })

      await prisma.game.update({
        where: { id: data.gameId },
        data: { reviewStatus: 'reviewed' },
      })

      const user = await prisma.user.findFirst({ where: { isActive: true } })
      if (user && !existingReview) {
        await prisma.user.update({
          where: { id: user.id },
          data: { xp: user.xp + 50 },
        })

        // Badge: first_review
        const totalReviews = await prisma.review.count({
          where: { game: { session: { userId: user.id } } },
        })
        if (totalReviews === 1) await tryUnlockBadge(user.id, 'first_review')

        // Badges: objective_5, objective_25
        const respectedCount = await prisma.review.count({
          where: { objectiveRespected: true, game: { session: { userId: user.id } } },
        })
        if (respectedCount >= 5) await tryUnlockBadge(user.id, 'objective_5')
        if (respectedCount >= 25) await tryUnlockBadge(user.id, 'objective_25')
      }

      return review
    },
  )

  ipcMain.handle('review:get-by-session', async (_event, sessionId: string) => {
    const prisma = getPrisma()

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        games: {
          include: { review: true },
          orderBy: { gameEndAt: 'asc' },
        },
      },
    })

    if (!session) return []
    return session.games.filter((g) => g.review).map((g) => g.review)
  })

  /** Returns a game and its parent session, even if the session is ended. Used for review from history. */
  ipcMain.handle('review:get-game-context', async (_event, gameId: string) => {
    const prisma = getPrisma()
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        review: true,
        session: {
          include: {
            games: {
              include: { review: true },
              orderBy: { gameEndAt: 'asc' },
            },
          },
        },
      },
    })
    if (!game) return null
    return { game, session: game.session }
  })

  ipcMain.handle(
    'review:analyze-bias',
    async (_event, data: { gameId: string; objectiveIds: string[] }) => {
      const prisma = getPrisma()
      const game = await prisma.game.findUnique({
        where: { id: data.gameId },
        include: { session: true },
      })
      if (!game) throw new Error('Game not found')

      const user = await prisma.user.findUnique({
        where: { id: game.session.userId },
      })
      if (!user) throw new Error('User not found')

      const bundle = await getCachedMatchBundle(prisma, game.matchId, user.region)
      const detailed = extractDetailedStats(bundle.matchData, bundle.timelineData, user.puuid)
      if (!detailed) return []

      return buildBiasSignals(data.objectiveIds, detailed, bundle.matchData, bundle.timelineData, user.puuid)
    },
  )

}

async function getCachedMatchBundle(prisma: ReturnType<typeof getPrisma>, matchId: string, region: string) {
  const cached = await prisma.matchCache.findUnique({ where: { matchId } })

  let matchData: any
  let timelineData: any = null

  if (cached) {
    matchData = JSON.parse(cached.matchJson)
    timelineData = cached.timelineJson ? JSON.parse(cached.timelineJson) : null
  } else {
    matchData = await getMatch(matchId, region)
  }

  if (!timelineData) {
    try {
      timelineData = await getMatchTimeline(matchId, region)
    } catch {
      timelineData = null
    }
  }

  await prisma.matchCache.upsert({
    where: { matchId },
    create: {
      matchId,
      matchJson: JSON.stringify(matchData),
      timelineJson: timelineData ? JSON.stringify(timelineData) : null,
    },
    update: {
      matchJson: JSON.stringify(matchData),
      timelineJson: timelineData ? JSON.stringify(timelineData) : undefined,
    },
  })

  return { matchData, timelineData }
}

function buildBiasSignals(objectiveIds: string[], detailed: any, matchData: any, timelineData: any, puuid: string) {
  const signals: Array<{
    objectiveId: string
    ruleId: string
    severity: 'warning'
    evidence: Record<string, number>
  }> = []

  const player = matchData.info.participants.find((p: any) => p.puuid === puuid)
  if (!player) return signals

  const role = player.teamPosition || player.individualPosition || 'UNKNOWN'
  const gameDuration = detailed.meta.duration ?? 0
  const csPerMin = Number(detailed.economy.csPerMin)
  const goldDiff15 = detailed.laning.goldDiff15 ?? 0
  const xpDiff15 = detailed.laning.xpDiff15 ?? 0
  const csDiff15 = detailed.laning.csDiff15 ?? 0
  const deaths = detailed.meta.deaths ?? 0
  const killParticipation = detailed.combat.killParticipation ?? 0
  const teamDamagePercent = detailed.combat.teamDamagePercent ?? 0
  const damagePerGold = detailed.combat.damagePerGold ?? 0
  const objectiveDamage = detailed.objectives.damageToEpicMonsters ?? 0
  const objectiveDamageParticipation = detailed.objectives.teamEpicMonsterDmgPercent ?? 0
  const buildingDamage = detailed.objectives.damageToBuildings ?? 0
  const visionScorePerMin = detailed.vision.visionScorePerMin ?? 0
  const controlWards = detailed.vision.controlWardsPurchased ?? 0
  const wardsPlaced = detailed.vision.wardsPlaced ?? 0
  const wardsDestroyed = detailed.vision.wardsDestroyed ?? 0
  const skillshotsDodged = detailed.behavioral.skillshotsDodged ?? 0
  const soloKills = detailed.combat.soloKills ?? 0

  const earlyJungleGankDeaths = countEarlyJungleGankDeathsOnOwnLane(matchData, timelineData, puuid)
  const expectedCsPerMin = getExpectedCsPerMin(role)

  const addSignal = (
    targetObjectiveIds: string[],
    ruleId: string,
    condition: boolean,
    evidence: Record<string, number>,
  ) => {
    if (!condition) return
    for (const objectiveId of targetObjectiveIds) {
      if (!objectiveIds.includes(objectiveId)) continue
      signals.push({
        objectiveId,
        ruleId,
        severity: 'warning',
        evidence,
      })
    }
  }

  addSignal(
    ['jungle_tracking', 'map_awareness', 'weak_strong_side', 'vision_setup', 'positioning'],
    'early_jungle_gank_deaths',
    earlyJungleGankDeaths >= 2,
    { count: earlyJungleGankDeaths },
  )

  addSignal(
    ['vision_setup'],
    'low_vision_activity',
    gameDuration >= 900 && controlWards === 0 && wardsPlaced <= 6,
    { controlWards, wardsPlaced },
  )

  addSignal(
    ['vision_control'],
    'low_vision_control',
    gameDuration >= 1200 && visionScorePerMin < 1.1 && wardsDestroyed === 0 && controlWards === 0,
    { visionScorePerMin, wardsDestroyed, controlWards },
  )

  addSignal(
    ['vision_control', 'vision_setup', 'shotcalling_communication'],
    'low_support_vision',
    role === 'UTILITY' && gameDuration >= 1200 && (visionScorePerMin < 1.8 || controlWards === 0),
    { visionScorePerMin, controlWards },
  )

  addSignal(
    ['csing_pathing'],
    'low_cs_per_min',
    expectedCsPerMin !== null && csPerMin < expectedCsPerMin,
    { actual: csPerMin, expected: expectedCsPerMin ?? 0 },
  )

  addSignal(
    ['trades', 'matchup_knowledge', 'level_up_timers', 'wave_management', 'resource_management'],
    'losing_laning_state',
    isLaningRole(role) && (goldDiff15 <= -700 || csDiff15 <= -12 || xpDiff15 <= -400),
    { goldDiff15, csDiff15, xpDiff15 },
  )

  addSignal(
    ['spacing'],
    'low_skillshot_dodging',
    gameDuration >= 1200 && deaths >= 6 && skillshotsDodged <= 2,
    { deaths, skillshotsDodged },
  )

  addSignal(
    ['aggression_calibration', 'limits_knowledge'],
    'high_deaths_low_value',
    deaths >= 8 && soloKills === 0 && damagePerGold < 0.9,
    { deaths, soloKills, damagePerGold },
  )

  addSignal(
    ['roam_gank_timing', 'fog_usage'],
    'low_roam_presence',
    ['MIDDLE', 'UTILITY'].includes(role) && gameDuration >= 1200 && killParticipation < 40,
    { killParticipation },
  )

  addSignal(
    ['gank_effectiveness', 'jungle_tracking'],
    'low_jungle_influence',
    role === 'JUNGLE' && gameDuration >= 1200 && killParticipation < 45 && objectiveDamageParticipation < 12 && objectiveDamage < 2500,
    { killParticipation, objectiveDamageParticipation, objectiveDamage },
  )

  addSignal(
    ['decision_making', 'wave_management_objectives', 'wincon_identification'],
    'low_objective_impact',
    gameDuration >= 1500 && objectiveDamage < 2500 && buildingDamage < 1500,
    { objectiveDamage, buildingDamage },
  )

  addSignal(
    ['lane_assignment', 'rotation_positioning'],
    'low_structure_pressure',
    gameDuration >= 1500 && buildingDamage < 1200,
    { buildingDamage },
  )

  addSignal(
    ['role_identification', 'threat_assessment', 'prefight_positioning'],
    'low_carry_output',
    isCarryRole(role) && gameDuration >= 1200 && teamDamagePercent < 22 && deaths >= 5,
    { teamDamagePercent, deaths },
  )

  addSignal(
    ['role_identification', 'threat_assessment', 'prefight_positioning'],
    'low_teamfight_presence',
    gameDuration >= 1200 && killParticipation < 35,
    { killParticipation },
  )

  addSignal(
    ['tempo'],
    'low_tempo_efficiency',
    gameDuration >= 1200 && objectiveDamage < 1500 && buildingDamage < 1000 && expectedCsPerMin !== null && csPerMin < expectedCsPerMin,
    { objectiveDamage, buildingDamage, actualCsPerMin: csPerMin, expectedCsPerMin: expectedCsPerMin ?? 0 },
  )

  // ---- Zone-based bias rules ----
  const laning = analyzeLaningBehavior(matchData, timelineData, puuid)
  if (laning && laning.totalLaningFrames >= 5) {
    const dangerPct = Math.round((laning.framesInDanger / laning.totalLaningFrames) * 100)
    const totalEarlyDeaths = laning.deathsInSafe + laning.deathsInNeutral + laning.deathsInDanger

    addSignal(
      ['positioning', 'map_awareness', 'weak_strong_side'],
      'high_danger_zone_time',
      dangerPct >= 40 && totalEarlyDeaths >= 2,
      { dangerPct, deathsInDanger: laning.deathsInDanger, totalEarlyDeaths },
    )

    addSignal(
      ['positioning', 'wave_management'],
      'deaths_in_danger_zone',
      laning.deathsInDanger >= 2,
      { deathsInDanger: laning.deathsInDanger, deathsTotal: totalEarlyDeaths },
    )

    if (isLaningRole(role)) {
      const totalDmg = laning.damageFromSafe + laning.damageFromNeutral + laning.damageFromDanger
      const dangerDmgPct = totalDmg > 0 ? Math.round((laning.damageFromDanger / totalDmg) * 100) : 0

      addSignal(
        ['spacing', 'positioning', 'aggression_calibration'],
        'high_danger_zone_trading',
        dangerDmgPct >= 55 && totalEarlyDeaths >= 2,
        { dangerDmgPct, deathsInDanger: laning.deathsInDanger },
      )
    }

    if (role === 'JUNGLE') {
      addSignal(
        ['gank_effectiveness', 'jungle_tracking'],
        'jungle_danger_quadrant_deaths',
        laning.deathsInDanger >= 2,
        { deathsInDanger: laning.deathsInDanger },
      )
    }
  }

  return signals
}

function getExpectedCsPerMin(role: string | null | undefined): number | null {
  switch (role) {
    case 'TOP':
    case 'MIDDLE':
      return 6.5
    case 'BOTTOM':
      return 7
    case 'JUNGLE':
      return 5
    default:
      return null
  }
}

function isLaningRole(role: string | null | undefined) {
  return ['TOP', 'MIDDLE', 'BOTTOM'].includes(role ?? '')
}

function isCarryRole(role: string | null | undefined) {
  return ['MIDDLE', 'BOTTOM'].includes(role ?? '')
}

function countEarlyJungleGankDeathsOnOwnLane(matchData: any | null, timelineData: any | null, puuid: string) {
  if (!matchData?.info?.participants || !timelineData?.info?.frames) return 0

  const player = matchData.info.participants.find((p: any) => p.puuid === puuid)
  if (!player) return 0

  const role = player.teamPosition || player.individualPosition
  if (!['TOP', 'MIDDLE', 'BOTTOM'].includes(role)) return 0

  const enemyJungler = matchData.info.participants.find(
    (p: any) => p.teamId !== player.teamId && p.teamPosition === 'JUNGLE',
  )
  if (!enemyJungler) return 0

  let count = 0
  for (const frame of timelineData.info.frames) {
    if ((frame.timestamp ?? 0) > 900_000) break
    for (const event of frame.events ?? []) {
      if (event.type !== 'CHAMPION_KILL') continue
      if (event.victimId !== player.participantId) continue
      if (!isOnPlayersLane(role, event.position)) continue

      const participants = [event.killerId, ...(event.assistingParticipantIds ?? [])]
      if (participants.includes(enemyJungler.participantId)) {
        count++
      }
    }
  }

  return count
}

function isOnPlayersLane(role: string, position: { x: number; y: number } | undefined) {
  if (!position) return true
  const { x, y } = position

  if (role === 'TOP') return y - x > 3200
  if (role === 'BOTTOM') return x - y > 3200
  if (role === 'MIDDLE') return Math.abs(x - y) <= 2200
  return false
}

// ---------------------------------------------------------------------------
// Lane Zone System
// ---------------------------------------------------------------------------

const OUTER_TOWERS = {
  BLUE: {
    TOP: { x: 981, y: 10441 },
    MIDDLE: { x: 5048, y: 6169 },
    BOTTOM: { x: 10504, y: 1029 },
  },
  RED: {
    TOP: { x: 4318, y: 13875 },
    MIDDLE: { x: 9767, y: 8465 },
    BOTTOM: { x: 13866, y: 4505 },
  },
}

type LaneZone = 'safe' | 'neutral' | 'danger'
type LaneKey = 'TOP' | 'MIDDLE' | 'BOTTOM'

function classifyLaneZone(
  role: string,
  teamId: number,
  position: { x: number; y: number },
): LaneZone {
  const laneKey: LaneKey = role === 'TOP' ? 'TOP' : role === 'BOTTOM' ? 'BOTTOM' : 'MIDDLE'
  const ownTower = teamId === 100 ? OUTER_TOWERS.BLUE[laneKey] : OUTER_TOWERS.RED[laneKey]
  const enemyTower = teamId === 100 ? OUTER_TOWERS.RED[laneKey] : OUTER_TOWERS.BLUE[laneKey]

  const distOwn = Math.hypot(position.x - ownTower.x, position.y - ownTower.y)
  const distEnemy = Math.hypot(position.x - enemyTower.x, position.y - enemyTower.y)
  const total = distOwn + distEnemy

  if (total === 0) return 'neutral'
  const ratio = distOwn / total
  if (ratio < 0.35) return 'safe'
  if (ratio < 0.65) return 'neutral'
  return 'danger'
}

function classifyJungleZone(
  teamId: number,
  position: { x: number; y: number },
  lanePriorities: { top: boolean; mid: boolean; bot: boolean },
): LaneZone {
  const isOwnSide = teamId === 100 ? position.x < 7500 : position.x > 7500
  if (isOwnSide) return 'safe'

  const isTopSide = position.y > 7500
  if (isTopSide) {
    return lanePriorities.top && lanePriorities.mid ? 'neutral' : 'danger'
  }
  return lanePriorities.bot && lanePriorities.mid ? 'neutral' : 'danger'
}

function getLanePriorities(
  frame: any,
  allies: any[],
  enemies: any[],
  teamId: number,
): { top: boolean; mid: boolean; bot: boolean } {
  const hasPrio = (role: string): boolean => {
    const ally = allies.find((p: any) => p.teamPosition === role)
    const enemy = enemies.find((p: any) => p.teamPosition === role)
    if (!ally || !enemy) return true

    const af = frame.participantFrames?.[String(ally.participantId)]
    const ef = frame.participantFrames?.[String(enemy.participantId)]
    if (!af?.position || !ef?.position) return true

    const laneKey: LaneKey = role === 'TOP' ? 'TOP' : role === 'BOTTOM' ? 'BOTTOM' : 'MIDDLE'
    const enemyTower = teamId === 100 ? OUTER_TOWERS.RED[laneKey] : OUTER_TOWERS.BLUE[laneKey]
    const allyDist = Math.hypot(af.position.x - enemyTower.x, af.position.y - enemyTower.y)
    const enemyDist = Math.hypot(ef.position.x - enemyTower.x, ef.position.y - enemyTower.y)
    return allyDist < enemyDist
  }

  return { top: hasPrio('TOP'), mid: hasPrio('MIDDLE'), bot: hasPrio('BOTTOM') }
}

// ---------------------------------------------------------------------------
// Laning Behavior Analysis (first 15 minutes)
// ---------------------------------------------------------------------------

interface LaningBehavior {
  framesInSafe: number
  framesInNeutral: number
  framesInDanger: number
  deathsInSafe: number
  deathsInNeutral: number
  deathsInDanger: number
  damageFromSafe: number
  damageFromNeutral: number
  damageFromDanger: number
  totalLaningFrames: number
}

function analyzeLaningBehavior(
  matchData: any,
  timelineData: any,
  puuid: string,
): LaningBehavior | null {
  if (!timelineData?.info?.frames) return null

  const player = matchData.info.participants.find((p: any) => p.puuid === puuid)
  if (!player) return null

  const role = player.teamPosition || player.individualPosition || 'UNKNOWN'
  const teamId = player.teamId
  const pid = player.participantId
  const isLaner = ['TOP', 'MIDDLE', 'BOTTOM'].includes(role)
  const isJungler = role === 'JUNGLE'

  if (!isLaner && !isJungler) return null

  const allies = matchData.info.participants.filter((p: any) => p.teamId === teamId)
  const enemies = matchData.info.participants.filter((p: any) => p.teamId !== teamId)

  const result: LaningBehavior = {
    framesInSafe: 0, framesInNeutral: 0, framesInDanger: 0,
    deathsInSafe: 0, deathsInNeutral: 0, deathsInDanger: 0,
    damageFromSafe: 0, damageFromNeutral: 0, damageFromDanger: 0,
    totalLaningFrames: 0,
  }

  let prevDmg = 0

  const frames = timelineData.info.frames
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    if ((frame.timestamp ?? 0) > 900_000) break

    const pf = frame.participantFrames?.[String(pid)]
    if (!pf?.position) continue

    result.totalLaningFrames++

    const zone: LaneZone = isLaner
      ? classifyLaneZone(role, teamId, pf.position)
      : classifyJungleZone(teamId, pf.position, getLanePriorities(frame, allies, enemies, teamId))

    if (zone === 'safe') result.framesInSafe++
    else if (zone === 'neutral') result.framesInNeutral++
    else result.framesInDanger++

    const curDmg: number = pf.damageStats?.totalDamageDoneToChampions ?? 0
    const dmgDelta = curDmg - prevDmg
    if (dmgDelta > 0) {
      if (zone === 'safe') result.damageFromSafe += dmgDelta
      else if (zone === 'neutral') result.damageFromNeutral += dmgDelta
      else result.damageFromDanger += dmgDelta
    }

    prevDmg = curDmg
  }

  for (const frame of frames) {
    if ((frame.timestamp ?? 0) > 900_000) break
    for (const event of frame.events ?? []) {
      if (event.type !== 'CHAMPION_KILL' || event.victimId !== pid) continue
      if (!event.position) continue

      let dZone: LaneZone
      if (isLaner) {
        dZone = classifyLaneZone(role, teamId, event.position)
      } else {
        const closestFrame = frames.find((f: any) => (f.timestamp ?? 0) >= (event.timestamp ?? 0)) ?? frame
        dZone = classifyJungleZone(teamId, event.position, getLanePriorities(closestFrame, allies, enemies, teamId))
      }
      if (dZone === 'safe') result.deathsInSafe++
      else if (dZone === 'neutral') result.deathsInNeutral++
      else result.deathsInDanger++
    }
  }

  return result
}


