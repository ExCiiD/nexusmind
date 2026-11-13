import type { PrismaClient } from '../../../prisma-client'

/**
 * Which local tables are synced, and how to merge them.
 *
 * Order matters: parents before children (push batches and pull pages are
 * applied in this order so foreign keys resolve).
 */
export interface SyncTableSpec {
  table: string
  /** FK column -> parent table; values are translated through the id map. */
  fks?: Record<string, string>
  /** Columns that point at the local user: always rewritten to this PC's user id. */
  userColumns?: string[]
  /** Machine-local columns (file paths): never sent, never overwritten. */
  localColumns?: string[]
  /**
   * Natural key: when another device created "the same" row under another
   * id (built-in tag, same match, same Riot account…), rows are merged and
   * the remote id is mapped onto the local one.
   */
  naturalKey?: string[]
}

export const SYNC_TABLES: SyncTableSpec[] = [
  { table: 'Account', userColumns: ['userId'], naturalKey: ['puuid'] },
  { table: 'Session', userColumns: ['userId'] },
  { table: 'Game', fks: { sessionId: 'Session' }, naturalKey: ['matchId'] },
  { table: 'Review', fks: { gameId: 'Game' }, naturalKey: ['gameId'] },
  { table: 'Assessment', userColumns: ['userId'] },
  { table: 'AssessmentScore', fks: { assessmentId: 'Assessment' }, naturalKey: ['assessmentId', 'fundamentalId', 'subcategoryId'] },
  { table: 'StatsSnapshot', userColumns: ['userId'] },
  { table: 'Badge', userColumns: ['userId'], naturalKey: ['userId', 'badgeId'] },
  { table: 'ExternalReview', userColumns: ['userId'], localColumns: ['filePath'] },
  { table: 'Recording', fks: { gameId: 'Game' }, localColumns: ['filePath', 'thumbnailPath'], naturalKey: ['gameId'] },
  { table: 'Bookmark', fks: { recordingId: 'Recording' } },
  { table: 'Team', userColumns: ['userId'] },
  { table: 'TeamMember', fks: { teamId: 'Team' } },
  { table: 'ChampionPoolEntry', fks: { memberId: 'TeamMember' }, naturalKey: ['memberId', 'championKey', 'role'] },
  { table: 'CustomGame', fks: { teamId: 'Team' } },
  { table: 'DraftPrep', userColumns: ['userId'], fks: { vsTeamId: 'Team' } },
  { table: 'MistakeTag', naturalKey: ['slug'] },
  { table: 'Mistake', fks: { gameId: 'Game', tagId: 'MistakeTag', recordingId: 'Recording' } },
  // Phase A: 👍/👎 on assistant insights (personal — never shared with a group).
  { table: 'AssistantFeedback', userColumns: ['userId'], naturalKey: ['userId', 'insightKey'] },
  // Coaching engine: advice already shown (anti-repetition across devices).
  { table: 'AdviceLog', userColumns: ['userId'], naturalKey: ['userId', 'problemId', 'day'] },
  { table: 'CoachingExperiment', userColumns: ['userId'] },
]

export const SYNC_TABLE_NAMES = SYNC_TABLES.map((t) => t.table)
export const tableOrder = (table: string) => {
  const i = SYNC_TABLE_NAMES.indexOf(table)
  return i < 0 ? Number.MAX_SAFE_INTEGER : i
}
export const specFor = (table: string) => SYNC_TABLES.find((t) => t.table === table)

const NOW_ISO = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
const NOT_APPLYING = `(SELECT applying FROM "_sync_control" WHERE id = 1) = 0`

/**
 * Creates the local bookkeeping tables and change-tracking triggers.
 * Idempotent; runs at every start. Triggers catch every write, including
 * raw SQL, so no IPC handler needs to know about sync.
 */
export async function ensureLocalSyncTables(prisma: PrismaClient): Promise<void> {
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql)
  await exec(`CREATE TABLE IF NOT EXISTS "_sync_control" ("id" INTEGER PRIMARY KEY CHECK ("id" = 1), "applying" INTEGER NOT NULL DEFAULT 0)`)
  await exec(`INSERT OR IGNORE INTO "_sync_control" ("id", "applying") VALUES (1, 0)`)
  // A crash while applying remote changes must not silently disable tracking.
  await exec(`UPDATE "_sync_control" SET "applying" = 0 WHERE "id" = 1`)
  await exec(`CREATE TABLE IF NOT EXISTS "_sync_outbox" ("table_name" TEXT NOT NULL, "record_id" TEXT NOT NULL, "changed_at" TEXT NOT NULL, PRIMARY KEY ("table_name", "record_id"))`)
  await exec(`CREATE TABLE IF NOT EXISTS "_sync_state" ("key" TEXT PRIMARY KEY, "value" TEXT)`)
  await exec(`CREATE TABLE IF NOT EXISTS "_sync_idmap" ("table_name" TEXT NOT NULL, "remote_id" TEXT NOT NULL, "local_id" TEXT NOT NULL, PRIMARY KEY ("table_name", "remote_id"))`)
  await exec(`CREATE TABLE IF NOT EXISTS "_sync_inbox" ("table_name" TEXT NOT NULL, "record_id" TEXT NOT NULL, "payload" TEXT NOT NULL, PRIMARY KEY ("table_name", "record_id"))`)

  const existing = new Set(
    (await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r.name),
  )
  for (const { table } of SYNC_TABLES) {
    if (!existing.has(table)) continue
    // v1 triggers used INSERT OR REPLACE, but SQLite lets the OUTER
    // statement's conflict handling override a trigger's: under a Prisma
    // upsert (INSERT … ON CONFLICT DO UPDATE) the REPLACE became ABORT and the
    // user's write failed when the row was already queued. DELETE + INSERT
    // never conflicts.
    for (const op of ['ins', 'upd', 'del']) await exec(`DROP TRIGGER IF EXISTS "_sync_${table}_${op}"`)
    const track = (row: 'NEW' | 'OLD') =>
      `DELETE FROM "_sync_outbox" WHERE "table_name" = '${table}' AND "record_id" = ${row}."id";` +
      ` INSERT INTO "_sync_outbox" ("table_name", "record_id", "changed_at") VALUES ('${table}', ${row}."id", ${NOW_ISO});`
    await exec(`CREATE TRIGGER IF NOT EXISTS "_sync_${table}_ins_v2" AFTER INSERT ON "${table}" WHEN ${NOT_APPLYING} BEGIN ${track('NEW')} END`)
    await exec(`CREATE TRIGGER IF NOT EXISTS "_sync_${table}_upd_v2" AFTER UPDATE ON "${table}" WHEN ${NOT_APPLYING} BEGIN ${track('NEW')} END`)
    await exec(`CREATE TRIGGER IF NOT EXISTS "_sync_${table}_del_v2" AFTER DELETE ON "${table}" WHEN ${NOT_APPLYING} BEGIN ${track('OLD')} END`)
  }
}
