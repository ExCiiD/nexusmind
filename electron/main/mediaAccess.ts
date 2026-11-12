import { app } from 'electron'
import { realpathSync } from 'fs'
import { join, resolve, sep } from 'path'
import { getPrisma } from './database'

/**
 * Access control for the `nxm://` media protocol.
 *
 * The renderer may only stream a file when it is either:
 *  1. inside a folder the app owns or the user configured
 *     (userData/recordings, userData/thumbnails, User.recordingPath,
 *     User.externalRecordingPath), or
 *  2. a file the user explicitly linked, i.e. referenced by a Recording,
 *     Clip or ExternalReview row.
 *
 * Without this, any compromised renderer could read every media file on
 * disk just by building an nxm:// URL.
 */

const ROOTS_TTL_MS = 30_000
let cachedRoots: { at: number; roots: string[] } | null = null

/** Positive cache only: a path denied now may be linked a second later. */
const allowedFiles = new Set<string>()

/** Normalises a Windows path for case-insensitive prefix comparison. */
export function normalizeMediaPath(p: string): string {
  let out = resolve(p)
  try {
    out = realpathSync.native(out)
  } catch {
    /* non-existent file: keep the resolved path, the caller will 404 */
  }
  return out.toLowerCase()
}

/** True when `file` is `root` itself or lives somewhere below it. */
export function isUnderRoot(file: string, root: string): boolean {
  const r = root.endsWith(sep) ? root : root + sep
  return file === root || file.startsWith(r)
}

async function getAllowedRoots(): Promise<string[]> {
  if (cachedRoots && Date.now() - cachedRoots.at < ROOTS_TTL_MS) return cachedRoots.roots

  const userData = app.getPath('userData')
  const roots = [join(userData, 'recordings'), join(userData, 'thumbnails')]
  try {
    const users = await getPrisma().user.findMany({
      select: { recordingPath: true, externalRecordingPath: true },
    })
    for (const u of users) {
      if (u.recordingPath) roots.push(u.recordingPath)
      if (u.externalRecordingPath) roots.push(u.externalRecordingPath)
    }
  } catch (err) {
    console.warn('[nxm] could not load configured recording folders:', err)
  }

  const normalized = [...new Set(roots.map(normalizeMediaPath))]
  cachedRoots = { at: Date.now(), roots: normalized }
  return normalized
}

async function isLinkedInDatabase(normalized: string): Promise<boolean> {
  const prisma = getPrisma()
  // SQLite comparisons are case-sensitive, so fetch candidates and compare
  // normalised paths in JS. Tables are small (one row per recording/clip).
  const [recordings, clips, externals] = await Promise.all([
    prisma.recording.findMany({ select: { filePath: true, thumbnailPath: true } }),
    prisma.clip.findMany({ select: { filePath: true, thumbnailPath: true } }),
    prisma.externalReview.findMany({ select: { filePath: true } }),
  ])
  const paths: Array<string | null> = [
    ...recordings.flatMap((r) => [r.filePath, r.thumbnailPath]),
    ...clips.flatMap((c) => [c.filePath, c.thumbnailPath]),
    ...externals.map((e) => e.filePath),
  ]
  return paths.some((p) => !!p && normalizeMediaPath(p) === normalized)
}

export async function isMediaPathAllowed(filePath: string): Promise<boolean> {
  const normalized = normalizeMediaPath(filePath)
  if (allowedFiles.has(normalized)) return true

  const roots = await getAllowedRoots()
  let ok = roots.some((root) => isUnderRoot(normalized, root))
  if (!ok) {
    try {
      ok = await isLinkedInDatabase(normalized)
    } catch (err) {
      console.warn('[nxm] database lookup failed:', err)
      ok = false
    }
  }
  if (ok) allowedFiles.add(normalized)
  return ok
}

/** Files the user chose in a native open dialog during this app run. */
const userPickedFiles = new Set<string>()

export function rememberUserPickedFile(filePath: string): void {
  userPickedFiles.add(normalizeMediaPath(filePath))
}

/**
 * Gate for any IPC that *persists* a path coming from the renderer: the path
 * must either have been picked by the user in a native dialog, or already be
 * an allowed media path. This stops a compromised renderer from linking (and
 * later streaming or deleting) arbitrary files.
 */
export async function isPersistablePath(filePath: string): Promise<boolean> {
  if (userPickedFiles.has(normalizeMediaPath(filePath))) return true
  return isMediaPathAllowed(filePath)
}

/** Call after the user changes recording folders so new roots apply at once. */
export function invalidateMediaAccessCache(): void {
  cachedRoots = null
}
