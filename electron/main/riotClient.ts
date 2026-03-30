const PLATFORM_URLS: Record<string, string> = {
  BR1: 'https://br1.api.riotgames.com',
  EUN1: 'https://eun1.api.riotgames.com',
  EUW1: 'https://euw1.api.riotgames.com',
  JP1: 'https://jp1.api.riotgames.com',
  KR: 'https://kr.api.riotgames.com',
  LA1: 'https://la1.api.riotgames.com',
  LA2: 'https://la2.api.riotgames.com',
  NA1: 'https://na1.api.riotgames.com',
  OC1: 'https://oc1.api.riotgames.com',
  PH2: 'https://ph2.api.riotgames.com',
  RU: 'https://ru.api.riotgames.com',
  SG2: 'https://sg2.api.riotgames.com',
  TH2: 'https://th2.api.riotgames.com',
  TR1: 'https://tr1.api.riotgames.com',
  TW2: 'https://tw2.api.riotgames.com',
  VN2: 'https://vn2.api.riotgames.com',
}

const REGIONAL_URLS: Record<string, string> = {
  americas: 'https://americas.api.riotgames.com',
  asia: 'https://asia.api.riotgames.com',
  europe: 'https://europe.api.riotgames.com',
  sea: 'https://sea.api.riotgames.com',
}

const REGION_TO_ROUTING: Record<string, string> = {
  BR1: 'americas',
  LA1: 'americas',
  LA2: 'americas',
  NA1: 'americas',
  OC1: 'sea',
  PH2: 'sea',
  SG2: 'sea',
  TH2: 'sea',
  TW2: 'sea',
  VN2: 'sea',
  JP1: 'asia',
  KR: 'asia',
  EUN1: 'europe',
  EUW1: 'europe',
  RU: 'europe',
  TR1: 'europe',
}

class TokenBucket {
  private tokens: number
  private lastRefill: number
  constructor(
    private maxTokens: number,
    private refillRate: number,
  ) {
    this.tokens = maxTokens
    this.lastRefill = Date.now()
  }

  async acquire(): Promise<void> {
    this.refill()
    if (this.tokens <= 0) {
      const waitMs = (1 / this.refillRate) * 1000
      await new Promise((r) => setTimeout(r, waitMs))
      this.refill()
    }
    this.tokens--
  }

  private refill() {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }
}

const rateLimiter = new TokenBucket(20, 20)

async function riotFetch(url: string, allowedFallbackStatus?: number[]): Promise<{ data: any; status: number }> {
  const apiKey = (import.meta.env.MAIN_VITE_RIOT_API_KEY as string | undefined)?.trim()
  if (!apiKey || apiKey.startsWith('RGAPI-xxx')) throw new Error('Riot API key not configured — set MAIN_VITE_RIOT_API_KEY in .env')

  await rateLimiter.acquire()

  const res = await fetch(url, {
    headers: { 'X-Riot-Token': apiKey },
  })

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10)
    await new Promise((r) => setTimeout(r, retryAfter * 1000))
    return riotFetch(url, allowedFallbackStatus)
  }

  if (!res.ok) {
    if (allowedFallbackStatus?.includes(res.status)) {
      return { data: null, status: res.status }
    }
    if (res.status === 403) {
      throw new Error('Riot API key is expired or invalid. Development keys expire every 24 hours — please regenerate at developer.riotgames.com')
    }
    if (res.status === 404) {
      throw new Error(`Account not found (404). Make sure your Game Name and Tag are correct for the selected region.`)
    }
    if (res.status === 400) {
      throw new Error(`Bad request (400). Check that your Game Name and Tag are spelled correctly.`)
    }
    throw new Error(`Riot API error ${res.status}: ${res.statusText}`)
  }

  return { data: await res.json(), status: res.status }
}

async function riotFetchJson(url: string): Promise<any> {
  const { data } = await riotFetch(url)
  return data
}

// Routing fallback order when the primary cluster returns 403 (e.g. dev keys lack SEA access)
const ROUTING_FALLBACKS: Record<string, string[]> = {
  sea: ['asia', 'americas', 'europe'],
}

async function riotFetchWithRoutingFallback(
  path: string,
  routing: string,
): Promise<any> {
  const primaryBase = REGIONAL_URLS[routing]
  const { data, status } = await riotFetch(`${primaryBase}${path}`, [403])
  if (status === 403) {
    const fallbacks = ROUTING_FALLBACKS[routing] ?? []
    for (const fb of fallbacks) {
      const fbBase = REGIONAL_URLS[fb]
      const result = await riotFetch(`${fbBase}${path}`, [403])
      if (result.status !== 403) return result.data
    }
    throw new Error('Riot API key is expired or invalid. Development keys expire every 24 hours — please regenerate at developer.riotgames.com')
  }
  return data
}

export async function getAccountByRiotId(
  gameName: string,
  tagLine: string,
  region: string,
): Promise<{ puuid: string; gameName: string; tagLine: string }> {
  const routing = REGION_TO_ROUTING[region] || 'europe'
  const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  return riotFetchWithRoutingFallback(path, routing)
}

export async function getSummonerByPuuid(
  puuid: string,
  region: string,
): Promise<{ id: string; accountId: string; puuid: string; profileIconId: number; summonerLevel: number }> {
  const base = PLATFORM_URLS[region]
  return riotFetchJson(`${base}/lol/summoner/v4/summoners/by-puuid/${puuid}`)
}

export async function getRankedStats(
  summonerId: string,
  region: string,
): Promise<
  Array<{
    queueType: string
    tier: string
    rank: string
    leaguePoints: number
    wins: number
    losses: number
  }>
> {
  const base = PLATFORM_URLS[region]
  return riotFetchJson(`${base}/lol/league/v4/entries/by-summoner/${summonerId}`)
}

export async function getMatchIds(
  puuid: string,
  region: string,
  count = 5,
  start = 0,
  queueFilter: 'soloq' | 'flex' | 'both' = 'both',
): Promise<string[]> {
  const routing = REGION_TO_ROUTING[region] || 'europe'

  if (queueFilter === 'both') {
    // Fetch SoloQ and Flex separately, merge and sort by recency
    const [soloIds, flexIds] = await Promise.all([
      riotFetchWithRoutingFallback(
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=0&count=${count}`,
        routing,
      ),
      riotFetchWithRoutingFallback(
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=440&start=0&count=${count}`,
        routing,
      ),
    ])
    // Merge, deduplicate, and take the most recent `count` entries
    const merged = [...new Set([...soloIds, ...flexIds])]
    // Match IDs embed a timestamp (last segment), sort descending
    merged.sort((a, b) => {
      const tsA = parseInt(a.split('_')[1] ?? '0', 10)
      const tsB = parseInt(b.split('_')[1] ?? '0', 10)
      return tsB - tsA
    })
    return merged.slice(start, start + count)
  }

  const queue = queueFilter === 'soloq' ? 420 : 440
  const path = `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queue}&start=${start}&count=${count}`
  return riotFetchWithRoutingFallback(path, routing)
}

export async function getMatch(
  matchId: string,
  region: string,
): Promise<any> {
  // Match IDs encode the platform prefix (e.g., "EUW1_12345", "NA1_67890").
  // Always prefer routing derived from the matchId itself — this handles cross-region smurfs.
  const platformFromId = matchId.split('_')[0]
  const routingFromId = REGION_TO_ROUTING[platformFromId]
  const routing = routingFromId || REGION_TO_ROUTING[region] || 'europe'
  const path = `/lol/match/v5/matches/${matchId}`
  return riotFetchWithRoutingFallback(path, routing)
}

export function extractPlayerStats(matchData: any, puuid: string) {
  const participant = matchData.info.participants.find((p: any) => p.puuid === puuid)
  if (!participant) return null

  const opponent = findLaneOpponent(matchData, puuid)

  return {
    champion: participant.championName,
    role: participant.teamPosition || participant.individualPosition || 'UNKNOWN',
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
    visionScore: participant.visionScore,
    duration: matchData.info.gameDuration,
    win: participant.win,
    gameEndAt: new Date(matchData.info.gameEndTimestamp),
    matchId: matchData.metadata.matchId,
    opponentChampion: opponent?.championName ?? null,
  }
}

export async function getMatchTimeline(
  matchId: string,
  region: string,
): Promise<any> {
  const platformFromId = matchId.split('_')[0]
  const routingFromId = REGION_TO_ROUTING[platformFromId]
  const routing = routingFromId || REGION_TO_ROUTING[region] || 'europe'
  const path = `/lol/match/v5/matches/${matchId}/timeline`
  return riotFetchWithRoutingFallback(path, routing)
}

function findLaneOpponent(matchData: any, puuid: string): any | null {
  const player = matchData.info.participants.find((p: any) => p.puuid === puuid)
  if (!player) return null
  const position = player.teamPosition || player.individualPosition
  if (!position) return null
  return (
    matchData.info.participants.find(
      (p: any) =>
        p.teamId !== player.teamId &&
        (p.teamPosition === position || p.individualPosition === position),
    ) ?? null
  )
}

function getTimelineFrameAt(timelineData: any, participantId: number, targetMs: number) {
  if (!timelineData?.info?.frames) return null
  let closest: any = null
  let closestDiff = Infinity
  for (const frame of timelineData.info.frames) {
    const diff = Math.abs(frame.timestamp - targetMs)
    if (diff < closestDiff) {
      closestDiff = diff
      closest = frame
    }
  }
  if (!closest) return null
  return closest.participantFrames?.[String(participantId)] ?? null
}

function getLatestTimelineFrame(timelineData: any, participantId: number) {
  const frames = timelineData?.info?.frames
  if (!frames?.length) return null
  const latest = frames[frames.length - 1]
  return latest?.participantFrames?.[String(participantId)] ?? null
}

function getTimelineEventsUntil(timelineData: any, targetMs: number): any[] {
  if (!timelineData?.info?.frames) return []
  return timelineData.info.frames
    .filter((frame: any) => (frame.timestamp ?? 0) <= targetMs)
    .flatMap((frame: any) => frame.events ?? [])
}

function countTurretPlatesByParticipantUntil(
  timelineData: any,
  participantId: number,
  targetMs: number,
): number | null {
  if (!timelineData?.info?.frames) return null
  const events = getTimelineEventsUntil(timelineData, targetMs)
  return events.filter((event: any) => {
    if (event?.type !== 'TURRET_PLATE_DESTROYED') return false
    const participants = [
      event.killerId,
      ...(event.assistingParticipantIds ?? []),
    ].filter((id: any) => typeof id === 'number')
    return participants.includes(participantId)
  }).length
}

export function extractDetailedStats(matchData: any, timelineData: any | null, puuid: string) {
  const p = matchData.info.participants.find((pp: any) => pp.puuid === puuid)
  if (!p) return null

  const gameDurationMin = matchData.info.gameDuration / 60
  const ch = p.challenges || {}
  const teamParticipants = matchData.info.participants.filter((pp: any) => pp.teamId === p.teamId)
  const teamKills = teamParticipants.reduce((s: number, pp: any) => s + pp.kills, 0)
  const teamGold = teamParticipants.reduce((s: number, pp: any) => s + pp.goldEarned, 0)
  const teamDamage = teamParticipants.reduce((s: number, pp: any) => s + pp.totalDamageDealtToChampions, 0)
  const teamDamageTaken = teamParticipants.reduce((s: number, pp: any) => s + pp.totalDamageTaken, 0)
  const teamObjectiveDamage = teamParticipants.reduce((s: number, pp: any) => s + (pp.damageDealtToObjectives ?? 0), 0)
  const teamBuildingDamage = teamParticipants.reduce((s: number, pp: any) => s + (pp.damageDealtToBuildings ?? 0), 0)
  // Epic monster damage = objective damage minus building damage
  const playerEpicMonsterDmg = Math.max(0, (p.damageDealtToObjectives ?? 0) - (p.damageDealtToBuildings ?? 0))
  const teamEpicMonsterDmg = Math.max(0, teamObjectiveDamage - teamBuildingDamage)

  const opponent = findLaneOpponent(matchData, puuid)

  // Timeline participant IDs (1-indexed in the match data)
  const participantId = p.participantId
  const opponentParticipantId = opponent?.participantId

  // @15 min stats from timeline
  let gold15: number | null = null
  let xp15: number | null = null
  let xpPerMin15: number | null = null
  let cs15: number | null = null
  let damage15: number | null = null
  let damagePerMin15: number | null = null
  let goldDiff15: number | null = null
  let xpDiff15: number | null = null
  let csDiff15: number | null = null
  let damageDiff15: number | null = null
  let turretPlates15: number | null = null
  let xpTotal: number | null = null
  let xpPerMin: number | null = null

  // Opponent @15 stats
  let oppGold15: number | null = null
  let oppXp15: number | null = null
  let oppXpPerMin15: number | null = null
  let oppCs15: number | null = null
  let oppDamage15: number | null = null
  let oppDamagePerMin15: number | null = null
  let oppTurretPlates15: number | null = null

  if (timelineData && matchData.info.gameDuration >= 900) {
    const frame = getTimelineFrameAt(timelineData, participantId, 900_000)
    if (frame) {
      gold15 = frame.totalGold ?? null
      xp15 = frame.xp ?? null
      xpPerMin15 = xp15 !== null ? Number((xp15 / 15).toFixed(1)) : null
      cs15 = (frame.minionsKilled ?? 0) + (frame.jungleMinionsKilled ?? 0)
      damage15 = frame.damageStats?.totalDamageDoneToChampions ?? null
      damagePerMin15 = damage15 !== null ? Number((damage15 / 15).toFixed(1)) : null
      turretPlates15 = countTurretPlatesByParticipantUntil(timelineData, participantId, 900_000)

      if (opponentParticipantId) {
        const oppFrame = getTimelineFrameAt(timelineData, opponentParticipantId, 900_000)
        if (oppFrame) {
          oppGold15 = oppFrame.totalGold ?? null
          oppXp15 = oppFrame.xp ?? null
          oppXpPerMin15 = oppXp15 !== null ? Number((oppXp15 / 15).toFixed(1)) : null
          oppCs15 = (oppFrame.minionsKilled ?? 0) + (oppFrame.jungleMinionsKilled ?? 0)
          oppDamage15 = oppFrame.damageStats?.totalDamageDoneToChampions ?? null
          oppDamagePerMin15 = oppDamage15 !== null ? Number((oppDamage15 / 15).toFixed(1)) : null
          oppTurretPlates15 = countTurretPlatesByParticipantUntil(timelineData, opponentParticipantId, 900_000)

          goldDiff15 = (gold15 ?? 0) - (oppGold15 ?? 0)
          xpDiff15 = (xp15 ?? 0) - (oppXp15 ?? 0)
          csDiff15 = cs15! - oppCs15
          damageDiff15 = (damage15 ?? 0) - (oppDamage15 ?? 0)
        }
      }
    }
  }

  if (timelineData) {
    const latestFrame = getLatestTimelineFrame(timelineData, participantId)
    if (latestFrame) {
      xpTotal = latestFrame.xp ?? null
      xpPerMin = xpTotal !== null && gameDurationMin > 0
        ? Number((xpTotal / gameDurationMin).toFixed(1))
        : null
    }
  }

  const visionScoreAdv = opponent
    ? p.visionScore - (opponent.visionScore ?? 0)
    : null

  const oppTeamParticipants = opponent
    ? matchData.info.participants.filter((pp: any) => pp.teamId !== p.teamId)
    : []
  const oppTeamKills = oppTeamParticipants.reduce((s: number, pp: any) => s + pp.kills, 0)

  return {
    laning: {
      gold15,
      xp15,
      xpPerMin15,
      cs15,
      damage15,
      damagePerMin15,
      goldDiff15,
      xpDiff15,
      csDiff15,
      damageDiff15,
      turretPlates15,
      firstBloodParticipation: p.firstBloodKill || p.firstBloodAssist || false,
    },
    economy: {
      xp: xpTotal,
      xpPerMin,
      goldPerMin: gameDurationMin > 0 ? Math.round(p.goldEarned / gameDurationMin) : 0,
      csPerMin: gameDurationMin > 0 ? Number((p.totalMinionsKilled + p.neutralMinionsKilled) / gameDurationMin).toFixed(1) : '0',
      teamGoldPercent: teamGold > 0 ? Number(((p.goldEarned / teamGold) * 100).toFixed(1)) : 0,
      laneCS: p.totalMinionsKilled,
      jungleCS: p.neutralMinionsKilled,
      maxCsAdvantage: ch.maxCsAdvantageOnLaneOpponent != null
        ? Math.round(ch.maxCsAdvantageOnLaneOpponent)
        : null,
    },
    combat: {
      killParticipation: teamKills > 0 ? Number((((p.kills + p.assists) / teamKills) * 100).toFixed(1)) : 0,
      damagePerMin: gameDurationMin > 0 ? Math.round(p.totalDamageDealtToChampions / gameDurationMin) : 0,
      teamDamagePercent: teamDamage > 0 ? Number(((p.totalDamageDealtToChampions / teamDamage) * 100).toFixed(1)) : 0,
      damagePerGold: p.goldEarned > 0 ? Number((p.totalDamageDealtToChampions / p.goldEarned).toFixed(2)) : 0,
      soloKills: ch.soloKills ?? null,
      damageTaken: p.totalDamageTaken,
      damageMitigated: p.damageSelfMitigated ?? 0,
      damageTakenPercent: teamDamageTaken > 0 ? Number(((p.totalDamageTaken / teamDamageTaken) * 100).toFixed(1)) : 0,
    },
    objectives: {
      damageToEpicMonsters: playerEpicMonsterDmg,
      teamEpicMonsterDmgPercent: teamEpicMonsterDmg > 0
        ? Number(((playerEpicMonsterDmg / teamEpicMonsterDmg) * 100).toFixed(1))
        : 0,
      damageToBuildings: p.damageDealtToBuildings ?? 0,
      teamBuildingDamagePercent: teamBuildingDamage > 0
        ? Number((((p.damageDealtToBuildings ?? 0) / teamBuildingDamage) * 100).toFixed(1))
        : 0,
      objectivesStolen: p.objectivesStolen ?? 0,
      firstTowerParticipation: p.firstTowerKill || p.firstTowerAssist || false,
      turretPlates: ch.turretPlatesTaken ?? 0,
      inhibitorTakedowns: p.inhibitorTakedowns ?? p.inhibitorKills ?? 0,
    },
    vision: {
      visionScorePerMin: gameDurationMin > 0 ? Number((p.visionScore / gameDurationMin).toFixed(2)) : 0,
      controlWardsPurchased: p.visionWardsBoughtInGame ?? 0,
      wardsPlaced: p.wardsPlaced ?? 0,
      wardsDestroyed: p.wardsKilled ?? 0,
      stealthWardsPlaced: ch.stealthWardsPlaced ?? null,
      visionScoreAdvantage: visionScoreAdv,
    },
    behavioral: {
      skillshotsDodged: ch.skillshotsDodged ?? null,
      killsNearEnemyTurret: ch.killsNearEnemyTurret ?? null,
      outnumberedKills: ch.outnumberedKills ?? null,
      takedownsInEnemyJungle: ch.takedownsInEnemyJungle ?? null,
    },
    meta: {
      champion: p.championName,
      role: p.teamPosition || p.individualPosition || 'UNKNOWN',
      win: p.win,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      cs: p.totalMinionsKilled + p.neutralMinionsKilled,
      visionScore: p.visionScore,
      duration: matchData.info.gameDuration,
      gameEndAt: matchData.info.gameEndTimestamp,
      matchId: matchData.metadata.matchId,
      opponentChampion: opponent?.championName ?? null,
    },
    opponent: opponent ? (() => {
      const oppCh = opponent.challenges ?? {}
      const oppCs = (opponent.totalMinionsKilled ?? 0) + (opponent.neutralMinionsKilled ?? 0)
      const oppTotalDamage = opponent.totalDamageDealtToChampions ?? 0
      const oppGold = opponent.goldEarned ?? 0
      const oppEpicMonsterDmg = Math.max(0, (opponent.damageDealtToObjectives ?? 0) - (opponent.damageDealtToBuildings ?? 0))
      return {
        champion: opponent.championName,
        kills: opponent.kills,
        deaths: opponent.deaths,
        assists: opponent.assists,
        cs: oppCs,
        laneCS: opponent.totalMinionsKilled ?? 0,
        jungleCS: opponent.neutralMinionsKilled ?? 0,
        visionScore: opponent.visionScore ?? 0,
        totalDamage: oppTotalDamage,
        damagePerMin: gameDurationMin > 0 ? Math.round(oppTotalDamage / gameDurationMin) : 0,
        goldEarned: oppGold,
        goldPerMin: gameDurationMin > 0 ? Math.round(oppGold / gameDurationMin) : 0,
        csPerMin: gameDurationMin > 0 ? Number((oppCs / gameDurationMin).toFixed(1)) : 0,
        visionScorePerMin: gameDurationMin > 0 ? Number(((opponent.visionScore ?? 0) / gameDurationMin).toFixed(2)) : 0,
        wardsPlaced: opponent.wardsPlaced ?? 0,
        wardsDestroyed: opponent.wardsKilled ?? 0,
        controlWardsPurchased: opponent.visionWardsBoughtInGame ?? 0,
        stealthWardsPlaced: oppCh.stealthWardsPlaced ?? null,
        damageTaken: opponent.totalDamageTaken ?? 0,
        damageMitigated: opponent.damageSelfMitigated ?? 0,
        damagePerGold: oppGold > 0 ? Number((oppTotalDamage / oppGold).toFixed(2)) : 0,
        killParticipation: oppTeamKills > 0 ? Number((((opponent.kills + opponent.assists) / oppTeamKills) * 100).toFixed(1)) : 0,
        epicMonsterDamage: oppEpicMonsterDmg,
        damageToBuildings: opponent.damageDealtToBuildings ?? 0,
        objectivesStolen: opponent.objectivesStolen ?? 0,
        inhibitorTakedowns: opponent.inhibitorTakedowns ?? opponent.inhibitorKills ?? 0,
        turretPlates: oppCh.turretPlatesTaken ?? 0,
        firstTowerParticipation: opponent.firstTowerKill || opponent.firstTowerAssist || false,
        firstBloodParticipation: opponent.firstBloodKill || opponent.firstBloodAssist || false,
        soloKills: oppCh.soloKills ?? null,
        skillshotsDodged: oppCh.skillshotsDodged ?? null,
        killsNearEnemyTurret: oppCh.killsNearEnemyTurret ?? null,
        outnumberedKills: oppCh.outnumberedKills ?? null,
        takedownsInEnemyJungle: oppCh.takedownsInEnemyJungle ?? null,
        gold15: oppGold15,
        xp15: oppXp15,
        xpPerMin15: oppXpPerMin15,
        cs15: oppCs15,
        damage15: oppDamage15,
        damagePerMin15: oppDamagePerMin15,
        turretPlates15: oppTurretPlates15,
      }
    })() : null,
  }
}
