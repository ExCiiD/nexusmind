/**
 * Backup round-trip on a real temp SQLite DB: export → delete → import must
 * bring the coaching data back, remap ids that differ locally, and refuse a
 * backup from another Riot account.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-backup-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '9.9.9' },
}))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { buildBackupPayload, encodeBackup, decodeBackup, importBackupPayload } from '../../electron/main/backup/backupCore'

let userId = ''

beforeAll(async () => {
  await initDatabase()
  const prisma = getPrisma()
  const user = await prisma.user.create({ data: { summonerName: 'Owner', puuid: 'owner-puuid', region: 'EUW1', nextAssessmentAt: new Date() } })
  userId = user.id
  const session = await prisma.session.create({ data: { userId, objectiveId: 'wave_management' } })
  const game = await prisma.game.create({
    data: {
      sessionId: session.id, matchId: 'EUW1_1', champion: 'Ahri', role: 'MIDDLE', kills: 5, deaths: 2, assists: 7,
      cs: 200, visionScore: 20, duration: 1800, win: true, gameEndAt: new Date('2026-05-01T20:00:00Z'),
    },
  })
  await prisma.review.create({ data: { gameId: game.id, timelineNotes: '[]', kpiScores: '{"cs":4}', objectiveRespected: true } })
  const tag = await prisma.mistakeTag.create({ data: { slug: 'overextend', label: 'Overextend', category: 'macro' } })
  await prisma.mistake.create({ data: { gameId: game.id, tagId: tag.id, gameTimeSec: 600 } })
}, 60_000)

afterAll(async () => {
  await closeDatabase()
  try { rmSync(h.root, { recursive: true, force: true }) } catch { /* Windows file lock */ }
})

describe('backup round-trip', () => {
  it('cloud payloads exclude the Riot match cache', async () => {
    const cloud = await buildBackupPayload({ forCloud: true })
    const file = await buildBackupPayload({ forCloud: false })
    expect(cloud.tables.MatchCache).toBeUndefined()
    expect(file.tables.MatchCache).toBeDefined()
    expect(cloud.manifest.puuid).toBe('owner-puuid')
  })

  it('restores deleted coaching data, including mistakes with a re-created tag', async () => {
    const encoded = encodeBackup(await buildBackupPayload({ forCloud: true }))
    const prisma = getPrisma()

    // Simulate a fresh PC: coaching data gone, built-in tag re-seeded under a new id.
    await prisma.mistake.deleteMany()
    await prisma.mistakeTag.deleteMany()
    await prisma.session.deleteMany() // cascades to games, reviews
    const reseeded = await prisma.mistakeTag.create({ data: { slug: 'overextend', label: 'Overextend', category: 'macro' } })

    const summary = await importBackupPayload(decodeBackup(encoded))

    expect(summary.added.Session).toBe(1)
    expect(summary.added.Game).toBe(1)
    expect(summary.added.Review).toBe(1)
    expect(summary.added.Mistake).toBe(1)
    expect(summary.conflicts).toBe(0)
    const mistake = await prisma.mistake.findFirst()
    expect(mistake?.tagId).toBe(reseeded.id)
    const game = await prisma.game.findFirst({ where: { matchId: 'EUW1_1' } })
    expect(game?.reviewStatus).toBe('reviewed')
  })

  it('is idempotent: importing twice adds nothing', async () => {
    const payload = await buildBackupPayload({ forCloud: true })
    const summary = await importBackupPayload(payload)
    expect(Object.values(summary.added).reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('ignores columns unknown to this schema (backup from a newer version)', async () => {
    const payload = await buildBackupPayload({ forCloud: true })
    payload.tables.Session = payload.tables.Session.map((s) => ({ ...s, id: s.id + 'x', futureColumn: 42 }))
    const summary = await importBackupPayload(payload)
    expect(summary.added.Session).toBe(1)
    expect(summary.conflicts).toBe(0)
  })

  it("refuses another player's backup", async () => {
    const payload = await buildBackupPayload({ forCloud: true })
    payload.manifest.puuid = 'someone-else'
    payload.tables.User = [{ ...payload.tables.User[0], puuid: 'someone-else' }]
    await expect(importBackupPayload(payload)).rejects.toThrow(/different Riot account/)
  })
})
