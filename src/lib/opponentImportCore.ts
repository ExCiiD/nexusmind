/**
 * #49: the desktop's Scouting tab and Draft Sim read the opponents stored on this computer (local Team rows,
 * isOpponent, groupId). An opponent entered in a Planning slot lives in the group's scouting on the server. This
 * works out what to change locally so it shows up, without ever overwriting what the user has locally.
 *
 * Pure: electron/main/cloud/opponentImport.ts reads both sides and applies the plan.
 *
 * Rules (docs/PROPOSITION_SCRIMS_PLANNING.md section 2.5):
 *   - matched on the opponent key (analyst.ts opponentKeyOf: name trimmed, spaces collapsed, lower case)
 *   - an opponent missing locally is created, unless the user deleted it locally (dismissed keys)
 *   - an opponent present locally only gets what it lacks: its tag if it has none, and a player for each role it has
 *     no player for. Nothing local is changed or removed.
 */
import { opponentKeyOf } from './analyst'
import type { TeamRole } from './team'

export interface ServerOpponent {
  name: string
  tag: string | null
  scoutNotes: string | null
  players: Array<{ role: TeamRole; displayName: string; ign: string | null; tagLine: string | null; region: string | null; puuid: string | null }>
}

export interface LocalOpponent {
  id: string
  name: string
  tag: string | null
  members: Array<{ role: string }>
}

export interface OpponentImportPlan {
  create: ServerOpponent[]
  fill: Array<{ teamId: string; tag: string | null; addPlayers: ServerOpponent['players'] }>
}

export function planOpponentImport(server: ServerOpponent[], local: LocalOpponent[], dismissedKeys: ReadonlySet<string>): OpponentImportPlan {
  const localByKey = new Map<string, LocalOpponent>()
  for (const t of local) {
    const key = opponentKeyOf(t.name)
    if (key && !localByKey.has(key)) localByKey.set(key, t)
  }
  const plan: OpponentImportPlan = { create: [], fill: [] }
  const seen = new Set<string>()
  for (const opp of server) {
    const key = opponentKeyOf(opp.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const players = opp.players.filter((p) => p.ign)
    const mine = localByKey.get(key)
    if (!mine) {
      if (!dismissedKeys.has(key)) plan.create.push({ ...opp, players })
      continue
    }
    const roles = new Set(mine.members.map((m) => m.role))
    const addPlayers = players.filter((p) => !roles.has(p.role))
    const tag = mine.tag ? null : opp.tag
    if (addPlayers.length > 0 || tag) plan.fill.push({ teamId: mine.id, tag, addPlayers })
  }
  return plan
}
