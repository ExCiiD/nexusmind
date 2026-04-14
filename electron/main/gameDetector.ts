import https from 'https'
import { getMatch, getMatchIds, extractPlayerStats, isQueueSessionEligible } from './riotClient'
import { getPrisma } from './database'
import { agentLog } from './debugAgentLog'

const LIVE_CLIENT_HOST = '127.0.0.1'
const LIVE_CLIENT_PORT = 2999
const POLL_INTERVAL_MS = 5_000

// ── Live Client API helpers ───────────────────────────────────────────────────

interface LiveClientResponse<T = unknown> {
  ok: boolean
  data?: T
}

function liveClientGet<T = unknown>(path: string): Promise<LiveClientResponse<T>> {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: LIVE_CLIENT_HOST,
        port: LIVE_CLIENT_PORT,
        path,
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
            resolve({ ok: true, data: JSON.parse(raw) as T })
          } catch {
            resolve({ ok: true })
          }
        })
      },
    )
    req.on('error', () => resolve({ ok: false }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }) })
  })
}

// ── Types for Live Client API data ────────────────────────────────────────────

interface LiveGameStats {
  gameTime: number
  gameMode?: string
  mapName?: string
}

interface LivePlayer {
  summonerName?: string
  riotId?: string
  championName?: string
  team?: string
  position?: string
  scores?: {
    kills?: number
    deaths?: number
    assists?: number
    creepScore?: number
    wardScore?: number
  }
  level?: number
}

interface LiveActivePlayer {
  summonerName?: string
  riotId?: string
  level?: number
}

interface LiveAllGameData {
  gameData?: LiveGameStats
  activePlayer?: LiveActivePlayer
  allPlayers?: LivePlayer[]
}

/** Snapshot of the active player's in-game state, collected via Live Client API. */
export interface LiveSnapshot {
  champion: string
  role: string
  kills: number
  deaths: number
  assists: number
  cs: number
  visionScore: number
  win: boolean
  duration: number
  gameMode: string
  level: number
}

// ── Game Detector ─────────────────────────────────────────────────────────────

export class GameDetector {
  private polling = false
  private intervalId: ReturnType<typeof setInterval> | null = null
  private wasInGame = false
  private currentGameTime = 0
  private gameStartedAt: number | null = null

  /**
   * Latest snapshot from the Live Client API.
   * Updated every poll cycle while in game so it's ready the instant the game ends.
   */
  private liveSnapshot: LiveSnapshot | null = null

  constructor(
    private onGameEnd: (matchData: any) => void,
    private onGameStart?: () => void,
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
      const res = await liveClientGet<LiveGameStats>('/liveclientdata/gamestats')
      if (res.ok) {
        if (!this.wasInGame) {
          this.wasInGame = true
          this.gameStartedAt = Date.now()
          this.liveSnapshot = null
          console.log(`[detector] Game start detected (gameTime: ${res.data?.gameTime ?? 0}s)`)
          try { this.onGameStart?.() } catch (err) {
            console.error('[detector] onGameStart error:', err)
          }
        }
        this.currentGameTime = res.data?.gameTime ?? 0

        this.collectLiveSnapshot().catch(() => {})
      } else {
        void this.handleGameNotActive()
      }
    } catch (err: unknown) {
      console.error('[detector] Unexpected poll error:', (err as Error)?.message ?? err)
      void this.handleGameNotActive()
    }
  }

  /**
   * Fetches `/liveclientdata/allgamedata` and updates the snapshot.
   * Runs in the background during each poll — never blocks the poll loop.
   */
  private async collectLiveSnapshot() {
    try {
      const res = await liveClientGet<LiveAllGameData>('/liveclientdata/allgamedata')
      if (!res.ok || !res.data) return

      const { gameData, activePlayer, allPlayers } = res.data
      if (!activePlayer || !allPlayers) return

      const activeName = activePlayer.riotId ?? activePlayer.summonerName ?? ''
      const me = allPlayers.find(
        (p) =>
          (p.riotId && p.riotId === activeName) ||
          (p.summonerName && p.summonerName === activeName),
      )
      if (!me) return

      this.liveSnapshot = {
        champion: me.championName ?? 'Unknown',
        role: normalizePosition(me.position),
        kills: me.scores?.kills ?? 0,
        deaths: me.scores?.deaths ?? 0,
        assists: me.scores?.assists ?? 0,
        cs: me.scores?.creepScore ?? 0,
        visionScore: Math.round(me.scores?.wardScore ?? 0),
        win: false,
        duration: Math.round(gameData?.gameTime ?? this.currentGameTime),
        gameMode: gameData?.gameMode ?? 'CLASSIC',
        level: me.level ?? activePlayer.level ?? 1,
      }
    } catch {
      /* non-fatal */
    }
  }

  private async handleGameNotActive() {
    if (!this.wasInGame) return

    this.wasInGame = false
    this.currentGameTime = 0
    const gameStartedAt = this.gameStartedAt ?? Date.now()
    const snapshot = this.liveSnapshot
    this.gameStartedAt = null
    this.liveSnapshot = null

    try {
      await Promise.resolve(this.onGameRawEnd?.())
    } catch (err) {
      console.error('[detector] onGameRawEnd error:', err)
    }

    // ── Phase 1: Instant navigation with Live Client snapshot ──────────
    if (snapshot) {
      console.log(
        `[detector] Instant game end — ${snapshot.champion} ${snapshot.kills}/${snapshot.deaths}/${snapshot.assists} (${snapshot.duration}s)`,
      )
      await this.fireInstantGameEnd(snapshot, gameStartedAt)
    }

    // ── Phase 2: Background enrich with Riot Match API ─────────────────
    this.enrichWithMatchApi(gameStartedAt, snapshot).catch((err) => {
      console.error('[detector] Background enrich failed:', err)
    })
  }

  /**
   * Fires `onGameEnd` immediately using data we already have from the Live Client API.
   * Creates a provisional Game row so the user sees the review page instantly.
   *
   * The Live Client API does NOT expose the queue ID, so we cannot know if the game
   * was ranked/flex/normal at this stage. If there's an active session and the game is
   * on Summoner's Rift (CLASSIC), we optimistically create the game row. The background
   * enrich will update the real queue type and correct eligibility if needed.
   */
  private async fireInstantGameEnd(snapshot: LiveSnapshot, gameStartedAt: number) {
    try {
      const prisma = getPrisma()
      const user = await prisma.user.findFirst({ where: { isActive: true } })
      if (!user) {
        this.onGameEnd({ game: null, stats: null, sessionId: null, isOffRole: false, isSessionEligible: false })
        return
      }

      const isSummonersRift = snapshot.gameMode === 'CLASSIC'
      const isAram = snapshot.gameMode === 'ARAM'

      const activeSession = await prisma.session.findFirst({
        where: { userId: user.id, status: 'active' },
      })

      if (activeSession && isSummonersRift) {
        const game = await prisma.game.create({
          data: {
            sessionId: activeSession.id,
            matchId: `live_${gameStartedAt}`,
            champion: snapshot.champion,
            role: snapshot.role,
            kills: snapshot.kills,
            deaths: snapshot.deaths,
            assists: snapshot.assists,
            cs: snapshot.cs,
            visionScore: snapshot.visionScore,
            duration: snapshot.duration,
            win: false,
            gameEndAt: new Date(),
            queueType: 'pending',
            isSessionEligible: true,
          },
        })

        const isOffRole =
          !!user.mainRole &&
          !!snapshot.role &&
          snapshot.role !== 'UNKNOWN' &&
          user.mainRole.toUpperCase() !== snapshot.role.toUpperCase()

        agentLog(
          'gameDetector.ts:fireInstantGameEnd',
          'instant-game-created',
          { gameId: game.id, sessionId: activeSession.id, champion: snapshot.champion },
          'INSTANT',
        )

        console.log(`[detector] Provisional game created (id=${game.id}) — review page should open now`)

        this.onGameEnd({
          game,
          stats: { ...snapshot, gameEndAt: new Date().toISOString(), matchId: game.matchId, queueType: 'pending' },
          sessionId: activeSession.id,
          isOffRole,
          isSessionEligible: true,
        })
      } else {
        const reason = !activeSession ? 'no active session' : isAram ? 'ARAM' : `gameMode=${snapshot.gameMode}`
        console.log(`[detector] No provisional game — ${reason}`)

        this.onGameEnd({
          game: null,
          stats: { ...snapshot, gameEndAt: new Date().toISOString(), queueType: 'unknown' },
          sessionId: null,
          isOffRole: false,
          isSessionEligible: isSummonersRift,
        })
      }
    } catch (err) {
      console.error('[detector] fireInstantGameEnd error:', err)
      this.onGameEnd({ game: null, stats: null, sessionId: null, isOffRole: false, isSessionEligible: false })
    }
  }

  /**
   * Runs in background after instant navigation. Fetches the real Riot Match API data,
   * updates the Game row with accurate stats (win/loss, exact CS, matchId, opponent, etc.).
   */
  private async enrichWithMatchApi(gameStartedAt: number, snapshot: LiveSnapshot | null) {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return

    const linkedAccounts = await prisma.account.findMany({ where: { userId: user.id } })
    const allAccounts = [
      { puuid: user.puuid, region: user.region },
      ...linkedAccounts.map((a) => ({ puuid: a.puuid, region: a.region })),
    ]

    const DELAYS_MS = [10_000, 15_000, 20_000, 30_000, 45_000]
    let latestMatchId: string | null = null
    let matchRegion: string = user.region
    let stats: ReturnType<typeof extractPlayerStats> = null

    for (let attempt = 0; attempt < DELAYS_MS.length; attempt++) {
      await new Promise((r) => setTimeout(r, DELAYS_MS[attempt]))

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
        .map((r) => (r as PromiseFulfilledResult<any>).value!)
        .filter((v): v is { matchId: string; region: string; stats: NonNullable<ReturnType<typeof extractPlayerStats>> } =>
          v !== null && v.stats !== null,
        )

      if (valid.length === 0) {
        console.log(`[detector] Enrich attempt ${attempt + 1}/${DELAYS_MS.length}: no match yet…`)
        continue
      }

      valid.sort((a, b) => {
        const ta = a.stats?.gameEndAt ? new Date(a.stats.gameEndAt).getTime() : 0
        const tb = b.stats?.gameEndAt ? new Date(b.stats.gameEndAt).getTime() : 0
        return tb - ta
      })

      const best = valid[0]
      latestMatchId = best.matchId
      matchRegion = best.region
      stats = best.stats
      console.log(`[detector] Enrich: match found on attempt ${attempt + 1}: ${latestMatchId}`)
      break
    }

    if (!latestMatchId || !stats) {
      console.log('[detector] Enrich: no match found after all retries')
      agentLog('gameDetector.ts:enrichWithMatchApi', 'no-match', { reason: 'timeout' }, 'ENRICH')
      return
    }

    const queueType = stats.queueType ?? 'unknown'
    const sessionEligible = isQueueSessionEligible(queueType)

    const provisionalMatchId = `live_${gameStartedAt}`
    try {
      const provisionalGame = await prisma.game.findFirst({ where: { matchId: provisionalMatchId } })
      if (provisionalGame) {
        await prisma.game.update({
          where: { id: provisionalGame.id },
          data: {
            matchId: latestMatchId,
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
            isSessionEligible: sessionEligible,
            opponentChampion: stats.opponentChampion ?? null,
          },
        })
        console.log(
          `[detector] Enrich: updated game ${provisionalGame.id} — ` +
            `${latestMatchId} ${stats.win ? 'WIN' : 'LOSS'} (queue=${queueType}, eligible=${sessionEligible})`,
        )

        if (!sessionEligible) {
          console.log(`[detector] Enrich: game was NOT ranked — removing from session`)
          await prisma.game.update({
            where: { id: provisionalGame.id },
            data: { isSessionEligible: false },
          })
        }

        agentLog(
          'gameDetector.ts:enrichWithMatchApi',
          'game-updated',
          { gameId: provisionalGame.id, matchId: latestMatchId, win: stats.win, queueType, sessionEligible },
          'ENRICH',
        )
      } else {
        const existing = await prisma.game.findUnique({ where: { matchId: latestMatchId } })
        if (!existing) {
          const activeSession = await prisma.session.findFirst({
            where: { userId: user.id, status: 'active' },
          })

          if (activeSession && sessionEligible) {
            const newGame = await prisma.game.create({
              data: {
                sessionId: activeSession.id,
                matchId: latestMatchId,
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
                opponentChampion: stats.opponentChampion ?? null,
              },
            })
            console.log(
              `[detector] Enrich: created game ${newGame.id} from Match API ` +
                `(${latestMatchId}, ${stats.win ? 'WIN' : 'LOSS'}, queue=${queueType})`,
            )

            const pendingRec = await prisma.recording.findFirst({
              where: { gameId: null, source: 'capture' },
              orderBy: { createdAt: 'desc' },
            })
            if (pendingRec) {
              await prisma.recording.update({
                where: { id: pendingRec.id },
                data: { gameId: newGame.id },
              })
              console.log(`[detector] Enrich: linked orphan recording ${pendingRec.id} to game ${newGame.id}`)
            }

            agentLog(
              'gameDetector.ts:enrichWithMatchApi',
              'game-created-fallback',
              { gameId: newGame.id, matchId: latestMatchId, linkedRecording: pendingRec?.id ?? null },
              'ENRICH',
            )
          } else {
            const reason = !activeSession ? 'no active session' : 'not session-eligible'
            console.log(`[detector] Enrich: no provisional game — ${reason}, skipping game creation`)
          }
        } else {
          console.log(`[detector] Enrich: match already exists as game ${existing.id}`)
        }
      }
    } catch (err) {
      console.error('[detector] Enrich: failed to update game:', err)
    }

    // Cache the match data for stats pages
    try {
      const matchData = await getMatch(latestMatchId, matchRegion).catch(() => null)
      if (matchData) {
        await prisma.matchCache.upsert({
          where: { matchId: latestMatchId },
          create: { matchId: latestMatchId, matchJson: JSON.stringify(matchData) },
          update: { matchJson: JSON.stringify(matchData) },
        }).catch(() => {})
      }
    } catch { /* non-fatal */ }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePosition(position?: string): string {
  if (!position) return 'UNKNOWN'
  const upper = position.toUpperCase()
  const MAP: Record<string, string> = {
    TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MIDDLE', MID: 'MIDDLE',
    BOTTOM: 'BOTTOM', ADC: 'BOTTOM', SUPPORT: 'UTILITY', UTILITY: 'UTILITY',
  }
  return MAP[upper] ?? upper
}

