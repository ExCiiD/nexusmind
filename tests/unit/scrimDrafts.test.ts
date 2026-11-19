import { describe, it, expect, vi, beforeEach } from 'vitest'

// WSC-19 (19/11/2026): a scrim links the group's drafts (team_drafts), not members' personal sync_records.
const h = vi.hoisted(() => ({ tables: [] as string[], groups: [] as string[] }))
vi.mock('../../web/src/supabase', () => ({
  sb: {
    from: (table: string) => {
      h.tables.push(table)
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = (_k: string, v: string) => { h.groups.push(v); return q }
      q.order = () => Promise.resolve({
        data: [{
          id: 'd1', group_id: 'g1', name: 'vs Rival', vs_scouting_id: null, my_team_side: 'red', notes: 'n',
          blue_picks: ['Ahri', ['Orianna', 'Syndra']], blue_bans: [], red_picks: [[]], red_bans: ['Zed'],
          created_at: 't', updated_at: 't',
        }],
        error: null,
      })
      return q
    },
  },
}))

const { listTeamDrafts } = await import('../../web/src/scrims')

beforeEach(() => { h.tables.length = 0; h.groups.length = 0 })

describe('listTeamDrafts', () => {
  it('reads the group\'s team_drafts, one champion per slot', async () => {
    const drafts = await listTeamDrafts('g1')
    expect(h.tables).toEqual(['team_drafts'])
    expect(h.groups).toEqual(['g1'])
    expect(drafts).toEqual([{
      id: 'd1', ownerId: '', name: 'vs Rival', myTeamSide: 'red', notes: 'n',
      bluePicks: ['Ahri', 'Orianna'], redPicks: [], blueBans: [], redBans: ['Zed'],
    }])
  })
  it('never reads personal sync_records any more (old call with member ids → nothing)', async () => {
    await expect(listTeamDrafts(['u1', 'u2'])).resolves.toEqual([])
    expect(h.tables).toEqual([])
  })
})
