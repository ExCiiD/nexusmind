/**
 * Local database snapshots in `<data>/backups` (AUDIT_PERF_2 gain 9, 20/11/2026): which to keep, which to compress.
 *
 * The folder had reached 1.7 GB (5 snapshots of 230-490 MB, plus the `before-delete-*` ones, never rotated).
 * - **Kinds**, rotated apart: `migration` (`…-before-<version>_<name>.db`) and `delete` (`…-before-delete-….db`).
 *   The 2 newest of each kind are kept.
 * - **Never deleted**: a name ending in `-keep.db` / `-keep.db.gz` (a snapshot the player asked to keep), and any
 *   file that is not a snapshot of this app.
 * - **Compressed**: every kept snapshot except the newest of its kind. After a failed update the newest is the
 *   one to restore, so it stays a plain `.db` that can be copied back as it is.
 */

export type SnapshotKind = 'migration' | 'delete'

export interface SnapshotFile { name: string; mtimeMs: number }

export const KEEP_PER_KIND = 2

const SNAPSHOT = /^nexusmind-.+\.db(\.gz)?$/

export function snapshotKind(name: string): SnapshotKind | null {
  if (!SNAPSHOT.test(name) || /-keep\.db(\.gz)?$/.test(name)) return null
  if (name.includes('-before-delete-')) return 'delete'
  if (/-before-\d{14}_/.test(name)) return 'migration'
  return null
}

/** What to do with the snapshots in the folder: delete the old ones, compress the kept ones but the newest. */
export function planBackupRotation(files: SnapshotFile[], keep = KEEP_PER_KIND): { remove: string[]; compress: string[] } {
  const remove: string[] = []
  const compress: string[] = []
  for (const kind of ['migration', 'delete'] as const) {
    const ofKind = files.filter((f) => snapshotKind(f.name) === kind).sort((a, b) => b.mtimeMs - a.mtimeMs)
    ofKind.slice(keep).forEach((f) => remove.push(f.name))
    ofKind.slice(1, keep).filter((f) => f.name.endsWith('.db')).forEach((f) => compress.push(f.name))
  }
  return { remove, compress }
}
