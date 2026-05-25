import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { getPrisma } from '../database'
import { gzipSync, gunzipSync } from 'zlib'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { hostname } from 'os'

/**
 * NexusMind Backup format (v1)
 * ────────────────────────────
 * `.nexusmind` files are a single gzipped JSON payload (no zip/tar dependency).
 * Storing JSON instead of the raw `dev.db` keeps imports portable across
 * SQLite versions and lets us merge cleanly into existing data on the target
 * PC instead of replacing it.
 *
 * IMPORTANT: video files (.mp4 etc.) are NEVER bundled — they're typically
 * 100s of MB and live per-PC. Recordings are imported as metadata only with
 * `filePath` set to NULL, and the user can re-link a local file later.
 */

const BACKUP_VERSION = 1

interface BackupManifest {
  version: number
  exportedAt: string
  deviceId: string
  displayName: string
}

interface BackupPayload {
  manifest: BackupManifest
  tables: {
    User: any[]
    Account: any[]
    Session: any[]
    Game: any[]
    Review: any[]
    Assessment: any[]
    AssessmentScore: any[]
    StatsSnapshot: any[]
    Badge: any[]
    GameDetailedStats: any[]
    MatchCache: any[]
    ExternalReview: any[]
    Recording: any[]
    // Team mgmt — added in v2 implicitly (forward-compatible: missing keys = [])
    Team?: any[]
    TeamMember?: any[]
    ChampionPoolEntry?: any[]
    DraftPrep?: any[]
  }
}

interface ImportSummary {
  sessionsAdded: number
  gamesAdded: number
  reviewsAdded: number
  assessmentsAdded: number
  snapshotsAdded: number
  recordingsAdded: number
  externalReviewsAdded: number
  conflicts: number
  skipped: number
}

export function registerBackupHandlers() {
  // ── Export ─────────────────────────────────────────────────────────────────

  ipcMain.handle('backup:export', async () => {
    const prisma = getPrisma()

    const user = await prisma.user.findFirst({ where: { isActive: true } })
    if (!user) throw new Error('No active user — cannot export.')

    const parentWindow = BrowserWindow.getFocusedWindow() ?? undefined
    const defaultName = `nexusmind-backup-${new Date().toISOString().slice(0, 10)}.nexusmind`
    const dialogOptions: Electron.SaveDialogOptions = {
      title: 'Export NexusMind data',
      defaultPath: defaultName,
      filters: [{ name: 'NexusMind backup', extensions: ['nexusmind'] }],
    }
    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) return { canceled: true as const }

    // Pull every table this app actually owns. Tables are dumped raw — we trust
    // SQLite's serialization since both endpoints run the same Prisma schema.
    const [
      users, accounts, sessions, games, reviews, assessments,
      assessmentScores, statsSnapshots, badges, gameDetailedStats,
      matchCaches, externalReviews, recordings,
      teams, teamMembers, championPoolEntries, draftPreps,
    ] = await Promise.all([
      prisma.user.findMany(),
      prisma.account.findMany(),
      prisma.session.findMany(),
      prisma.game.findMany(),
      prisma.review.findMany(),
      prisma.assessment.findMany(),
      prisma.assessmentScore.findMany(),
      prisma.statsSnapshot.findMany(),
      prisma.badge.findMany(),
      prisma.gameDetailedStats.findMany(),
      prisma.matchCache.findMany(),
      prisma.externalReview.findMany(),
      prisma.recording.findMany(),
      prisma.team.findMany(),
      prisma.teamMember.findMany(),
      prisma.championPoolEntry.findMany(),
      prisma.draftPrep.findMany(),
    ])

    const payload: BackupPayload = {
      manifest: {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        deviceId: `${hostname()}-${app.getVersion()}`,
        displayName: user.displayName || user.summonerName,
      },
      tables: {
        User: users,
        Account: accounts,
        Session: sessions,
        Game: games,
        Review: reviews,
        Assessment: assessments,
        AssessmentScore: assessmentScores,
        StatsSnapshot: statsSnapshots,
        Badge: badges,
        GameDetailedStats: gameDetailedStats,
        MatchCache: matchCaches,
        ExternalReview: externalReviews,
        // Recording metadata is exported but `filePath`/`thumbnailPath` is
        // stripped on IMPORT (not here) so other PCs don't try to load
        // non-existent local files.
        Recording: recordings,
        Team: teams,
        TeamMember: teamMembers,
        ChampionPoolEntry: championPoolEntries,
        DraftPrep: draftPreps,
      },
    }

    const json = JSON.stringify(payload)
    const gz = gzipSync(Buffer.from(json, 'utf-8'), { level: 9 })
    writeFileSync(result.filePath, gz)

    const counts = {
      sessions: sessions.length,
      games: games.length,
      reviews: reviews.length,
      assessments: assessments.length,
      snapshots: statsSnapshots.length,
      recordings: recordings.length,
      externalReviews: externalReviews.length,
    }
    console.log('[backup:export] Wrote', result.filePath, counts, 'bytes:', gz.length)
    return { canceled: false as const, filePath: result.filePath, counts }
  })

  // ── Import ─────────────────────────────────────────────────────────────────

  ipcMain.handle('backup:import', async () => {
    const parentWindow = BrowserWindow.getFocusedWindow() ?? undefined
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Import NexusMind data',
      filters: [{ name: 'NexusMind backup', extensions: ['nexusmind'] }],
      properties: ['openFile'],
    }
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || !result.filePaths[0]) return { canceled: true as const }

    const path = result.filePaths[0]
    if (!existsSync(path)) throw new Error(`File not found: ${path}`)

    let payload: BackupPayload
    try {
      const gz = readFileSync(path)
      const json = gunzipSync(gz).toString('utf-8')
      payload = JSON.parse(json)
    } catch (err) {
      throw new Error(`Invalid or corrupted .nexusmind file: ${(err as Error).message}`)
    }

    if (!payload?.manifest || payload.manifest.version > BACKUP_VERSION) {
      throw new Error(
        `Unsupported backup version (${payload?.manifest?.version}). Update NexusMind on this PC.`,
      )
    }

    const prisma = getPrisma()
    const localUser = await prisma.user.findFirst({ where: { isActive: true } })
    if (!localUser) throw new Error('No active user on this PC — log in first, then import.')

    const summary: ImportSummary = {
      sessionsAdded: 0, gamesAdded: 0, reviewsAdded: 0,
      assessmentsAdded: 0, snapshotsAdded: 0, recordingsAdded: 0,
      externalReviewsAdded: 0, conflicts: 0, skipped: 0,
    }

    // ── User identity remap ──────────────────────────────────────────────────
    //
    // The export contains the source user's row (with their own `id`). We don't
    // overwrite the local user — we just remap any reference to it onto the
    // local user's id, identifying the source by PUUID match. If the imported
    // backup belongs to a DIFFERENT player (different PUUID), we abort: merging
    // two different accounts' data into one local user would silently corrupt
    // analytics.
    const sourceUser = payload.tables.User?.find((u) => u.puuid === localUser.puuid)
    if (!sourceUser) {
      throw new Error(
        `Backup belongs to a different player (puuid mismatch). Cannot merge.`,
      )
    }
    const userIdMap = new Map<string, string>([[sourceUser.id, localUser.id]])

    // ── Accounts (linked smurfs) ─────────────────────────────────────────────
    for (const acc of payload.tables.Account ?? []) {
      const existing = await prisma.account.findUnique({ where: { puuid: acc.puuid } })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.account.create({
          data: {
            id: acc.id,
            userId: localUser.id,
            puuid: acc.puuid,
            gameName: acc.gameName,
            tagLine: acc.tagLine,
            region: acc.region,
            profileIconId: acc.profileIconId ?? 0,
            createdAt: new Date(acc.createdAt),
          },
        })
      } catch { summary.conflicts++ }
    }

    // ── Sessions (id-keyed; userId remapped) ─────────────────────────────────
    for (const sess of payload.tables.Session ?? []) {
      const remappedUserId = userIdMap.get(sess.userId) ?? localUser.id
      const existing = await prisma.session.findUnique({ where: { id: sess.id } })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.session.create({
          data: {
            id: sess.id,
            userId: remappedUserId,
            date: new Date(sess.date),
            objectiveId: sess.objectiveId,
            objectiveIds: sess.objectiveIds ?? '[]',
            selectedKpiIds: sess.selectedKpiIds ?? '[]',
            subObjective: sess.subObjective,
            customNote: sess.customNote,
            status: sess.status ?? 'active',
            aiSummary: sess.aiSummary,
            sessionConclusion: sess.sessionConclusion,
          },
        })
        summary.sessionsAdded++
      } catch { summary.conflicts++ }
    }

    // ── Games (matchId is the natural dedup key) ─────────────────────────────
    for (const g of payload.tables.Game ?? []) {
      const existing = await prisma.game.findUnique({ where: { matchId: g.matchId } })
      if (existing) { summary.skipped++; continue }
      // Only import games whose parent session exists locally (after Session
      // import above). Otherwise we'd violate the FK.
      const parentSession = await prisma.session.findUnique({ where: { id: g.sessionId } })
      if (!parentSession) { summary.conflicts++; continue }
      try {
        await prisma.game.create({
          data: {
            id: g.id,
            sessionId: g.sessionId,
            matchId: g.matchId,
            champion: g.champion,
            opponentChampion: g.opponentChampion,
            reviewStatus: g.reviewStatus ?? 'pending',
            role: g.role,
            kills: g.kills,
            deaths: g.deaths,
            assists: g.assists,
            cs: g.cs,
            visionScore: g.visionScore,
            duration: g.duration,
            win: g.win,
            rank: g.rank,
            lp: g.lp,
            gameEndAt: new Date(g.gameEndAt),
            queueType: g.queueType ?? 'unknown',
            isSessionEligible: g.isSessionEligible ?? true,
          },
        })
        summary.gamesAdded++
      } catch { summary.conflicts++ }
    }

    // ── MatchCache (matchId-keyed, useful for re-extraction without API hits) ─
    for (const mc of payload.tables.MatchCache ?? []) {
      const existing = await prisma.matchCache.findUnique({ where: { matchId: mc.matchId } })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.matchCache.create({
          data: {
            id: mc.id,
            matchId: mc.matchId,
            matchJson: mc.matchJson,
            timelineJson: mc.timelineJson,
            createdAt: new Date(mc.createdAt),
          },
        })
      } catch { summary.conflicts++ }
    }

    // ── GameDetailedStats (gameId unique, requires game to exist) ────────────
    for (const ds of payload.tables.GameDetailedStats ?? []) {
      const game = await prisma.game.findUnique({ where: { id: ds.gameId } })
      if (!game) { summary.skipped++; continue }
      const existing = await prisma.gameDetailedStats.findUnique({ where: { gameId: ds.gameId } })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.gameDetailedStats.create({
          data: {
            id: ds.id,
            gameId: ds.gameId,
            stats: ds.stats,
            createdAt: new Date(ds.createdAt),
          },
        })
      } catch { summary.conflicts++ }
    }

    // ── Reviews (gameId unique) ──────────────────────────────────────────────
    for (const r of payload.tables.Review ?? []) {
      const game = await prisma.game.findUnique({ where: { id: r.gameId } })
      if (!game) { summary.skipped++; continue }
      const existing = await prisma.review.findUnique({ where: { gameId: r.gameId } })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.review.create({
          data: {
            id: r.id,
            gameId: r.gameId,
            timelineNotes: r.timelineNotes,
            kpiScores: r.kpiScores,
            kpiNotes: r.kpiNotes,
            freeText: r.freeText,
            aiSummary: r.aiSummary,
            objectiveRespected: r.objectiveRespected,
            createdAt: new Date(r.createdAt),
          },
        })
        // Mark the game as reviewed since we just imported its review.
        await prisma.game.update({
          where: { id: r.gameId },
          data: { reviewStatus: 'reviewed' },
        })
        summary.reviewsAdded++
      } catch { summary.conflicts++ }
    }

    // ── Assessments + scores ─────────────────────────────────────────────────
    for (const a of payload.tables.Assessment ?? []) {
      const existing = await prisma.assessment.findUnique({ where: { id: a.id } })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.assessment.create({
          data: { id: a.id, userId: localUser.id, createdAt: new Date(a.createdAt) },
        })
        summary.assessmentsAdded++
      } catch { summary.conflicts++ }
    }
    for (const s of payload.tables.AssessmentScore ?? []) {
      const parent = await prisma.assessment.findUnique({ where: { id: s.assessmentId } })
      if (!parent) { summary.skipped++; continue }
      try {
        await prisma.assessmentScore.create({
          data: {
            id: s.id,
            assessmentId: s.assessmentId,
            fundamentalId: s.fundamentalId,
            subcategoryId: s.subcategoryId,
            score: s.score,
          },
        })
      } catch { summary.skipped++ }
    }

    // ── Stats snapshots ──────────────────────────────────────────────────────
    for (const s of payload.tables.StatsSnapshot ?? []) {
      const existing = await prisma.statsSnapshot.findUnique({ where: { id: s.id } })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.statsSnapshot.create({
          data: {
            id: s.id,
            userId: localUser.id,
            mainRole: s.mainRole,
            stats: s.stats,
            gameCount: s.gameCount,
            firstGameAt: new Date(s.firstGameAt),
            lastGameAt: new Date(s.lastGameAt),
            createdAt: new Date(s.createdAt),
          },
        })
        summary.snapshotsAdded++
      } catch { summary.conflicts++ }
    }

    // ── Badges (composite unique on userId+badgeId) ──────────────────────────
    for (const b of payload.tables.Badge ?? []) {
      const existing = await prisma.badge.findFirst({
        where: { userId: localUser.id, badgeId: b.badgeId },
      })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.badge.create({
          data: {
            id: b.id,
            userId: localUser.id,
            badgeId: b.badgeId,
            unlockedAt: new Date(b.unlockedAt),
          },
        })
      } catch { summary.skipped++ }
    }

    // ── External reviews ─────────────────────────────────────────────────────
    for (const er of payload.tables.ExternalReview ?? []) {
      const existing = await prisma.externalReview.findUnique({ where: { id: er.id } })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.externalReview.create({
          data: {
            id: er.id,
            userId: localUser.id,
            title: er.title,
            objectiveId: er.objectiveId,
            objectiveIds: er.objectiveIds ?? '[]',
            selectedKpiIds: er.selectedKpiIds ?? '[]',
            kpiScores: er.kpiScores ?? '{}',
            timelineNotes: er.timelineNotes ?? '[]',
            freeText: er.freeText,
            // Local file likely doesn't exist on this PC — null it.
            filePath: null,
            playerName: er.playerName,
            matchData: er.matchData,
            createdAt: new Date(er.createdAt),
            updatedAt: new Date(er.updatedAt ?? er.createdAt),
          },
        })
        summary.externalReviewsAdded++
      } catch { summary.conflicts++ }
    }

    // ── Recordings (metadata only — local file is on the source PC) ──────────
    for (const rec of payload.tables.Recording ?? []) {
      // Skip if the linked game doesn't exist locally (avoid FK violations).
      if (rec.gameId) {
        const game = await prisma.game.findUnique({ where: { id: rec.gameId } })
        if (!game) { summary.skipped++; continue }
        // Skip if the local game already has a recording (don't overwrite).
        const existing = await prisma.recording.findUnique({ where: { gameId: rec.gameId } })
        if (existing) { summary.skipped++; continue }
      }
      try {
        await prisma.recording.create({
          data: {
            id: rec.id,
            gameId: rec.gameId,
            filePath: null,
            youtubeUrl: rec.youtubeUrl,
            source: rec.source ?? 'manual',
            duration: rec.duration,
            thumbnailPath: null,
            createdAt: new Date(rec.createdAt),
          },
        })
        summary.recordingsAdded++
      } catch { summary.conflicts++ }
    }

    // ── Teams ────────────────────────────────────────────────────────────────
    for (const t of payload.tables.Team ?? []) {
      const existing = await prisma.team.findUnique({ where: { id: t.id } })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.team.create({
          data: {
            id: t.id,
            userId: localUser.id,
            name: t.name,
            tag: t.tag,
            logo: t.logo,
            notes: t.notes,
            isOpponent: t.isOpponent ?? false,
            scoutNotes: t.scoutNotes,
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt ?? t.createdAt),
          },
        })
      } catch { summary.conflicts++ }
    }

    // ── TeamMembers (require parent team) ────────────────────────────────────
    for (const m of payload.tables.TeamMember ?? []) {
      const team = await prisma.team.findUnique({ where: { id: m.teamId } })
      if (!team) { summary.skipped++; continue }
      const existing = await prisma.teamMember.findUnique({ where: { id: m.id } })
      if (existing) { summary.skipped++; continue }
      try {
        await prisma.teamMember.create({
          data: {
            id: m.id,
            teamId: m.teamId,
            displayName: m.displayName,
            ign: m.ign,
            tagLine: m.tagLine,
            region: m.region,
            role: m.role,
            puuid: m.puuid,
          },
        })
      } catch { summary.conflicts++ }
    }

    // ── ChampionPoolEntry (require parent member) ────────────────────────────
    for (const e of payload.tables.ChampionPoolEntry ?? []) {
      const member = await prisma.teamMember.findUnique({ where: { id: e.memberId } })
      if (!member) { summary.skipped++; continue }
      try {
        await prisma.championPoolEntry.upsert({
          where: { memberId_championKey_role: { memberId: e.memberId, championKey: e.championKey, role: e.role } },
          create: {
            id: e.id,
            memberId: e.memberId,
            championKey: e.championKey,
            role: e.role,
            tier: e.tier ?? 'comfort',
            notes: e.notes,
            playRate: e.playRate,
            winRate: e.winRate,
          },
          update: {},
        })
      } catch { summary.conflicts++ }
    }

    // ── DraftPrep (vsTeamId optional) ────────────────────────────────────────
    for (const d of payload.tables.DraftPrep ?? []) {
      const existing = await prisma.draftPrep.findUnique({ where: { id: d.id } })
      if (existing) { summary.skipped++; continue }
      // If vsTeamId points to a team that wasn't imported, drop the link.
      let vsTeamId = d.vsTeamId
      if (vsTeamId) {
        const vsTeam = await prisma.team.findUnique({ where: { id: vsTeamId } })
        if (!vsTeam) vsTeamId = null
      }
      try {
        await prisma.draftPrep.create({
          data: {
            id: d.id,
            userId: localUser.id,
            name: d.name,
            vsTeamId,
            bluePicks: d.bluePicks ?? '[]',
            blueBans: d.blueBans ?? '[]',
            redPicks: d.redPicks ?? '[]',
            redBans: d.redBans ?? '[]',
            myTeamSide: d.myTeamSide ?? 'blue',
            notes: d.notes,
            createdAt: new Date(d.createdAt),
            updatedAt: new Date(d.updatedAt ?? d.createdAt),
          },
        })
      } catch { summary.conflicts++ }
    }

    console.log('[backup:import] Done:', summary)
    return { canceled: false as const, summary }
  })
}
