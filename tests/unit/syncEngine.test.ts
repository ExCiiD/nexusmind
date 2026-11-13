/**
 * Sync engine against a real temp SQLite DB and an in-memory fake of the
 * server's sync_records + sync_push semantics (LWW on updated_at, seq cursor).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-sync-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '0.0.0' },
}))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { SyncEngine, SyncError, type PushRecord, type RemoteRecord, type SyncRemote } from '../../electron/main/sync/syncEngine'

/** Mirrors public.sync_push / sync_records. */
class FakeRemote implements SyncRemote {
  rows = new Map<string, RemoteRecord>()
  private seq = 0
  async push(records: PushRecord[]) {
    for (const r of records) {
      const key = `${r.t}|${r.id}`
      const prev = this.rows.get(key)
      if (prev && prev.updated_at > r.at) continue
      this.rows.set(key, {
        table_name: r.t, record_id: r.id, data: r.del ? null : (r.data ?? null),
        deleted: !!r.del, updated_at: r.at, device_id: r.dev, seq: ++this.seq,
      })
    }
  }
  async pull(after: number, limit: number) {
    return [...this.rows.values()].filter((r) => r.seq > after && r.table_name !== '_profile')
      .sort((a, b) => a.seq - b.seq).slice(0, limit)
  }
  async getRecord(t: string, id: string) { return this.rows.get(`${t}|${id}`) ?? null }
  /** A write coming from another PC. */
  other(t: string, id: string, data: Record<string, unknown> | null, at: string) {
    return this.push([{ t, id, data: data ?? undefined, del: data === null, at, dev: 'other-pc' }])
  }
  get(t: string, id: string) { return this.rows.get(`${t}|${id}`) }
}

const remote = new FakeRemote()
let engine: SyncEngine
let userId = ''
let localTagId = ''

const outbox = async () =>
  (await getPrisma().$queryRawUnsafe<any[]>(`SELECT table_name, record_id FROM "_sync_outbox"`)).map((r) => `${r.table_name}:${r.record_id}`)

beforeAll(async () => {
  await initDatabase()
  const prisma = getPrisma()
  const user = await prisma.user.create({ data: { summonerName: 'P', puuid: 'puuid-1', region: 'EUW1', nextAssessmentAt: new Date() } })
  userId = user.id
  // Data that existed before sync was ever enabled (bootstrap case).
  await prisma.session.create({ data: { id: 'sess-old', userId, objectiveId: 'wave_management' } })
  localTagId = (await prisma.mistakeTag.create({ data: { slug: 'overextend', label: 'Overextend', category: 'macro', isBuiltIn: true } })).id
  engine = new SyncEngine(prisma as any, remote, 'cloud-user-1')
}, 60_000)

afterAll(async () => {
  await closeDatabase()
  try { rmSync(h.root, { recursive: true, force: true }) } catch { /* Windows file lock */ }
})

describe('sync engine', () => {
  it('first sync pushes pre-existing data and claims the cloud account for this player', async () => {
    await engine.syncOnce()
    expect(remote.get('Session', 'sess-old')?.data).toMatchObject({ objectiveId: 'wave_management' })
    expect(remote.get('_profile', 'owner')?.data).toEqual({ puuid: 'puuid-1' })
    expect(await outbox()).toEqual([])
  })

  it('tracks local writes (Prisma or raw SQL) and never uploads local file paths', async () => {
    const prisma = getPrisma()
    const s = await prisma.session.create({ data: { id: 'sess-2', userId, objectiveId: 'vision' } })
    const g = await prisma.game.create({
      data: { id: 'game-2', sessionId: s.id, matchId: 'EUW1_2', champion: 'Ahri', role: 'MIDDLE', kills: 1, deaths: 1, assists: 1, cs: 1, visionScore: 1, duration: 1, win: true, gameEndAt: new Date() },
    })
    await prisma.recording.create({ data: { id: 'rec-2', gameId: g.id, filePath: 'C:\\Videos\\secret.mp4', source: 'manual' } })
    await prisma.$executeRawUnsafe(`UPDATE "Session" SET "customNote" = 'raw' WHERE id = 'sess-2'`)
    expect(await outbox()).toEqual(expect.arrayContaining(['Session:sess-2', 'Game:game-2', 'Recording:rec-2']))

    await engine.syncOnce()
    expect(remote.get('Session', 'sess-2')?.data).toMatchObject({ customNote: 'raw' })
    expect(remote.get('Recording', 'rec-2')?.data).not.toHaveProperty('filePath')
  })

  it('applies another PC\'s data under this PC\'s user, without echoing it back', async () => {
    const at = new Date(Date.now() + 1000).toISOString()
    await remote.other('Session', 'sess-remote', { id: 'sess-remote', userId: 'their-user-id', objectiveId: 'trading', date: Date.now(), status: 'completed', objectiveIds: '[]', selectedKpiIds: '[]' }, at)
    await remote.other('Game', 'game-remote', { id: 'game-remote', sessionId: 'sess-remote', matchId: 'EUW1_9', champion: 'Zed', role: 'MIDDLE', kills: 9, deaths: 0, assists: 3, cs: 200, visionScore: 10, duration: 1500, win: true, gameEndAt: Date.now(), queueType: 'soloq', reviewStatus: 'pending', isSessionEligible: true }, at)

    const res = await engine.syncOnce()
    expect(res.appliedTables).toEqual(expect.arrayContaining(['Session', 'Game']))
    const prisma = getPrisma()
    const sess = await prisma.session.findUnique({ where: { id: 'sess-remote' } })
    expect(sess?.userId).toBe(userId)
    const game = await prisma.game.findUnique({ where: { id: 'game-remote' } })
    expect(game?.win).toBe(true)
    expect(game?.gameEndAt).toBeInstanceOf(Date)
    expect(await outbox()).toEqual([])
  })

  it('merges a built-in tag created under another id and remaps mistakes to it', async () => {
    const at = new Date(Date.now() + 2000).toISOString()
    await remote.other('MistakeTag', 'tag-their-id', { id: 'tag-their-id', slug: 'overextend', label: 'Overextend', category: 'macro', isBuiltIn: true, createdAt: Date.now() }, at)
    await remote.other('Mistake', 'mistake-1', { id: 'mistake-1', gameId: 'game-remote', tagId: 'tag-their-id', gameTimeSec: 420, severity: 2, createdAt: Date.now() }, at)
    await engine.syncOnce()
    const m = await getPrisma().mistake.findUnique({ where: { id: 'mistake-1' } })
    expect(m?.tagId).toBe(localTagId)
    expect(await getPrisma().mistakeTag.count({ where: { slug: 'overextend' } })).toBe(1)
  })

  it('last write wins: a newer local edit is kept, a newer remote edit is applied', async () => {
    const prisma = getPrisma()
    await prisma.session.update({ where: { id: 'sess-2' }, data: { customNote: 'local-new' } })
    await remote.other('Session', 'sess-2', { ...(remote.get('Session', 'sess-2')!.data as any), customNote: 'remote-old' }, '2000-01-01T00:00:00.000Z')
    await engine.syncOnce()
    expect((await prisma.session.findUnique({ where: { id: 'sess-2' } }))?.customNote).toBe('local-new')

    await remote.other('Session', 'sess-2', { ...(remote.get('Session', 'sess-2')!.data as any), customNote: 'remote-new' }, new Date(Date.now() + 60_000).toISOString())
    await engine.syncOnce()
    expect((await prisma.session.findUnique({ where: { id: 'sess-2' } }))?.customNote).toBe('remote-new')
  })

  it('keeps this PC\'s video path when the recording is edited elsewhere', async () => {
    await remote.other('Recording', 'rec-2', { ...(remote.get('Recording', 'rec-2')!.data as any), youtubeUrl: 'https://youtu.be/x' }, new Date(Date.now() + 70_000).toISOString())
    await engine.syncOnce()
    const rec = await getPrisma().recording.findUnique({ where: { id: 'rec-2' } })
    expect(rec?.youtubeUrl).toBe('https://youtu.be/x')
    expect(rec?.filePath).toBe('C:\\Videos\\secret.mp4')
  })

  it('propagates deletions both ways as tombstones', async () => {
    const prisma = getPrisma()
    await prisma.session.delete({ where: { id: 'sess-old' } })
    await engine.syncOnce()
    expect(remote.get('Session', 'sess-old')?.deleted).toBe(true)

    await remote.other('Session', 'sess-remote', null, new Date(Date.now() + 80_000).toISOString())
    await engine.syncOnce()
    expect(await prisma.session.findUnique({ where: { id: 'sess-remote' } })).toBeNull()
    expect(await prisma.game.findUnique({ where: { id: 'game-remote' } })).toBeNull() // cascade
  })

  it('parks a child whose parent has not arrived yet and applies it later', async () => {
    const at = new Date(Date.now() + 90_000).toISOString()
    await remote.other('Review', 'rev-late', { id: 'rev-late', gameId: 'game-late', timelineNotes: '[]', kpiScores: '{}', objectiveRespected: true, createdAt: Date.now() }, at)
    await engine.syncOnce()
    expect(await getPrisma().review.findUnique({ where: { id: 'rev-late' } })).toBeNull()

    await remote.other('Session', 'sess-late', { id: 'sess-late', userId: 'x', objectiveId: 'o', date: Date.now(), status: 'completed', objectiveIds: '[]', selectedKpiIds: '[]' }, at)
    await remote.other('Game', 'game-late', { id: 'game-late', sessionId: 'sess-late', matchId: 'EUW1_77', champion: 'Lux', role: 'SUPPORT', kills: 0, deaths: 0, assists: 0, cs: 0, visionScore: 0, duration: 1, win: false, gameEndAt: Date.now(), queueType: 'soloq', reviewStatus: 'pending', isSessionEligible: true }, at)
    await engine.syncOnce()
    expect(await getPrisma().review.findUnique({ where: { id: 'rev-late' } })).not.toBeNull()
  })

  it("refuses to sync when the cloud account belongs to another player", async () => {
    await remote.push([{ t: '_profile', id: 'owner', data: { puuid: 'someone-else' }, at: new Date(Date.now() + 100_000).toISOString(), dev: 'other-pc' }])
    await expect(engine.syncOnce()).rejects.toBeInstanceOf(SyncError)
  })
})
