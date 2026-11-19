import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getPrisma } from '../database'
import { getSupabase, getSessionUserId } from './supabase'
import { getSharedTeam } from '../../../src/lib/teamCore'
import { opponentKeyOf } from '../../../src/lib/analyst'
import { planOpponentImport, type ServerOpponent } from '../../../src/lib/opponentImportCore'

/**
 * #49: brings the group's scouted opponents (team_scouting, including the ones entered in a Planning slot) into
 * the local Team rows the Scouting tab and the Draft Sim read. Called from team:list when it lists a group's
 * opponents, and after a match is saved from the Planning. Best effort: signed out, offline or before the
 * migration, the local list is shown as it is.
 *
 * An opponent the user deletes locally is remembered (dismissed-opponents.json in the app's data folder) so the
 * next import does not bring it back.
 */

const THROTTLE_MS = 60_000
const lastRun = new Map<string, number>()
const inFlight = new Map<string, Promise<void>>()

const dismissedFile = (): string => join(app.getPath('userData'), 'dismissed-opponents.json')

async function readDismissed(): Promise<Record<string, string[]>> {
  try {
    const raw = JSON.parse(await readFile(dismissedFile(), 'utf-8')) as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {}
  } catch { return {} }
}

/** Remembers that the user removed this opponent of this group (team:delete). */
export async function rememberDismissedOpponent(groupId: string, name: string): Promise<void> {
  const key = opponentKeyOf(name)
  if (!key) return
  const all = await readDismissed()
  const keys = new Set(all[groupId] ?? [])
  if (keys.has(key)) return
  keys.add(key)
  all[groupId] = [...keys]
  await writeFile(dismissedFile(), JSON.stringify(all), 'utf-8')
}

/** Imports now, or reuses an import of the last minute (`force` skips that). */
export function importGroupOpponents(groupId: string, opts: { force?: boolean } = {}): Promise<void> {
  const running = inFlight.get(groupId)
  if (running) return running
  if (!opts.force && Date.now() - (lastRun.get(groupId) ?? 0) < THROTTLE_MS) return Promise.resolve()
  const run = doImport(groupId)
    .catch((err) => console.warn('[opponents] import skipped:', (err as Error)?.message))
    .finally(() => { inFlight.delete(groupId); lastRun.set(groupId, Date.now()) })
  inFlight.set(groupId, run)
  return run
}

async function doImport(groupId: string): Promise<void> {
  if (!(await getSessionUserId())) return
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) return

  const shared = await getSharedTeam(getSupabase(), groupId, { pools: false, drafts: false })
  const server: ServerOpponent[] = shared.scouting.map((s) => ({
    name: s.name, tag: s.tag, scoutNotes: s.scoutNotes,
    players: s.roster.map((m) => ({ role: m.role, displayName: m.displayName, ign: m.ign, tagLine: m.tagLine, region: m.region, puuid: m.puuid })),
  }))
  if (server.length === 0) return

  const local = await prisma.team.findMany({
    where: { userId: user.id, isOpponent: true, groupId },
    select: { id: true, name: true, tag: true, members: { select: { role: true } } },
  })
  const dismissed = new Set((await readDismissed())[groupId] ?? [])
  const plan = planOpponentImport(server, local, dismissed)

  for (const opp of plan.create) {
    await prisma.team.create({
      data: {
        userId: user.id, name: opp.name, tag: opp.tag, scoutNotes: opp.scoutNotes, isOpponent: true, groupId,
        members: { create: opp.players.map((p) => ({ displayName: p.displayName || (p.ign as string), ign: p.ign, tagLine: p.tagLine, region: p.region, role: p.role, puuid: p.puuid })) },
      },
    })
  }
  for (const f of plan.fill) {
    if (f.tag) await prisma.team.update({ where: { id: f.teamId }, data: { tag: f.tag } })
    for (const p of f.addPlayers) {
      await prisma.teamMember.create({
        data: { teamId: f.teamId, displayName: p.displayName || (p.ign as string), ign: p.ign, tagLine: p.tagLine, region: p.region, role: p.role, puuid: p.puuid },
      })
    }
  }
}
