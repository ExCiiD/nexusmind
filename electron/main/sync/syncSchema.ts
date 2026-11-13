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
    const track = (row: 'NEW' | 'OLD') =>
      `INSERT OR REPLACE INTO "_sync_outbox" ("table_name", "record_id", "changed_at") VALUES ('${table}', ${row}."id", ${NOW_ISO});`
    await exec(`CREATE TRIGGER IF NOT EXISTS "_sync_${table}_ins" AFTER INSERT ON "${table}" WHEN ${NOT_APPLYING} BEGIN ${track('NEW')} END`)
    await exec(`CREATE TRIGGER IF NOT EXISTS "_sync_${table}_upd" AFTER UPDATE ON "${table}" WHEN ${NOT_APPLYING} BEGIN ${track('NEW')} END`)
    await exec(`CREATE TRIGGER IF NOT EXISTS "_sync_${table}_del" AFTER DELETE ON "${table}" WHEN ${NOT_APPLYING} BEGIN ${track('OLD')} END`)
  }
}
