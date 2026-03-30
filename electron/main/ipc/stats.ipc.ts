import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import {
  getMatchIds,
  getMatch,
  getMatchTimeline,
  extractPlayerStats,
  extractDetailedStats,
} from '../riotClient'

// Debug: capture last stats:match-history execution details
let lastMatchHistoryDebug: Record<string, any> = { status: 'never_called' }

/** Fetch match IDs from the main user + all linked accounts, merged and sorted. */
async function getAggregatedMatchIds(
  user: { puuid: string; region: string; queueFilter?: string | null },
  accounts: Array<{ puuid: string; region: string }>,
  count: number,
): Promise<{ matchIds: string[]; allPuuids: string[] }> {
  const queueFilter = (user.queueFilter ?? 'both') as 'soloq' | 'flex' | 'both'
  const allAccounts = [
    { puuid: user.puuid, region: user.region },
    ...accounts,
  ]
  const allPuuids = allAccounts.map((a) => a.puuid)

  const perAccountIds = await Promise.all(
    allAccounts.map(({ puuid, region }) =>
      getMatchIds(puuid, region, count, 0, queueFilter),
    ),
  )

  const merged = [...new Set(perAccountIds.flat())]
  merged.sort((a, b) => {
    const tsA = parseInt(a.split('_')[1] ?? '0', 10)
    const tsB = parseInt(b.split('_')[1] ?? '0', 10)
    return tsB - tsA
  })

  return { matchIds: merged.slice(0, count), allPuuids }
}

/** Find which puuid from the list is present in a match. */
function resolvePuuid(matchData: any, puuids: string[]): string | null {
  const participants: any[] = matchData.info?.participants ?? []
  for (const puuid of puuids) {
    if (participants.some((p: any) => p.puuid === puuid)) return puuid
  }
  return null
}

/** Resolve the display name for an account by puuid. */
function resolveAccountName(puuid: string, user: any, accounts: any[]): string {
  if (puuid === user.puuid) return user.displayName || user.summonerName
  const account = accounts.find((a: any) => a.puuid === puuid)
  return account?.gameName ?? (user.displayName || user.summonerName)
}

function hasCurrentDetailedStatsSchema(parsed: any): boolean {
  return Boolean(
    parsed &&
    parsed.laning &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'xpPerMin15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'damage15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'damagePerMin15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'damageDiff15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'turretPlates15') &&
    parsed.economy &&
    Object.prototype.hasOwnProperty.call(parsed.economy, 'xp') &&
    Object.prototype.hasOwnProperty.call(parsed.economy, 'xpPerMin') &&
    parsed.objectives &&
    Object.prototype.hasOwnProperty.call(parsed.objectives, 'teamEpicMonsterDmgPercent') &&
    Object.prototype.hasOwnProperty.call(parsed.objectives, 'turretPlates'),
  )
}

function hasCurrentSnapshotSchema(parsed: any): boolean {
  return Boolean(
    parsed &&
    parsed.laning &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'xpPerMin15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'damage15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'damagePerMin15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'damageDiff15') &&
    Object.prototype.hasOwnProperty.call(parsed.laning, 'turretPlates15') &&
    parsed.economy &&
    Object.prototype.hasOwnProperty.call(parsed.economy, 'xp') &&
    Object.prototype.hasOwnProperty.call(parsed.economy, 'xpPerMin') &&
    parsed.objectives &&
    Object.prototype.hasOwnProperty.call(parsed.objectives, 'teamEpicMonsterDmgPercent') &&
    Object.prototype.hasOwnProperty.call(parsed.objectives, 'turretPlates'),
  )
}

export function registerStatsHandlers() {
  ipcMain.handle('stats:diagnose', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ include: { accounts: true } })
    if (!user) return { error: 'No user found in local database' }

    const out: Record<string, any> = {
      puuid: user.puuid.slice(0, 12) + '…',
      region: user.region,
      queueFilter: user.queueFilter ?? 'both',
    }

    // Step 1: get match IDs
    let matchIds: string[] = []
    try {
      matchIds = await getMatchIds(user.puuid, user.region, 5, 0, 'soloq')
      out['step1_soloQ_ids'] = matchIds.length
    } catch (e: any) {
      out['step1_soloQ_error'] = e.message
    }
    try {
      const flex = await getMatchIds(user.puuid, user.region, 5, 0, 'flex')
      out['step1_flex_ids'] = flex.length
      if (matchIds.length === 0) matchIds = flex
    } catch (e: any) {
      out['step1_flex_error'] = e.message
    }

    if (matchIds.length === 0) {
      out['step2_skip'] = 'no match IDs to test'
      return out
    }

    const testId = matchIds[0]
    out['step2_testing_matchId'] = testId

    // Step 2: fetch full match data
    let matchData: any
    try {
      matchData = await getMatch(testId, user.region)
      out['step2_getMatch'] = 'OK'
      out['step2_participantCount'] = matchData?.info?.participants?.length ?? 'missing info'
      out['step2_gameDuration'] = matchData?.info?.gameDuration ?? 'missing'
      out['step2_queueId'] = matchData?.info?.queueId ?? 'missing'
    } catch (e: any) {
      out['step2_getMatch_error'] = e.message
      return out
    }

    // Step 3: resolve puuid
    const participants: any[] = matchData?.info?.participants ?? []
    const puuidFound = participants.some((p: any) => p.puuid === user.puuid)
    out['step3_puuid_in_match'] = puuidFound ? 'YES' : 'NO'
    if (!puuidFound) {
      out['step3_participant_puuids_sample'] = participants.slice(0, 3).map((p: any) => p.puuid?.slice(0, 12) + '…')
      out['step3_stored_puuid'] = user.puuid.slice(0, 12) + '…'
    }

    // Step 4: extract stats
    if (puuidFound) {
      const stats = extractPlayerStats(matchData, user.puuid)
      out['step4_extractStats'] = stats ? 'OK' : 'NULL (extraction failed)'
      if (stats) {
        out['step4_duration_seconds'] = stats.duration
        out['step4_passes_300s_filter'] = (stats.duration ?? 0) >= 300 ? 'YES' : `NO (${stats.duration}s)`
        out['step4_champion'] = stats.champion
        out['step4_role'] = stats.role
      }
    }

    // Step 5: run THE EXACT stats:match-history logic
    try {
      const accounts = await prisma.account.findMany({ where: { userId: user.id } })
      out['step5_accounts'] = accounts.length

      const { matchIds: realIds, allPuuids: realPuuids } = await getAggregatedMatchIds(user, accounts, 50)
      out['step5_aggregated_ids'] = realIds.length
      out['step5_sample_ids'] = realIds.slice(0, 2).join(', ')

      if (realIds.length === 0) {
        out['step5_result'] = 'EMPTY: getAggregatedMatchIds returned 0'
        return out
      }

      const testBatch = realIds.slice(0, 3)
      const results = await Promise.allSettled(
        testBatch.map(async (id: string) => {
          let matchData: any
          const cached = await prisma.matchCache.findUnique({ where: { matchId: id } })
          if (cached) {
            matchData = JSON.parse(cached.matchJson)
          } else {
            matchData = await getMatch(id, user.region)
            await prisma.matchCache.upsert({
              where: { matchId: id },
              create: { matchId: id, matchJson: JSON.stringify(matchData) },
              update: {},
            })
          }
          const rp = resolvePuuid(matchData, realPuuids)
          if (!rp) return null
          const stats = extractPlayerStats(matchData, rp)
          if (!stats) return null
          return {
            gameId: null,
            ...stats,
            imported: false,
            reviewed: false,
            reviewStatus: 'pending' as const,
            accountName: user.summonerName,
          }
        })
      )

      const fulfilled = results.filter((r) => r.status === 'fulfilled' && r.value !== null)
      const rejected = results.filter((r) => r.status === 'rejected')
      out['step5_fulfilled'] = fulfilled.length
      out['step5_rejected'] = rejected.length
      if (rejected.length > 0) {
        out['step5_reject_reason'] = (rejected[0] as PromiseRejectedResult).reason?.message ?? String((rejected[0] as PromiseRejectedResult).reason)
      }

      const mapped = fulfilled.map((r) => (r as PromiseFulfilledResult<any>).value)
      const passDuration = mapped.filter((g: any) => (g.duration ?? 0) >= 300)
      out['step5_pass_duration'] = passDuration.length

      // Test IPC serialization: gameEndAt is a Date object — check if it survives
      if (passDuration.length > 0) {
        const sample = passDuration[0]
        out['step5_gameEndAt_type'] = typeof sample.gameEndAt
        out['step5_gameEndAt_isDate'] = sample.gameEndAt instanceof Date
        out['step5_gameEndAt_val'] = String(sample.gameEndAt).slice(0, 30)
        try {
          const serialized = JSON.parse(JSON.stringify(passDuration[0]))
          out['step5_serializes'] = 'YES'
          out['step5_serialized_keys'] = Object.keys(serialized).length
        } catch (e: any) {
          out['step5_serializes'] = `NO: ${e.message}`
        }
      }
    } catch (e: any) {
      out['step5_error'] = e.message
    }

    // Step 6: show what the ACTUAL stats:match-history call did
    for (const [k, v] of Object.entries(lastMatchHistoryDebug)) {
      out[`real_${k}`] = String(v)
    }

    return out
  })

  ipcMain.handle(
    'stats:match-history',
    async (_event, count = 20) => {
      lastMatchHistoryDebug = { status: 'running', calledAt: new Date().toISOString(), count }
      try {
        const prisma = getPrisma()
        const user = await prisma.user.findFirst()
        if (!user) throw new Error('No user found')

        const accounts = await prisma.account.findMany({ where: { userId: user.id } })
        const { matchIds, allPuuids } = await getAggregatedMatchIds(user, accounts, Math.min(count, 50))
        lastMatchHistoryDebug.matchIdsCount = matchIds.length
        if (matchIds.length === 0) {
          lastMatchHistoryDebug.status = 'done_empty_ids'
          return []
        }

        const results = await Promise.allSettled(
          matchIds.map(async (id: string) => {
            let matchData: any

            const cached = await prisma.matchCache.findUnique({ where: { matchId: id } })
            if (cached) {
              matchData = JSON.parse(cached.matchJson)
            } else {
              const regionToTry = user.region
              matchData = await getMatch(id, regionToTry)
              await prisma.matchCache.upsert({
                where: { matchId: id },
                create: { matchId: id, matchJson: JSON.stringify(matchData) },
                update: {},
              })
            }

            const puuid = resolvePuuid(matchData, allPuuids)
            if (!puuid) return null
            const stats = extractPlayerStats(matchData, puuid)
            if (!stats) return null

            const dbGame = await prisma.game.findUnique({
              where: { matchId: id },
              include: { review: true },
            })

            return {
              gameId: dbGame?.id ?? null,
              ...stats,
              imported: !!dbGame,
              reviewed: !!dbGame?.review,
              reviewStatus: dbGame?.reviewStatus ?? (dbGame?.review ? 'reviewed' : 'pending'),
              accountName: resolveAccountName(puuid, user, accounts),
            }
          }),
        )

        const fulfilled = results.filter((r) => r.status === 'fulfilled' && r.value !== null)
        const rejected = results.filter((r) => r.status === 'rejected')
        lastMatchHistoryDebug.totalSettled = results.length
        lastMatchHistoryDebug.fulfilled = fulfilled.length
        lastMatchHistoryDebug.rejected = rejected.length
        if (rejected.length > 0) {
          lastMatchHistoryDebug.firstRejectReason = (rejected[0] as PromiseRejectedResult).reason?.message ?? String((rejected[0] as PromiseRejectedResult).reason)
        }

        const final = fulfilled
          .map((r) => (r as PromiseFulfilledResult<any>).value)
          .filter((g: any) => (g.duration ?? 0) >= 300)

        lastMatchHistoryDebug.afterDurationFilter = final.length
        lastMatchHistoryDebug.status = 'done'
        lastMatchHistoryDebug.finishedAt = new Date().toISOString()
        return final
      } catch (err: any) {
        lastMatchHistoryDebug.status = 'error'
        lastMatchHistoryDebug.error = err?.message ?? String(err)
        throw err
      }
    },
  )

  ipcMain.handle(
    'stats:get-detailed',
    async (_event, matchId: string) => {
      const prisma = getPrisma()
      const user = await prisma.user.findFirst()
      if (!user) throw new Error('No user found')

      const accounts = await prisma.account.findMany({ where: { userId: user.id } })
      const allPuuids = [user.puuid, ...accounts.map((a) => a.puuid)]

      const dbGame = await prisma.game.findUnique({
        where: { matchId },
        include: { detailedStats: true },
      })

      let resolvedPuuid: string | null = null

      if (dbGame?.detailedStats) {
        const parsed = JSON.parse(dbGame.detailedStats.stats)
        if (hasCurrentDetailedStatsSchema(parsed)) {
          // Try to find the account name from the match cache
          const cached = await prisma.matchCache.findUnique({ where: { matchId } })
          if (cached) {
            const matchData = JSON.parse(cached.matchJson)
            resolvedPuuid = resolvePuuid(matchData, allPuuids)
          }
          return {
            ...parsed,
            meta: {
              ...parsed.meta,
              accountName: resolvedPuuid
                ? resolveAccountName(resolvedPuuid, user, accounts)
                : (user.displayName || user.summonerName),
            },
          }
        }
        await prisma.gameDetailedStats.delete({ where: { gameId: dbGame.id } }).catch(() => {})
      }

      let matchData: any
      let timelineData: any = null

      const cached = await prisma.matchCache.findUnique({ where: { matchId } })
      if (cached) {
        matchData = JSON.parse(cached.matchJson)
        timelineData = cached.timelineJson ? JSON.parse(cached.timelineJson) : null
      } else {
        matchData = await getMatch(matchId, user.region)
      }

      if (!timelineData) {
        try {
          timelineData = await getMatchTimeline(matchId, user.region)
        } catch (err) {
          console.warn(`[stats] Timeline fetch failed for ${matchId}:`, err)
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
          timelineJson: timelineData ? JSON.stringify(timelineData) : undefined,
        },
      })

      const puuid = resolvePuuid(matchData, allPuuids) ?? user.puuid
      const detailed = extractDetailedStats(matchData, timelineData, puuid)
      if (!detailed) {
        if (dbGame) {
          await prisma.gameDetailedStats.deleteMany({ where: { gameId: dbGame.id } })
        }
        throw new Error('Could not extract stats for this player')
      }

      if (dbGame) {
        await prisma.gameDetailedStats.upsert({
          where: { gameId: dbGame.id },
          create: { gameId: dbGame.id, stats: JSON.stringify(detailed) },
          update: { stats: JSON.stringify(detailed) },
        })
      }

      return {
        ...detailed,
        meta: {
          ...detailed.meta,
          accountName: resolveAccountName(puuid, user, accounts),
        },
      }
    },
  )

  ipcMain.handle('stats:compute-averages', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) throw new Error('No user found')

    const matchIds = await getMatchIds(user.puuid, user.region, 20)
    if (matchIds.length === 0) return null

    const allStats: any[] = []
    for (const matchId of matchIds) {
      let matchData: any
      let timelineData: any = null

      const cached = await prisma.matchCache.findUnique({ where: { matchId } })
      if (cached) {
        matchData = JSON.parse(cached.matchJson)
        timelineData = cached.timelineJson ? JSON.parse(cached.timelineJson) : null
      } else {
        matchData = await getMatch(matchId, user.region)
      }

      if (!timelineData) {
        try {
          timelineData = await getMatchTimeline(matchId, user.region)
        } catch { /* timeline optional */ }
      }

      await prisma.matchCache.upsert({
        where: { matchId },
        create: {
          matchId,
          matchJson: JSON.stringify(matchData),
          timelineJson: timelineData ? JSON.stringify(timelineData) : null,
        },
        update: {
          timelineJson: timelineData ? JSON.stringify(timelineData) : undefined,
        },
      })

      const detailed = extractDetailedStats(matchData, timelineData, user.puuid)
      if (detailed) allStats.push(detailed)
    }

    if (allStats.length === 0) return null

    const avg = computeAverages(allStats)
    const firstGameAt = new Date(Math.min(...allStats.map((s) => s.meta.gameEndAt)))
    const lastGameAt = new Date(Math.max(...allStats.map((s) => s.meta.gameEndAt)))

    await prisma.statsSnapshot.create({
      data: {
        userId: user.id,
        stats: JSON.stringify(avg),
        gameCount: allStats.length,
        firstGameAt,
        lastGameAt,
      },
    })

    return {
      averages: avg,
      gameCount: allStats.length,
      firstGameAt: firstGameAt.toISOString(),
      lastGameAt: lastGameAt.toISOString(),
    }
  })

  ipcMain.handle('stats:get-snapshots', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) return []

    const snapshots = await prisma.statsSnapshot.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    })

    const validSnapshots: Array<{
      id: string
      stats: any
      gameCount: number
      firstGameAt: string
      lastGameAt: string
      createdAt: string
    }> = []

    for (const s of snapshots) {
      const parsed = JSON.parse(s.stats)
      if (!hasCurrentSnapshotSchema(parsed)) {
        await prisma.statsSnapshot.delete({ where: { id: s.id } }).catch(() => {})
        continue
      }
      validSnapshots.push({
        id: s.id,
        stats: parsed,
        gameCount: s.gameCount,
        firstGameAt: s.firstGameAt.toISOString(),
        lastGameAt: s.lastGameAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })
    }

    return validSnapshots
  })

  /** Auto-create snapshots for every new batch of 20 games since the last snapshot. */
  ipcMain.handle('stats:auto-snapshot', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) return { created: 0 }

    const accounts = await prisma.account.findMany({ where: { userId: user.id } })
    const { matchIds, allPuuids } = await getAggregatedMatchIds(user, accounts, 100)
    if (matchIds.length === 0) return { created: 0 }

    const lastSnapshot = await prisma.statsSnapshot.findFirst({
      where: { userId: user.id },
      orderBy: { lastGameAt: 'desc' },
    })
    const lastGameAtMs = lastSnapshot?.lastGameAt.getTime() ?? 0

    // matchIds are sorted newest-first; filter to those potentially after last snapshot
    // Add 1h buffer to account for match ID timestamp vs gameEnd timestamp gap
    const candidateIds = matchIds.filter((id) => {
      const ts = parseInt(id.split('_')[1] ?? '0', 10)
      return ts > lastGameAtMs - 3_600_000
    })

    // Oldest first for ordered batch processing
    const orderedIds = [...candidateIds].reverse()

    const gamesWithStats: { stats: any; ts: number }[] = []
    for (const matchId of orderedIds) {
      let matchData: any
      let timelineData: any = null

      const cached = await prisma.matchCache.findUnique({ where: { matchId } })
      if (cached) {
        matchData = JSON.parse(cached.matchJson)
        timelineData = cached.timelineJson ? JSON.parse(cached.timelineJson) : null
      } else {
        try {
          matchData = await getMatch(matchId, user.region)
          await prisma.matchCache.upsert({
            where: { matchId },
            create: { matchId, matchJson: JSON.stringify(matchData) },
            update: {},
          })
        } catch {
          continue
        }
      }

      if (!timelineData) {
        try {
          timelineData = await getMatchTimeline(matchId, user.region)
          await prisma.matchCache.upsert({
            where: { matchId },
            create: {
              matchId,
              matchJson: JSON.stringify(matchData),
              timelineJson: JSON.stringify(timelineData),
            },
            update: { timelineJson: JSON.stringify(timelineData) },
          })
        } catch { /* timeline optional */ }
      }

      const puuid = resolvePuuid(matchData, allPuuids) ?? user.puuid
      const detailed = extractDetailedStats(matchData, timelineData, puuid)
      if (!detailed) continue

      // Only include games genuinely after the last snapshot
      if (detailed.meta.gameEndAt > lastGameAtMs) {
        gamesWithStats.push({ stats: detailed, ts: detailed.meta.gameEndAt })
      }
    }

    // Sort oldest first
    gamesWithStats.sort((a, b) => a.ts - b.ts)

    let created = 0
    let startIdx = 0
    while (gamesWithStats.length - startIdx >= 20) {
      const batch = gamesWithStats.slice(startIdx, startIdx + 20)
      const allStats = batch.map((g) => g.stats)
      const avg = computeAverages(allStats)
      const firstGameAt = new Date(Math.min(...allStats.map((s) => s.meta.gameEndAt)))
      const lastGameAtNew = new Date(Math.max(...allStats.map((s) => s.meta.gameEndAt)))

      await prisma.statsSnapshot.create({
        data: {
          userId: user.id,
          stats: JSON.stringify(avg),
          gameCount: allStats.length,
          firstGameAt,
          lastGameAt: lastGameAtNew,
        },
      })
      created++
      startIdx += 20
    }

    return { created }
  })
}

function computeAverages(statsArray: any[]) {
  const n = statsArray.length
  const sum = (fn: (s: any) => number | null) => {
    let total = 0
    let count = 0
    for (const s of statsArray) {
      const v = fn(s)
      if (v !== null && v !== undefined) { total += v; count++ }
    }
    return count > 0 ? Number((total / count).toFixed(1)) : null
  }

  const boolRate = (fn: (s: any) => boolean) => {
    const trueCount = statsArray.filter((s) => fn(s)).length
    return Number(((trueCount / n) * 100).toFixed(1))
  }

  return {
    laning: {
      gold15: sum((s) => s.laning.gold15),
      xp15: sum((s) => s.laning.xp15),
      xpPerMin15: sum((s) => s.laning.xpPerMin15),
      cs15: sum((s) => s.laning.cs15),
      damage15: sum((s) => s.laning.damage15),
      damagePerMin15: sum((s) => s.laning.damagePerMin15),
      goldDiff15: sum((s) => s.laning.goldDiff15),
      xpDiff15: sum((s) => s.laning.xpDiff15),
      csDiff15: sum((s) => s.laning.csDiff15),
      damageDiff15: sum((s) => s.laning.damageDiff15),
      turretPlates15: sum((s) => s.laning.turretPlates15),
      firstBloodRate: boolRate((s) => s.laning.firstBloodParticipation),
    },
    economy: {
      xp: sum((s) => s.economy.xp),
      xpPerMin: sum((s) => s.economy.xpPerMin),
      goldPerMin: sum((s) => s.economy.goldPerMin),
      csPerMin: sum((s) => parseFloat(s.economy.csPerMin)),
      teamGoldPercent: sum((s) => s.economy.teamGoldPercent),
      laneCS: sum((s) => s.economy.laneCS),
      jungleCS: sum((s) => s.economy.jungleCS),
      maxCsAdvantage: (() => {
        const value = sum((s) => s.economy.maxCsAdvantage)
        return value !== null ? Math.round(value) : null
      })(),
    },
    combat: {
      killParticipation: sum((s) => s.combat.killParticipation),
      damagePerMin: sum((s) => s.combat.damagePerMin),
      teamDamagePercent: sum((s) => s.combat.teamDamagePercent),
      damagePerGold: sum((s) => s.combat.damagePerGold),
      soloKills: sum((s) => s.combat.soloKills),
      damageTaken: sum((s) => s.combat.damageTaken),
      damageMitigated: sum((s) => s.combat.damageMitigated),
      damageTakenPercent: sum((s) => s.combat.damageTakenPercent),
    },
    objectives: {
      damageToEpicMonsters: sum((s) => s.objectives.damageToEpicMonsters),
      teamEpicMonsterDmgPercent: sum((s) => s.objectives.teamEpicMonsterDmgPercent),
      damageToBuildings: sum((s) => s.objectives.damageToBuildings),
      objectivesStolen: sum((s) => s.objectives.objectivesStolen),
      firstTowerRate: boolRate((s) => s.objectives.firstTowerParticipation),
      turretPlates: sum((s) => s.objectives.turretPlates),
      inhibitorTakedowns: sum((s) => s.objectives.inhibitorTakedowns),
      teamBuildingDamagePercent: sum((s) => s.objectives.teamBuildingDamagePercent),
    },
    vision: {
      visionScorePerMin: sum((s) => s.vision.visionScorePerMin),
      controlWardsPurchased: sum((s) => s.vision.controlWardsPurchased),
      wardsPlaced: sum((s) => s.vision.wardsPlaced),
      wardsDestroyed: sum((s) => s.vision.wardsDestroyed),
      stealthWardsPlaced: sum((s) => s.vision.stealthWardsPlaced),
      visionScoreAdvantage: sum((s) => s.vision.visionScoreAdvantage),
    },
    behavioral: {
      skillshotsDodged: sum((s) => s.behavioral.skillshotsDodged),
      killsNearEnemyTurret: sum((s) => s.behavioral.killsNearEnemyTurret),
      outnumberedKills: sum((s) => s.behavioral.outnumberedKills),
      takedownsInEnemyJungle: sum((s) => s.behavioral.takedownsInEnemyJungle),
    },
    meta: {
      winRate: boolRate((s) => s.meta.win),
      avgKills: sum((s) => s.meta.kills),
      avgDeaths: sum((s) => s.meta.deaths),
      avgAssists: sum((s) => s.meta.assists),
      avgCS: sum((s) => s.meta.cs),
      avgVisionScore: sum((s) => s.meta.visionScore),
      avgDuration: sum((s) => s.meta.duration),
      gameCount: n,
    },
  }
}
