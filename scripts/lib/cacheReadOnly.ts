/**
 * Read-only access to a COPY of the app's MatchCache (engine calibration scripts, 26/11/2026).
 * Never opens the live database: pass the path of a copy made in a temp folder. Opened with { readOnly: true }.
 */
import { DatabaseSync } from 'node:sqlite'
import { gunzipSync } from 'node:zlib'

const GZ = 'gz1:'
const decode = (s: string | null): string | null => {
  if (!s) return null
  if (!s.startsWith(GZ)) return s
  try { return gunzipSync(Buffer.from(s.slice(GZ.length), 'base64')).toString('utf-8') } catch { return null }
}

export interface CachedGame { matchId: string; match: any; timeline: any }

/** Every cached game whose version is 16.x (the current season), with its parsed match and timeline. */
export function* cachedCurrentGames(dbCopyPath: string, limit = Infinity): Generator<CachedGame> {
  const db = new DatabaseSync(dbCopyPath, { readOnly: true })
  try {
    const ids = db.prepare('SELECT matchId FROM MatchCache WHERE timelineJson IS NOT NULL ORDER BY createdAt DESC').all() as Array<{ matchId: string }>
    const get = db.prepare('SELECT matchJson, timelineJson FROM MatchCache WHERE matchId = ?')
    let n = 0
    for (const { matchId } of ids) {
      if (n >= limit) return
      const row = get.get(matchId) as { matchJson: string; timelineJson: string | null } | undefined
      if (!row) continue
      let match: any
      try { match = JSON.parse(decode(row.matchJson) ?? '') } catch { continue }
      const major = Number.parseInt(String(match?.info?.gameVersion ?? '').split('.')[0], 10)
      if (!(major >= 16)) continue
      const tj = decode(row.timelineJson)
      if (!tj) continue
      let timeline: any
      try { timeline = JSON.parse(tj) } catch { continue }
      n++
      yield { matchId, match, timeline }
    }
  } finally {
    db.close()
  }
}
