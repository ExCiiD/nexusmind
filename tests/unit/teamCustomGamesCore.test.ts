import { describe, it, expect, vi } from 'vitest'
import { deleteGroupCustomGame, fromGroupRow, listGroupCustomGames, mergeWithGroupGames, publishCustomGame } from '../../src/lib/teamCustomGamesCore'

// #41a (19/11/2026): the group's players get the scrim / tournament games the staff imported.
const row = (id: string, localId: string | null) => ({
  id, group_id: 'g1', game_type: 'scrim' as const, game_date: null, duration_sec: 1800, win: true,
  participants: [{ playerName: 'A', championName: 'Ahri', teamId: 100 }], source_file: 'scrim.csv', local_id: localId, created_at: 't',
})

describe('fromGroupRow', () => {
  it('maps a group row to the local shape, id prefixed so it never collides', () => {
    const g = fromGroupRow(row('u1', 'loc1'), 'team1')
    expect(g).toMatchObject({ id: 'group:u1', teamId: 'team1', gameType: 'scrim', durationSec: 1800, win: true, source: 'group', localId: 'loc1' })
    expect(JSON.parse(g.participantsJson)).toEqual([{ playerName: 'A', championName: 'Ahri', teamId: 100 }])
  })
})

describe('mergeWithGroupGames', () => {
  it('keeps local games and adds the group games this PC did not import itself', () => {
    const local = [{ id: 'loc1' }, { id: 'loc2' }]
    const group = [fromGroupRow(row('u1', 'loc1'), 't'), fromGroupRow(row('u2', 'other-pc'), 't'), fromGroupRow(row('u3', null), 't')]
    expect(mergeWithGroupGames(local, group).map((g) => g.id)).toEqual(['loc1', 'loc2', 'group:u2', 'group:u3'])
  })
  it('a player (no local games) gets every group game', () => {
    expect(mergeWithGroupGames([], [fromGroupRow(row('u1', 'loc1'), 't')]).map((g) => g.id)).toEqual(['group:u1'])
  })
})

describe('writes and reads', () => {
  it('publishes idempotently on (group_id, local_id), participants as JSON', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    await publishCustomGame({ from: () => ({ upsert }) } as never, 'g1', {
      id: 'loc1', gameType: 'tournament', gameDate: new Date('2026-11-19T10:00:00Z'), durationSec: 2000, win: false,
      participantsJson: '[{"playerName":"A"}]', sourceFile: 'cup.csv',
    })
    expect(upsert).toHaveBeenCalledWith({
      group_id: 'g1', game_type: 'tournament', game_date: '2026-11-19T10:00:00.000Z', duration_sec: 2000, win: false,
      participants: [{ playerName: 'A' }], source_file: 'cup.csv', local_id: 'loc1',
    }, { onConflict: 'group_id,local_id' })
  })
  it('lists one group, optionally one type', async () => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) q[m] = vi.fn().mockReturnValue(q)
    q.then = (resolve: (v: unknown) => void) => resolve({ data: [row('u1', null)], error: null })
    await expect(listGroupCustomGames({ from: () => q } as never, 'g1', 'scrim')).resolves.toHaveLength(1)
    expect(q.eq).toHaveBeenCalledWith('group_id', 'g1')
    expect(q.eq).toHaveBeenCalledWith('game_type', 'scrim')
  })
  it('deletes a group game by its id, or a published local game by its local id', async () => {
    const calls: string[] = []
    const q: Record<string, unknown> = {}
    q.eq = vi.fn((k: string, v: string) => { calls.push(`${k}=${v}`); return q })
    q.then = (resolve: (v: unknown) => void) => resolve({ error: null })
    const sb = { from: () => ({ delete: () => q }) } as never
    await deleteGroupCustomGame(sb, 'group:u1')
    await deleteGroupCustomGame(sb, 'loc1', 'g1')
    await deleteGroupCustomGame(sb, 'loc2', null)
    expect(calls).toEqual(['id=u1', 'group_id=g1', 'local_id=loc1'])
  })
})
