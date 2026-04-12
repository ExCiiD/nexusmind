import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { getAccountByRiotId, getSummonerByPuuid } from '../riotClient'

const GARENA_REGIONS = new Set(['VN2', 'SG2', 'TH2', 'TW2', 'PH2'])

export function registerAuthHandlers() {
  ipcMain.handle('auth:connect-riot', async (_event, gameName: string, tagLine: string, region: string, displayName?: string) => {
    const account = await getAccountByRiotId(gameName, tagLine, region)

    let profileIconId = 0
    try {
      const summoner = await getSummonerByPuuid(account.puuid, region)
      profileIconId = summoner.profileIconId
    } catch (err) {
      if (!GARENA_REGIONS.has(region)) throw err
      console.warn(`[auth] Summoner endpoint unavailable for ${region} (Garena server) — continuing`)
    }
    const prisma = getPrisma()

    // Deactivate any currently active user
    await prisma.user.updateMany({ where: { isActive: true }, data: { isActive: false } })

    let user = await prisma.user.findUnique({ where: { puuid: account.puuid } })
    let isNewUser = false

    if (!user) {
      isNewUser = true
      user = await prisma.user.create({
        data: {
          displayName: displayName?.trim() || account.gameName,
          summonerName: account.gameName,
          puuid: account.puuid,
          tagLine: account.tagLine,
          region,
          profileIconId,
          isActive: true,
          nextAssessmentAt: new Date(),
        },
      })
    } else {
      user = await prisma.user.update({
        where: { puuid: account.puuid },
        data: {
          displayName: displayName?.trim() || user.displayName || account.gameName,
          summonerName: account.gameName,
          tagLine: account.tagLine,
          region,
          profileIconId,
          isActive: true,
        },
      })
    }

    return { ...user, isNewUser }
  })

  // Soft disconnect: marks the user as inactive without deleting any data
  ipcMain.handle('auth:disconnect', async () => {
    const prisma = getPrisma()
    await prisma.user.updateMany({ where: { isActive: true }, data: { isActive: false } })
  })

  // Reactivate a saved account by id (no re-entry required, refreshes Riot data)
  ipcMain.handle('auth:reactivate', async (_event, userId: string) => {
    const prisma = getPrisma()
    const existing = await prisma.user.findUnique({ where: { id: userId } })
    if (!existing) throw new Error('Account not found')

    let profileIconId = existing.profileIconId
    try {
      const summoner = await getSummonerByPuuid(existing.puuid, existing.region)
      profileIconId = summoner.profileIconId
    } catch {
      // Ignore Garena / network errors — use cached icon
    }

    // Refresh Riot identity data
    let summonerName = existing.summonerName
    let tagLine = existing.tagLine
    try {
      const account = await getAccountByRiotId(existing.summonerName, existing.tagLine, existing.region)
      summonerName = account.gameName
      tagLine = account.tagLine
    } catch {
      // Use cached data if Riot is unreachable
    }

    // Deactivate any currently active user, then activate the selected one
    await prisma.user.updateMany({ where: { isActive: true }, data: { isActive: false } })

    const user = await prisma.user.update({
      where: { id: userId },
      data: { summonerName, tagLine, profileIconId, isActive: true },
    })

    return user
  })

  // Returns all saved accounts (active or not) for the account picker screen
  ipcMain.handle('auth:list-saved-accounts', async () => {
    const prisma = getPrisma()
    return prisma.user.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        displayName: true,
        summonerName: true,
        tagLine: true,
        region: true,
        profileIconId: true,
        isActive: true,
        mainRole: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { sessions: true } },
      },
    })
  })

  ipcMain.handle('badges:get', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return []
    const badges = await prisma.badge.findMany({ where: { userId: user.id } })
    return badges.map((b) => b.badgeId)
  })

  ipcMain.handle('user:get', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return null
    // Augment with columns the stale Prisma client doesn't know about yet
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT discordWebhookUrl FROM "User" WHERE id = ?`,
        user.id,
      )
      if (rows[0]) {
        ;(user as any).discordWebhookUrl = rows[0].discordWebhookUrl ?? null
      }
    } catch {
      // Column may not exist in very old DBs — ignore gracefully
    }
    return user
  })

  ipcMain.handle('user:update', async (_event, data: any) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No user found')

    const ALLOWED_FIELDS = new Set([
      'displayName', 'assessmentFreqDays', 'nextAssessmentAt',
      'queueFilter', 'mainRole', 'profileIconId',
      'autoRecord', 'recordingPath', 'externalRecordingPath',
      'recordQuality', 'recordFps', 'recordEncoder',
      'recordScope', 'recordAllowCustom', 'allowDesktopFallback',
    ])
    const safeData: Record<string, unknown> = {}
    for (const key of Object.keys(data)) {
      if (ALLOWED_FIELDS.has(key)) safeData[key] = data[key]
    }
    if (Object.keys(safeData).length === 0) throw new Error('No allowed fields provided')

    return prisma.user.update({ where: { id: user.id }, data: safeData })
  })
}
