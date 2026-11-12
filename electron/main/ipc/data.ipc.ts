/**
 * Data maintenance IPC — destructive bulk cleanups exposed in Settings.
 *
 * Channels:
 *   data:clear-stats-mistakes → removes derived analytics (mistakes, stats
 *                               snapshots, detailed-stats cache, lane-phase
 *                               reports). Keeps games/recordings/reviews.
 *   data:reset-all            → wipes the active user's whole performance
 *                               dataset (sessions, games, stats, mistakes,
 *                               reviews, recordings + their files) and resets
 *                               XP/streak. Keeps account, settings, teams and
 *                               built-in mistake tags.
 *   data:clear-recent         → same wipe as reset-all but scoped to the last
 *                               N days (by game end / recording date). Handy
 *                               to drop a bad test session without nuking
 *                               historical data.
 */

import { ipcMain } from 'electron'
import { existsSync, unlinkSync } from 'fs'
import { getPrisma } from '../database'

function tryUnlink(p: string | null | undefined): boolean {
  if (p && existsSync(p)) {
    try { unlinkSync(p); return true } catch { /* ignore — best effort */ }
  }
  return false
}

export function registerDataHandlers() {
  // ── Clear stats + mistakes (non-destructive to games/recordings) ──────────
  ipcMain.handle('data:clear-stats-mistakes', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return { snapshots: 0, detailedStats: 0, lanePhase: 0, mistakes: 0 }

    const games = await prisma.game.findMany({
      where: { session: { userId: user.id } },
      select: { id: true },
    })
    const gameIds = games.map((g) => g.id)

    const mistakes = await prisma.mistake.deleteMany({ where: { gameId: { in: gameIds } } })
    const detailedStats = await prisma.gameDetailedStats.deleteMany({ where: { gameId: { in: gameIds } } })
    const snapshots = await prisma.statsSnapshot.deleteMany({ where: { userId: user.id } })
    const lanePhase = await prisma.game.updateMany({
      where: { id: { in: gameIds }, lanePhaseReport: { not: null } },
      data: { lanePhaseReport: null },
    })

    console.log(`[data] Cleared stats+mistakes — mistakes=${mistakes.count} detailedStats=${detailedStats.count} snapshots=${snapshots.count} lanePhase=${lanePhase.count}`)
    return {
      snapshots: snapshots.count,
      detailedStats: detailedStats.count,
      lanePhase: lanePhase.count,
      mistakes: mistakes.count,
    }
  })

  // ── Clear only the last N days of data ────────────────────────────────────
  ipcMain.handle('data:clear-recent', async (_e, days: number) => {
    const prisma = getPrisma()
    const empty = { games: 0, recordings: 0, files: 0, snapshots: 0, sessions: 0, mistakes: 0 }
    const n = Number(days)
    if (!Number.isFinite(n) || n <= 0) return empty
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) return empty

    const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000)

    // Games played in the window (by in-game end time).
    const games = await prisma.game.findMany({
      where: { session: { userId: user.id }, gameEndAt: { gte: cutoff } },
      select: { id: true },
    })
    const gameIds = games.map((g) => g.id)

    // Count mistakes up front (they vanish via cascade once games are gone).
    const mistakeCount = gameIds.length
      ? await prisma.mistake.count({ where: { gameId: { in: gameIds } } })
      : 0

    // Recordings to free from disk: those linked to the window's games, plus
    // orphan recordings created within the window.
    const recordings = await prisma.recording.findMany({
      where: {
        OR: [
          ...(gameIds.length ? [{ gameId: { in: gameIds } }] : []),
          { gameId: null, createdAt: { gte: cutoff } },
        ],
      },
      select: { id: true, filePath: true, thumbnailPath: true },
    })
    const recIds = recordings.map((r) => r.id)
    const clips = recIds.length
      ? await prisma.clip.findMany({ where: { recordingId: { in: recIds } }, select: { filePath: true, thumbnailPath: true } })
      : []

    let filesDeleted = 0
    for (const r of recordings) {
      if (tryUnlink(r.filePath)) filesDeleted++
      if (tryUnlink(r.thumbnailPath)) filesDeleted++
    }
    for (const c of clips) {
      if (tryUnlink(c.filePath)) filesDeleted++
      if (tryUnlink(c.thumbnailPath)) filesDeleted++
    }

    // Delete games (cascade → detailedStats, review, recording → clips,
    // bookmarks, mistakes) and any orphan recordings in the window.
    if (gameIds.length) await prisma.game.deleteMany({ where: { id: { in: gameIds } } })
    if (recIds.length) await prisma.recording.deleteMany({ where: { id: { in: recIds } } })
    const snapshots = await prisma.statsSnapshot.deleteMany({ where: { userId: user.id, createdAt: { gte: cutoff } } })
    // Drop sessions from the window that are now empty (don't touch older ones).
    const sessions = await prisma.session.deleteMany({
      where: { userId: user.id, date: { gte: cutoff }, games: { none: {} } },
    })

    console.log(`[data] Cleared last ${n}d — games=${gameIds.length} recordings=${recordings.length} files=${filesDeleted} snapshots=${snapshots.count} sessions=${sessions.count} mistakes=${mistakeCount}`)
    return {
      games: gameIds.length,
      recordings: recordings.length,
      files: filesDeleted,
      snapshots: snapshots.count,
      sessions: sessions.count,
      mistakes: mistakeCount,
    }
  })

  // ── Full reset — wipe the performance dataset + free disk space ───────────
  ipcMain.handle('data:reset-all', async () => {
    const prisma = getPrisma()
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) {
      return { sessions: 0, games: 0, recordings: 0, files: 0, snapshots: 0, matchCache: 0, externalReviews: 0, assessments: 0 }
    }

    // Gather every recording + clip file path BEFORE the cascade removes the
    // rows, so we can free the disk. We wipe ALL recordings (including orphans
    // not linked to a game) — a reset should leave nothing behind.
    const recordings = await prisma.recording.findMany({
      select: { id: true, filePath: true, thumbnailPath: true },
    })
    const recIds = recordings.map((r) => r.id)
    const clips = recIds.length
      ? await prisma.clip.findMany({ where: { recordingId: { in: recIds } }, select: { filePath: true, thumbnailPath: true } })
      : []

    let filesDeleted = 0
    for (const r of recordings) {
      if (tryUnlink(r.filePath)) filesDeleted++
      if (tryUnlink(r.thumbnailPath)) filesDeleted++
    }
    for (const c of clips) {
      if (tryUnlink(c.filePath)) filesDeleted++
      if (tryUnlink(c.thumbnailPath)) filesDeleted++
    }

    const gameCount = await prisma.game.count({ where: { session: { userId: user.id } } })

    // Deleting sessions cascades: Session → Game → (GameDetailedStats, Review,
    // Recording → (Clip, Bookmark, Mistake)). Orphan recordings (gameId null)
    // are cleaned up by the explicit deleteMany below.
    const sessions = await prisma.session.deleteMany({ where: { userId: user.id } })
    await prisma.recording.deleteMany({})
    const snapshots = await prisma.statsSnapshot.deleteMany({ where: { userId: user.id } })
    const externalReviews = await prisma.externalReview.deleteMany({ where: { userId: user.id } })
    const assessments = await prisma.assessment.deleteMany({ where: { userId: user.id } })
    const matchCache = await prisma.matchCache.deleteMany({})

    // Fresh-start the progression counters surfaced on the dashboard.
    await prisma.user.update({
      where: { id: user.id },
      data: { xp: 0, streakDays: 0, lastActiveDate: null },
    })

    console.log(`[data] Full reset — sessions=${sessions.count} games=${gameCount} recordings=${recordings.length} files=${filesDeleted} snapshots=${snapshots.count} matchCache=${matchCache.count}`)
    return {
      sessions: sessions.count,
      games: gameCount,
      recordings: recordings.length,
      files: filesDeleted,
      snapshots: snapshots.count,
      matchCache: matchCache.count,
      externalReviews: externalReviews.count,
      assessments: assessments.count,
    }
  })
}
