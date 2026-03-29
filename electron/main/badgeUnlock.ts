import { getPrisma } from './database'

export async function tryUnlockBadge(userId: string, badgeId: string): Promise<void> {
  const prisma = getPrisma()
  await prisma.badge.upsert({
    where: { userId_badgeId: { userId, badgeId } },
    create: { userId, badgeId },
    update: {},
  })
}
