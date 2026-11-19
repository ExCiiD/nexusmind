/**
 * #40 analyst features (src/lib/analyst.ts AnalystApi): Objectives, draft log, opponent dossier. Every input is
 * checked with zod before it reaches Supabase or Riot. Rights are the database's (draft_log, opponent_dossiers
 * policies): a player calling a staff action gets FORBIDDEN from RLS.
 */
import { z } from 'zod'
import { validatedHandle } from './validate'
import * as analyst from '../cloud/analyst'

const uuid = z.string().uuid()
const isoDate = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date')
const source = z.enum(['flex', 'scrim', 'tournament'])
const side = z.enum(['blue', 'red'])
const champion = z.string().trim().min(1).max(40)
const role = z.enum(['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']).nullable()
const picks = z.array(z.object({ champion, role })).max(5)
const bans = z.array(champion).max(5).nullable()
const opponentKey = z.string().trim().min(1).max(80)

const objectivesFilters = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  sources: z.array(source).min(1).max(3),
  side: z.enum(['both', 'blue', 'red']),
}).strict()

const draftInput = z.object({
  playedAt: isoDate,
  source: z.enum(['flex', 'scrim', 'tournament', 'manual']),
  opponentName: z.string().trim().max(80).nullable(),
  side,
  win: z.boolean().nullable(),
  ourPicks: picks,
  theirPicks: picks,
  ourBans: bans,
  theirBans: bans,
  notes: z.string().max(4000).nullable().optional(),
}).strict()

const draftPatch = z.object({
  opponentName: z.string().trim().max(80).nullable(),
  win: z.boolean().nullable(),
  ourBans: bans,
  theirBans: bans,
  pickOrder: z.array(champion).max(10).nullable(),
  notes: z.string().max(4000).nullable(),
}).partial().strict()

const dossierInput = z.object({
  opponentName: z.string().trim().min(1).max(80),
  howTheyPlay: z.string().max(600).nullable(),
  suggestedBans: z.array(champion).max(5),
  gamePlan: z.string().max(600).nullable(),
}).strict()

export function registerAnalystHandlers() {
  validatedHandle('analyst:objectives-games', z.tuple([uuid, objectivesFilters]), (_e, groupId, filters) => analyst.teamObjectivesGames(groupId, filters))
  validatedHandle('analyst:objectives-game-timeline', z.tuple([uuid]), (_e, gameId) => analyst.teamObjectivesGameTimeline(gameId))

  validatedHandle('analyst:draft-log-list', z.tuple([uuid]), (_e, groupId) => analyst.draftLogList(groupId))
  validatedHandle('analyst:draft-log-sync', z.tuple([uuid]), (_e, groupId) => analyst.draftLogSyncFromGames(groupId))
  validatedHandle('analyst:draft-log-create', z.tuple([uuid, draftInput]), (_e, groupId, input) => analyst.draftLogCreate(groupId, input))
  validatedHandle('analyst:draft-log-update', z.tuple([uuid, draftPatch]), (_e, id, patch) => analyst.draftLogUpdate(id, patch))
  validatedHandle('analyst:draft-log-delete', z.tuple([uuid]), (_e, id) => analyst.draftLogDelete(id))

  validatedHandle('analyst:dossier-get', z.tuple([uuid, opponentKey]), (_e, groupId, key) => analyst.opponentDossierGet(groupId, key))
  validatedHandle('analyst:dossier-save', z.tuple([uuid, opponentKey, dossierInput]), (_e, groupId, key, input) => analyst.opponentDossierSave(groupId, key, input))
  validatedHandle('analyst:dossier-publish', z.tuple([uuid, opponentKey]), (_e, groupId, key) => analyst.opponentDossierPublish(groupId, key))
  validatedHandle('analyst:dossier-unpublish', z.tuple([uuid, opponentKey]), (_e, groupId, key) => analyst.opponentDossierUnpublish(groupId, key))
  validatedHandle('analyst:dossier-refresh', z.tuple([uuid, opponentKey]), (_e, groupId, key) => analyst.opponentDossierRefresh(groupId, key))
}
