import { app, BrowserWindow, clipboard, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { getPrisma } from '../database'
import { getAccountByRiotId, getLeagueEntriesByPuuid } from '../riotClient'
import { RiotAuthError } from '../riotTransport'
import { renderPoster } from '../lftPoster'
import { recordRankSnapshots } from '../weeklyAwards'
import { validatedHandle, id } from './validate'
import { parseLeagueEntries, type MemberRankResult, type PlayerRanks } from '../../../src/lib/rankCore'
import { isLftSize, soloPoolFromGames, soloRole, type SoloLftMember } from '../../../src/lib/lftCore'

/**
 * Looking-for-team announcements (Espace d'équipe):
 *  - team:member-ranks — Solo/Duo and Flex rank of each roster member
 *    (league-v4 by PUUID; the PUUID is resolved from the Riot ID and kept
 *    when missing, as auto-fill and scouting do). Short in-memory cache.
 *  - lft:export-png — renders the announcement off screen at its exact size
 *    (lftPoster.ts), then saves it (save dialog) and/or copies it.
 */

const RANK_TTL_MS = 5 * 60_000
const rankCache = new Map<string, { at: number; ranks: PlayerRanks }>()
const inFlight = new Map<string, Promise<PlayerRanks>>()

/** `fresh`: this call read Riot (not the cache, not another caller's read). */
async function ranksOf(puuid: string, region: string, force: boolean): Promise<{ ranks: PlayerRanks; at: number; fresh: boolean }> {
  const key = `${region}|${puuid}`
  const hit = rankCache.get(key)
  if (!force && hit && Date.now() - hit.at < RANK_TTL_MS) return { ranks: hit.ranks, at: hit.at, fresh: false }
  let pending = inFlight.get(key)
  const mine = !pending
  if (!pending) {
    pending = getLeagueEntriesByPuuid(puuid, region).then(parseLeagueEntries)
    inFlight.set(key, pending)
  }
  try {
    const ranks = await pending
    const at = Date.now()
    rankCache.set(key, { at, ranks })
    return { ranks, at, fresh: mine }
  } finally {
    inFlight.delete(key)
  }
}

/** A reading that came from Riot, for whoever keeps a rank history. */
export interface FreshRank {
  memberId: string
  puuid: string
  ranks: PlayerRanks
  /** When it was read (ms). */
  at: number
}

function errorResult(memberId: string, err: unknown): MemberRankResult {
  const message = err instanceof Error ? err.message : String(err)
  const code = err instanceof RiotAuthError
    ? (err.code === 'LOGIN_REQUIRED' ? 'login' : 'not-configured')
    : /\b404\b/.test(message) ? 'not-found' : 'unknown'
  return { memberId, status: 'error', code, message }
}

type RosterMember = { id: string; ign: string | null; tagLine: string | null; region: string | null; puuid: string | null }

async function memberRank(m: RosterMember, force: boolean): Promise<{ result: MemberRankResult; fresh: FreshRank | null }> {
  const ign = m.ign?.trim()
  const tag = m.tagLine?.trim()
  if (!ign || !tag || !m.region) return { result: { memberId: m.id, status: 'no-riot-id' }, fresh: null }
  try {
    let puuid = m.puuid
    if (!puuid) {
      const acct = await getAccountByRiotId(ign, tag, m.region)
      if (!acct?.puuid) throw new Error('Could not resolve Riot account (404)')
      puuid = acct.puuid
      await getPrisma().teamMember.update({ where: { id: m.id }, data: { puuid } })
    }
    const { ranks, at, fresh } = await ranksOf(puuid, m.region, force)
    return { result: { memberId: m.id, status: 'ok', ranks, fetchedAt: at }, fresh: fresh ? { memberId: m.id, puuid, ranks, at } : null }
  } catch (err) {
    console.warn('[lft] rank lookup failed for member', m.id, (err as Error)?.message)
    return { result: errorResult(m.id, err), fresh: null }
  }
}

/** Ranks of a team's roster. `fresh`: the readings that came from Riot on
 *  this call (the 5-minute cache left out); they also go to the weekly rank
 *  history (Grinder award), which never throws. */
export async function readTeamRanks(teamId: string, force: boolean): Promise<{ results: MemberRankResult[]; fresh: FreshRank[] }> {
  const team = await getPrisma().team.findUnique({ where: { id: teamId }, include: { members: true } })
  if (!team) throw new Error('Team not found')
  const read = await Promise.all(team.members.map((m: RosterMember) => memberRank(m, force)))
  const fresh = read.flatMap((r) => (r.fresh ? [r.fresh] : []))
  if (fresh.length) void recordRankSnapshots(fresh)
  return { results: read.map((r) => r.result), fresh }
}

const exportInput = z.object({
  markup: z.string().min(1).max(2_000_000),
  css: z.string().max(3_000_000),
  width: z.number().int(),
  height: z.number().int(),
  fileName: z.string().max(120).regex(/^[A-Za-z0-9._-]+\.png$/, 'invalid file name'),
  action: z.enum(['save', 'copy']),
}).refine((v) => isLftSize(v.width, v.height), 'unknown announcement size')

/** How many of the player's latest games make their solo pool (same order of size as a scouted pool). */
const SOLO_GAMES = 100

/**
 * Solo LFT for a player without a group (§ 18.2): the poster's roster member built from the active user (Riot ID,
 * role, pool from their own games) and their rank, read like a roster member's.
 */
export async function readMySoloLft(force: boolean): Promise<{ member: SoloLftMember; rank: MemberRankResult } | null> {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) return null
  const games = await prisma.game.findMany({
    where: { session: { userId: user.id } },
    orderBy: { gameEndAt: 'desc' },
    take: SOLO_GAMES,
    select: { champion: true, role: true, win: true },
  })
  const role = soloRole(user.mainRole, games) ?? 'MID'
  const member: SoloLftMember = {
    id: 'me', teamId: '', displayName: user.summonerName, ign: user.summonerName, tagLine: user.tagLine || null,
    region: user.region, role, puuid: user.puuid,
    champPool: soloPoolFromGames(games, 'me'),
  }
  const ign = user.summonerName?.trim()
  if (!ign || !user.tagLine || !user.region) return { member, rank: { memberId: 'me', status: 'no-riot-id' } }
  try {
    const { ranks, at } = await ranksOf(user.puuid, user.region, force)
    return { member, rank: { memberId: 'me', status: 'ok', ranks, fetchedAt: at } }
  } catch (err) {
    return { member, rank: errorResult('me', err) }
  }
}

export function registerLftHandlers(): void {
  validatedHandle('lft:my-solo', z.tuple([z.object({ force: z.boolean().optional() }).optional()]), (_e, opts) => readMySoloLft(!!opts?.force))

  validatedHandle(
    'team:member-ranks',
    z.tuple([id, z.object({ force: z.boolean().optional() }).optional()]),
    async (_e, teamId, opts): Promise<MemberRankResult[]> => {
      const { results } = await readTeamRanks(teamId, !!opts?.force)
      return results
    },
  )

  validatedHandle('lft:export-png', z.tuple([exportInput]), async (event, req) => {
    // The page is rendered as if it lived where the app is loaded from, so
    // the app's own fonts and logo load; never a place the renderer names.
    const baseUrl = new URL('.', event.sender.getURL()).href
    const image = await renderPoster({ markup: req.markup, css: req.css, width: req.width, height: req.height, baseUrl })
    clipboard.writeImage(image)
    if (req.action === 'copy') return { copied: true as const, filePath: null }

    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const options: Electron.SaveDialogOptions = {
      defaultPath: join(app.getPath('pictures'), req.fileName),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    }
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { copied: true as const, filePath: null }
    const filePath = /\.png$/i.test(result.filePath) ? result.filePath : `${result.filePath}.png`
    await writeFile(filePath, image.toPNG())
    return { copied: true as const, filePath }
  })
}
