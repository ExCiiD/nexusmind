import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { getAccountByRiotId } from '../riotClient'

export function registerAccountHandlers() {
  ipcMain.handle('account:list', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) return []
    return prisma.account.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    })
  })

  ipcMain.handle('account:add', async (_event, gameName: string, tagLine: string, region: string) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) throw new Error('No user found')

    // Prevent adding the main account as a secondary
    if (user.puuid === undefined) throw new Error('Main user not configured')

    const riotAccount = await getAccountByRiotId(gameName, tagLine, region)

    if (riotAccount.puuid === user.puuid) {
      throw new Error('This account is already your main account')
    }

    const existing = await prisma.account.findUnique({ where: { puuid: riotAccount.puuid } })
    if (existing) throw new Error('This account is already linked')

    return prisma.account.create({
      data: {
        userId: user.id,
        puuid: riotAccount.puuid,
        gameName: riotAccount.gameName,
        tagLine: riotAccount.tagLine,
        region,
      },
    })
  })

  ipcMain.handle('account:remove', async (_event, accountId: string) => {
    const prisma = getPrisma()
    await prisma.account.delete({ where: { id: accountId } })
    return { success: true }
  })
}
