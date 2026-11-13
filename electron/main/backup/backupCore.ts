import { app } from 'electron'
import { hostname } from 'os'
import { gzipSync, gunzipSync } from 'zlib'
import { getPrisma, getPrismaNamespace } from '../database'

/**
 * NexusMind backup format
 * ───────────────────────
 * A gzipped JSON payload `{ manifest, tables }`, shared by the `.nexusmind`
 * file export and the cloud backup. Imports MERGE into the local database
 * (nothing local is overwritten) and are portable across app versions:
 * only columns that exist in the current schema are written, so a backup
 * made by a newer or older version still imports.
 *
 * Never included: video files, Riot MatchCache in cloud backups
 * (re-downloadable, ~100 KB per match), Discord webhook URLs (secrets).
 */

export const BACKUP_VERSION = 2

export interface BackupManifest {
  version: number
  exportedAt: string
  deviceId: string
  appVersion: string
  displayName: string
  puuid: string
}

export interface BackupPayload {
  manifest: BackupManifest
  tables: Record<string, any[]>
}

export interface ImportSummary {
  added: Record<string, number>
  skipped: number
  conflicts: number
}

type Delegate = {
  findMany: (args?: any) => Promise<any[]>
  findUnique: (args: any) => Promise<any>
  findFirst: (args: any) => Promise<any>
  create: (args: any) => Promise<any>
}

interface TableSpec {
  /** Prisma model name (also the key in `tables`). */
  model: string
  /** Where-clause identifying an already-present row (dedupe). Defaults to `{ id }`. */
  existing?: (row: any, ctx: ImportContext) => any
  /** Foreign keys: field -> parent model. Rows whose parent is absent are skipped. */
  parents?: Record<string, string>
  /** Optional FKs: set to null when the parent is absent instead of skipping. */
  optionalParents?: Record<string, string>
  /** The row's user FK, remapped to the local user. */
  userField?: string
  /** Fields reset on import (machine-local paths…). */
  nullify?: string[]
  /** Runs after a successful create. */
  after?: (row: any, ctx: ImportContext) => Promise<void>
  /** Included in cloud backups? (file exports always include everything listed). */
  cloud?: boolean
}

interface ImportContext {
  localUserId: string
  /** model -> (source id -> local id) for rows that already existed under another id. */
  idMap: Map<string, Map<string, string>>
}

/**
 * Import order matters: parents before children.
 * Tables NOT listed here are never exported (e.g. DiscordWebhook, Clip).
 */
const TABLES: TableSpec[] = [
  { model: 'Account', userField: 'userId', existing: (r) => ({ puuid: r.puuid }) },
  { model: 'Session', userField: 'userId' },
  { model: 'Game', parents: { sessionId: 'Session' }, existing: (r) => ({ matchId: r.matchId }) },
  { model: 'MatchCache', existing: (r) => ({ matchId: r.matchId }), cloud: false },
  { model: 'GameDetailedStats', parents: { gameId: 'Game' }, existing: (r, c) => ({ gameId: mapId(c, 'Game', r.gameId) }) },
  {
    model: 'Review',
    parents: { gameId: 'Game' },
    existing: (r, c) => ({ gameId: mapId(c, 'Game', r.gameId) }),
    after: async (r, c) => {
      await (getPrisma() as any).game.update({ where: { id: mapId(c, 'Game', r.gameId) }, data: { reviewStatus: 'reviewed' } })
    },
  },
  { model: 'Assessment', userField: 'userId' },
  { model: 'AssessmentScore', parents: { assessmentId: 'Assessment' } },
  { model: 'StatsSnapshot', userField: 'userId' },
  { model: 'Badge', userField: 'userId', existing: (r, c) => ({ userId: c.localUserId, badgeId: r.badgeId }) },
  { model: 'ExternalReview', userField: 'userId', nullify: ['filePath'] },
  {
    model: 'Recording',
    optionalParents: { gameId: 'Game' },
    nullify: ['filePath', 'thumbnailPath'],
    existing: (r, c) => (r.gameId ? { gameId: mapId(c, 'Game', r.gameId) } : { id: r.id }),
  },
  { model: 'Bookmark', parents: { recordingId: 'Recording' } },
  { model: 'Team', userField: 'userId' },
  { model: 'TeamMember', parents: { teamId: 'Team' } },
  {
    model: 'ChampionPoolEntry',
    parents: { memberId: 'TeamMember' },
    existing: (r, c) => ({ memberId: mapId(c, 'TeamMember', r.memberId), championKey: r.championKey, role: r.role }),
  },
  { model: 'CustomGame', parents: { teamId: 'Team' } },
  { model: 'DraftPrep', userField: 'userId', optionalParents: { vsTeamId: 'Team' } },
  { model: 'MistakeTag', existing: (r) => ({ slug: r.slug }) },
  {
    model: 'AssistantFeedback',
    userField: 'userId',
    existing: (r, c) => ({ userId: c.localUserId, insightKey: r.insightKey }),
  },
  {
    model: 'Mistake',
    parents: { gameId: 'Game', tagId: 'MistakeTag' },
    optionalParents: { recordingId: 'Recording' },
  },
]

function mapId(ctx: ImportContext, model: string, id: string | null | undefined): string | null | undefined {
  if (!id) return id
  return ctx.idMap.get(model)?.get(id) ?? id
}

function delegateFor(model: string): Delegate {
  const key = model.charAt(0).toLowerCase() + model.slice(1)
  const d = (getPrisma() as any)[key]
  if (!d) throw new Error(`Unknown Prisma model: ${model}`)
  return d as Delegate
}

/** Scalar column names of a model in the *current* schema. */
function scalarFields(model: string): Set<string> {
  const m = getPrismaNamespace().dmmf.datamodel.models.find((x: any) => x.name === model)
  if (!m) return new Set()
  return new Set(m.fields.filter((f: any) => f.kind === 'scalar' || f.kind === 'enum').map((f: any) => f.name))
}

// ── Export ─────────────────────────────────────────────────────────────────

export async function buildBackupPayload(opts: { forCloud: boolean }): Promise<BackupPayload> {
  const prisma = getPrisma()
  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) throw new Error('No active user to back up')

  const tables: Record<string, any[]> = { User: [user] }
  for (const spec of TABLES) {
    if (opts.forCloud && spec.cloud === false) continue
    tables[spec.model] = await delegateFor(spec.model).findMany()
  }

  return {
    manifest: {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      deviceId: hostname(),
      appVersion: app.getVersion(),
      displayName: user.displayName || user.summonerName,
      puuid: user.puuid,
    },
    tables,
  }
}

export function encodeBackup(payload: BackupPayload): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(payload), 'utf-8'), { level: 9 })
}

export function decodeBackup(buf: Buffer): BackupPayload {
  let payload: BackupPayload
  try {
    payload = JSON.parse(gunzipSync(buf).toString('utf-8'))
  } catch (err) {
    throw new Error(`Invalid or corrupted backup: ${(err as Error).message}`)
  }
  if (!payload?.manifest || !payload.tables) throw new Error('Invalid backup: missing manifest')
  if (payload.manifest.version > BACKUP_VERSION) {
    throw new Error(`Backup made by a newer NexusMind (format v${payload.manifest.version}). Update the app first.`)
  }
  return payload
}

export function countRows(payload: BackupPayload): Record<string, number> {
  return Object.fromEntries(Object.entries(payload.tables).map(([k, v]) => [k, v?.length ?? 0]))
}

// ── Import (merge) ───────────────────────────────────────────────────────────

export async function importBackupPayload(payload: BackupPayload): Promise<ImportSummary> {
  const prisma = getPrisma()
  const localUser = await prisma.user.findFirst({ where: { isActive: true } })
  if (!localUser) throw new Error('No active user on this PC — connect your Riot account first, then restore.')

  // Merging another player's history into this profile would corrupt analytics.
  const sourcePuuid = payload.manifest.puuid ?? payload.tables.User?.[0]?.puuid
  const sameOwner = sourcePuuid === localUser.puuid || payload.tables.User?.some((u) => u.puuid === localUser.puuid)
  if (!sameOwner) throw new Error('This backup belongs to a different Riot account. It cannot be merged into this profile.')

  const ctx: ImportContext = { localUserId: localUser.id, idMap: new Map() }
  const summary: ImportSummary = { added: {}, skipped: 0, conflicts: 0 }

  for (const spec of TABLES) {
    const rows = payload.tables[spec.model] ?? []
    if (rows.length === 0) continue
    const delegate = delegateFor(spec.model)
    const fields = scalarFields(spec.model)
    const map = new Map<string, string>()
    ctx.idMap.set(spec.model, map)

    for (const src of rows) {
      try {
        // 1. Parents: remap, then require (or null out) their presence.
        const row = { ...src }
        let orphan = false
        for (const [field, parent] of Object.entries(spec.parents ?? {})) {
          row[field] = mapId(ctx, parent, row[field])
          if (!row[field] || !(await delegateFor(parent).findUnique({ where: { id: row[field] } }))) orphan = true
        }
        if (orphan) { summary.skipped++; continue }
        for (const [field, parent] of Object.entries(spec.optionalParents ?? {})) {
          row[field] = mapId(ctx, parent, row[field])
          if (row[field] && !(await delegateFor(parent).findUnique({ where: { id: row[field] } }))) row[field] = null
        }
        if (spec.userField) row[spec.userField] = ctx.localUserId
        for (const f of spec.nullify ?? []) if (f in row) row[f] = null

        // 2. Dedupe: keep the local row, remember its id for children.
        const where = spec.existing ? spec.existing(src, ctx) : { id: src.id }
        const existing = await delegate.findFirst({ where })
        if (existing) {
          if (existing.id !== src.id) map.set(src.id, existing.id)
          summary.skipped++
          continue
        }

        // 3. Insert only the columns this schema knows about.
        const data: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(row)) if (fields.has(k) && v !== undefined) data[k] = v
        await delegate.create({ data })
        await spec.after?.(src, ctx)
        summary.added[spec.model] = (summary.added[spec.model] ?? 0) + 1
      } catch (err) {
        summary.conflicts++
        console.warn(`[backup:import] ${spec.model} ${src?.id}:`, (err as Error)?.message)
      }
    }
  }
  return summary
}
