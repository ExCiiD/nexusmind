import { ipcMain, dialog } from 'electron'
import { getPrisma } from '../database'
import { getAccountByRiotId, getMatchIds, getMatch, extractPlayerStats } from '../riotClient'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

/** Fetch the last N ranked games for an external player by Riot ID. */
async function fetchExternalPlayerGames(
  gameName: string,
  tagLine: string,
  region: string,
  count = 10,
): Promise<any[]> {
  const clampedCount = Math.min(count, 100)
  const account = await getAccountByRiotId(gameName, tagLine, region)
  const matchIds = await getMatchIds(account.puuid, region, clampedCount, 0, 'both')

  const results = await Promise.allSettled(
    matchIds.map((id) => getMatch(id, region)),
  )

  return results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map((r) => {
      const matchData = r.value
      const stats = extractPlayerStats(matchData, account.puuid)
      if (!stats) return null
      return {
        matchId: matchData.metadata.matchId,
        champion: stats.champion,
        role: stats.role,
        kills: stats.kills,
        deaths: stats.deaths,
        assists: stats.assists,
        cs: stats.cs,
        visionScore: stats.visionScore,
        duration: stats.duration,
        win: stats.win,
        gameEndAt: new Date(matchData.info.gameEndTimestamp).toISOString(),
        opponentChampion: stats.opponentChampion ?? null,
        puuid: account.puuid,
        playerName: `${account.gameName}#${account.tagLine}`,
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => new Date(b.gameEndAt).getTime() - new Date(a.gameEndAt).getTime())
}

/**
 * All ExternalReview persistence is done via raw SQL because the Prisma client is
 * not regenerated at runtime. The SQLite table is created by the migration runner.
 */
export function registerExternalReviewHandlers() {
  ipcMain.handle(
    'external-review:fetch-player-history',
    async (_event, gameName: string, tagLine: string, region: string, count = 10) => {
      return fetchExternalPlayerGames(gameName, tagLine, region, count)
    },
  )

  ipcMain.handle(
    'external-review:create',
    async (
      _event,
      data: {
        title: string
        objectiveId?: string
        objectiveIds?: string
        selectedKpiIds?: string
        filePath?: string
        playerName?: string
        matchData?: string
      },
    ) => {
      const prisma = getPrisma()
      const user = await prisma.user.findFirst({ where: { isActive: true } })
      if (!user) throw new Error('No user found')

      const id = randomUUID()
      const now = new Date().toISOString()

      await prisma.$executeRawUnsafe(
        `INSERT INTO "ExternalReview" (id, userId, title, objectiveId, objectiveIds, selectedKpiIds, filePath, playerName, matchData, timelineNotes, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
        id,
        user.id,
        data.title,
        data.objectiveId ?? null,
        data.objectiveIds ?? '[]',
        data.selectedKpiIds ?? '[]',
        data.filePath ?? null,
        data.playerName ?? null,
        data.matchData ?? null,
        now,
        now,
      )

      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM "ExternalReview" WHERE id = ?`, id,
      )
      return rows[0] ?? null
    },
  )

  ipcMain.handle('external-review:get', async (_event, id: string) => {
    const prisma = getPrisma()
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "ExternalReview" WHERE id = ?`, id,
    )
    return rows[0] ?? null
  })

  ipcMain.handle(
    'external-review:save',
    async (
      _event,
      id: string,
      data: {
        timelineNotes?: string
        freeText?: string
        filePath?: string
        kpiScores?: string
      },
    ) => {
      const prisma = getPrisma()
      const now = new Date().toISOString()
      const setClauses: string[] = ['updatedAt = ?']
      const values: any[] = [now]

      if (data.timelineNotes !== undefined) { setClauses.push('timelineNotes = ?'); values.push(data.timelineNotes) }
      if (data.freeText !== undefined) { setClauses.push('freeText = ?'); values.push(data.freeText) }
      if (data.filePath !== undefined) { setClauses.push('filePath = ?'); values.push(data.filePath || null) }
      if (data.kpiScores !== undefined) { setClauses.push('kpiScores = ?'); values.push(data.kpiScores) }

      values.push(id)
      await prisma.$executeRawUnsafe(
        `UPDATE "ExternalReview" SET ${setClauses.join(', ')} WHERE id = ?`,
        ...values,
      )

      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM "ExternalReview" WHERE id = ?`, id,
      )
      return rows[0] ?? null
    },
  )

  ipcMain.handle('external-review:list', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return []
    return prisma.$queryRawUnsafe(
      `SELECT * FROM "ExternalReview" WHERE userId = ? ORDER BY createdAt DESC`,
      user.id,
    )
  })

  ipcMain.handle('external-review:pick-file', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })

    const defaultPath = (user as any)?.externalRecordingPath ?? join(homedir(), 'Videos')

    const result = await dialog.showOpenDialog({
      title: 'Select Recording File',
      defaultPath,
      filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'] }],
      properties: ['openFile'],
    })

    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('external-review:delete', async (_event, id: string) => {
    const prisma = getPrisma()
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "filePath" FROM "ExternalReview" WHERE id = ?`, id,
    )
    if (rows[0]?.filePath && existsSync(rows[0].filePath)) {
      try { unlinkSync(rows[0].filePath) } catch { /* ignore */ }
    }
    await prisma.$executeRawUnsafe(`DELETE FROM "ExternalReview" WHERE id = ?`, id)
    return { success: true }
  })
}
