/**
 * Match ids the start-up catch-up (gameCatchUp.ts) and the orphan-recording backfill must not import
 * (20/11/2026):
 * - **deleted**: the player deleted that game (game:delete, session:delete, session:bulk-delete). It never comes back
 *   on its own, and an explicit import by the player brings it back and forgets it here.
 * - **not_found**: Riot has no such match (a practice tool game named in the League game log). Asked again after
 *   NOT_FOUND_RETRY_MS, since a game that just ended can also be missing for a few minutes.
 *
 * Local to this PC, not synced.
 */
import { getPrisma } from './database'

export const NOT_FOUND_RETRY_MS = 24 * 3_600_000

/** Pure: whether a stored entry still hides its match. */
export function stillIgnored(entry: { reason: string; createdAt: Date }, now = Date.now()): boolean {
  if (entry.reason === 'deleted') return true
  return now - entry.createdAt.getTime() < NOT_FOUND_RETRY_MS
}

const isRealMatchId = (id: string | null | undefined): id is string => !!id && !id.startsWith('live_')

/** Remembers games the player deleted (provisional `live_…` ids are not real matches: skipped). */
export async function rememberDeletedMatches(matchIds: Array<string | null | undefined>): Promise<void> {
  const prisma = getPrisma()
  for (const matchId of new Set(matchIds.filter(isRealMatchId))) {
    await prisma.ignoredMatch.upsert({
      where: { matchId },
      create: { matchId, reason: 'deleted' },
      update: { reason: 'deleted', createdAt: new Date() },
    }).catch((err) => console.warn('[ignored] could not remember a deleted match:', (err as Error)?.message))
  }
}

/** Riot answered 404 for this match: not asked again for a day. A deleted entry stays deleted. */
export async function rememberNotFound(matchId: string): Promise<void> {
  const prisma = getPrisma()
  const existing = await prisma.ignoredMatch.findUnique({ where: { matchId } }).catch(() => null)
  if (existing?.reason === 'deleted') return
  await prisma.ignoredMatch.upsert({
    where: { matchId },
    create: { matchId, reason: 'not_found' },
    update: { reason: 'not_found', createdAt: new Date() },
  }).catch(() => { /* best effort */ })
}

/** The player imported these games on purpose: no longer ignored. */
export async function forgetIgnoredMatches(matchIds: string[]): Promise<void> {
  if (matchIds.length === 0) return
  await getPrisma().ignoredMatch.deleteMany({ where: { matchId: { in: matchIds } } }).catch(() => { /* best effort */ })
}

/** Which of these match ids are ignored now. */
export async function ignoredAmong(matchIds: string[], now = Date.now()): Promise<Set<string>> {
  if (matchIds.length === 0) return new Set()
  const rows = await getPrisma().ignoredMatch.findMany({ where: { matchId: { in: matchIds } } }).catch(() => [])
  return new Set(rows.filter((r) => stillIgnored(r, now)).map((r) => r.matchId))
}
