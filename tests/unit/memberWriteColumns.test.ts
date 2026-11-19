import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setMyLook, updateMyMemberProfile } from '../../src/lib/collabCore'

// A member may only UPDATE the columns granted in
// 20261118202150_captain_roles_presence (role, is_captain, group and dates
// go through SECURITY DEFINER RPCs). A direct write from the app to any other
// column would be refused by Postgres, so the app's payloads must stay
// inside that grant.
const MIGRATION = join(__dirname, '../../supabase/migrations/20261118202150_captain_roles_presence.sql')

function grantedUpdateColumns(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8')
  const m = sql.match(/grant update \(([^)]+)\) on public\.group_members to authenticated/i)
  if (!m) throw new Error('column grant not found')
  return m[1].split(',').map((c) => c.trim())
}

/** Records every `.update()` payload; every chained filter stays awaitable. */
function fakeSupabase() {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const sb = {
    from: (table: string) => {
      const query: Record<string, unknown> = {
        update: (payload: Record<string, unknown>) => { updates.push({ table, payload }); return query },
        eq: () => query,
        then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
      }
      return query
    },
  }
  return { sb: sb as never, updates }
}

describe('group_members writes from the app', () => {
  it('the grant leaves out role and is_captain', () => {
    const cols = grantedUpdateColumns()
    expect(cols).not.toContain('is_captain')
    expect(cols).not.toContain('role')
    expect(cols).not.toContain('group_id')
    expect(cols).not.toContain('user_id')
  })

  it('only touch granted columns', async () => {
    const { sb, updates } = fakeSupabase()
    await updateMyMemberProfile(sb, 'u1', 'g1', { displayName: 'Nami', riotId: 'Nami#EUW' } as never)
    await setMyLook(sb, 'u1', { iconId: 'halo', bannerId: 'abysse' })
    expect(updates).toHaveLength(2)
    const granted = grantedUpdateColumns()
    for (const u of updates) {
      expect(u.table).toBe('group_members')
      for (const col of Object.keys(u.payload)) expect(granted).toContain(col)
    }
  })
})
