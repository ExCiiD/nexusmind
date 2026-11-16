import { getPrisma } from '../database'
import { getSupabase } from '../cloud/supabase'
import { currentUserId } from './syncService'
import { SYNC_TABLES, tableOrder } from './syncSchema'

/**
 * Cleanup for the sync-leak fixed in beta.104 (see memory
 * sync-engine-rls-scoping.md / commit e9b95a7): before that fix, a coach/
 * owner/analyst's own-device sync had no `user_id` filter on `sync_records`
 * and relied on RLS alone, so it also pulled a *shared* teammate's own rows
 * — `SyncEngine.prepareRow()` then stamps every applied row with the LOCAL
 * active user's own id, so those rows became indistinguishable from the
 * user's own data by local inspection alone. The only way to tell them
 * apart is to ask the server: `sync_records` still remembers the *true*
 * owner for every `(table_name, record_id)` pair that was ever pushed.
 *
 * Only tables that (a) get a `userColumns` stamp on apply and (b) are
 * actually exposed by the `sync_records_read_shared` RLS policy
 * (`private.can_read_player_table`'s table lists) could have been
 * contaminated this way — everything else either never leaves this
 * device's own account scope, or has no user stamp to mis-attribute.
 */
const ROOT_TABLES = ['Account', 'Session', 'Assessment', 'StatsSnapshot', 'Badge', 'ExternalReview', 'Team', 'DraftPrep', 'CoachingExperiment']
const BATCH = 500

/** Local row ids in `table` whose `sync_records` entry (if any) belongs to
 *  someone other than `myUid` — i.e. rows this device absorbed from a
 *  shared teammate rather than created itself. A row never pushed at all
 *  (no `sync_records` entry) is left alone — it's this device's own,
 *  unsynced data. */
async function findForeignRootIds(table: string, myUid: string): Promise<string[]> {
  const prisma = getPrisma()
  const localIds = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${table}"`)).map((r) => r.id)
  if (localIds.length === 0) return []

  const foreign: string[] = []
  for (let i = 0; i < localIds.length; i += BATCH) {
    const batch = localIds.slice(i, i + BATCH)
    const { data, error } = await getSupabase()
      .from('sync_records')
      .select('record_id, user_id')
      .eq('table_name', table)
      .in('record_id', batch)
    if (error) throw new Error(`audit failed for ${table}: ${error.message}`)
    for (const row of data ?? []) {
      if (row.user_id !== myUid) foreign.push(row.record_id as string)
    }
  }
  return foreign
}

/** Follows `fks` forward (parent → child) from the seeded foreign root ids
 *  so a contaminated Session/Team/Assessment also takes its Games,
 *  Reviews, TeamMembers, AssessmentScores, etc. with it — repeats until a
 *  pass finds nothing new, since a child can itself be another row's
 *  parent (Session → Game → Review/Recording → Mistake/Bookmark). */
async function cascadeChildren(byTable: Map<string, Set<string>>): Promise<void> {
  const prisma = getPrisma()
  let changed = true
  while (changed) {
    changed = false
    for (const spec of SYNC_TABLES) {
      for (const [fkCol, parentTable] of Object.entries(spec.fks ?? {})) {
        const parentIds = byTable.get(parentTable)
        if (!parentIds || parentIds.size === 0) continue
        const ids = [...parentIds]
        for (let i = 0; i < ids.length; i += BATCH) {
          const batch = ids.slice(i, i + BATCH)
          const placeholders = batch.map(() => '?').join(', ')
          const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM "${spec.table}" WHERE "${fkCol}" IN (${placeholders})`, ...batch,
          )
          const set = byTable.get(spec.table) ?? new Set<string>()
          for (const r of rows) if (!set.has(r.id)) { set.add(r.id); changed = true }
          byTable.set(spec.table, set)
        }
      }
    }
  }
}

async function findAllForeignRows(): Promise<Map<string, Set<string>>> {
  const myUid = await currentUserId()
  if (!myUid) throw new Error('NOT_SIGNED_IN')
  const byTable = new Map<string, Set<string>>()
  for (const table of ROOT_TABLES) {
    const ids = await findForeignRootIds(table, myUid)
    if (ids.length > 0) byTable.set(table, new Set(ids))
  }
  await cascadeChildren(byTable)
  return byTable
}

/** Read-only: counts, never deletes. Safe to call anytime. */
export async function auditForeignSyncRows(): Promise<Record<string, number>> {
  const byTable = await findAllForeignRows()
  const report: Record<string, number> = {}
  for (const [table, ids] of byTable) if (ids.size > 0) report[table] = ids.size
  return report
}

/**
 * Re-audits (never trusts a list round-tripped from the renderer) and
 * deletes every confirmed-foreign row, children first so FKs never break.
 * Runs under the same `applying = 1` guard `SyncEngine` uses while
 * applying a pull — this is a correction of contamination the sync
 * machinery itself caused, not a new local edit, so it must not queue a
 * tombstone that would push a delete for a record_id this account never
 * legitimately owned.
 */
export async function deleteForeignSyncRows(): Promise<Record<string, number>> {
  const byTable = await findAllForeignRows()
  const prisma = getPrisma()
  const deleted: Record<string, number> = {}

  await prisma.$executeRawUnsafe(`UPDATE "_sync_control" SET applying = 1 WHERE id = 1`)
  try {
    const tablesToDelete = [...byTable.keys()].sort((a, b) => tableOrder(b) - tableOrder(a))
    for (const table of tablesToDelete) {
      const ids = [...(byTable.get(table) ?? [])]
      if (ids.length === 0) continue
      let count = 0
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH)
        const placeholders = batch.map(() => '?').join(', ')
        count += await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE id IN (${placeholders})`, ...batch)
      }
      if (count > 0) deleted[table] = count
    }
  } finally {
    await prisma.$executeRawUnsafe(`UPDATE "_sync_control" SET applying = 0 WHERE id = 1`)
  }
  return deleted
}
