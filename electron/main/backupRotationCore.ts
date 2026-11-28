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
 *
 * Tightened by the health check of 28/11/2026 (still 4 files, 525 MB, a plain one of 360 MB), when `now` is given:
 * - the **second** snapshot of a kind is kept only while it is younger than SECOND_COPY_MAX_DAYS: past that, the
 *   newest one is the only safety net still worth its space;
 * - the **newest** of a kind stays plain only for PLAIN_MAX_DAYS: a failed update shows at the first launch after
 *   it, so after two days it is compressed too (gunzip restores it, ~4 times smaller).
 * The newest snapshot of each kind is never deleted, whatever its age.
 */

export type SnapshotKind = 'migration' | 'delete'

export interface SnapshotFile { name: string; mtimeMs: number }

export const KEEP_PER_KIND = 2
export const SECOND_COPY_MAX_DAYS = 14
export const PLAIN_MAX_DAYS = 2

const DAY_MS = 86_400_000
const SNAPSHOT = /^nexusmind-.+\.db(\.gz)?$/

export function snapshotKind(name: string): SnapshotKind | null {
  if (!SNAPSHOT.test(name) || /-keep\.db(\.gz)?$/.test(name)) return null
  if (name.includes('-before-delete-')) return 'delete'
  if (/-before-\d{14}_/.test(name)) return 'migration'
  return null
}

/**
 * What to do with the snapshots in the folder: delete the old ones, compress the kept ones but the newest.
 * Without `now` only the count rule applies (the behaviour before 28/11); with it, the age rules above too.
 */
export function planBackupRotation(files: SnapshotFile[], keep = KEEP_PER_KIND, now?: number): { remove: string[]; compress: string[] } {
  const remove: string[] = []
  const compress: string[] = []
  const age = (f: SnapshotFile) => (now === undefined ? 0 : (now - f.mtimeMs) / DAY_MS)
  for (const kind of ['migration', 'delete'] as const) {
    const ofKind = files.filter((f) => snapshotKind(f.name) === kind).sort((a, b) => b.mtimeMs - a.mtimeMs)
    const kept = ofKind.slice(0, keep).filter((f, i) => i === 0 || age(f) <= SECOND_COPY_MAX_DAYS)
    ofKind.filter((f) => !kept.includes(f)).forEach((f) => remove.push(f.name))
    kept
      .filter((f, i) => f.name.endsWith('.db') && (i > 0 || (now !== undefined && age(f) > PLAIN_MAX_DAYS)))
      .forEach((f) => compress.push(f.name))
  }
  return { remove, compress }
}
