import { getMatch, getMatchIds, extractPlayerStats } from './riotClient'
import { getPrisma } from './database'

const LIVE_CLIENT_URL = 'https://127.0.0.1:2999/liveclientdata/gamestats'
const POLL_INTERVAL_MS = 5_000

export class GameDetector {
  private polling = false
  private intervalId: ReturnType<typeof setInterval> | null = null
  private wasInGame = false
  private currentGameTime = 0
  private onGameEnd: (matchData: any) => void

  constructor(onGameEnd: (matchData: any) => void) {
    this.onGameEnd = onGameEnd
  }

  start() {
    if (this.polling) return
    this.polling = true
    this.poll()
    this.intervalId = setInterval(() => this.poll(), POLL_INTERVAL_MS)
  }

  stop() {
    this.polling = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private async poll() {
    try {
      const res = await fetch(LIVE_CLIENT_URL, {
        // LoL client uses self-signed cert
        signal: AbortSignal.timeout(3000),
      })

      if (res.ok) {
        const data = await res.json() as { gameTime?: number }
        this.wasInGame = true
        this.currentGameTime = data.gameTime || 0
      } else {
        this.handleGameNotActive()
      }
    } catch {
      this.handleGameNotActive()
    }
  }

  private async handleGameNotActive() {
    if (!this.wasInGame) return

    this.wasInGame = false
    this.currentGameTime = 0

    try {
      await this.fetchAndSaveLatestMatch()
    } catch (err) {
      console.error('Failed to fetch match after game end:', err)
    }
  }

  private async fetchAndSaveLatestMatch() {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst()
    if (!user) return

    // Wait a few seconds for Riot's API to register the match
    await new Promise((r) => setTimeout(r, 10_000))

    const matchIds = await getMatchIds(user.puuid, user.region, 1)
    if (matchIds.length === 0) return

    const latestMatchId = matchIds[0]

    const existing = await prisma.game.findUnique({ where: { matchId: latestMatchId } })
    if (existing) return

    const matchData = await getMatch(latestMatchId, user.region)
    const stats = extractPlayerStats(matchData, user.puuid)
    if (!stats) return

    const activeSession = await prisma.session.findFirst({
      where: { userId: user.id, status: 'active' },
    })

    if (activeSession) {
      const game = await prisma.game.create({
        data: {
          sessionId: activeSession.id,
          matchId: stats.matchId,
          champion: stats.champion,
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

      this.onGameEnd({ game, stats, sessionId: activeSession.id })
    }
  }
}
