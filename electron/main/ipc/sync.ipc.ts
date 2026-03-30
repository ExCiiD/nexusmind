import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { getSupabase } from '../supabaseClient'

// Push all local data to Supabase for the current student user
export async function syncStudentData(): Promise<void> {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst()
  if (!user?.supabaseUid) return

  const role = user.role
  if (role !== 'student' && role !== 'both') return

  const supa = getSupabase()
  const uid = user.supabaseUid

  try {
    // Sync profile
    await supa.from('profiles').upsert({
      id: uid,
      local_puuid: user.puuid,
      display_name: user.displayName || user.summonerName,
      role: user.role,
    })

    // Sync completed sessions with their games and reviews
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, status: 'completed' },
      include: {
        games: {
          include: { review: true, recording: true },
        },
      },
      orderBy: { date: 'desc' },
      take: 50,
    })

    for (const session of sessions) {
      await supa.from('synced_sessions').upsert({
        id: session.id,
        student_id: uid,
        date: session.date.toISOString(),
        objective_id: session.objectiveId,
        objective_ids: session.objectiveIds,
        selected_kpi_ids: session.selectedKpiIds,
        sub_objective: session.subObjective,
        custom_note: session.customNote,
        status: session.status,
        ai_summary: session.aiSummary,
      })

      for (const game of session.games) {
        await supa.from('synced_games').upsert({
          id: game.id,
          session_id: session.id,
          student_id: uid,
          match_id: game.matchId,
          champion: game.champion,
          opponent_champion: game.opponentChampion,
          review_status: game.reviewStatus,
          role: game.role,
          kills: game.kills,
          deaths: game.deaths,
          assists: game.assists,
          cs: game.cs,
          vision_score: game.visionScore,
          duration: game.duration,
          win: game.win,
          rank: game.rank,
          lp: game.lp,
          game_end_at: game.gameEndAt.toISOString(),
          youtube_url: game.recording?.youtubeUrl ?? null,
        })

        if (game.review) {
          await supa.from('synced_reviews').upsert({
            id: game.review.id,
            game_id: game.id,
            student_id: uid,
            timeline_notes: game.review.timelineNotes,
            kpi_scores: game.review.kpiScores,
            free_text: game.review.freeText,
            ai_summary: game.review.aiSummary,
            objective_respected: game.review.objectiveRespected,
            created_at: game.review.createdAt.toISOString(),
          })
        }
      }
    }

    // Sync assessments
    const assessments = await prisma.assessment.findMany({
      where: { userId: user.id },
      include: { scores: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    for (const assessment of assessments) {
      await supa.from('synced_assessments').upsert({
        id: assessment.id,
        student_id: uid,
        created_at: assessment.createdAt.toISOString(),
      })

      for (const score of assessment.scores) {
        await supa.from('synced_assessment_scores').upsert({
          id: score.id,
          assessment_id: assessment.id,
          student_id: uid,
          fundamental_id: score.fundamentalId,
          subcategory_id: score.subcategoryId,
          score: score.score,
        })
      }
    }

    console.log('[sync] Student data synced to Supabase')
  } catch (err: any) {
    console.error('[sync] Failed to sync student data:', err?.message ?? err)
  }
}

export function registerSyncHandlers() {
  ipcMain.handle('sync:push', async () => {
    await syncStudentData()
    return { success: true }
  })
}
