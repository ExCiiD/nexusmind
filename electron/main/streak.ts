import { getPrisma } from './database'
import { tryUnlockBadge } from './badgeUnlock'

/**
 * Counts today as a day played: the streak and its badges. Called when a session is created by hand, and when the
 * first game of a session started by Ascend arrives (an empty auto session counts for nothing).
 */
export async function bumpStreak(userId: string): Promise<void> {
  const prisma = getPrisma()
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return
  const now = new Date()
  const lastActive = user.lastActiveDate
  const dayDiff = lastActive ? Math.floor((now.getTime() - lastActive.getTime()) / 86400000) : 0
  const newStreak = dayDiff <= 1 ? user.streakDays + (dayDiff === 1 ? 1 : 0) : 1
  await prisma.user.update({ where: { id: user.id }, data: { streakDays: newStreak, lastActiveDate: now } })
  if (newStreak >= 3) await tryUnlockBadge(user.id, 'streak_3')
  if (newStreak >= 7) await tryUnlockBadge(user.id, 'streak_7')
  if (newStreak >= 30) await tryUnlockBadge(user.id, 'streak_30')
}
