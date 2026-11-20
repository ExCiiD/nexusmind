/**
 * The server of each of the player's Riot accounts (decision of 20/11/2026, src/lib/riotRegionCore.ts).
 *
 * - On start: the manual choices and the previous servers are loaded into the resolver of riotClient, then every
 *   account is detected in the background.
 * - When an "Auto" account turns out to play elsewhere (a transfer), its `region` is saved and the old one kept in
 *   `previousRegion`, where its older games stay. An account with a manual choice is never changed.
 * - `account:regions` / `account:set-region-mode`: the settings screen (one line per account, main account included).
 */
import { z } from 'zod'
import { validatedHandle, id } from './ipc/validate'
import { getPrisma } from './database'
import { onDetectedRegionChange, regionResolver } from './riotClient'
import { normalizePlatform, normalizeRegionMode, type AccountRegionInfo, type Platform } from '../../src/lib/riotRegionCore'

/** Saves a detected server on every row of that puuid still in "Auto" (profiles and linked accounts). */
export async function saveDetectedRegion(puuid: string, from: Platform | null, to: Platform): Promise<void> {
  const prisma = getPrisma()
  const data = { region: to, ...(from && from !== to ? { previousRegion: from } : {}) }
  await prisma.user.updateMany({ where: { puuid, regionMode: 'auto', NOT: { region: to } }, data })
  await prisma.account.updateMany({ where: { puuid, regionMode: 'auto', NOT: { region: to } }, data })
}

async function ownAccounts(): Promise<Array<{ accountId: string; puuid: string; gameName: string; tagLine: string; region: string; regionMode: string; previousRegion: string | null }>> {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) return []
  const linked = await prisma.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } })
  return [
    { accountId: 'main', puuid: user.puuid, gameName: user.summonerName, tagLine: user.tagLine, region: user.region, regionMode: user.regionMode, previousRegion: user.previousRegion },
    ...linked.map((a) => ({ accountId: a.id, puuid: a.puuid, gameName: a.gameName, tagLine: a.tagLine, region: a.region, regionMode: a.regionMode, previousRegion: a.previousRegion })),
  ].filter((a) => !!a.puuid)
}

/** Loads every saved choice into the resolver (all profiles), then detects the active profile's accounts. */
export async function initAccountRegions(): Promise<void> {
  const prisma = getPrisma()
  const [users, accounts] = await Promise.all([
    prisma.user.findMany({ select: { puuid: true, regionMode: true, previousRegion: true } }),
    prisma.account.findMany({ select: { puuid: true, regionMode: true, previousRegion: true } }),
  ])
  for (const r of [...users, ...accounts]) {
    if (!r.puuid) continue
    regionResolver.setMode(r.puuid, r.regionMode)
    regionResolver.setPrevious(r.puuid, r.previousRegion)
  }
  onDetectedRegionChange((puuid, from, to) => {
    saveDetectedRegion(puuid, from, to).catch((err) => console.warn('[regions] could not save the detected server:', (err as Error)?.message))
  })
  for (const a of await ownAccounts()) {
    regionResolver.resolve(a.puuid, a.region).catch(() => { /* keeps the stored server */ })
  }
}

export async function listAccountRegions(force = false): Promise<AccountRegionInfo[]> {
  const accounts = await ownAccounts()
  if (force) for (const a of accounts) regionResolver.invalidate(a.puuid)
  return Promise.all(accounts.map(async (a) => {
    const mode = normalizeRegionMode(a.regionMode)
    const res = await regionResolver.resolve(a.puuid, a.region).catch(() => null)
    const seen = regionResolver.peek(a.puuid)
    return {
      accountId: a.accountId,
      puuid: a.puuid,
      gameName: a.gameName,
      tagLine: a.tagLine,
      mode,
      region: res?.platform ?? normalizePlatform(a.region),
      detected: seen?.platform ?? null,
      detectedAt: seen ? new Date(seen.at).toISOString() : null,
      previousRegion: res?.previous ?? normalizePlatform(a.previousRegion),
    }
  }))
}

/** `mode`: 'auto' or a platform ('EUW1', 'SG2'…). Throws BAD_REGION for anything else, NOT_FOUND for an unknown account. */
export async function setAccountRegionMode(accountId: string, mode: string): Promise<AccountRegionInfo> {
  const wanted = String(mode ?? '').trim().toLowerCase() === 'auto' ? 'auto' : normalizePlatform(mode)
  if (!wanted) throw new Error('BAD_REGION')
  const prisma = getPrisma()
  const target = (await ownAccounts()).find((a) => a.accountId === accountId)
  if (!target) throw new Error('NOT_FOUND')
  // A manual server becomes the stored one too, for the few calls that do not go through the resolver.
  const data = wanted === 'auto' ? { regionMode: 'auto' } : { regionMode: wanted, region: wanted }
  if (accountId === 'main') await prisma.user.updateMany({ where: { puuid: target.puuid, isActive: true }, data })
  else await prisma.account.update({ where: { id: accountId }, data })
  regionResolver.setMode(target.puuid, wanted)
  if (wanted === 'auto') regionResolver.invalidate(target.puuid)
  const info = (await listAccountRegions()).find((a) => a.accountId === accountId)
  if (!info) throw new Error('NOT_FOUND')
  return info
}

/** 'main' or an Account id (cuid). */
export const accountIdSchema = z.union([z.literal('main'), id])
/** 'auto' or a platform this app knows ('EUW1', 'sg2'…), nothing else. */
export const regionModeSchema = z.string().trim().max(8).refine((v) => v.toLowerCase() === 'auto' || normalizePlatform(v) !== null, 'must be auto or a known platform')

export function registerAccountRegionHandlers(): void {
  validatedHandle('account:regions', z.tuple([z.object({ force: z.boolean().optional() }).strict().optional()]), (_e, opts) => listAccountRegions(!!opts?.force))
  validatedHandle('account:set-region-mode', z.tuple([accountIdSchema, regionModeSchema]), (_e, accountId, mode) => setAccountRegionMode(accountId, mode))
}
