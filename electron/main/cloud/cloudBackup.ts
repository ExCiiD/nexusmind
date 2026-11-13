import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getSupabase, getAccessToken } from './supabase'
import { getPrisma } from '../database'
import {
  BACKUP_VERSION,
  buildBackupPayload,
  countRows,
  decodeBackup,
  encodeBackup,
  importBackupPayload,
  type ImportSummary,
} from '../backup/backupCore'

/** Cloud copies kept per account (oldest pruned first). */
export const MAX_CLOUD_BACKUPS = 10
/** Supabase free plan: 50 MB per object. */
const MAX_BACKUP_BYTES = 50 * 1024 * 1024
const AUTO_BACKUP_EVERY_MS = 24 * 60 * 60 * 1000

export interface CloudBackupRow {
  id: string
  created_at: string
  size_bytes: number
  app_version: string | null
  device: string | null
  counts: Record<string, number>
}

function statePath(): string {
  return join(app.getPath('userData'), 'cloud-state.json')
}

export function getLastCloudBackupAt(): string | null {
  try {
    return existsSync(statePath()) ? (JSON.parse(readFileSync(statePath(), 'utf-8')).lastBackupAt ?? null) : null
  } catch {
    return null
  }
}

function setLastCloudBackupAt(iso: string): void {
  try { writeFileSync(statePath(), JSON.stringify({ lastBackupAt: iso })) } catch { /* non-fatal */ }
}

async function requireUserId(): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new Error('LOGIN_REQUIRED')
  const { data } = await getSupabase().auth.getUser(token)
  if (!data.user) throw new Error('LOGIN_REQUIRED')
  return data.user.id
}

export async function createCloudBackup(): Promise<CloudBackupRow> {
  const uid = await requireUserId()
  const payload = await buildBackupPayload({ forCloud: true })
  const buf = encodeBackup(payload)
  if (buf.length > MAX_BACKUP_BYTES) {
    throw new Error(`Backup is too large for the cloud (${Math.round(buf.length / 1048576)} MB > 50 MB).`)
  }

  const sb = getSupabase()
  const path = `${uid}/${new Date().toISOString().replace(/[:.]/g, '-')}.nexusmind`
  const up = await sb.storage.from('backups').upload(path, buf, { contentType: 'application/gzip', upsert: false })
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`)

  const counts = countRows(payload)
  const { data, error } = await sb
    .from('cloud_backups')
    .insert({
      user_id: uid,
      storage_path: path,
      size_bytes: buf.length,
      format_version: BACKUP_VERSION,
      app_version: payload.manifest.appVersion,
      device: payload.manifest.deviceId,
      counts,
    })
    .select('id, created_at, size_bytes, app_version, device, counts')
    .single()
  if (error) {
    await sb.storage.from('backups').remove([path])
    throw new Error(`Could not record backup: ${error.message}`)
  }

  setLastCloudBackupAt(data.created_at)
  await pruneOldBackups().catch((err) => console.warn('[cloud-backup] prune failed:', err?.message))
  return data as CloudBackupRow
}

export async function listCloudBackups(): Promise<CloudBackupRow[]> {
  await requireUserId()
  const { data, error } = await getSupabase()
    .from('cloud_backups')
    .select('id, created_at, size_bytes, app_version, device, counts')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as CloudBackupRow[]
}

export async function restoreCloudBackup(id: string): Promise<ImportSummary> {
  await requireUserId()
  const sb = getSupabase()
  const { data: row, error } = await sb.from('cloud_backups').select('storage_path').eq('id', id).single()
  if (error || !row) throw new Error('Backup not found')
  const dl = await sb.storage.from('backups').download(row.storage_path)
  if (dl.error || !dl.data) throw new Error(`Download failed: ${dl.error?.message ?? 'empty file'}`)
  const buf = Buffer.from(await dl.data.arrayBuffer())
  return importBackupPayload(decodeBackup(buf))
}

export async function deleteCloudBackup(id: string): Promise<void> {
  await requireUserId()
  const sb = getSupabase()
  const { data: row } = await sb.from('cloud_backups').select('storage_path').eq('id', id).single()
  if (!row) return
  await sb.storage.from('backups').remove([row.storage_path])
  await sb.from('cloud_backups').delete().eq('id', id)
}

async function pruneOldBackups(): Promise<void> {
  const sb = getSupabase()
  const { data } = await sb.from('cloud_backups').select('id, storage_path').order('created_at', { ascending: false })
  const stale = (data ?? []).slice(MAX_CLOUD_BACKUPS)
  if (stale.length === 0) return
  await sb.storage.from('backups').remove(stale.map((r) => r.storage_path))
  await sb.from('cloud_backups').delete().in('id', stale.map((r) => r.id))
}

/**
 * Daily automatic backup: runs at startup and then every hour, uploading
 * only when signed in, onboarded, and the last backup is older than 24 h.
 */
export function startAutoCloudBackup(): void {
  const tick = async () => {
    try {
      if (!(await getAccessToken())) return
      const user = await getPrisma().user.findFirst({ where: { isActive: true } })
      if (!user) return
      const last = getLastCloudBackupAt()
      if (last && Date.now() - new Date(last).getTime() < AUTO_BACKUP_EVERY_MS) return
      const row = await createCloudBackup()
      console.log(`[cloud-backup] automatic backup done (${row.size_bytes} bytes)`)
    } catch (err) {
      console.warn('[cloud-backup] automatic backup skipped:', (err as Error)?.message)
    }
  }
  setTimeout(tick, 60_000)
  setInterval(tick, 60 * 60 * 1000)
}
