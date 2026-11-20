/**
 * Reads the real match id of the game being played from the League client's game log (gameLogCore.ts).
 * Best effort: any missing folder or unreadable file gives null, and the post-game chain falls back to the
 * account's match list.
 */
import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from 'fs'
import { join } from 'path'
import { leagueDirsFromInstalls, parseGameLog, pickGameLogFolder, type GameLogRef } from './gameLogCore'

const INSTALLS_FILE = 'C:/ProgramData/Riot Games/RiotClientInstalls.json'
const DEFAULT_DIRS = ['C:/Riot Games/League of Legends']
/** The command line is in the first lines: 64 KB is plenty. */
const HEAD_BYTES = 64 * 1024

function leagueDirs(): string[] {
  let fromInstalls: string[] = []
  try {
    if (existsSync(INSTALLS_FILE)) fromInstalls = leagueDirsFromInstalls(JSON.parse(readFileSync(INSTALLS_FILE, 'utf-8')))
  } catch { /* unreadable: defaults only */ }
  return [...new Set([...fromInstalls, ...DEFAULT_DIRS])]
}

function readHead(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, n).toString('utf-8')
  } finally {
    closeSync(fd)
  }
}

/** The match of the game that started around `startedAtMs`, or null. */
export function readGameLogRef(startedAtMs: number): GameLogRef | null {
  for (const dir of leagueDirs()) {
    try {
      const logs = join(dir, 'Logs', 'GameLogs')
      if (!existsSync(logs)) continue
      const folders = readdirSync(logs).map((name) => {
        try { return { name, mtimeMs: statSync(join(logs, name)).mtimeMs } } catch { return { name, mtimeMs: 0 } }
      })
      const folder = pickGameLogFolder(folders, startedAtMs)
      if (!folder) continue
      const file = readdirSync(join(logs, folder)).find((f) => f.endsWith('_r3dlog.txt'))
      if (!file) continue
      const ref = parseGameLog(readHead(join(logs, folder, file)))
      if (ref) return ref
    } catch { /* next folder */ }
  }
  return null
}

/** The matches of every game log written since `sinceMs`, newest first (start-up catch-up). */
export function readRecentGameLogRefs(sinceMs: number, max = 30): GameLogRef[] {
  const out: GameLogRef[] = []
  for (const dir of leagueDirs()) {
    try {
      const logs = join(dir, 'Logs', 'GameLogs')
      if (!existsSync(logs)) continue
      const folders = readdirSync(logs)
        .map((name) => { try { return { name, mtimeMs: statSync(join(logs, name)).mtimeMs } } catch { return { name, mtimeMs: 0 } } })
        .filter((f) => f.mtimeMs >= sinceMs)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, max)
      for (const f of folders) {
        try {
          const file = readdirSync(join(logs, f.name)).find((x) => x.endsWith('_r3dlog.txt'))
          const ref = file ? parseGameLog(readHead(join(logs, f.name, file))) : null
          if (ref && !out.some((r) => r.matchId === ref.matchId)) out.push(ref)
        } catch { /* next */ }
      }
    } catch { /* next install */ }
  }
  return out
}
