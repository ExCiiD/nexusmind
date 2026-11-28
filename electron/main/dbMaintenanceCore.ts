/**
 * When to VACUUM the local database (health check of 28/11/2026). SQLite reuses the pages a delete frees but never
 * shrinks the file: 139 MB of a 494 MB file were free pages. A VACUUM rewrites the whole file (a few seconds, the
 * database is held meanwhile), so it only runs when the space to win is worth it:
 * at least VACUUM_MIN_FREE_BYTES free, and at least VACUUM_MIN_FREE_RATIO of the file.
 */
export const VACUUM_MIN_FREE_BYTES = 64 * 1024 * 1024
export const VACUUM_MIN_FREE_RATIO = 0.2

export function shouldVacuum(p: { pageSize: number; pageCount: number; freePages: number }): boolean {
  if (!(p.pageSize > 0) || !(p.pageCount > 0) || !(p.freePages > 0)) return false
  return p.freePages * p.pageSize >= VACUUM_MIN_FREE_BYTES && p.freePages / p.pageCount >= VACUUM_MIN_FREE_RATIO
}
