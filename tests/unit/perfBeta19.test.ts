/**
 * AUDIT_PERF_2, beta.19 back-end gains: perf log labels (0), compressed timelines (6), backup rotation (9).
 * The stores (1, 7) and the parallel loop (2) are in perfStores.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { gzipSync } from 'node:zlib'
import { decodeTimeline, encodeTimeline, isCompressedTimeline, parseStoredTimeline, GZ_PREFIX } from '../../electron/main/matchStoreCore'
import { formatPerfLine, labelForUrl, perfLogEnabled } from '../../electron/main/perfLogCore'
import { planBackupRotation, snapshotKind } from '../../electron/main/backupRotationCore'

describe('gain 6: compressed timelines', () => {
  const timeline = { metadata: { matchId: 'EUW1_1' }, info: { frames: Array.from({ length: 30 }, (_, i) => ({ timestamp: i * 60_000, participantFrames: { 1: { totalGold: i * 400 } } })) } }

  it('round-trips, and is much smaller than the JSON', () => {
    const stored = encodeTimeline(timeline)
    expect(isCompressedTimeline(stored)).toBe(true)
    expect(stored.length).toBeLessThan(JSON.stringify(timeline).length / 3)
    expect(JSON.parse(decodeTimeline(stored)!)).toEqual(timeline)
    expect(parseStoredTimeline(stored)).toEqual(timeline)
  })

  it('reads a plain JSON timeline written before this version as it is', () => {
    const plain = JSON.stringify(timeline)
    expect(decodeTimeline(plain)).toBe(plain)
    expect(parseStoredTimeline(plain)).toEqual(timeline)
  })

  it('accepts a JSON string, never compresses twice, and survives bad values', () => {
    const once = encodeTimeline(JSON.stringify(timeline))
    expect(encodeTimeline(once)).toBe(once)
    expect(decodeTimeline(null)).toBeNull()
    expect(decodeTimeline('')).toBeNull()
    expect(decodeTimeline(GZ_PREFIX + 'not-base64-gzip')).toBeNull()
    expect(parseStoredTimeline('{broken')).toBeNull()
    expect(decodeTimeline(GZ_PREFIX + gzipSync(Buffer.from('{"a":1}')).toString('base64'))).toBe('{"a":1}')
  })
})

describe('gain 0: perf log', () => {
  it('is off unless NEXUSMIND_PERF_LOG=1', () => {
    expect(perfLogEnabled({})).toBe(false)
    expect(perfLogEnabled({ NEXUSMIND_PERF_LOG: 'true' })).toBe(false)
    expect(perfLogEnabled({ NEXUSMIND_PERF_LOG: '1' })).toBe(true)
  })

  it('labels Riot calls without ids (puuid, match id, Riot ID)', () => {
    const puuid = 'eQc4Fi68j9uF_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-abcdefghijklmnopqrstuvwxyz0'
    expect(labelForUrl(`https://nexusmind-riot-proxy.nexusmind-riot-proxy.workers.dev/europe/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=20`))
      .toEqual({ kind: 'riot', label: 'GET europe/lol/match/v5/matches/by-puuid/:id/ids' })
    // A malformed % escape does not throw (the request would fail while the log is on).
    expect(() => labelForUrl('https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/bad%E0%A4%A/x')).not.toThrow()
    expect(labelForUrl('https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_8051837730/timeline').label)
      .toBe('GET europe/lol/match/v5/matches/:match/timeline')
    expect(labelForUrl('https://nexusmind-riot-proxy.nexusmind-riot-proxy.workers.dev/asia/riot/account/v1/accounts/by-riot-id/3XC/AIGRI').label)
      .toBe('GET asia/riot/account/v1/accounts/by-riot-id/:name/:tag')
  })

  it('labels Supabase calls by table or function, never the query (filters, ids)', () => {
    expect(labelForUrl('https://zwubyzrfpelhxjjezvrh.supabase.co/rest/v1/sync_records?user_id=eq.0000&select=*', 'GET'))
      .toEqual({ kind: 'supabase', label: 'GET /rest/v1/sync_records' })
    expect(labelForUrl('https://zwubyzrfpelhxjjezvrh.supabase.co/rest/v1/rpc/sync_push', 'POST').label).toBe('POST /rest/v1/rpc/sync_push')
    expect(labelForUrl('https://zwubyzrfpelhxjjezvrh.supabase.co/auth/v1/token?grant_type=refresh_token', 'POST').label).toBe('POST /auth/v1/token')
    expect(labelForUrl('https://example.com/a/b').kind).toBe('net')
  })

  it('writes one tab-separated line', () => {
    expect(formatPerfLine(new Date('2026-11-20T18:00:00Z'), 'ipc', 'stats:match-history', 41.6, 'ok'))
      .toBe('2026-11-20T18:00:00.000Z\tipc\tstats:match-history\t42\tok\n')
  })
})

describe('gain 9: backup rotation', () => {
  const f = (name: string, day: number) => ({ name, mtimeMs: Date.UTC(2026, 10, day) })
  const folder = [
    f('nexusmind-2026-11-19T04-44-10-792Z-before-20261118170000_pool_play_dates.db', 19),
    f('nexusmind-2026-11-19T06-57-21-903Z-before-20261119130000_mic_on_by_default.db', 19.5),
    f('nexusmind-2026-11-19T17-54-13-758Z-before-20261119270000_team_member_previous_riot_id.db', 20),
    f('nexusmind-2026-11-20T13-11-05-512Z-before-20261120130000_account_region_mode.db', 21),
    f('nexusmind-2026-11-19T05-08-09-845Z-before-delete-crimson.db', 19.2),
    f('nexusmind-2026-11-20T08-01-19-090Z-before-delete-2025-matchcache.db', 20.5),
    f('nexusmind-2026-11-18T01-00-00-000Z-before-delete-old.db.gz', 18),
    f('nexusmind-2026-11-10T00-00-00-000Z-before-delete-history-keep.db', 10),
    f('cloud-AscendTest-team-data-2026-11-19.txt', 19),
  ]

  it('keeps the 2 newest of each kind, never a -keep snapshot nor a foreign file', () => {
    const { remove } = planBackupRotation(folder)
    expect(remove.sort()).toEqual([
      'nexusmind-2026-11-18T01-00-00-000Z-before-delete-old.db.gz',
      'nexusmind-2026-11-19T04-44-10-792Z-before-20261118170000_pool_play_dates.db',
      'nexusmind-2026-11-19T06-57-21-903Z-before-20261119130000_mic_on_by_default.db',
    ].sort())
    expect(snapshotKind('nexusmind-2026-11-10T00-00-00-000Z-before-delete-history-keep.db')).toBeNull()
    expect(snapshotKind('cloud-AscendTest-team-data-2026-11-19.txt')).toBeNull()
  })

  it('compresses the kept ones except the newest of each kind (the one to restore after a failed update)', () => {
    const { compress } = planBackupRotation(folder)
    expect(compress.sort()).toEqual([
      'nexusmind-2026-11-19T05-08-09-845Z-before-delete-crimson.db',
      'nexusmind-2026-11-19T17-54-13-758Z-before-20261119270000_team_member_previous_riot_id.db',
    ].sort())
  })
})
