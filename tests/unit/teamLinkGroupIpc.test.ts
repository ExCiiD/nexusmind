/**
 * Integration: team:link-group, team:list and team:create (#7) on a
 * throw-away SQLite database (every migration applied). Covers the
 * ownership check, the transaction, and that opponents can share a group
 * while the group's own team stays unique.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  const root = mkdtempSync(join(tmpdir(), 'nxm-linkgroup-'))
  process.env.NEXUSMIND_DB_PATH = join(root, 'data', 'test.db')
  return { root, handlers: new Map<string, (...args: unknown[]) => unknown>() }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(h.root, 'userData'), getAppPath: () => process.cwd(), getVersion: () => '0.0.0-test' },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn), on: () => {} },
  dialog: {},
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../../electron/main/riotTransport', () => ({
  RiotAuthError: class RiotAuthError extends Error {},
}))
vi.mock('../../electron/main/riotClient', () => ({
  getMatchIds: vi.fn(), getMatch: vi.fn(), getAccountByRiotId: vi.fn(), getChampionMasteries: vi.fn(), getSeasonMatchIds: vi.fn(),
}))
vi.mock('../../electron/main/dataDragon', () => ({ getChampionIdToKey: vi.fn(async () => ({})) }))

import { initDatabase, closeDatabase, getPrisma } from '../../electron/main/database'
import { registerTeamHandlers } from '../../electron/main/ipc/team.ipc'

const G1 = '11111111-1111-4111-8111-111111111111'
const G2 = '22222222-2222-4222-8222-222222222222'
const call = (channel: string, ...args: unknown[]) => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`no handler ${channel}`)
  return fn({} as never, ...args) as Promise<any>
}

let me = ''
let other = ''

beforeAll(async () => {
  await initDatabase()
  registerTeamHandlers()
  const prisma = getPrisma()
  me = (await prisma.user.create({ data: { summonerName: 'Me', puuid: 'p-me', region: 'EUW1', nextAssessmentAt: new Date(), isActive: true } })).id
  other = (await prisma.user.create({ data: { summonerName: 'Other', puuid: 'p-other', region: 'EUW1', nextAssessmentAt: new Date(), isActive: false } })).id
})

afterAll(async () => {
  await closeDatabase()
  rmSync(h.root, { recursive: true, force: true })
})

describe('team:link-group', () => {
  it('only one own team per group: linking a second one releases the first', async () => {
    const a = await call('team:create', { name: 'A' })
    const b = await call('team:create', { name: 'B' })
    await call('team:link-group', a.id, G1)
    await call('team:link-group', b.id, G1)
    const prisma = getPrisma()
    expect((await prisma.team.findUnique({ where: { id: a.id } }))?.groupId).toBeNull()
    expect((await prisma.team.findUnique({ where: { id: b.id } }))?.groupId).toBe(G1)
  })

  it('opponents share a group and never release the own team', async () => {
    const own = await call('team:create', { name: 'Own' })
    await call('team:link-group', own.id, G2)
    const o1 = await call('team:create', { name: 'Rival 1', isOpponent: true, groupId: G2 })
    const o2 = await call('team:create', { name: 'Rival 2', isOpponent: true })
    await call('team:link-group', o2.id, G2)
    const prisma = getPrisma()
    expect((await prisma.team.findUnique({ where: { id: own.id } }))?.groupId).toBe(G2)
    const listed = await call('team:list', { isOpponent: true, groupId: G2 })
    expect(listed.map((t: { id: string }) => t.id).sort()).toEqual([o1.id, o2.id].sort())
  })

  it('lists pre-#7 opponents (no group) only when asked', async () => {
    const legacy = await call('team:create', { name: 'Old rival', isOpponent: true })
    const strict = await call('team:list', { isOpponent: true, groupId: G1 })
    const withLegacy = await call('team:list', { isOpponent: true, groupId: G1, includeUnassigned: true })
    expect(strict.some((t: { id: string }) => t.id === legacy.id)).toBe(false)
    expect(withLegacy.some((t: { id: string }) => t.id === legacy.id)).toBe(true)
  })

  it('refuses a team that belongs to another local profile, and changes nothing', async () => {
    const prisma = getPrisma()
    const foreign = await prisma.team.create({ data: { userId: other, name: 'Not mine', groupId: G1 } })
    const mineBefore = await prisma.team.findMany({ where: { userId: me, groupId: G1 } })
    await expect(call('team:link-group', foreign.id, G2)).rejects.toThrow('Team not found')
    expect((await prisma.team.findUnique({ where: { id: foreign.id } }))?.groupId).toBe(G1)
    expect(await prisma.team.findMany({ where: { userId: me, groupId: G1 } })).toEqual(mineBefore)
  })

  it('rolls the release back when the update fails (one transaction)', async () => {
    const prisma = getPrisma()
    const holder = await prisma.team.findFirst({ where: { userId: me, groupId: G1, isOpponent: false } })
    expect(holder).not.toBeNull()
    const doomed = await call('team:create', { name: 'Doomed' })
    // Make the final update fail after updateMany ran, inside the transaction.
    const realTx = prisma.$transaction.bind(prisma)
    const spy = vi.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: (tx: any) => Promise<unknown>) =>
      realTx(async (tx: any) => fn(new Proxy(tx, {
        get: (target, prop) => prop === 'team'
          ? new Proxy(target.team, { get: (t, p) => p === 'update' ? async () => { throw new Error('disk full') } : t[p] })
          : target[prop],
      })))) as never)
    await expect(call('team:link-group', doomed.id, G1)).rejects.toThrow('disk full')
    spy.mockRestore()
    expect((await prisma.team.findUnique({ where: { id: holder!.id } }))?.groupId).toBe(G1)
  })

  it('validates its input', async () => {
    await expect(call('team:link-group', 'x', 'not-a-uuid')).rejects.toThrow(/Invalid input for team:link-group/)
    await expect(call('team:create', { name: 'X', userId: 'someone' })).rejects.toThrow(/Invalid input for team:create/)
    await expect(call('team:list', { groupId: 'nope' })).rejects.toThrow(/Invalid input for team:list/)
  })

  it('team:remove-member and team:delete-custom-game validate their id (P3)', async () => {
    await expect(call('team:remove-member', 42)).rejects.toThrow(/Invalid input for team:remove-member/)
    await expect(call('team:remove-member', 'a b; drop')).rejects.toThrow(/Invalid input for team:remove-member/)
    await expect(call('team:delete-custom-game', undefined)).rejects.toThrow(/Invalid input for team:delete-custom-game/)
    await expect(call('team:delete-custom-game', 'group:not-a-uuid')).rejects.toThrow(/Invalid input for team:delete-custom-game/)

    const prisma = getPrisma()
    const team = await call('team:create', { name: 'Roster' })
    const member = await prisma.teamMember.create({ data: { teamId: team.id, displayName: 'Mid', role: 'MID' } })
    expect(await call('team:remove-member', member.id)).toEqual({ ok: true })
    expect(await prisma.teamMember.findUnique({ where: { id: member.id } })).toBeNull()
  })
})
