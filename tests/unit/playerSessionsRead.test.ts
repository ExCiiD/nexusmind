/**
 * WSC-08 (20/11/2026): "Mes revues" reads the Session rows, then only the games of the latest sessions, then only
 * their reviews, filtered on the server, instead of up to 5 000 rows.
 */
import { describe, it, expect } from 'vitest'
import { getPlayerSessions } from '../../src/lib/collabCore'

type Row = { user_id: string; table_name: string; record_id: string; deleted: boolean; data: any }

/** A tiny PostgREST stand-in: eq / in (json paths too) / limit, and a log of what each request asked for. */
function fakeSb(rows: Row[]) {
  const requests: Array<{ table?: string; inCol?: string; inCount?: number }> = []
  const get = (r: Row, col: string) => (col.startsWith('data->>') ? r.data?.[col.slice(7)] : (r as any)[col])
  const builder = () => {
    const filters: Array<(r: Row) => boolean> = []
    const req: { table?: string; inCol?: string; inCount?: number } = {}
    let max = Infinity
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => { if (col === 'table_name') req.table = v as string; filters.push((r) => get(r, col) === v); return q },
      in: (col: string, vs: unknown[]) => { req.inCol = col; req.inCount = vs.length; filters.push((r) => vs.includes(get(r, col))); return q },
      limit: (n: number) => { max = n; return q },
      then: (res: (v: any) => void) => {
        requests.push(req)
        res({ data: rows.filter((r) => filters.every((f) => f(r))).slice(0, max).map((r) => ({ record_id: r.record_id, data: r.data })), error: null })
      },
    }
    return q
  }
  return { sb: { from: () => builder() } as any, requests }
}

const P = 'player-1'
function history(sessions: number, gamesPer: number): Row[] {
  const rows: Row[] = []
  for (let s = 0; s < sessions; s++) {
    const sid = `s${s}`
    rows.push({ user_id: P, table_name: 'Session', record_id: sid, deleted: false, data: { id: sid, date: Date.UTC(2026, 10, 1) + s * 3600_000, objectiveId: 'cs', objectiveIds: '["cs"]' } })
    for (let g = 0; g < gamesPer; g++) {
      const gid = `${sid}g${g}`
      rows.push({ user_id: P, table_name: 'Game', record_id: gid, deleted: false, data: { id: gid, sessionId: sid, matchId: `EUW1_${s}${g}`, champion: 'Ahri', gameEndAt: Date.UTC(2026, 10, 1) + s * 3600_000 + g * 60_000 } })
      rows.push({ user_id: P, table_name: 'Review', record_id: `r${gid}`, deleted: false, data: { id: `r${gid}`, gameId: gid, freeText: 'ok' } })
    }
  }
  return rows
}

describe('getPlayerSessions (WSC-08)', () => {
  it('reads only the games and reviews of the latest sessions, filtered on the server', async () => {
    const { sb, requests } = fakeSb(history(80, 5)) // 80 sessions, 400 games, 400 reviews
    const out = await getPlayerSessions(sb, P, 30)
    expect(out).toHaveLength(30)
    expect(out[0].id).toBe('s79')
    expect(out[0].games).toHaveLength(5)
    expect(out[0].games[0].review?.freeText).toBe('ok')
    expect(requests.map((r) => r.table)).toEqual(['Session', 'Game', 'Review', 'Review'])
    expect(requests[1]).toMatchObject({ inCol: 'data->>sessionId', inCount: 30 })
    expect(requests.slice(2).map((r) => r.inCount)).toEqual([100, 50]) // 150 game ids, by 100
  })

  it('the off-session container is always listed, placed by its latest game, without objective', async () => {
    const rows = history(40, 1)
    rows.push({ user_id: P, table_name: 'Session', record_id: 'off', deleted: false, data: { id: 'off', date: Date.UTC(2026, 0, 1), objectiveId: '__review_only__', sessionConclusion: 'System container' } })
    rows.push({ user_id: P, table_name: 'Game', record_id: 'og', deleted: false, data: { id: 'og', sessionId: 'off', matchId: 'EUW1_8051837730', champion: 'Ahri', gameEndAt: Date.UTC(2026, 10, 20, 11, 44) } })
    const { sb } = fakeSb(rows)
    const out = await getPlayerSessions(sb, P, 30)
    expect(out[0]).toMatchObject({ id: 'off', offSession: true, objectiveIds: [], sessionConclusion: null })
    expect(out).toHaveLength(31)
  })

  it('a player with nothing synced: one request', async () => {
    const { sb, requests } = fakeSb([])
    expect(await getPlayerSessions(sb, P)).toEqual([])
    expect(requests).toHaveLength(1)
  })
})
