import { describe, it, expect } from 'vitest'
import { GROUP_LOGO_MAX_BYTES, listMyGroups, logoPathOf, setGroupLogo } from '../../src/lib/collabCore'

const G = '00000000-0000-4000-8000-000000000001'
const PUBLIC = `https://proj.supabase.co/storage/v1/object/public/group-logos/${G}/logo-1.webp`

/** A Supabase client stub for the logo calls: storage, rpc and the group
 *  queries, each answering with the next result in line. */
function fakeSupabase(results: Array<{ data?: unknown; error?: unknown }> = []) {
  const calls: unknown[][] = []
  const next = () => Promise.resolve({ data: null, error: null, ...(results.shift() ?? {}) })
  // A thenable builder, like supabase-js: each awaited query takes the next result.
  const query: Record<string, unknown> = {
    select: (...a: unknown[]) => { calls.push(['select', ...a]); return query },
    eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return query },
    in: (...a: unknown[]) => { calls.push(['in', ...a]); return query },
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => next().then(ok, ko),
  }
  const bucket = (name: string) => ({
    upload: (...a: unknown[]) => { calls.push(['upload', name, ...a]); return next() },
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${name}/${path}` } }),
    remove: (paths: string[]) => { calls.push(['remove', name, paths]); return next() },
  })
  const sb = {
    from: (table: string) => { calls.push(['from', table]); return query },
    rpc: (fn: string, args: unknown) => { calls.push(['rpc', fn, args]); return next() },
    storage: { from: bucket },
  }
  return { sb: sb as never, calls }
}

describe('logoPathOf', () => {
  it("reads the bucket path of a logo of this group's folder", () => {
    expect(logoPathOf(PUBLIC, G)).toBe(`${G}/logo-1.webp`)
    expect(logoPathOf(`${PUBLIC}?v=2`, G)).toBe(`${G}/logo-1.webp`)
  })
  it("refuses another group's folder, other buckets, paths going up and nothing", () => {
    expect(logoPathOf(PUBLIC, 'other-group')).toBeNull()
    expect(logoPathOf(`https://proj.supabase.co/storage/v1/object/public/backups/${G}/x.webp`, G)).toBeNull()
    expect(logoPathOf(`https://proj.supabase.co/storage/v1/object/public/group-logos/${G}/../x.webp`, G)).toBeNull()
    expect(logoPathOf(null, G)).toBeNull()
  })
})

describe('setGroupLogo', () => {
  const image = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/webp' as const }

  it("uploads into the group's folder, points the group at it, then removes the previous file", async () => {
    const { sb, calls } = fakeSupabase()
    const url = await setGroupLogo(sb, G, image, PUBLIC)
    expect(url).toMatch(new RegExp(`/storage/v1/object/public/group-logos/${G}/logo-\\d+\\.webp$`))
    const upload = calls.find((c) => c[0] === 'upload')!
    expect(upload[1]).toBe('group-logos')
    expect(upload[2]).toMatch(new RegExp(`^${G}/logo-\\d+\\.webp$`))
    expect(upload[4]).toMatchObject({ contentType: 'image/webp', upsert: false })
    expect(calls).toContainEqual(['rpc', 'set_group_logo', { p_group: G, p_url: url }])
    expect(calls).toContainEqual(['remove', 'group-logos', [`${G}/logo-1.webp`]])
    // The group points at the new file before the old one goes.
    expect(calls.findIndex((c) => c[0] === 'rpc')).toBeLessThan(calls.findIndex((c) => c[0] === 'remove'))
  })

  it('clears the logo without uploading', async () => {
    const { sb, calls } = fakeSupabase()
    await expect(setGroupLogo(sb, G, null, PUBLIC)).resolves.toBeNull()
    expect(calls.some((c) => c[0] === 'upload')).toBe(false)
    expect(calls).toContainEqual(['rpc', 'set_group_logo', { p_group: G, p_url: null }])
  })

  it('stops on a refused upload, before touching the group', async () => {
    const { sb, calls } = fakeSupabase([{ error: { message: 'new row violates row-level security policy', code: '42501' } }])
    await expect(setGroupLogo(sb, G, image, null)).rejects.toThrow()
    expect(calls.some((c) => c[0] === 'rpc')).toBe(false)
  })

  it('refuses an empty or oversized image', async () => {
    const { sb } = fakeSupabase()
    await expect(setGroupLogo(sb, G, { bytes: new Uint8Array(0), contentType: 'image/webp' }, null)).rejects.toThrow()
    await expect(setGroupLogo(sb, G, { bytes: new Uint8Array(GROUP_LOGO_MAX_BYTES + 1), contentType: 'image/webp' }, null)).rejects.toThrow()
  })
})

describe('listMyGroups and logos', () => {
  const memberships = { data: [{ group_id: G, role: 'owner' }] }
  const members = { data: [{ group_id: G, user_id: 'u1', role: 'owner', is_captain: false, display_name: 'Coach', riot_id: null, joined_at: '' }] }
  const sharing = { data: [] }

  it("returns each group's logo", async () => {
    const { sb } = fakeSupabase([memberships, { data: [{ id: G, name: 'Legion', kind: 'team', logo_url: PUBLIC }] }, members, sharing])
    const [g] = await listMyGroups(sb, 'u1')
    expect(g.logoUrl).toBe(PUBLIC)
  })

  it('still lists the groups before the logo column exists', async () => {
    const { sb, calls } = fakeSupabase([
      memberships,
      { error: { message: 'column groups.logo_url does not exist', code: '42703' } },
      members,
      sharing,
      { data: [{ id: G, name: 'Legion', kind: 'team' }] },
    ])
    const [g] = await listMyGroups(sb, 'u1')
    expect(g.name).toBe('Legion')
    expect(g.logoUrl).toBeNull()
    expect(calls.filter((c) => c[0] === 'select' && c[1] === 'id, name, kind')).toHaveLength(1)
  })
})
