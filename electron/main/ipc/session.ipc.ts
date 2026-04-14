import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { tryUnlockBadge } from '../badgeUnlock'
import { getMatchIds, getMatch, getMatchTimeline, extractPlayerStats } from '../riotClient'
export function registerSessionHandlers() {
  ipcMain.handle('session:create', async (_event, data: { objectiveId: string; objectiveIds?: string[]; selectedKpiIds?: string[]; subObjective?: string; customNote?: string; date?: string; isRetroactive?: boolean }) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No user found')

    // Only block active session creation for live sessions; retroactive can always be created
    if (!data.isRetroactive) {
      const existing = await prisma.session.findFirst({
        where: { userId: user.id, status: 'active' },
      })
      if (existing) throw new Error('An active session already exists')
    }

    const ids = data.objectiveIds ?? [data.objectiveId]
    const sessionDate = data.date ? new Date(data.date) : new Date()

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        objectiveId: ids[0],
        objectiveIds: JSON.stringify(ids),
        selectedKpiIds: JSON.stringify(data.selectedKpiIds ?? []),
        subObjective: data.subObjective,
        customNote: data.customNote,
        date: sessionDate,
        // Retroactive sessions are immediately completed
        status: data.isRetroactive ? 'completed' : 'active',
      },
      include: { games: { include: { review: true } } },
    })

    // Update streak
    const now = new Date()
    const lastActive = user.lastActiveDate
    const dayDiff = lastActive
      ? Math.floor((now.getTime() - lastActive.getTime()) / 86400000)
      : 0

    const newStreak = dayDiff <= 1 ? user.streakDays + (dayDiff === 1 ? 1 : 0) : 1
    await prisma.user.update({
      where: { id: user.id },
      data: { streakDays: newStreak, lastActiveDate: now },
    })

    if (newStreak >= 3) await tryUnlockBadge(user.id, 'streak_3')
    if (newStreak >= 7) await tryUnlockBadge(user.id, 'streak_7')
    if (newStreak >= 30) await tryUnlockBadge(user.id, 'streak_30')

    return session
  })

  ipcMain.handle('session:get-active', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return null

    const session = await prisma.session.findFirst({
      where: { userId: user.id, status: 'active' },
      include: {
        games: {
          include: { review: true },
          orderBy: { gameEndAt: 'desc' },
        },
      },
    })

    if (!session) return null

    const accounts = await prisma.account.findMany({ where: { userId: user.id } })
    const matchIds = session.games.map((g) => g.matchId).filter(Boolean)
    const caches = await prisma.matchCache.findMany({
      where: { matchId: { in: matchIds } },
      select: { matchId: true, matchJson: true },
    })
    const cacheByMatchId = new Map(caches.map((c) => [c.matchId, c.matchJson]))
    const allPuuids = [user.puuid, ...accounts.map((a) => a.puuid)]

    const resolveAccountInfo = (matchId: string | null): { accountName: string; accountProfileIconId: number } => {
      const defaultName = user.displayName || user.summonerName
      const defaultIconId = (user as any).profileIconId ?? 0
      if (!matchId) return { accountName: defaultName, accountProfileIconId: defaultIconId }
      const raw = cacheByMatchId.get(matchId)
      if (!raw) return { accountName: defaultName, accountProfileIconId: defaultIconId }
      try {
        const matchData = JSON.parse(raw)
        const participants: any[] = matchData.info?.participants ?? []
        const matchedPuuid = allPuuids.find((p) => participants.some((pp: any) => pp.puuid === p))
        if (!matchedPuuid || matchedPuuid === user.puuid) return { accountName: defaultName, accountProfileIconId: defaultIconId }
        const acc = accounts.find((a) => a.puuid === matchedPuuid)
        return {
          accountName: acc?.gameName ?? defaultName,
          accountProfileIconId: (acc as any)?.profileIconId ?? 0,
        }
      } catch {
        return { accountName: defaultName, accountProfileIconId: defaultIconId }
      }
    }

    return {
      ...session,
      games: session.games.map((g) => ({
        ...g,
        ...resolveAccountInfo(g.matchId),
      })),
    }
  })

  ipcMain.handle('riot:fetch-match-history', async (_event, count = 10) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No user found')

    const accounts = await prisma.account.findMany({ where: { userId: user.id } })
    const queueFilter = (user.queueFilter ?? 'both') as 'soloq' | 'flex' | 'both'

    const allAccountPuuids = [
      { puuid: user.puuid, region: user.region },
      ...accounts.map((a) => ({ puuid: a.puuid, region: a.region })),
    ]
    const allPuuids = allAccountPuuids.map((a) => a.puuid)

    const parsed = Number(count)
    const clampedCount = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 100)) : 10

    const perAccount = await Promise.all(
      allAccountPuuids.map(({ puuid, region }) =>
        getMatchIds(puuid, region, clampedCount, 0, queueFilter).catch(() => [] as string[]),
      ),
    )
    const merged = [...new Set(perAccount.flat())]
    if (merged.length === 0) return []

    const results = await Promise.allSettled(
      merged.map(async (id) => {
        const existing = await prisma.game.findUnique({ where: { matchId: id } })
        const matchData = await getMatch(id, user.region)
        const resolvedPuuid = allPuuids.find((p) =>
          matchData.info?.participants?.some((pp: any) => pp.puuid === p),
        ) ?? user.puuid
        const stats = extractPlayerStats(matchData, resolvedPuuid)
        if (!stats) return null

        let accountName = user.displayName || user.summonerName
        if (resolvedPuuid !== user.puuid) {
          const acc = accounts.find((a) => a.puuid === resolvedPuuid)
          if (acc) accountName = acc.gameName ?? accountName
        }

        return { ...stats, alreadyImported: !!existing, accountName }
      }),
    )

    return results
      .filter((r) => r.status === 'fulfilled' && r.value !== null)
      .map((r) => (r as PromiseFulfilledResult<any>).value)
      .sort((a: any, b: any) => new Date(b.gameEndAt).getTime() - new Date(a.gameEndAt).getTime())
      .slice(0, clampedCount)
  })

  ipcMain.handle('session:import-games', async (_event, matchIds: string[]) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No user found')

    const activeSession = await prisma.session.findFirst({
      where: { userId: user.id, status: 'active' },
    })
    if (!activeSession) throw new Error('No active session. Start a session first.')

    // Gather all linked account puuids for multi-account support
    const linkedAccounts = await prisma.account.findMany({ where: { userId: user.id } })
    const allPuuids = [user.puuid, ...linkedAccounts.map((a) => a.puuid)]

    const imported: any[] = []
    for (const matchId of matchIds) {
      const existing = await prisma.game.findUnique({ where: { matchId } })
      if (existing) continue

      try {
        // Check cache first — avoids redundant API calls and cross-region issues
        let matchData: any = null
        const cached = await prisma.matchCache.findUnique({ where: { matchId } })
        if (cached) {
          matchData = JSON.parse(cached.matchJson)
        } else {
          // getMatch now derives the correct routing from the matchId prefix (EUW1_, NA1_, etc.)
          matchData = await getMatch(matchId, user.region)
          await prisma.matchCache.upsert({
            where: { matchId },
            create: { matchId, matchJson: JSON.stringify(matchData) },
            update: { matchJson: JSON.stringify(matchData) },
          })
        }

        // Resolve which account played this match across all linked puuids
        const participants: any[] = matchData.info?.participants ?? []
        const resolvedPuuid =
          allPuuids.find((puuid) => participants.some((pp: any) => pp.puuid === puuid)) ?? null

        if (!resolvedPuuid) {
          console.warn(`[import] No matching puuid found for ${matchId}`)
          continue
        }
        const stats = extractPlayerStats(matchData, resolvedPuuid)
        if (!stats) {
          console.warn(`[import] Could not extract stats for ${matchId} — player not found among known puuids`)
          continue
        }

        let timelineData: any = cached?.timelineJson ? JSON.parse(cached.timelineJson) : null
        if (!timelineData) {
          try {
            timelineData = await getMatchTimeline(matchId, user.region)
            if (timelineData) {
              await prisma.matchCache.upsert({
                where: { matchId },
                create: {
                  matchId,
                  matchJson: JSON.stringify(matchData),
                  timelineJson: JSON.stringify(timelineData),
                },
                update: { timelineJson: JSON.stringify(timelineData) },
              })
            }
          } catch {
            // Timeline is optional
          }
        }

        const game = await prisma.game.create({
          data: {
            sessionId: activeSession.id,
            matchId: stats.matchId,
            champion: stats.champion,
            opponentChampion: stats.opponentChampion ?? null,
            reviewStatus: 'pending',
            role: stats.role,
            kills: stats.kills,
            deaths: stats.deaths,
            assists: stats.assists,
            cs: stats.cs,
            visionScore: stats.visionScore,
            duration: stats.duration,
            win: stats.win,
            gameEndAt: stats.gameEndAt,
          },
        })
        imported.push(game)
      } catch (err: any) {
        console.error(`[import] Failed to import match ${matchId}:`, err)
      }
    }

    return imported
  })

  ipcMain.handle('session:set-review-status', async (_event, gameId: string, reviewStatus: string) => {
    const prisma = getPrisma()

    if (!['pending', 'to_be_reviewed'].includes(reviewStatus)) {
      throw new Error('Invalid review status')
    }

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { review: true },
    })

    if (!game) throw new Error('Game not found')
    if (game.review) throw new Error('Reviewed games cannot be postponed')

    return prisma.game.update({
      where: { id: gameId },
      data: { reviewStatus },
      include: { review: true },
    })
  })

  /**
   * Returns all completed sessions (most recent first) with just the objective/KPI arrays.
   * The frontend uses this to build a per-objective KPI memory map without needing
   * to know the KPI→objective mapping on the backend side.
   */
  ipcMain.handle('session:get-kpi-history', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return []
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, status: 'completed' },
      orderBy: { date: 'desc' },
      select: { objectiveIds: true, selectedKpiIds: true },
    })
    return sessions.map((s) => ({
      objectiveIds:   JSON.parse(s.objectiveIds  ?? '[]') as string[],
      selectedKpiIds: JSON.parse(s.selectedKpiIds ?? '[]') as string[],
    }))
  })

  ipcMain.handle('session:get-last-config', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return null
    const last = await prisma.session.findFirst({
      where: { userId: user.id, status: 'completed' },
      orderBy: { date: 'desc' },
    })
    if (!last) return null
    return {
      objectiveIds:   JSON.parse(last.objectiveIds  ?? '[]'),
      selectedKpiIds: JSON.parse(last.selectedKpiIds ?? '[]'),
      customNote:     last.customNote ?? '',
      date:           last.date.toISOString(),
    }
  })

  ipcMain.handle('session:end', async (_event, id: string, manualSummary?: string, sessionConclusion?: string) => {
    const prisma = getPrisma()

    const session = await prisma.session.update({
      where: { id },
      data: {
        status: 'completed',
        ...(sessionConclusion !== undefined ? { sessionConclusion } : manualSummary ? { aiSummary: manualSummary } : {}),
      },
      include: {
        games: { include: { review: true } },
      },
    })

    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (user) {
      const gamesPlayed = session.games.length
      const reviewsCompleted = session.games.filter((g) => g.review).length
      const xpGained = gamesPlayed * 25 + reviewsCompleted * 50
      await prisma.user.update({
        where: { id: user.id },
        data: { xp: user.xp + xpGained },
      })

      // Badges: sessions_10, sessions_50
      const completedCount = await prisma.session.count({
        where: { userId: user.id, status: 'completed' },
      })
      if (completedCount >= 10) await tryUnlockBadge(user.id, 'sessions_10')
      if (completedCount >= 50) await tryUnlockBadge(user.id, 'sessions_50')
    }

    return session
  })

  ipcMain.handle('session:delete', async (_event, id: string) => {
    const prisma = getPrisma()

    const games = await prisma.game.findMany({
      where: { sessionId: id },
      select: { id: true },
    })
    const gameIds = games.map((g) => g.id)

    if (gameIds.length > 0) {
      await prisma.gameDetailedStats.deleteMany({ where: { gameId: { in: gameIds } } })
      await prisma.review.deleteMany({ where: { gameId: { in: gameIds } } })
      await prisma.game.deleteMany({ where: { sessionId: id } })
    }

    await prisma.session.delete({ where: { id } })
    return { success: true }
  })

  ipcMain.handle('session:bulk-delete', async (_event, ids: string[]) => {
    const prisma = getPrisma()

    const games = await prisma.game.findMany({
      where: { sessionId: { in: ids } },
      select: { id: true },
    })
    const gameIds = games.map((g) => g.id)

    if (gameIds.length > 0) {
      await prisma.gameDetailedStats.deleteMany({ where: { gameId: { in: gameIds } } })
      await prisma.review.deleteMany({ where: { gameId: { in: gameIds } } })
      await prisma.game.deleteMany({ where: { sessionId: { in: ids } } })
    }

    await prisma.session.deleteMany({ where: { id: { in: ids } } })
    return { success: true, deleted: ids.length }
  })

  ipcMain.handle('session:cancel', async (_event, id: string) => {
    const prisma = getPrisma()

    const games = await prisma.game.findMany({
      where: { sessionId: id },
      select: { id: true },
    })
    const gameIds = games.map((g) => g.id)

    if (gameIds.length > 0) {
      await prisma.gameDetailedStats.deleteMany({ where: { gameId: { in: gameIds } } })
      await prisma.review.deleteMany({ where: { gameId: { in: gameIds } } })
      await prisma.game.deleteMany({ where: { sessionId: id } })
    }

    await prisma.session.delete({ where: { id } })
    return { success: true }
  })

  ipcMain.handle('session:update', async (_event, id: string, data: { objectiveIds?: string[]; selectedKpiIds?: string[]; customNote?: string }) => {
    const prisma = getPrisma()

    const updateData: Record<string, unknown> = {}
    if (data.objectiveIds !== undefined) {
      updateData.objectiveId = data.objectiveIds[0]
      updateData.objectiveIds = JSON.stringify(data.objectiveIds)
    }
    if (data.selectedKpiIds !== undefined) {
      updateData.selectedKpiIds = JSON.stringify(data.selectedKpiIds)
    }
    if (data.customNote !== undefined) {
      updateData.customNote = data.customNote || null
    }

    const session = await prisma.session.update({
      where: { id },
      data: updateData,
      include: { games: { include: { review: true } } },
    })

    return session
  })

  ipcMain.handle('game:delete', async (_event, gameId: string) => {
    const prisma = getPrisma()
    await prisma.gameDetailedStats.deleteMany({ where: { gameId } })
    await prisma.review.deleteMany({ where: { gameId } })
    await prisma.game.delete({ where: { id: gameId } })
    return { success: true }
  })
}

