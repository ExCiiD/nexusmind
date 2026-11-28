import { createHash } from 'node:crypto'
import { getPrisma } from './database'
import { timelineFromRow } from './matchStore'
import { participantIdOf } from './mistakeDetector'
import { seasonOf } from '../../src/lib/microReview/gameClock'
import { TIER_VERSION, computeTiers, type MistakeTier, type TierReason, type TierResult } from '../../src/lib/microReview/mistakeTiers'

/**
 * Tiers of the Mistake Lab (28/11/2026, docs/moteur/engine-reports/2026-11-28-tiers-erreurs.md), computed on this PC from the
 * match and timeline already cached (never Riot) and kept in a LOCAL table (never synced: it is derived, and each device
 * recomputes it). A game's tiers depend on all its mistakes (chains, "after a fatal"), so they are computed together and
 * recomputed when the game's mistakes change or the rules' version moves.
 */
export interface StoredTier {
  tier: MistakeTier
  tierReason: TierReason | null
  chainId: string | null
  chainRole: 'cause' | 'effect' | null
}
const NO_TIER = null

let tableReady = false
async function ensureTable(): Promise<void> {
  if (tableReady) return
  await getPrisma().$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "MistakeTierCache" ("mistakeId" TEXT PRIMARY KEY, "gameId" TEXT NOT NULL, "sig" TEXT NOT NULL, "tier" TEXT NOT NULL, "reason" TEXT, "chainId" TEXT, "chainRole" TEXT)',
  )
  await getPrisma().$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "MistakeTierCache_game" ON "MistakeTierCache" ("gameId")')
  tableReady = true
}

const sigOf = (rows: Array<{ id: string; tag: { slug: string }; gameTimeSec: number; autoDetected: boolean }>): string =>
  createHash('sha1').update(`v${TIER_VERSION}|` + rows.map((r) => `${r.id}:${r.tag.slug}:${r.gameTimeSec}:${r.autoDetected ? 1 : 0}`).sort().join(',')).digest('hex').slice(0, 20)

/** The tiers of one game's mistakes (mistake id → tier); a mistake missing from the map has an unknown tier (no timeline). */
export async function ensureGameTiers(gameId: string): Promise<Map<string, StoredTier>> {
  await ensureTable()
  const prisma = getPrisma()
  const rows = await prisma.mistake.findMany({ where: { gameId }, include: { tag: { select: { slug: true } } } })
  const out = new Map<string, StoredTier>()
  if (!rows.length) return out
  const sig = sigOf(rows)
  const stored = await prisma.$queryRawUnsafe<Array<{ mistakeId: string; sig: string; tier: string; reason: string | null; chainId: string | null; chainRole: string | null }>>(
    'SELECT mistakeId, sig, tier, reason, chainId, chainRole FROM "MistakeTierCache" WHERE gameId = ?', gameId)
  if (stored.length === rows.length && stored.every((s) => s.sig === sig)) {
    for (const s of stored) out.set(s.mistakeId, { tier: s.tier as MistakeTier, tierReason: s.reason ? JSON.parse(s.reason) : null, chainId: s.chainId, chainRole: (s.chainRole as 'cause' | 'effect' | null) ?? null })
    return out
  }
  const computed = await compute(gameId, rows)
  await prisma.$executeRawUnsafe('DELETE FROM "MistakeTierCache" WHERE gameId = ?', gameId)
  if (!computed) return out
  for (const r of rows) {
    const t = computed.get(r.id)
    if (!t) continue
    const st: StoredTier = { tier: t.tier, tierReason: t.reason, chainId: t.chainId ?? null, chainRole: t.chainRole ?? null }
    out.set(r.id, st)
    await prisma.$executeRawUnsafe('INSERT OR REPLACE INTO "MistakeTierCache" (mistakeId, gameId, sig, tier, reason, chainId, chainRole) VALUES (?, ?, ?, ?, ?, ?, ?)',
      r.id, gameId, sig, st.tier, st.tierReason ? JSON.stringify(st.tierReason) : null, st.chainId, st.chainRole)
  }
  return out
}

async function compute(gameId: string, rows: Array<{ id: string; tag: { slug: string }; gameTimeSec: number; autoDetected: boolean }>): Promise<Map<string, TierResult> | null> {
  const prisma = getPrisma()
  try {
    const game = await prisma.game.findUnique({ where: { id: gameId } })
    if (!game?.matchId) return NO_TIER
    const cache = await prisma.matchCache.findUnique({ where: { matchId: game.matchId } })
    const timeline = cache ? timelineFromRow(prisma, game.matchId, cache.timelineJson) : null
    if (!cache?.matchJson || !timeline) return NO_TIER
    const match: any = typeof cache.matchJson === 'string' ? JSON.parse(cache.matchJson) : cache.matchJson
    if (seasonOf(match) !== 'current') return NO_TIER
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    const accounts = user ? await prisma.account.findMany({ where: { userId: user.id } }) : []
    const puuids = user ? [user.puuid, ...accounts.map((a) => a.puuid)].filter((p) => !!p) : []
    const pid = participantIdOf(match, { puuids, championName: game.champion, win: game.win })
    if (pid == null) return NO_TIER
    return computeTiers(match, timeline as any, pid, rows.map((r) => ({ key: r.id, tagSlug: r.tag.slug, tSec: r.gameTimeSec, autoDetected: r.autoDetected })))
  } catch (err) {
    console.warn('[mistake] tiers failed for', gameId, (err as Error)?.message ?? err)
    return NO_TIER
  }
}

/** Tiers for several games at once (the Lab's window). */
export async function ensureTiersForGames(gameIds: string[]): Promise<Map<string, StoredTier>> {
  const all = new Map<string, StoredTier>()
  for (const id of [...new Set(gameIds)]) for (const [k, v] of await ensureGameTiers(id)) all.set(k, v)
  return all
}

/** The fields the Lab reads on an occurrence (`tier` null = unknown, no timeline). */
export const tierFields = (t: StoredTier | undefined) => ({
  tier: t?.tier ?? null, tierReason: t?.tierReason ?? null, chainId: t?.chainId ?? null, chainRole: t?.chainRole ?? null,
})
