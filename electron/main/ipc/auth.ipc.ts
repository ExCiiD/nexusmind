import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { invalidateMediaAccessCache } from '../mediaAccess'
import { z } from 'zod'
import { validatedHandle, userUpdateSchema } from './validate'
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

  /**
   * Profile page: the activity counters player titles are earned from
   * (src/lib/profile.ts). Counts only — no row data leaves the main process.
   * Recordings/clips/bookmarks carry no userId, so "this user's" means
   * linked to one of their games, plus orphan recordings (no game) which on
   * a single-user desktop install can only be theirs.
   */
  ipcMain.handle('profile:get-stats', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return null
    const ownGame = { session: { userId: user.id } }
    const ownRecording = { OR: [{ game: ownGame }, { gameId: null }] }
    const [games, reviews, sessions, recordings, clips, bookmarks, mistakes, externalReviews, assessments] = await Promise.all([
      prisma.game.count({ where: ownGame }),
      prisma.review.count({ where: { game: ownGame } }),
      prisma.session.count({ where: { userId: user.id } }),
      prisma.recording.count({ where: ownRecording }),
      prisma.clip.count({ where: { recording: ownRecording } }),
      prisma.bookmark.count({ where: { recording: ownRecording } }),
      prisma.mistake.count({ where: { game: ownGame, autoDetected: false } }),
      prisma.externalReview.count({ where: { userId: user.id } }),
      prisma.assessment.count({ where: { userId: user.id } }),
    ])
    return {
      games, reviews, sessions, recordings, clips, bookmarks, mistakes, externalReviews, assessments,
      xp: user.xp,
      streakDays: user.streakDays,
      memberSince: user.createdAt.toISOString(),
    }
  })

  ipcMain.handle('user:get', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return null
    return user
  })

  // Unknown keys are stripped by the schema, so only whitelisted, correctly
  // typed fields can ever reach prisma.user.update.
  validatedHandle('user:update', z.tuple([userUpdateSchema]), async (_event, safeData) => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No user found')

    if (Object.keys(safeData).length === 0) throw new Error('No allowed fields provided')

    const updated = await prisma.user.update({ where: { id: user.id }, data: safeData })
    if ('recordingPath' in safeData || 'externalRecordingPath' in safeData) invalidateMediaAccessCache()
    return updated
  })
}
