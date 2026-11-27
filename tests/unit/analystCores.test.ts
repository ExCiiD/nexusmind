/**
 * #40 § 11-12 pure cores (draft log, opponent dossier) and the shared storage / orchestration (analystCore) on an
 * in-memory fake of the Supabase query builder. The tables' rights are tested on Postgres by
 * scripts/test-analyst-tables.mjs.
 */
import { describe, it, expect, vi } from 'vitest'
import { draftFromMatch, filterDrafts, summarizeDrafts } from '../../src/lib/draftLogCore'
import {
  assembleDossierView, dossierToDiscordText, duosOf, poolChangeOf, recentFormOf, playerCards, type PlayerRankedGame,
} from '../../src/lib/opponentDossierCore'
import {
  sourceOf, listTeamObjectivesGames, loadTeamGameTimeline, syncDraftsFromGames, saveDossier, setDossierStatus, refreshDossier,
} from '../../src/lib/analystCore'
import { TEAM_TIMELINE_VERSION, hasWardEvents } from '../../src/lib/teamTimelineCore'
import { getSessionCollective } from '../../src/lib/teamCollectiveStatsCore'
import type { DraftLogEntry } from '../../src/lib/analyst'
import type { SharedScoutingEntry } from '../../src/lib/team'

// ── A Riot match ───────────────────────────────────────────────────────────
const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const CHAMPS = ['Gnar', 'Vi', 'Ahri', 'Jinx', 'Thresh', 'Renekton', 'Lee Sin', 'Zed', 'Kaisa', 'Nautilus']
function riotMatch(o: { blueWin?: boolean; bans?: boolean; queueId?: number; start?: number } = {}) {
  return {
    info: {
      gameVersion: '16.22.734.1', gameDuration: 1850, queueId: o.queueId ?? 0, gameStartTimestamp: o.start ?? Date.parse('2026-11-18T19:00:00Z'),
      teams: [
        { teamId: 100, win: o.blueWin ?? true, bans: o.bans === false ? [] : [{ championId: 157, pickTurn: 2 }, { championId: 238, pickTurn: 1 }, { championId: -1, pickTurn: 3 }] },
        { teamId: 200, win: !(o.blueWin ?? true), bans: o.bans === false ? [] : [{ championId: 222, pickTurn: 6 }] },
      ],
      // Shuffled positions: the draft must come out top → support.
      participants: [4, 0, 3, 1, 2, 9, 5, 8, 6, 7].map((i) => ({
        participantId: i + 1, teamId: i < 5 ? 100 : 200, teamPosition: POS[i % 5], championName: CHAMPS[i], championId: 1000 + i,
        win: i < 5 ? (o.blueWin ?? true) : !(o.blueWin ?? true), riotIdGameName: i < 5 ? `Us${i}` : `Them${i}`,
      })),
    },
  }
}
const NAMES: Record<number, string> = { 157: 'Yasuo', 238: 'Zed', 222: 'Jinx' }
const champName = (id: number) => NAMES[id] ?? null

describe('draftFromMatch', () => {
  it('our side and theirs, picks top → support, bans in ban order without the skipped ones', () => {
    const d = draftFromMatch(riotMatch(), 100, { matchId: 'EUW1_1', source: 'scrim', opponentName: 'Aegis' }, champName)
    expect(d).toMatchObject({ side: 'blue', win: true, patch: '16.22', durationSec: 1850, source: 'scrim', opponentName: 'Aegis' })
    expect(d.ourPicks).toEqual([
      { champion: 'Gnar', role: 'TOP' }, { champion: 'Vi', role: 'JUNGLE' }, { champion: 'Ahri', role: 'MID' },
      { champion: 'Jinx', role: 'ADC' }, { champion: 'Thresh', role: 'SUPPORT' },
    ])
    expect(d.ourBans).toEqual(['Zed', 'Yasuo'])
    expect(d.theirBans).toEqual(['Jinx'])
    const red = draftFromMatch(riotMatch(), 200, { matchId: 'EUW1_1', source: 'scrim', opponentName: null }, champName)
    expect(red).toMatchObject({ side: 'red', win: false })
    expect(red.ourPicks[0]).toEqual({ champion: 'Renekton', role: 'TOP' })
  })

  it('a custom without draft mode has no bans: null, not an empty list', () => {
    const d = draftFromMatch(riotMatch({ bans: false }), 100, { matchId: 'EUW1_2', source: 'scrim', opponentName: null }, champName)
    expect(d.ourBans).toBeNull()
    expect(d.theirBans).toBeNull()
  })
})

// ── Draft summaries ────────────────────────────────────────────────────────
const entry = (o: Partial<DraftLogEntry>): DraftLogEntry => ({
  id: 'x', groupId: 'g', matchId: null, source: 'scrim', playedAt: '2026-11-18T19:00:00Z', patch: '16.22', opponentName: 'Aegis', opponentKey: 'aegis',
  side: 'blue', win: true, durationSec: 1800, ourPicks: [{ champion: 'Ahri', role: 'MID' }], theirPicks: [{ champion: 'Zed', role: 'MID' }],
  ourBans: ['Yone'], theirBans: ['Jinx'], pickOrder: null, notes: null, createdBy: null, createdAt: '', updatedAt: '', ...o,
})

describe('filterDrafts and summarizeDrafts', () => {
  const log = [
    entry({ id: '1' }),
    entry({ id: '2', side: 'red', win: false, theirBans: ['Jinx', 'Kaisa'], theirPicks: [{ champion: 'Zed', role: 'MID' }] }),
    entry({ id: '3', side: 'red', win: true, opponentKey: 'nova', source: 'tournament', ourPicks: [{ champion: 'Syndra', role: 'MID' }], theirBans: null }),
    entry({ id: '4', win: null, source: 'manual' }),
  ]
  it('filters by opponent, source, side, champion (picked or banned) and result', () => {
    expect(filterDrafts(log, { opponentKey: 'aegis' }).map((d) => d.id)).toEqual(['1', '2', '4'])
    expect(filterDrafts(log, { sources: ['tournament'] }).map((d) => d.id)).toEqual(['3'])
    expect(filterDrafts(log, { side: 'red' }).map((d) => d.id)).toEqual(['2', '3'])
    expect(filterDrafts(log, { champion: 'kaisa' }).map((d) => d.id)).toEqual(['2'])
    expect(filterDrafts(log, { result: 'loss' }).map((d) => d.id)).toEqual(['2'])
  })
  it('summary: record, sides, bans against us, champions on both sides; unknown results left out', () => {
    const s = summarizeDrafts(log)
    expect(s).toMatchObject({ count: 4, wins: 2, losses: 1 })
    expect(s.blue).toEqual({ share: 1, games: 1, wins: 1 })
    expect(s.red).toEqual({ share: 0.5, games: 2, wins: 1 })
    expect(s.bannedAgainstUs).toEqual([{ champion: 'Jinx', count: 3 }, { champion: 'Kaisa', count: 1 }])
    expect(s.ourPicks[0]).toEqual({ champion: 'Ahri', games: 3, wins: 1, winRate: 1 / 3, role: 'MID' })
    // Zed against us: games 1 and 2 (and 4), their win only in game 2.
    expect(s.theirPicks.find((r) => r.champion === 'Zed')).toMatchObject({ games: 4, wins: 1 })
    expect(s.ourFirstPick).toBeNull() // no pick order typed
  })
})

// ── Dossier ────────────────────────────────────────────────────────────────
const g = (matchId: string, win: boolean, champion: string, daysAgo: number, now: number): PlayerRankedGame => ({ matchId, win, champion, at: now - daysAgo * 86_400_000 })

describe('opponent dossier pieces', () => {
  const NOW = Date.parse('2026-11-19T12:00:00Z')
  it('recent form: last 10, newest first', () => {
    const games = Array.from({ length: 12 }, (_, i) => g(`M${i}`, i % 2 === 0, 'Ahri', i, NOW))
    expect(recentFormOf(games)).toEqual(['W', 'L', 'W', 'L', 'W', 'L', 'W', 'L', 'W', 'L'])
  })
  it('pool change: 5 recent games on a champion never played before', () => {
    const games = [...Array.from({ length: 5 }, (_, i) => g(`Z${i}`, true, 'Zeri', i, NOW)), g('O1', true, 'Jinx', 20, NOW)]
    expect(poolChangeOf(games, NOW)).toEqual({ champion: 'Zeri', games: 5, days: 7 })
    expect(poolChangeOf([...games, g('Z_old', true, 'Zeri', 30, NOW)], NOW)).toBeNull()
  })
  it('duos: 3 games together or more', () => {
    const a = { displayName: 'Jungle', games: ['A', 'B', 'C', 'D'].map((m) => g(m, m !== 'D', 'Vi', 1, NOW)) }
    const b = { displayName: 'Mid', games: ['A', 'B', 'C', 'X'].map((m) => g(m, true, 'Ahri', 1, NOW)) }
    const c = { displayName: 'Top', games: ['A', 'Y'].map((m) => g(m, true, 'Gnar', 1, NOW)) }
    expect(duosOf([a, b, c])).toEqual([{ a: 'Jungle', b: 'Mid', games: 3, winRate: 1 }])
  })

  const scouting: SharedScoutingEntry[] = [{
    id: 's1', groupId: 'g', name: 'Aegis Gaming', tag: 'AGS', scoutNotes: 'Scaling comps', createdAt: '', updatedAt: '',
    roster: (['MID', 'TOP'] as const).map((role, i) => ({
      id: `r${i}`, groupId: 'g', userId: null, displayName: role === 'MID' ? 'Faker2' : 'Topson', ign: role === 'MID' ? 'Faker2' : null, tagLine: role === 'MID' ? 'KR1' : null,
      region: 'EUW1', role, status: 'starter' as const, puuid: null, scoutingId: 's1', createdAt: '', updatedAt: '',
      pool: [
        { id: 'p1', rosterId: `r${i}`, championKey: 'Ahri', role, tier: 'main' as const, notes: null, playRate: 120, winRate: 61, masteryPoints: 400_000, kda: 4.2, updatedAt: '' },
        { id: 'p2', rosterId: `r${i}`, championKey: 'Syndra', role, tier: 'flex' as const, notes: null, playRate: 8, winRate: 50, masteryPoints: 20_000, kda: 2, updatedAt: '' },
      ],
    })),
  }]

  it('player cards: starters top → support, top champions with a badge', () => {
    const cards = playerCards(scouting[0], null)
    expect(cards.map((c) => c.role)).toEqual(['TOP', 'MID'])
    expect(cards[1]).toMatchObject({ displayName: 'Faker2', riotId: 'Faker2#KR1', status: 'not_refreshed', recentForm: [] })
    expect(cards[1].topChampions[0]).toMatchObject({ champion: 'Ahri', tier: 'main', games: 120, winRate: 61, threat: 'dominant' })
    expect(cards[1].topChampions[1].threat).toBeNull()
  })

  it('the view: dossier, players, our record against them; Discord text', () => {
    const drafts = [entry({ id: '1', opponentKey: 'aegis gaming', win: true }), entry({ id: '2', opponentKey: 'aegis gaming', win: false }), entry({ id: '3', opponentKey: 'nova' })]
    const view = assembleDossierView({
      opponentKey: 'aegis gaming', scouting, drafts, objectivesVsUs: null, reducedMode: true,
      dossier: { id: 'd', groupId: 'g', opponentKey: 'aegis gaming', opponentName: 'Aegis Gaming', howTheyPlay: 'Scaling', suggestedBans: ['Ahri', 'Zed'], gamePlan: 'Early tempo', status: 'draft', publishedAt: null, snapshot: null, snapshotAt: null, updatedAt: '', updatedBy: null },
    })
    expect(view).toMatchObject({ opponentName: 'Aegis Gaming', opponentTag: 'AGS', scoutNotes: 'Scaling comps', reducedMode: true })
    expect(view.vsUs).toMatchObject({ wins: 1, losses: 1 })
    expect(view.vsUs!.drafts).toHaveLength(2)
    const text = dossierToDiscordText(view)
    expect(text).toContain('**Aegis Gaming [AGS]**')
    expect(text).toContain('Bans: Ahri, Zed')
    expect(text).toContain('MID Faker2: Ahri (120g, 61 %)')
    expect(assembleDossierView({ opponentKey: 'nobody', scouting, drafts: [], objectivesVsUs: null, reducedMode: false, dossier: null }).vsUs).toBeNull()
  })
})

// ── analystCore on a fake Supabase ─────────────────────────────────────────
type Row = Record<string, any>
function fakeSb(tables: Record<string, Row[]>, rpc?: (name: string, args: any) => any) {
  const pick = (row: Row, cols: string) => {
    if (cols.trim() === '*') return { ...row }
    const out: Row = {}
    for (const raw of cols.split(',').map((c) => c.trim())) {
      const [alias, expr] = raw.includes(':') ? raw.split(':') : [raw.split('->')[0], raw]
      const path = expr.split(/->>?/)
      let v: any = row[path[0]]
      for (const k of path.slice(1)) v = v == null ? null : v[k]
      out[alias] = v ?? null
    }
    return out
  }
  const from = (name: string) => {
    tables[name] ??= []
    const filters: Array<(r: Row) => boolean> = []
    let mode: 'select' | 'update' | 'insert' | 'delete' | 'upsert' = 'select'
    let cols = '*'
    let patch: Row = {}
    let inserted: Row[] = []
    const q: any = {
      select: (c = '*') => { cols = c; return q },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q },
      in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return q },
      not: (c: string, _op: string, _v: null) => { filters.push((r) => r[c] !== null && r[c] !== undefined); return q },
      order: () => q, limit: () => q,
      update: (p: Row) => { mode = 'update'; patch = p; return q },
      delete: () => { mode = 'delete'; return q },
      insert: (rows: Row | Row[]) => { mode = 'insert'; inserted = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: `id${Math.random()}`, ...r })); return q },
      upsert: (rows: Row[], _o: unknown) => { mode = 'upsert'; inserted = rows.map((r) => ({ id: `id${Math.random()}`, ...r })); return q },
      run: () => {
        const t = tables[name]
        if (mode === 'insert' || mode === 'upsert') { t.push(...inserted); return inserted.map((r) => pick(r, cols)) }
        const hits = t.filter((r) => filters.every((f) => f(r)))
        if (mode === 'update') { hits.forEach((r) => Object.assign(r, patch)); return hits.map((r) => pick(r, cols)) }
        if (mode === 'delete') { tables[name] = t.filter((r) => !hits.includes(r)); return [] }
        return hits.map((r) => pick(r, cols))
      },
      maybeSingle: async () => ({ data: q.run()[0] ?? null, error: null }),
      single: async () => ({ data: q.run()[0], error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: q.run(), error: null }),
    }
    return q
  }
  return { from, rpc: async (n: string, a: any) => ({ data: rpc?.(n, a), error: null }) } as any
}

function timelineOf() {
  const frames = Array.from({ length: 3 }, (_, m) => ({
    timestamp: m * 60_000,
    participantFrames: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, { totalGold: 500 + m * (i < 5 ? 400 : 300) }])),
    events: m === 1 ? [{ type: 'ELITE_MONSTER_KILL', timestamp: 70_000, killerTeamId: 100, monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON' }] : [],
  }))
  return { info: { frames } }
}

describe('analystCore: objectives', () => {
  it('sourceOf: a tournament event, then the queue', () => {
    expect(sourceOf('tournament', 0)).toBe('tournament')
    expect(sourceOf('scrim', 700)).toBe('tournament')
    expect(sourceOf('scrim', 440)).toBe('flex')
    expect(sourceOf(null, 0)).toBe('scrim')
  })

  const tables = () => ({
    team_sessions: [{ id: 's1', group_id: 'G', calendar_event_id: 'e1' }, { id: 's2', group_id: 'G', calendar_event_id: 'e2' }, { id: 'sX', group_id: 'OTHER', calendar_event_id: null }],
    calendar_events: [{ id: 'e1', kind: 'scrim' }, { id: 'e2', kind: 'tournament' }],
    team_session_games: [
      { id: 'g1', session_id: 's1', match_id: 'EUW1_1', created_at: '2026-11-10T00:00:00Z', match_json: riotMatch({ start: Date.parse('2026-11-18T19:00:00Z') }), our_team_id: null, enemy_team_name: 'Aegis', timeline_summary: null },
      { id: 'g2', session_id: 's2', match_id: 'EUW1_2', created_at: '2026-11-12T00:00:00Z', match_json: null, our_team_id: 200, enemy_team_name: 'Nova', timeline_summary: null },
      { id: 'gX', session_id: 'sX', match_id: 'EUW1_9', created_at: '2026-11-12T00:00:00Z', match_json: null, our_team_id: 100, enemy_team_name: null, timeline_summary: null },
    ],
    group_members: [{ group_id: 'G', riot_id: 'Us0#EUW' }, { group_id: 'G', riot_id: 'Us1#EUW' }],
  })

  it('a reader the RPC refuses (a player who did not report the game) still gets the summary, just not cached', async () => {
    const t = tables()
    const sb = fakeSb(t, () => false)
    const riot = { fetchMatch: vi.fn(), fetchTimeline: vi.fn(async () => timelineOf()) }
    const summary = await loadTeamGameTimeline(sb, 'g1', riot)
    expect(summary).toMatchObject({ version: TEAM_TIMELINE_VERSION, side: 'blue' })
    expect(t.team_session_games[0].timeline_summary).toBeNull()
  })

  it('lists the group\'s games, newest first, with their source', async () => {
    const sb = fakeSb(tables())
    const refs = await listTeamObjectivesGames(sb, 'G', { sources: ['scrim', 'tournament'], side: 'both' })
    expect(refs.map((r) => [r.gameId, r.source, r.cached])).toEqual([['g1', 'scrim', false], ['g2', 'tournament', false]])
    expect(refs[0].playedAt).toBe('2026-11-18T19:00:00.000Z')
    expect((await listTeamObjectivesGames(sb, 'G', { sources: ['tournament'], side: 'both' })).map((r) => r.gameId)).toEqual(['g2'])
  })

  it('extracts once, caches the summary (through the RPC) and our side, then reads the cache without Riot', async () => {
    const t = tables()
    // CyberSecurity S19-13: the summary is written by set_team_game_timeline_summary only (here: an allowed reader).
    const rpc = vi.fn((name: string, args: any) => {
      if (name !== 'set_team_game_timeline_summary') return null
      t.team_session_games.find((g: Row) => g.id === args.p_game)!.timeline_summary = args.p_summary
      return true
    })
    const sb = fakeSb(t, rpc)
    const riot = { fetchMatch: vi.fn(), fetchTimeline: vi.fn(async () => timelineOf()) }
    const first = await loadTeamGameTimeline(sb, 'g1', riot)
    expect(first).toMatchObject({ version: TEAM_TIMELINE_VERSION, side: 'blue', source: 'scrim', opponentName: 'Aegis' })
    expect(riot.fetchMatch).not.toHaveBeenCalled() // match already cached
    expect(t.team_session_games[0].our_team_id).toBe(100) // resolved from the roster's Riot IDs, then kept
    expect(rpc).toHaveBeenCalledWith('set_team_game_timeline_summary', { p_game: 'g1', p_summary: first })
    expect(t.team_session_games[0].timeline_summary).toEqual(first)
    const second = await loadTeamGameTimeline(sb, 'g1', riot)
    expect(second).toEqual(first)
    expect(riot.fetchTimeline).toHaveBeenCalledTimes(1)
  })

  it('ward events: a cached summary without them is re-extracted from the LOCAL raw timeline only, never from Riot', async () => {
    const t = tables()
    const rpc = vi.fn((name: string, args: any) => {
      t.team_session_games.find((g: Row) => g.id === args.p_game)!.timeline_summary = args.p_summary
      return true
    })
    const sb = fakeSb(t, rpc)
    const first: any = await loadTeamGameTimeline(sb, 'g1', { fetchMatch: vi.fn(), fetchTimeline: async () => timelineOf() })
    delete first.players.wards // a summary cached before the ward events were kept
    expect(hasWardEvents(first)).toBe(false)
    t.team_session_games[0].timeline_summary = first

    const withWards = timelineOf()
    ;(withWards.info.frames[1].events as any[]).push({ type: 'WARD_PLACED', timestamp: 65_000, creatorId: 2 }, { type: 'WARD_PLACED', timestamp: 66_000, creatorId: 8 })
    const riot = { fetchMatch: vi.fn(), fetchTimeline: vi.fn(), fetchLocalTimeline: vi.fn(async () => withWards) }
    const out: any = await loadTeamGameTimeline(sb, 'g1', riot, { withPlayers: true, withWards: true, localOnly: true })
    expect(hasWardEvents(out)).toBe(true)
    expect(out.players.wards).toEqual([{ t: 65_000, pid: 2, kind: 'place' }]) // ours only
    expect(riot.fetchTimeline).not.toHaveBeenCalled()
    expect(riot.fetchMatch).not.toHaveBeenCalled()
    // cached now: a second open does not even read the local timeline
    await loadTeamGameTimeline(sb, 'g1', riot, { withPlayers: true, withWards: true, localOnly: true })
    expect(riot.fetchLocalTimeline).toHaveBeenCalledTimes(1)
  })

  it('ward events: raw timeline no longer local = unavailable, no Riot read, summary untouched', async () => {
    const t = tables()
    const sb = fakeSb(t)
    const first: any = await loadTeamGameTimeline(sb, 'g1', { fetchMatch: vi.fn(), fetchTimeline: async () => timelineOf() })
    delete first.players.wards
    t.team_session_games[0].timeline_summary = first
    const riot = { fetchMatch: vi.fn(), fetchTimeline: vi.fn(), fetchLocalTimeline: vi.fn(async () => null) }
    expect(await loadTeamGameTimeline(sb, 'g1', riot, { withWards: true, localOnly: true })).toEqual({ unavailable: 'no-local-timeline' })
    expect(riot.fetchTimeline).not.toHaveBeenCalled()
    expect(t.team_session_games[0].timeline_summary).toBe(first)
    // a web-like adapter (no local reader) behaves the same
    expect(await loadTeamGameTimeline(sb, 'g1', { fetchMatch: vi.fn(), fetchTimeline: vi.fn() }, { withWards: true, localOnly: true })).toEqual({ unavailable: 'no-local-timeline' })
  })

  it('collective stats: only the games lacking ward events are asked for a local re-extraction; a failure leaves them without setup', async () => {
    const t = tables()
    t.team_session_games = [t.team_session_games[0]]
    const sb = fakeSb(t)
    const enrich = vi.fn(async () => ({ unavailable: 'no-local-timeline' }))
    const stats = await getSessionCollective(sb, 's1', enrich)
    expect(enrich).toHaveBeenCalledTimes(1)
    expect(stats?.games[0].setup).toBeNull()
    expect(stats?.games).toHaveLength(1)
    // without a loader (web): nothing is asked
    expect((await getSessionCollective(sb, 's1'))?.gamesCounted).toBe(1)
  })

  it('fetches a missing match and caches it; a Riot failure is reported, not thrown', async () => {
    const t = tables()
    const sb = fakeSb(t)
    const ok = await loadTeamGameTimeline(sb, 'g2', { fetchMatch: async () => riotMatch({ queueId: 0 }), fetchTimeline: async () => timelineOf() })
    expect(ok).toMatchObject({ side: 'red', source: 'tournament' })
    expect(t.team_session_games[1].match_json).not.toBeNull()
    const t2 = tables()
    const failed = await loadTeamGameTimeline(fakeSb(t2), 'g2', { fetchMatch: async () => { throw new Error('429') }, fetchTimeline: vi.fn() })
    expect(failed).toEqual({ unavailable: 'riot-error', message: '429' })
  })

  it('no side found from the roster: unavailable, nothing cached', async () => {
    const t = tables()
    t.group_members = [{ group_id: 'G', riot_id: 'Nobody#EUW' }]
    const out = await loadTeamGameTimeline(fakeSb(t), 'g1', { fetchMatch: vi.fn(), fetchTimeline: vi.fn() })
    expect(out).toEqual({ unavailable: 'no-side' })
    expect(t.team_session_games[0].timeline_summary).toBeNull()
  })

  it('syncDraftsFromGames: adds the cached games missing from the log, once', async () => {
    const t: any = { ...tables(), draft_log: [] as Row[] }
    const sb = fakeSb(t)
    expect(await syncDraftsFromGames(sb, 'G', 'coach-1', champName)).toEqual({ added: 1 }) // g2 has no match yet
    expect(t.draft_log[0]).toMatchObject({ group_id: 'G', created_by: 'coach-1', match_id: 'EUW1_1', side: 'blue', opponent_key: 'aegis', source: 'scrim', patch: '16.22' })
    expect(await syncDraftsFromGames(sb, 'G', 'coach-1', champName)).toEqual({ added: 0 })
  })
})

describe('analystCore: dossiers', () => {
  it('save creates then updates; status goes through the RPC', async () => {
    const t: any = { opponent_dossiers: [] as Row[] }
    const rpc = vi.fn((name: string, args: any) => { const r = t.opponent_dossiers.find((d: Row) => d.id === args.p_id); r.status = args.p_status; return r })
    const sb = fakeSb(t, rpc)
    const input = { opponentName: ' Aegis Gaming ', howTheyPlay: 'Scaling', suggestedBans: ['A', 'B', 'C', 'D', 'E', 'F'], gamePlan: null }
    const d1 = await saveDossier(sb, 'G', 'aegis gaming', input)
    expect(d1).toMatchObject({ opponentName: 'Aegis Gaming', suggestedBans: ['A', 'B', 'C', 'D', 'E'] })
    await saveDossier(sb, 'G', 'aegis gaming', { ...input, gamePlan: 'Early' })
    expect(t.opponent_dossiers).toHaveLength(1)
    expect(t.opponent_dossiers[0].game_plan).toBe('Early')
    const pub = await setDossierStatus(sb, 'G', 'aegis gaming', 'published')
    expect(rpc).toHaveBeenCalledWith('set_opponent_dossier_status', { p_id: t.opponent_dossiers[0].id, p_status: 'published' })
    expect(pub.status).toBe('published')
    await expect(setDossierStatus(sb, 'G', 'nobody', 'published')).rejects.toThrow('NOT_FOUND')
  })

  it('refresh: Riot for each starter, a missing Riot ID reported, snapshot stored with duos', async () => {
    const NOW = Date.parse('2026-11-19T12:00:00Z')
    const t: any = {
      team_rosters: [
        { id: 'r1', group_id: 'G', scouting_id: 's1', display_name: 'Faker2', ign: 'Faker2', tag_line: 'KR1', region: 'EUW1', role: 'MID', status: 'starter', puuid: null, user_id: null },
        { id: 'r2', group_id: 'G', scouting_id: 's1', display_name: 'Ghost', ign: 'Ghost', tag_line: 'EUW', region: 'EUW1', role: 'ADC', status: 'starter', puuid: 'p-ghost', user_id: null },
        { id: 'r3', group_id: 'G', scouting_id: 's1', display_name: 'Lost', ign: 'Lost', tag_line: 'EUW', region: 'EUW1', role: 'TOP', status: 'starter', puuid: null, user_id: null },
      ],
      team_scouting: [{ id: 's1', group_id: 'G', name: 'Aegis Gaming', tag: 'AGS', scout_notes: 'Scaling comps' }],
      team_drafts: [], team_pool_entries: [], opponent_dossiers: [], draft_log: [], team_sessions: [], team_session_games: [],
    }
    const sb = fakeSb(t)
    const shared = ['A', 'B', 'C'].map((m, i) => ({ matchId: m, win: i < 2, champion: 'X', at: NOW - 86_400_000 }))
    const riot = {
      accountByRiotId: vi.fn(async (name: string) => (name === 'Lost' ? null : { puuid: `p-${name}` })),
      rankOf: vi.fn(async () => 'Emerald II'),
      rankedGames: vi.fn(async (puuid: string) => (puuid === 'p-ghost' ? shared : [...shared, { matchId: 'Z', win: false, champion: 'Ahri', at: NOW }])),
    }
    const view = await refreshDossier(sb, 'G', 'aegis gaming', riot, { gamesPerPlayer: 20, reducedMode: true, now: NOW })
    expect(riot.accountByRiotId).toHaveBeenCalledTimes(2) // Ghost's puuid was known
    expect(riot.rankedGames).toHaveBeenCalledWith('p-Faker2', 'EUW1', 20)
    const snap = t.opponent_dossiers[0].snapshot
    expect(snap.players.map((p: any) => [p.displayName, p.status])).toEqual([['Faker2', 'ok'], ['Ghost', 'ok'], ['Lost', 'not_found']])
    expect(snap.duos).toEqual([{ a: 'Faker2', b: 'Ghost', games: 3, winRate: 2 / 3 }])
    // No dossier yet: a draft is created, its summary pre-filled with the scouting notes.
    expect(t.opponent_dossiers).toHaveLength(1)
    expect(t.opponent_dossiers[0]).toMatchObject({ opponent_name: 'Aegis Gaming', opponent_key: 'aegis gaming', how_they_play: 'Scaling comps' })
    expect(view.reducedMode).toBe(true)
  })
})
