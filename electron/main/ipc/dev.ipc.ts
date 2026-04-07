import { ipcMain, BrowserWindow, app } from 'electron'
import { getPrisma } from '../database'

const FAKE_CHAMPIONS = [
  'Jinx', 'Caitlyn', 'Ahri', 'Zed', 'Thresh', 'Lux', 'Yasuo',
  'Jhin', 'Nautilus', 'Orianna', 'Syndra', 'Kaisa', 'Ezreal',
]
const FAKE_ROLES = ['TOP', 'JUNGLE', 'MID', 'BOT', 'SUPPORT']

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function registerDevHandlers(mainWindow: BrowserWindow) {
  if (app.isPackaged) return

  ipcMain.handle('dev:simulate-game', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No user found — run seed first')

    const activeSession = await prisma.session.findFirst({
      where: { userId: user.id, status: 'active' },
    })
    if (!activeSession) throw new Error('No active session — create one first')

    const kills = rand(0, 12)
    const deaths = rand(0, 8)
    const assists = rand(0, 15)
    const win = Math.random() > 0.5
    const duration = rand(20 * 60, 45 * 60)

    const game = await prisma.game.create({
      data: {
        sessionId: activeSession.id,
        matchId: `DEV-SIM-${Date.now()}`,
        champion: pick(FAKE_CHAMPIONS),
        role: pick(FAKE_ROLES),
        kills, deaths, assists,
        cs: rand(120, 280),
        visionScore: rand(15, 55),
        duration,
        win,
        gameEndAt: new Date(),
      },
    })

    const stats = { kills, deaths, assists, cs: game.cs, visionScore: game.visionScore, duration, win, champion: game.champion, role: game.role }
    mainWindow.webContents.send('game:ended', { game, stats, sessionId: activeSession.id })
    mainWindow.show()
    mainWindow.focus()

    return { game, stats }
  })

  ipcMain.handle('dev:is-dev', () => !app.isPackaged)
}

