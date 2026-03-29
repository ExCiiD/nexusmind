import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { getAccountByRiotId, getSummonerByPuuid } from '../riotClient'

const GARENA_REGIONS = new Set(['VN2', 'SG2', 'TH2', 'TW2', 'PH2'])

export function registerAuthHandlers() {
  ipcMain.handle('auth:connect-riot', async (_event, gameName: string, tagLine: string, region: string, displayName?: string) => {
    const account = await getAccountByRiotId(gameName, tagLine, region)

    // Garena-operated servers (VN2, SG2, TH2, TW2, PH2) may not support the
    // summoner endpoint with a standard Riot developer key — treat as non-fatal
    try {
      await getSummonerByPuuid(account.puuid, region)
    } catch (err) {
      if (!GARENA_REGIONS.has(region)) throw err
      console.warn(`[auth] Summoner endpoint unavailable for ${region} (Garena server) — continuing`)
    }
    const prisma = getPrisma()

    let user = await prisma.user.findUnique({ where: { puuid: account.puuid } })

    if (!user) {
      user = await prisma.user.create({
        data: {
          displayName: displayName?.trim() || account.gameName,
          summonerName: account.gameName,
          puuid: account.puuid,
          tagLine: account.tagLine,
          region,
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
        },
      })
    }

    return user
  })

  ipcMain.handle('auth:disconnect', async () => {
    const prisma = getPrisma()
    await prisma.user.deleteMany()
  })

  ipcMain.handle('badges:get', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) return []
    const badges = await prisma.badge.findMany({ where: { userId: user.id } })
    return badges.map((b) => b.badgeId)
  })

  ipcMain.handle('user:get', async () => {
    const prisma = getPrisma()
    return prisma.user.findFirst()
  })

  ipcMain.handle('user:update', async (_event, data: any) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) throw new Error('No user found')
    return prisma.user.update({
      where: { id: user.id },
      data,
    })
  })
}
