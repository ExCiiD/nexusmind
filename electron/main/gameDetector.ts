import https from 'https'
import { getMatch, getMatchIds, extractPlayerStats, isQueueSessionEligible } from './riotClient'
import { getPrisma } from './database'

const LIVE_CLIENT_HOST = '127.0.0.1'
const LIVE_CLIENT_PORT = 2999
const LIVE_CLIENT_PATH = '/liveclientdata/gamestats'
const POLL_INTERVAL_MS = 5_000

/** Fetches the Live Client API, bypassing the self-signed TLS cert from Riot. */
function pollLiveClient(): Promise<{ ok: boolean; data?: { gameTime?: number } }> {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: LIVE_CLIENT_HOST,
        port: LIVE_CLIENT_PORT,
        path: LIVE_CLIENT_PATH,
        rejectUnauthorized: false,
        timeout: 3000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          resolve({ ok: false })
          return
        }
        let raw = ''
        res.on('data', (chunk: Buffer) => { raw += chunk.toString() })
        res.on('end', () => {
          try {
            resolve({ ok: true, data: JSON.parse(raw) })
          } catch {
            resolve({ ok: true, data: {} })
          }
        })
      },
    )
    req.on('error', () => resolve({ ok: false }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }) })
  })
}

export class GameDetector {
  private polling = false
  private intervalId: ReturnType<typeof setInterval> | null = null
  private wasInGame = false
  private currentGameTime = 0
  /** Timestamp when the current game was first detected — used to validate post-game match lookup */
  private gameStartedAt: number | null = null

  constructor(
    private onGameEnd: (matchData: any) => void,
    private onGameStart?: () => void,
    /** Fires immediately when the live client stops responding (before Riot API fetch). Use to stop recording. May be async (e.g. persist Recording row before match lookup). */
    private onGameRawEnd?: () => void | Promise<void>,
  ) {}

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
      const res = await pollLiveClient()
      if (res.ok) {
        if (!this.wasInGame) {
          // Transition: not in game → in game
          this.wasInGame = true
          this.gameStartedAt = Date.now()
          console.log(`[detector] Game start detected (gameTime: ${res.data?.gameTime ?? 0}s)`)
          try { this.onGameStart?.() } catch (err) {
            console.error('[detector] onGameStart error:', err)
          }
        }
        this.currentGameTime = res.data?.gameTime ?? 0
      } else {
        void this.handleGameNotActive()
      }
    } catch (err: unknown) {
      console.error('[detector] Unexpected poll error:', (err as Error)?.message ?? err)
      void this.handleGameNotActive()
    }
  }

  private async handleGameNotActive() {
    if (!this.wasInGame) return

    this.wasInGame = false
    this.currentGameTime = 0
    const gameStartedAt = this.gameStartedAt ?? Date.now()
    this.gameStartedAt = null

    // Stop recording and persist DB row first — must complete before Riot match lookup so onGameEnd can link by filePath
    try {
      await Promise.resolve(this.onGameRawEnd?.())
    } catch (err) {
      console.error('[detector] onGameRawEnd error:', err)
    }

    this.fetchAndSaveLatestMatch(gameStartedAt).catch((err) => {
      console.error('[detector] Failed to fetch match after game end:', err)
    })
  }

  private async fetchAndSaveLatestMatch(gameStartedAt: number) {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return

    // Build the list of all puuid/region pairs to check (main account + linked accounts).
    const linkedAccounts = await prisma.account.findMany({ where: { userId: user.id } })
    const allAccounts = [
      { puuid: user.puuid, region: user.region },
      ...linkedAccounts.map((a) => ({ puuid: a.puuid, region: a.region })),
    ]

    // Riot API can take 15-90s to register a match after it ends.
    // Retry with exponential backoff, checking all linked accounts on each attempt.
    const DELAYS_MS = [15_000, 20_000, 30_000, 45_000, 60_000]
    let latestMatchId: string | null = null
    let matchRegion: string = user.region
    let stats: ReturnType<typeof extractPlayerStats> = null

    for (let attempt = 0; attempt < DELAYS_MS.length; attempt++) {
      await new Promise((r) => setTimeout(r, DELAYS_MS[attempt]))

      // Check all accounts in parallel; take the first valid candidate.
      const results = await Promise.allSettled(
        allAccounts.map(async (acc) => {
          const ids = await getMatchIds(acc.puuid, acc.region, 1).catch(() => [] as string[])
          if (ids.length === 0) return null

          const matchData = await getMatch(ids[0], acc.region).catch(() => null)
          if (!matchData) return null

          const s = extractPlayerStats(matchData, acc.puuid)
          if (!s) return null

          const matchEndMs = s.gameEndAt ? new Date(s.gameEndAt).getTime() : 0
          if (matchEndMs > 0 && matchEndMs < gameStartedAt) return null

          return { matchId: ids[0], region: acc.region, stats: s }
        }),
      )

      const valid = results
        .filter((r) => r.status === 'fulfilled' && r.value !== null)
        .map((r) => (r as PromiseFulfilledResult<{ matchId: string; region: string; stats: ReturnType<typeof extractPlayerStats> } | null>).value!)
        .filter((v): v is { matchId: string; region: string; stats: NonNullable<ReturnType<typeof extractPlayerStats>> } =>
          v !== null && v.stats !== null,
        )

      if (valid.length === 0) {
        console.log(`[detector] Attempt ${attempt + 1}/${DELAYS_MS.length}: no valid match found on any account, retrying…`)
        continue
      }

      // Pick the most recently ended match across all accounts.
      valid.sort((a, b) => {
        const ta = a.stats?.gameEndAt ? new Date(a.stats.gameEndAt).getTime() : 0
        const tb = b.stats?.gameEndAt ? new Date(b.stats.gameEndAt).getTime() : 0
        return tb - ta
      })

      const best = valid[0]
      latestMatchId = best.matchId
      matchRegion = best.region
      stats = best.stats
      console.log(`[detector] Match found on attempt ${attempt + 1}: ${latestMatchId} (region: ${matchRegion})`)
      break
    }

    if (!latestMatchId || !stats) {
      console.log('[detector] No valid match found after all retries — clearing pending recording')
      this.onGameEnd({ game: null, stats: null, sessionId: null, isOffRole: false, isSessionEligible: false })
      return
    }

    const queueType = stats.queueType ?? 'unknown'
    const sessionEligible = isQueueSessionEligible(queueType)
    console.log(`[detector] Queue type: ${queueType}, session eligible: ${sessionEligible}`)

    // If the game was already imported from history (e.g. retroactive session),
    // still link the pending recording to it instead of discarding it.
    const existing = await prisma.game.findUnique({ where: { matchId: latestMatchId } })
    if (existing) {
      console.log('[detector] Latest match already imported — linking recording to existing game', existing.id)
      this.onGameEnd({ game: existing, stats, sessionId: existing.sessionId, isOffRole: false, isSessionEligible: sessionEligible })
      return
    }

    const activeSession = await prisma.session.findFirst({
      where: { userId: user.id, status: 'active' },
    })

    if (activeSession && sessionEligible) {
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
          queueType,
          isSessionEligible: true,
        },
      })

      // Compare the played role to the user's configured main role.
      // Only flag as off-role when mainRole is set and the roles differ.
      const isOffRole =
        !!user.mainRole &&
        !!stats.role &&
        stats.role !== 'UNKNOWN' &&
        user.mainRole.toUpperCase() !== stats.role.toUpperCase()

      if (isOffRole) {
        console.log(`[detector] Off-role detected: played ${stats.role}, main role is ${user.mainRole}`)
      }

      this.onGameEnd({ game, stats, sessionId: activeSession.id, isOffRole, isSessionEligible: true })
    } else {
      // Either no active session or non-eligible queue (ARAM, Arena, custom…).
      // Still fire onGameEnd so the recording can be linked, but skip review auto-open.
      if (!sessionEligible) {
        console.log(`[detector] Non-eligible queue (${queueType}) — recording will be saved but review skipped`)
      } else {
        console.log('[detector] No active session — firing onGameEnd without game row (recording link only)')
      }
      this.onGameEnd({ game: null, stats, sessionId: null, isOffRole: false, isSessionEligible: sessionEligible })
    }
  }
}
