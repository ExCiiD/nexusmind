import { randomUUID } from 'crypto'
import type { PrismaClient } from '../../../prisma-client'
import { SYNC_TABLES, specFor, tableOrder, type SyncTableSpec } from './syncSchema'

/**
 * Local-first, last-write-wins sync between this PC's SQLite database and
 * the user's `sync_records` on the server.
 *
 *  push: rows listed in `_sync_outbox` (filled by triggers) are serialized
 *        and upserted; a missing row becomes a tombstone.
 *  pull: records after our cursor (server `seq`) are applied, parents first.
 *        Our own echoes are skipped. A row we changed more recently than the
 *        remote version is kept (it will be pushed).
 *
 * Rows whose parent hasn't arrived yet wait in `_sync_inbox` and are retried.
 */

export interface RemoteRecord {
  table_name: string
  record_id: string
  data: Record<string, unknown> | null
  deleted: boolean
  updated_at: string
  device_id: string | null
  seq: number
}

export interface PushRecord {
  t: string
  id: string
  data?: Record<string, unknown>
  del?: boolean
  at: string
  dev: string
}

export interface SyncRemote {
  push(records: PushRecord[]): Promise<void>
  pull(afterSeq: number, limit: number): Promise<RemoteRecord[]>
  getRecord(table: string, id: string): Promise<RemoteRecord | null>
}

export type SyncPhase = 'idle' | 'syncing' | 'error' | 'blocked'
export interface SyncStatus {
  phase: SyncPhase
  pending: number
  lastSyncAt: string | null
  /** Stable code for the renderer (i18n). */
  error: string | null
}

export interface SyncResult {
  pushed: number
  pulled: number
  appliedTables: string[]
}

const PUSH_BATCH = 200
const PULL_PAGE = 500
const PROFILE_TABLE = '_profile'

export class SyncError extends Error {
  constructor(public readonly code: 'DIFFERENT_PLAYER' | 'MULTIPLE_LOCAL_PROFILES' | 'NO_LOCAL_PROFILE', message: string) {
    super(message)
  }
}

/** JSON-safe copy of a raw SQLite row (BigInt → number, Date → epoch ms, Buffer dropped). */
export function serializeRow(row: Record<string, unknown>, omit: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (omit.includes(k)) continue
    if (typeof v === 'bigint') out[k] = Number(v)
    else if (v instanceof Date) out[k] = v.getTime()
    else if (v instanceof Uint8Array) continue
    else out[k] = v
  }
  return out
}

export class SyncEngine {
  private columnsCache = new Map<string, string[]>()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly remote: SyncRemote,
    private readonly cloudUserId: string,
  ) {}

  // ── small SQL helpers ────────────────────────────────────────────────────

  private q<T = any>(sql: string, ...args: unknown[]): Promise<T[]> {
    return this.prisma.$queryRawUnsafe<T[]>(sql, ...args)
  }
  private x(sql: string, ...args: unknown[]): Promise<number> {
    return this.prisma.$executeRawUnsafe(sql, ...args)
  }

  async getState(key: string): Promise<string | null> {
    const rows = await this.q<{ value: string | null }>(`SELECT value FROM "_sync_state" WHERE key = ?`, key)
    return rows[0]?.value ?? null
  }
  async setState(key: string, value: string | null): Promise<void> {
    await this.x(`INSERT INTO "_sync_state" (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
  }

  private async columns(table: string): Promise<string[]> {
    if (!this.columnsCache.has(table)) {
      const info = await this.q<{ name: string }>(`PRAGMA table_info("${table}")`)
      this.columnsCache.set(table, info.map((c) => c.name))
    }
    return this.columnsCache.get(table)!
  }

  private async mapId(table: string, remoteId: unknown): Promise<unknown> {
    if (typeof remoteId !== 'string' || !remoteId) return remoteId
    const rows = await this.q<{ local_id: string }>(
      `SELECT local_id FROM "_sync_idmap" WHERE table_name = ? AND remote_id = ?`, table, remoteId,
    )
    return rows[0]?.local_id ?? remoteId
  }

  async pendingCount(): Promise<number> {
    const rows = await this.q<{ n: number | bigint }>(`SELECT COUNT(*) AS n FROM "_sync_outbox"`)
    return Number(rows[0]?.n ?? 0)
  }

  private async deviceId(): Promise<string> {
    let id = await this.getState('device_id')
    if (!id) {
      id = randomUUID()
      await this.setState('device_id', id)
    }
    return id
  }

  // ── preparation ──────────────────────────────────────────────────────────

  private async localUser(): Promise<{ id: string; puuid: string }> {
    const users = await this.q<{ id: string; puuid: string }>(`SELECT id, puuid FROM "User"`)
    if (users.length === 0) throw new SyncError('NO_LOCAL_PROFILE', 'Connect your Riot account first.')
    if (users.length > 1) {
      throw new SyncError('MULTIPLE_LOCAL_PROFILES', 'Sync is only available with a single local profile on this PC.')
    }
    return users[0]
  }

  /**
   * First sync for this cloud account on this PC: reset the cursor and queue
   * every existing row, stamped with its own last-modified time so it never
   * overrides newer edits made on another device.
   */
  private async bootstrapIfNeeded(): Promise<void> {
    if ((await this.getState('owner_uid')) === this.cloudUserId) return
    await this.x(`DELETE FROM "_sync_idmap"`)
    await this.x(`DELETE FROM "_sync_inbox"`)
    await this.setState('cursor', '0')
    for (const { table } of SYNC_TABLES) {
      const cols = await this.columns(table)
      if (cols.length === 0) continue
      const stamp = cols.includes('updatedAt') ? 'updatedAt' : cols.includes('createdAt') ? 'createdAt' : null
      const rows = await this.q<{ id: string; ts: unknown }>(`SELECT id, ${stamp ? `"${stamp}"` : 'NULL'} AS ts FROM "${table}"`)
      for (const r of rows) {
        await this.x(
          `INSERT OR IGNORE INTO "_sync_outbox" (table_name, record_id, changed_at) VALUES (?, ?, ?)`,
          table, r.id, toIso(r.ts),
        )
      }
    }
    await this.setState('owner_uid', this.cloudUserId)
  }

  /** One cloud account = one Riot player: refuse to merge another player's history. */
  private async checkOwner(puuid: string): Promise<void> {
    const profile = await this.remote.getRecord(PROFILE_TABLE, 'owner')
    if (!profile || profile.deleted) {
      await this.remote.push([{ t: PROFILE_TABLE, id: 'owner', data: { puuid }, at: new Date().toISOString(), dev: await this.deviceId() }])
      return
    }
    if ((profile.data as any)?.puuid !== puuid) {
      throw new SyncError('DIFFERENT_PLAYER', 'This Ascend account already syncs another Riot player.')
    }
  }

  // ── push ─────────────────────────────────────────────────────────────────

  async push(): Promise<number> {
    const dev = await this.deviceId()
    let total = 0
    for (;;) {
      const batch = await this.q<{ table_name: string; record_id: string; changed_at: string }>(
        `SELECT table_name, record_id, changed_at FROM "_sync_outbox" ORDER BY changed_at LIMIT ${PUSH_BATCH}`,
      )
      if (batch.length === 0) break
      batch.sort((a, b) => tableOrder(a.table_name) - tableOrder(b.table_name))

      const records: PushRecord[] = []
      for (const item of batch) {
        const spec = specFor(item.table_name)
        if (!spec) continue
        const rows = await this.q<Record<string, unknown>>(`SELECT * FROM "${item.table_name}" WHERE id = ?`, item.record_id)
        records.push(
          rows[0]
            ? { t: item.table_name, id: item.record_id, data: serializeRow(rows[0], spec.localColumns), at: item.changed_at, dev }
            : { t: item.table_name, id: item.record_id, del: true, at: item.changed_at, dev },
        )
      }
      if (records.length > 0) await this.remote.push(records)

      // Only clear entries that didn't change again while we were pushing.
      for (const item of batch) {
        await this.x(
          `DELETE FROM "_sync_outbox" WHERE table_name = ? AND record_id = ? AND changed_at = ?`,
          item.table_name, item.record_id, item.changed_at,
        )
      }
      total += records.length
      if (batch.length < PUSH_BATCH) break
    }
    return total
  }

  // ── pull / apply ─────────────────────────────────────────────────────────

  async pull(): Promise<{ count: number; tables: Set<string> }> {
    const dev = await this.deviceId()
    const tables = new Set<string>()
    let cursor = Number((await this.getState('cursor')) ?? '0')
    let count = 0

    for (;;) {
      const page = await this.remote.pull(cursor, PULL_PAGE)
      if (page.length === 0) break
      const toApply = page
        .filter((r) => r.device_id !== dev && r.table_name !== PROFILE_TABLE && specFor(r.table_name))
        .sort((a, b) => tableOrder(a.table_name) - tableOrder(b.table_name) || a.seq - b.seq)

      await this.withApplying(async () => {
        for (const rec of toApply) {
          if (await this.applyRecord(rec)) {
            tables.add(rec.table_name)
            count++
          }
        }
      })
      cursor = Math.max(cursor, ...page.map((r) => r.seq))
      await this.setState('cursor', String(cursor))
      if (page.length < PULL_PAGE) break
    }

    // Retry rows that were waiting for a parent.
    const waiting = await this.q<{ payload: string }>(`SELECT payload FROM "_sync_inbox"`)
    if (waiting.length > 0) {
      const recs = waiting.map((w) => JSON.parse(w.payload) as RemoteRecord)
        .sort((a, b) => tableOrder(a.table_name) - tableOrder(b.table_name))
      await this.withApplying(async () => {
        for (const rec of recs) {
          if (await this.applyRecord(rec)) { tables.add(rec.table_name); count++ }
        }
      })
    }
    return { count, tables }
  }

  private async withApplying(fn: () => Promise<void>): Promise<void> {
    await this.x(`UPDATE "_sync_control" SET applying = 1 WHERE id = 1`)
    try { await fn() } finally {
      await this.x(`UPDATE "_sync_control" SET applying = 0 WHERE id = 1`)
    }
  }

  /** Applies one remote record. Returns true when the local DB changed. */
  async applyRecord(rec: RemoteRecord): Promise<boolean> {
    const spec = specFor(rec.table_name)!
    const table = spec.table
    const localId = String(await this.mapId(table, rec.record_id))

    // Local edit newer than the remote one: keep ours (it is queued for push).
    const pending = await this.q<{ changed_at: string }>(
      `SELECT changed_at FROM "_sync_outbox" WHERE table_name = ? AND record_id = ?`, table, localId,
    )
    if (pending[0] && pending[0].changed_at > rec.updated_at) return false

    if (rec.deleted) {
      const n = await this.x(`DELETE FROM "${table}" WHERE id = ?`, localId)
      await this.x(`DELETE FROM "_sync_inbox" WHERE table_name = ? AND record_id = ?`, table, rec.record_id)
      return n > 0
    }

    const row = await this.prepareRow(spec, rec.data ?? {})
    row.id = localId
    try {
      const changed = await this.upsertRow(spec, row)
      await this.x(`DELETE FROM "_sync_inbox" WHERE table_name = ? AND record_id = ?`, table, rec.record_id)
      return changed
    } catch (err) {
      const msg = String((err as Error)?.message ?? err)
      if (/UNIQUE constraint failed/i.test(msg) && spec.naturalKey) {
        const existingId = await this.findByNaturalKey(spec, row)
        if (existingId && existingId !== localId) {
          await this.x(
            `INSERT OR REPLACE INTO "_sync_idmap" (table_name, remote_id, local_id) VALUES (?, ?, ?)`,
            table, rec.record_id, existingId,
          )
          row.id = existingId
          const changed = await this.upsertRow(spec, row)
          await this.x(`DELETE FROM "_sync_inbox" WHERE table_name = ? AND record_id = ?`, table, rec.record_id)
          return changed
        }
      }
      if (/FOREIGN KEY constraint failed/i.test(msg)) {
        await this.x(
          `INSERT OR REPLACE INTO "_sync_inbox" (table_name, record_id, payload) VALUES (?, ?, ?)`,
          table, rec.record_id, JSON.stringify(rec),
        )
        return false
      }
      throw err
    }
  }

  private async prepareRow(spec: SyncTableSpec, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const cols = new Set(await this.columns(spec.table))
    const row: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      if (cols.has(k) && !spec.localColumns?.includes(k)) row[k] = v
    }
    const user = await this.localUser()
    for (const c of spec.userColumns ?? []) if (cols.has(c)) row[c] = user.id
    for (const [col, parent] of Object.entries(spec.fks ?? {})) {
      if (col in row) row[col] = await this.mapId(parent, row[col])
    }
    return row
  }

  private async upsertRow(spec: SyncTableSpec, row: Record<string, unknown>): Promise<boolean> {
    const keys = Object.keys(row)
    const exists = (await this.q(`SELECT 1 FROM "${spec.table}" WHERE id = ?`, row.id)).length > 0
    if (exists) {
      const set = keys.filter((k) => k !== 'id')
      if (set.length === 0) return false
      await this.x(
        `UPDATE "${spec.table}" SET ${set.map((k) => `"${k}" = ?`).join(', ')} WHERE id = ?`,
        ...set.map((k) => row[k]), row.id,
      )
      return true
    }
    await this.x(
      `INSERT INTO "${spec.table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      ...keys.map((k) => row[k]),
    )
    return true
  }

  private async findByNaturalKey(spec: SyncTableSpec, row: Record<string, unknown>): Promise<string | null> {
    const nk = spec.naturalKey!
    if (nk.some((k) => !(k in row))) return null
    const rows = await this.q<{ id: string }>(
      `SELECT id FROM "${spec.table}" WHERE ${nk.map((k) => `"${k}" IS ?`).join(' AND ')} LIMIT 1`,
      ...nk.map((k) => row[k]),
    )
    return rows[0]?.id ?? null
  }

  // ── full cycle ───────────────────────────────────────────────────────────

  async syncOnce(): Promise<SyncResult> {
    const user = await this.localUser()
    await this.bootstrapIfNeeded()
    await this.checkOwner(user.puuid)
    const pushed = await this.push()
    const { count, tables } = await this.pull()
    await this.setState('last_sync_at', new Date().toISOString())
    return { pushed, pulled: count, appliedTables: [...tables] }
  }
}

function toIso(ts: unknown): string {
  if (ts === null || ts === undefined) return '1970-01-01T00:00:00.000Z'
  const n = typeof ts === 'bigint' ? Number(ts) : ts instanceof Date ? ts.getTime() : typeof ts === 'number' ? ts : Date.parse(String(ts))
  return Number.isFinite(n) ? new Date(n).toISOString() : '1970-01-01T00:00:00.000Z'
}
