import { describe, it, expect, beforeEach } from 'vitest'
import { listMemberLooks, setMyCardChampion } from '../../src/lib/collabCore'
import {
  CUTOUTS_BASE, hasHostedCutout, hostedSkins, isCardChampion, listCardSkins, parseCutoutManifest, resetCardSkinsCache,
} from '../../src/lib/cardSkinsCore'

/** A Supabase client stub: records the calls, answers each awaited query (`.eq()` / `.in()`) with the next result. */
function fakeSupabase(results: Array<{ data?: unknown; error?: unknown }>) {
  const calls: unknown[][] = []
  const next = () => Promise.resolve({ data: null, error: null, ...(results.shift() ?? {}) })
  const query = {
    select: (...a: unknown[]) => { calls.push(['select', ...a]); return query },
    update: (...a: unknown[]) => { calls.push(['update', ...a]); return query },
    eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return next() },
    in: (...a: unknown[]) => { calls.push(['in', ...a]); return next() },
  }
  const sb = { from: (table: string) => { calls.push(['from', table]); return query } }
  return { sb: sb as never, calls }
}

const MANIFEST = {
  cutoutVersion: 3,
  ddragon: '16.23.1',
  skins: {
    MonkeyKing_0: { champion: 'Wukong', w: 500, h: 700 },
    MonkeyKing_7: { champion: 'Wukong', w: 510, h: 700 },
    MonkeyKing_3: { champion: 'Wukong', w: 520, h: 700 },
    MonkeyKingX_1: { champion: 'Not Wukong', w: 1, h: 1 },
    Ahri_1: { champion: 'Ahri', w: 400, h: 600 },
    '../etc_1': { champion: 'x', w: 1, h: 1 },
  },
}

function fakeFetch(routes: Record<string, unknown>) {
  const urls: string[] = []
  const fn = async (url: string) => {
    urls.push(url)
    const body = routes[url]
    return { ok: body !== undefined, json: async () => body }
  }
  return { fn, urls }
}

describe('isCardChampion', () => {
  it('accepts a Data Dragon id and a skin number only', () => {
    expect(isCardChampion({ championId: 'MonkeyKing', skinNum: 7 })).toBe(true)
    expect(isCardChampion({ championId: 'Ahri', skinNum: 0 })).toBe(true)
    expect(isCardChampion({ championId: "Kai'Sa", skinNum: 1 })).toBe(false)
    expect(isCardChampion({ championId: 'https://x/a.png', skinNum: 1 })).toBe(false)
    expect(isCardChampion({ championId: 'Ahri', skinNum: 1000 })).toBe(false)
    expect(isCardChampion({ championId: 'Ahri', skinNum: 1.5 })).toBe(false)
    expect(isCardChampion({ championId: 'Ahri' })).toBe(false)
    expect(isCardChampion(null)).toBe(false)
  })
})

describe('the hosted manifest', () => {
  it('keeps <id>_<num> entries only and lists a champion\'s skins, base skin first', () => {
    const m = parseCutoutManifest(MANIFEST)!
    expect(Object.keys(m.skins)).not.toContain('../etc_1')
    expect(hostedSkins(m, 'MonkeyKing')).toEqual([
      { num: 0, width: 500, height: 700 }, { num: 3, width: 520, height: 700 }, { num: 7, width: 510, height: 700 },
    ])
    expect(hostedSkins(m, 'Jinx')).toEqual([])
    expect(hasHostedCutout(m, { championId: 'MonkeyKing', skinNum: 7 })).toBe(true)
    expect(hasHostedCutout(m, { championId: 'MonkeyKing', skinNum: 1 })).toBe(false)
  })

  it('refuses something that is not a manifest', () => {
    expect(parseCutoutManifest(null)).toBeNull()
    expect(parseCutoutManifest({ skins: {} })).toBeNull()
    expect(parseCutoutManifest({ ddragon: 'latest', skins: {} })).toBeNull()
  })
})

describe('listCardSkins', () => {
  beforeEach(() => resetCardSkinsCache())
  const NAMES = 'https://ddragon.leagueoflegends.com/cdn/16.23.1/data/fr_FR/champion/MonkeyKing.json'

  it('gives the hosted skins with their Data Dragon names (base skin unnamed)', async () => {
    const { fn } = fakeFetch({
      [`${CUTOUTS_BASE}/manifest.json`]: MANIFEST,
      [NAMES]: { data: { MonkeyKing: { skins: [{ num: 0, name: 'default' }, { num: 3, name: 'Wukong jade' }, { num: 7, name: 'Wukong de la Lancerie' }, { num: 9, name: 'no cut-out' }] } } },
    })
    await expect(listCardSkins(fn, 'MonkeyKing', 'fr_FR')).resolves.toEqual([
      { num: 0, name: null, url: `${CUTOUTS_BASE}/MonkeyKing_0.webp`, width: 500, height: 700 },
      { num: 3, name: 'Wukong jade', url: `${CUTOUTS_BASE}/MonkeyKing_3.webp`, width: 520, height: 700 },
      { num: 7, name: 'Wukong de la Lancerie', url: `${CUTOUTS_BASE}/MonkeyKing_7.webp`, width: 510, height: 700 },
    ])
  })

  it('fetches the manifest once for several champions', async () => {
    const { fn, urls } = fakeFetch({ [`${CUTOUTS_BASE}/manifest.json`]: MANIFEST })
    await listCardSkins(fn, 'MonkeyKing')
    await listCardSkins(fn, 'Ahri')
    expect(urls.filter((u) => u.endsWith('manifest.json'))).toHaveLength(1)
  })

  it('still lists the skins without names when Data Dragon cannot be read', async () => {
    const { fn } = fakeFetch({ [`${CUTOUTS_BASE}/manifest.json`]: MANIFEST })
    const skins = await listCardSkins(fn, 'Ahri')
    expect(skins).toEqual([{ num: 1, name: null, url: `${CUTOUTS_BASE}/Ahri_1.webp`, width: 400, height: 600 }])
  })

  it('is empty offline, and tries the manifest again next time', async () => {
    const offline = fakeFetch({})
    await expect(listCardSkins(offline.fn, 'Ahri')).resolves.toEqual([])
    const online = fakeFetch({ [`${CUTOUTS_BASE}/manifest.json`]: MANIFEST })
    await expect(listCardSkins(online.fn, 'Ahri')).resolves.toHaveLength(1)
  })

  it('asks for nothing with an id that is not a champion id', async () => {
    const { fn, urls } = fakeFetch({})
    await expect(listCardSkins(fn, '../manifest')).resolves.toEqual([])
    expect(urls).toEqual([])
  })
})

describe('setMyCardChampion', () => {
  it('writes the choice on all my memberships', async () => {
    const { sb, calls } = fakeSupabase([{ error: null }])
    await expect(setMyCardChampion(sb, 'u1', { championId: 'MonkeyKing', skinNum: 7 })).resolves.toBe(true)
    expect(calls).toEqual([
      ['from', 'group_members'],
      ['update', { card_champion: 'MonkeyKing', card_skin_num: 7 }],
      ['eq', 'user_id', 'u1'],
    ])
  })

  it('null goes back to the default champion', async () => {
    const { sb, calls } = fakeSupabase([{ error: null }])
    await expect(setMyCardChampion(sb, 'u1', null)).resolves.toBe(true)
    expect(calls).toContainEqual(['update', { card_champion: null, card_skin_num: null }])
  })

  it('sends nothing malformed, and reports a refused write', async () => {
    const bad = fakeSupabase([])
    await expect(setMyCardChampion(bad.sb, 'u1', { championId: 'x/y', skinNum: 1 })).resolves.toBe(false)
    expect(bad.calls).toEqual([])
    const refused = fakeSupabase([{ error: { message: 'column "card_champion" does not exist', code: '42703' } }])
    await expect(setMyCardChampion(refused.sb, 'u1', { championId: 'Ahri', skinNum: 1 })).resolves.toBe(false)
  })
})

describe('listMemberLooks with cards', () => {
  it('reads the card next to the look, the first filled one per member', async () => {
    const { sb } = fakeSupabase([
      { data: [{ group_id: 'g1' }, { group_id: 'g2' }] },
      {
        data: [
          { user_id: 'a', riot_id: 'Kaito#EUW', profile_icon: 'brasier', profile_banner: 'abysse', card_champion: null, card_skin_num: null },
          { user_id: 'a', riot_id: 'Kaito#EUW', profile_icon: 'brasier', profile_banner: 'abysse', card_champion: 'MonkeyKing', card_skin_num: 7 },
          { user_id: 'b', riot_id: 'Nyra#EUW', profile_icon: null, profile_banner: null, card_champion: 'Bad Id', card_skin_num: 1 },
        ],
      },
    ])
    await expect(listMemberLooks(sb, 'u1')).resolves.toEqual([
      { userId: 'a', riotId: 'Kaito#EUW', iconId: 'brasier', bannerId: 'abysse', card: { championId: 'MonkeyKing', skinNum: 7 } },
      { userId: 'b', riotId: 'Nyra#EUW', iconId: null, bannerId: null, card: null },
    ])
  })

  it('before the migration, reads the looks without the card columns', async () => {
    const { sb, calls } = fakeSupabase([
      { data: [{ group_id: 'g1' }] },
      { error: { message: 'column group_members.card_champion does not exist', code: '42703' } },
      { data: [{ user_id: 'a', riot_id: 'Kaito#EUW', profile_icon: 'brasier', profile_banner: 'abysse' }] },
    ])
    await expect(listMemberLooks(sb, 'u1')).resolves.toEqual([
      { userId: 'a', riotId: 'Kaito#EUW', iconId: 'brasier', bannerId: 'abysse', card: null },
    ])
    expect(calls.filter((c) => c[0] === 'select').map((c) => c[1])).toEqual([
      'group_id',
      'user_id, riot_id, profile_icon, profile_banner, card_champion, card_skin_num',
      'user_id, riot_id, profile_icon, profile_banner',
    ])
  })
})
