/**
 * Games played outside any Ascend session (decision of 20/11/2026: "every game" is recorded).
 *
 * A Game always belongs to a Session, which is how every query finds a profile's games (`session.userId`). A game
 * played with no active session goes to the profile's off-session container: one closed Session per profile,
 * tagged by `objectiveId`, left out of the session lists and of the session KPIs (its games are never
 * `isSessionEligible`). The History, the stats and "Dernière partie" show them like any other game.
 *
 * The same container already held the games found from orphan recordings (recording.ipc.ts), so nothing moves.
 */
import { getPrisma } from './database'
import { bumpStreak } from './streak'

export const OFF_SESSION_OBJECTIVE_ID = '__review_only__'

/** The profile's off-session container, created on first need. */
export async function getOrCreateOffSessionSession(userId: string): Promise<string> {
  const prisma = getPrisma()
  const existing = await prisma.session.findFirst({ where: { userId, objectiveId: OFF_SESSION_OBJECTIVE_ID }, select: { id: true } })
  if (existing) return existing.id
  const created = await prisma.session.create({
    data: {
      userId,
      objectiveId: OFF_SESSION_OBJECTIVE_ID,
      status: 'closed',
      sessionConclusion: 'System container for games played outside any session.',
    },
  })
  console.log(`[games] created the off-session container ${created.id}`)
  return created.id
}

export function isOffSessionSession(session: { objectiveId?: string | null } | null | undefined): boolean {
  return session?.objectiveId === OFF_SESSION_OBJECTIVE_ID
}

/**
 * Where a game that just ended goes: the active session when there is one (counted in its KPIs as before),
 * otherwise the off-session container (never counted).
 */
export async function sessionForNewGame(userId: string): Promise<{ sessionId: string; inSession: boolean }> {
  const prisma = getPrisma()
  const active = await prisma.session.findFirst({ where: { userId, status: 'active', NOT: { objectiveId: OFF_SESSION_OBJECTIVE_ID } }, select: { id: true, autoStarted: true, _count: { select: { games: true } } } })
  if (active) {
    // The first game of a session Ascend started by itself: today counts as a day played (an empty one never does).
    if (active.autoStarted && active._count.games === 0) await bumpStreak(userId).catch(() => {})
    return { sessionId: active.id, inSession: true }
  }
  return { sessionId: await getOrCreateOffSessionSession(userId), inSession: false }
}
