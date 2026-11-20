#!/usr/bin/env node
/**
 * End-to-end check of supabase/migrations/20261119224007_scrims_in_planning.sql (#49) and its rollback, on a
 * throw-away Postgres (PGlite, in memory) rebuilt from every migration production has applied (the schema the
 * baseline test proves identical to production), never on the project's database.
 *
 * Usage: node scripts/test-scrims-in-planning.mjs <folder where @electric-sql/pglite is installed>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openPglite, replay, migrationFiles, repo, migDir } from './lib/pgliteSupabase.mjs'

const pgliteDir = process.argv[2]
if (!pgliteDir) { console.error('Pass the folder that holds node_modules/@electric-sql/pglite.'); process.exit(2) }

const MIGRATION = '20261119224007_scrims_in_planning.sql'
const migration = readFileSync(join(migDir, MIGRATION), 'utf-8')
const rollback = readFileSync(join(repo, 'supabase/rollback/20261119224007_rollback.sql'), 'utf-8')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`)
  if (!ok) failures++
}

const db = await openPglite(pgliteDir)
// Everything production has: the files before this one, without the analyst tables (not in production yet).
await replay(db, migrationFiles().filter((f) => f < MIGRATION && !f.startsWith('20261119223819')))

const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows
const u = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const OWNER = u(1), COACH = u(2), ANALYST = u(3), MANAGER = u(4), CAPTAIN = u(5), PLAYER = u(6), PLAYER2 = u(7), OUTSIDER = u(8)
const G = '10000000-0000-0000-0000-000000000001', G2 = '10000000-0000-0000-0000-000000000002'

async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
async function fails(user, sql, params) {
  try { await as(user, () => db.query(sql, params)); return null } catch (e) { return e.message }
}

// ── Data from before the migration ───────────────────────────────────────────
for (const id of [OWNER, COACH, ANALYST, MANAGER, CAPTAIN, PLAYER, PLAYER2, OUTSIDER]) await db.query('insert into auth.users (id) values ($1)', [id])
await db.query(`insert into public.groups (id, name, kind, created_by) values ($1, 'G', 'team', $2), ($3, 'G2', 'team', $4)`, [G, OWNER, G2, OUTSIDER])
for (const [id, role, captain] of [[OWNER, 'owner', false], [COACH, 'coach', false], [ANALYST, 'analyst', false], [MANAGER, 'manager', false],
  [CAPTAIN, 'player', true], [PLAYER, 'player', false], [PLAYER2, 'player', false]]) {
  await db.query('insert into public.group_members (group_id, user_id, role, is_captain, display_name) values ($1, $2, $3, $4, $5)', [G, id, role, captain, id.slice(-2)])
}
await db.query(`insert into public.group_members (group_id, user_id, role, display_name) values ($1, $2, 'owner', 'x')`, [G2, OUTSIDER])
// Published roster: our starters.
for (const [id, role] of [[CAPTAIN, 'TOP'], [PLAYER, 'MID'], [PLAYER2, 'ADC']]) {
  await db.query(`insert into public.team_rosters (group_id, user_id, display_name, role, status, created_by) values ($1, $2, $3, $4, 'starter', $5)`, [G, id, id.slice(-2), role, OWNER])
}
// Two scouted teams whose names give the same key, and one more.
await db.query(`insert into public.team_scouting (id, group_id, name, created_by, updated_at) values
  ('20000000-0000-0000-0000-000000000001', $1, 'Karmine  Academy', $2, now() - interval '2 days'),
  ('20000000-0000-0000-0000-000000000002', $1, 'karmine academy ', $2, now() - interval '1 day'),
  ('20000000-0000-0000-0000-000000000003', $1, 'Vitality Bee', $2, now())`, [G, OWNER])
// Old scrims: one already linked from a slot, one past and one upcoming without any slot.
const S_LINKED = '30000000-0000-0000-0000-000000000001', S_PAST = '30000000-0000-0000-0000-000000000002', S_NEXT = '30000000-0000-0000-0000-000000000003'
await db.query(`insert into public.scrims (id, group_id, title, opponent, scheduled_at, duration_min, created_by) values
  ($1, $4, 'Linked', 'Vitality Bee', now() + interval '3 days', 120, $5),
  ($2, $4, 'Past', 'Nobody Known', now() - interval '3 days', 90, $5),
  ($3, $4, 'Next', null, now() + interval '5 days', 150, $5)`, [S_LINKED, S_PAST, S_NEXT, G, OWNER])
const E_LINKED = '40000000-0000-0000-0000-000000000001'
await db.query(`insert into public.calendar_events (id, group_id, kind, title, starts_at, ends_at, linked_scrim_id, created_by)
  values ($1, $2, 'scrim', 'Linked', now() + interval '3 days', now() + interval '3 days 2 hours', $3, $4)`, [E_LINKED, G, S_LINKED, OWNER])
const sessionsBefore = Number((await one('select count(*) n from public.team_sessions')).n)

// ── The migration, twice ─────────────────────────────────────────────────────
await db.exec(migration)
await db.exec(migration)
check('the migration applies twice', true)

// ── Backfill ─────────────────────────────────────────────────────────────────
const scrims = Object.fromEntries((await all('select id, calendar_event_id, opponent_key, opponent_scouting_id, kind from public.scrims')).map((r) => [r.id, r]))
check('backfill: the slot that already pointed at a scrim is adopted', scrims[S_LINKED].calendar_event_id === E_LINKED)
check('backfill: every scrim has its slot', Object.values(scrims).every((s) => s.calendar_event_id))
const pastEvent = await one('select kind, attendee_scope, linked_scrim_id, extract(epoch from ends_at - starts_at) / 60 as mins from public.calendar_events where id = $1', [scrims[S_PAST].calendar_event_id])
check('backfill: a created slot is a scrim slot for the whole team, with the scrim\'s length and its link',
  pastEvent.kind === 'scrim' && pastEvent.attendee_scope === 'whole_team' && pastEvent.linked_scrim_id === S_PAST && Number(pastEvent.mins) === 90, JSON.stringify(pastEvent))
const sessionOf = async (eventId) => Number((await one('select count(*) n from public.team_sessions where calendar_event_id = $1', [eventId])).n)
check('backfill: an upcoming scrim gets its team session, a past one does not',
  (await sessionOf(scrims[S_NEXT].calendar_event_id)) === 1 && (await sessionOf(scrims[S_PAST].calendar_event_id)) === 0)
check('backfill: the session trigger is back on', (await one(`select tgenabled from pg_trigger where tgname = 'calendar_event_auto_team_session'`)).tgenabled === 'O')
check('backfill: opponent keys, and the scouted team when one has the key',
  scrims[S_LINKED].opponent_key === 'vitality bee' && scrims[S_LINKED].opponent_scouting_id === '20000000-0000-0000-0000-000000000003'
  && scrims[S_PAST].opponent_key === 'nobody known' && scrims[S_PAST].opponent_scouting_id === null && scrims[S_NEXT].opponent_key === null)
check('backfill: no scouted team is created for an old scrim that only had a name',
  Number((await one('select count(*) n from public.team_scouting')).n) === 3)
const keys = Object.fromEntries((await all('select id, opponent_key from public.team_scouting')).map((r) => [r.id, r.opponent_key]))
check('backfill: two teams with the same key are both kept, the newest keeps the key',
  keys['20000000-0000-0000-0000-000000000002'] === 'karmine academy' && keys['20000000-0000-0000-0000-000000000001'] === 'karmine academy (2)', JSON.stringify(keys))
check('backfill: older team sessions untouched', Number((await one('select count(*) n from public.team_sessions')).n) === sessionsBefore + 1)

// ── save_match_event ─────────────────────────────────────────────────────────
const save = (user, event, match) => as(user, () => db.query('select public.save_match_event($1, $2, $3) as id', [G, event, match]))
const start = new Date(Date.now() + 7 * 864e5).toISOString(), end = new Date(Date.now() + 7 * 864e5 + 2.5 * 36e5).toISOString()
const event = { kind: 'scrim', title: 'Scrim vs KCA', startsAt: start, endsAt: end, attendeeScope: 'custom', attendeeUserIds: [CAPTAIN, PLAYER, OUTSIDER] }
const kca = { name: '  Karmine   Academy ', tag: 'KCA', opggUrl: 'https://www.op.gg/multisearch/euw?summoners=A-EUW',
  players: [{ role: 'TOP', riotId: 'Toplaner#EUW' }, { role: 'JUNGLE', riotId: 'Jgl#KC' }, { role: 'MID', riotId: null }] }

for (const [label, user, ev, m, code] of [
  ['a player cannot plan a match', PLAYER, event, { opponent: kca }, 'FORBIDDEN'],
  ['an analyst cannot plan a slot (calendar rights)', ANALYST, event, { opponent: kca }, 'FORBIDDEN'],
  ['a member of another group cannot', OUTSIDER, event, {}, 'FORBIDDEN'],
  ['only scrim or tournament', MANAGER, { ...event, kind: 'flex' }, {}, 'INVALID_KIND'],
  ['the end comes after the start', MANAGER, { ...event, endsAt: start }, {}, 'INVALID_EVENT'],
  ['a format is bo1, bo3 or bo5', MANAGER, event, { boFormat: 'bo7' }, 'INVALID_EVENT'],
  ['an opponent needs a name', MANAGER, event, { opponent: { name: '  ' } }, 'INVALID_OPPONENT'],
  ['one player per role', MANAGER, event, { opponent: { name: 'X', players: [{ role: 'TOP', riotId: 'a#1' }, { role: 'TOP', riotId: 'b#1' }] } }, 'INVALID_OPPONENT'],
  ['an unknown role', MANAGER, event, { opponent: { name: 'X', players: [{ role: 'UTILITY', riotId: 'a#1' }] } }, 'INVALID_OPPONENT'],
  ['six players', MANAGER, event, { opponent: { name: 'X', players: ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT', 'TOP'].map((role) => ({ role })) } }, 'INVALID_OPPONENT'],
  ['an OP.GG link that is not a stats site', MANAGER, event, { opponent: { name: 'X', opggUrl: 'https://evil.example/op.gg' } }, 'INVALID_OPPONENT'],
  ['an OP.GG link over plain http', MANAGER, event, { opponent: { name: 'X', opggUrl: 'http://op.gg/x' } }, 'INVALID_OPPONENT'],
  ['a slot of another group', MANAGER, { ...event, id: E_LINKED.replace('4000', '4999') }, {}, 'NOT_FOUND'],
]) {
  const msg = await fails(user, 'select public.save_match_event($1, $2, $3)', [G, ev, m])
  check(`save_match_event refuses: ${label}`, (msg ?? '').includes(code), msg ?? 'accepted')
}
check('nothing was written by the refused calls', Number((await one(`select count(*) n from public.calendar_events where title = 'Scrim vs KCA'`)).n) === 0)

const eventId = (await save(MANAGER, event, { boFormat: 'bo3', opponent: kca })).rows[0].id
const ev1 = await one('select kind, title, attendee_scope, linked_scrim_id from public.calendar_events where id = $1', [eventId])
const sc1 = await one('select id, kind, opponent, opponent_key, opponent_scouting_id, bo_format, duration_min, scheduled_at from public.scrims where calendar_event_id = $1', [eventId])
check('a manager plans a scrim: one slot, one scrim linked both ways',
  ev1.kind === 'scrim' && sc1 && ev1.linked_scrim_id === sc1.id && sc1.kind === 'scrim' && sc1.bo_format === 'bo3' && sc1.duration_min === 150, JSON.stringify({ ev1, sc1 }))
const attendees = (await all('select user_id from public.calendar_event_attendees where event_id = $1 order by user_id', [eventId])).map((r) => r.user_id)
check('attendees: members of the group only', JSON.stringify(attendees) === JSON.stringify([CAPTAIN, PLAYER]), JSON.stringify(attendees))
check('the team session is opened for the slot', (await sessionOf(eventId)) === 1)
check('the opponent is reused by its key (spaces and case ignored), not duplicated',
  sc1.opponent_key === 'karmine academy' && sc1.opponent_scouting_id === '20000000-0000-0000-0000-000000000002' && sc1.opponent === 'Karmine   Academy')
const kcaTeam = await one(`select tag, opgg_url, source from public.team_scouting where id = '20000000-0000-0000-0000-000000000002'`)
check('an empty tag and OP.GG link are filled in, the team stays a published one',
  kcaTeam.tag === 'KCA' && kcaTeam.opgg_url.startsWith('https://www.op.gg/') && kcaTeam.source === 'publish', JSON.stringify(kcaTeam))
const roster = async (scoutingId) => Object.fromEntries((await all('select role, ign, tag_line from public.team_rosters where scouting_id = $1', [scoutingId])).map((r) => [r.role, `${r.ign}#${r.tag_line}`]))
const r1 = await roster('20000000-0000-0000-0000-000000000002')
check('its players are added by role (a player without a Riot ID is skipped)',
  r1.TOP === 'Toplaner#EUW' && r1.JUNGLE === 'Jgl#KC' && !('MID' in r1), JSON.stringify(r1))

// CHOICE 2: the manager does not change what is already scouted, a coach does.
await save(MANAGER, { ...event, id: eventId }, { boFormat: 'bo3', opponent: { name: 'KARMINE ACADEMY', tag: 'NEW', players: [{ role: 'TOP', riotId: 'Other#EUW' }, { role: 'MID', riotId: 'Mid#EUW' }] } })
const r2 = await roster('20000000-0000-0000-0000-000000000002')
const tag2 = (await one(`select tag from public.team_scouting where id = '20000000-0000-0000-0000-000000000002'`)).tag
check('a manager fills an empty role but does not change a scouted player or tag', r2.TOP === 'Toplaner#EUW' && r2.MID === 'Mid#EUW' && tag2 === 'KCA', JSON.stringify({ r2, tag2 }))
await save(COACH, { ...event, id: eventId }, { boFormat: 'bo5', opponent: { name: 'Karmine Academy', tag: 'KC2', players: [{ role: 'TOP', riotId: 'Other#EUW' }] } })
const r3 = await roster('20000000-0000-0000-0000-000000000002')
const tag3 = (await one(`select tag from public.team_scouting where id = '20000000-0000-0000-0000-000000000002'`)).tag
check('a coach (staff) may change them', r3.TOP === 'Other#EUW' && tag3 === 'KC2', JSON.stringify({ r3, tag3 }))
check('editing the same slot keeps one scrim', Number((await one('select count(*) n from public.scrims where calendar_event_id = $1', [eventId])).n) === 1)
{
  const withoutAttendees = { ...event }
  delete withoutAttendees.attendeeUserIds
  await save(MANAGER, { ...withoutAttendees, id: eventId }, { boFormat: 'bo5' })
  const kept = (await all('select user_id from public.calendar_event_attendees where event_id = $1 order by user_id', [eventId])).map((r) => r.user_id)
  check('an edit that does not send attendeeUserIds keeps the attendees', JSON.stringify(kept) === JSON.stringify([CAPTAIN, PLAYER]), JSON.stringify(kept))
  await save(MANAGER, { ...event, id: eventId, attendeeUserIds: [PLAYER2] }, { boFormat: 'bo5' })
  const replaced = (await all('select user_id from public.calendar_event_attendees where event_id = $1', [eventId])).map((r) => r.user_id)
  check('an edit that sends them replaces them', JSON.stringify(replaced) === JSON.stringify([PLAYER2]), JSON.stringify(replaced))
  await save(MANAGER, { ...event, id: eventId }, { boFormat: 'bo3', opponent: { name: 'Karmine Academy' } })
}

// A new opponent, an official match (CHOICE 1).
const offId = (await save(CAPTAIN, { ...event, kind: 'tournament', title: 'Cup', attendeeUserIds: [] }, { opponent: { name: 'Team Nova', players: [{ role: 'SUPPORT', riotId: 'Supp#NA1', region: 'NA1' }] } })).rows[0].id
const off = await one('select s.kind, t.source, t.name, t.created_by from public.scrims s join public.team_scouting t on t.id = s.opponent_scouting_id where s.calendar_event_id = $1', [offId])
check('a captain plans an official match: the scrim is "official", the new opponent is created from the slot',
  off.kind === 'official' && off.source === 'match' && off.name === 'Team Nova' && off.created_by === CAPTAIN, JSON.stringify(off))
await save(MANAGER, event, {})
check('a scrim without an opponent is allowed', Number((await one(`select count(*) n from public.scrims where title = 'Scrim vs KCA' and opponent_key is null`)).n) === 1)

// ── Writers that do not know the key ─────────────────────────────────────────
await as(COACH, () => db.query(`insert into public.team_scouting (group_id, name) values ($1, ' Old  Client Team')`, [G]))
check('a scouted team inserted without a key (web, older desktop) gets it from its name',
  (await one(`select opponent_key from public.team_scouting where name = ' Old  Client Team'`)).opponent_key === 'old client team')
check('a second team with the same name is refused', /duplicate key|unique/.test(await fails(COACH, `insert into public.team_scouting (group_id, name) values ($1, 'old client team')`, [G]) ?? ''))
await as(COACH, () => db.query(`update public.team_scouting set name = 'Team Nova Rebrand' where group_id = $1 and name = 'Team Nova'`, [G]))
check('a rename moves the key, and the scrims against that team follow',
  Number((await one(`select count(*) n from public.scrims where opponent_key = 'team nova rebrand'`)).n) === 1
  && Number((await one(`select count(*) n from public.scrims where opponent_key = 'team nova'`)).n) === 0)

// ── The scrim follows its slot ───────────────────────────────────────────────
await db.query(`update public.scrims set reminder_24h_sent = true, low_availability_notified = true where calendar_event_id = $1`, [eventId])
await as(MANAGER, () => db.query(`update public.calendar_events set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' + interval '30 minutes' where id = $1`, [eventId]))
const moved = await one(`select s.scheduled_at = e.starts_at as same, s.duration_min, s.reminder_24h_sent, s.low_availability_notified
  from public.scrims s join public.calendar_events e on e.id = s.calendar_event_id where e.id = $1`, [eventId])
check('moving the slot moves the scrim, its length, and re-arms its reminders',
  moved.same && moved.duration_min === 180 && !moved.reminder_24h_sent && !moved.low_availability_notified, JSON.stringify(moved))

// ── update_match_detail ──────────────────────────────────────────────────────
const detail = (user, patch) => as(user, () => db.query('select public.update_match_detail($1, $2)', [sc1.id, patch]))
await detail(ANALYST, { prepNotes: 'Ban Azir', checklist: [{ label: 'VOD', done: true }], draftIds: ['d1'], status: 'done' })
const d1 = await one('select prep_notes, checklist, draft_ids, status from public.scrims where id = $1', [sc1.id])
check('an analyst writes the preparation and the status', d1.prep_notes === 'Ban Azir' && d1.checklist[0].done === true && d1.draft_ids[0] === 'd1' && d1.status === 'done', JSON.stringify(d1))
await detail(MANAGER, { reviewNotes: 'Good early' })
check('a manager writes the review, the rest is untouched', (await one('select review_notes, prep_notes from public.scrims where id = $1', [sc1.id])).prep_notes === 'Ban Azir')
for (const [label, user, patch, code] of [
  ['a player', PLAYER, { prepNotes: 'x' }, 'FORBIDDEN'],
  ['an unknown field', COACH, { title: 'x' }, 'INVALID_DETAIL'],
  ['a bad checklist', COACH, { checklist: [{ label: 1 }] }, 'INVALID_DETAIL'],
  ['a bad status', COACH, { status: 'won' }, 'INVALID_DETAIL'],
  ['too many drafts (table rule)', COACH, { draftIds: Array.from({ length: 11 }, (_, i) => `d${i}`) }, 'INVALID_DETAIL'],
]) {
  const msg = await fails(user, 'select public.update_match_detail($1, $2)', [sc1.id, patch])
  check(`update_match_detail refuses ${label}`, (msg ?? '').includes(code), msg ?? 'accepted')
}

// ── Opponent roles from the detail panel ─────────────────────────────────────
{
  const KCA = '20000000-0000-0000-0000-000000000002'
  const rolesOf = async (scoutingId) => Object.fromEntries((await all('select ign, role from public.team_rosters where scouting_id = $1', [scoutingId])).map((x) => [x.ign, x.role]))
  const before = await rolesOf(KCA)
  const others = await all(`select id, role from public.team_rosters where scouting_id is distinct from $1 order by id`, [KCA])
  await detail(MANAGER, { opponentRoles: [{ riotId: ' other#EUW ', role: 'MID' }, { riotId: 'Mid#euw', role: 'TOP' }] })
  const after = await rolesOf(KCA)
  check('a manager swaps two opponent roles from the panel (Riot ID case and spaces ignored)',
    after.Other === 'MID' && after.Mid === 'TOP' && after.Jgl === before.Jgl, JSON.stringify({ before, after }))
  check('nothing else changes: the other rosters keep their roles',
    JSON.stringify(await all(`select id, role from public.team_rosters where scouting_id is distinct from $1 order by id`, [KCA])) === JSON.stringify(others))
  for (const [label, user, patch, code] of [
    ['a player', PLAYER, { opponentRoles: [{ riotId: 'Jgl#KC', role: 'TOP' }] }, 'FORBIDDEN'],
    ['a Riot ID that is not one of the opponent\'s players', COACH, { opponentRoles: [{ riotId: 'Ghost#EUW', role: 'TOP' }] }, 'INVALID_DETAIL'],
    ['the same role twice', COACH, { opponentRoles: [{ riotId: 'Jgl#KC', role: 'TOP' }, { riotId: 'Other#EUW', role: 'TOP' }] }, 'INVALID_DETAIL'],
    ['an unknown role', COACH, { opponentRoles: [{ riotId: 'Jgl#KC', role: 'UTILITY' }] }, 'INVALID_DETAIL'],
    ['a value without a tag', COACH, { opponentRoles: [{ riotId: 'Jgl', role: 'TOP' }] }, 'INVALID_DETAIL'],
  ]) {
    const msg = await fails(user, 'select public.update_match_detail($1, $2)', [sc1.id, patch])
    check(`opponent roles refused: ${label}`, (msg ?? '').includes(code), msg ?? 'accepted')
  }
  // One bad Riot ID in the list: nothing of the list is written.
  await fails(COACH, 'select public.update_match_detail($1, $2)', [sc1.id, { opponentRoles: [{ riotId: 'Jgl#KC', role: 'SUPPORT' }, { riotId: 'Ghost#EUW', role: 'ADC' }] }])
  check('a refused list writes nothing (the valid line is rolled back too)', (await rolesOf(KCA)).Jgl === after.Jgl)
  const noOpp = (await one(`select id from public.scrims where title = 'Scrim vs KCA' and opponent_key is null`)).id
  check('a scrim without a scouted opponent has no roles to set',
    /INVALID_DETAIL/.test(await fails(COACH, 'select public.update_match_detail($1, $2)', [noOpp, { opponentRoles: [{ riotId: 'Jgl#KC', role: 'TOP' }] }]) ?? ''))
}

// ── Presence on the slot drives the availability check ───────────────────────
await db.exec('delete from public.notifications')
const soonStart = new Date(Date.now() + 20 * 36e5).toISOString(), soonEnd = new Date(Date.now() + 22 * 36e5).toISOString()
const soonId = (await save(MANAGER, { ...event, title: 'Soon', startsAt: soonStart, endsAt: soonEnd, attendeeUserIds: [CAPTAIN, PLAYER, PLAYER2] }, {})).rows[0].id
await as(CAPTAIN, () => db.query(`select public.respond_to_calendar_event($1, 'confirmed')`, [soonId]))
await db.exec('select public.run_scrim_availability_check()')
const soonScrim = (await one('select id from public.scrims where calendar_event_id = $1', [soonId])).id
const missing = (await all(`select user_id from public.notifications where type = 'scrim_availability_missing' and data->>'scrimId' = $1`, [soonScrim])).map((r) => r.user_id)
const low = await one(`select data->>'yesCount' as yes from public.notifications where type = 'scrim_low_availability' and data->>'scrimId' = $1 limit 1`, [soonScrim])
check('the availability check reads the slot\'s answers: 1 confirmed, the two others reminded',
  low?.yes === '1' && missing.length === 2 && !missing.includes(CAPTAIN), JSON.stringify({ low, missing }))

// ── Deleting the slot (CHOICE 3) ─────────────────────────────────────────────
const before = Number((await one('select count(*) n from public.team_scouting')).n)
await as(MANAGER, () => db.query('delete from public.calendar_events where id = $1', [offId]))
check('deleting the slot deletes its scrim and keeps the opponent',
  Number((await one('select count(*) n from public.scrims s where s.calendar_event_id = $1', [offId])).n) === 0
  && Number((await one('select count(*) n from public.team_scouting')).n) === before)

// ── Who may call what ────────────────────────────────────────────────────────
await db.exec('set role anon')
let anonRefused = 0
for (const sql of ['select public.save_match_event(null, null, null)', 'select public.update_match_detail(null, null)']) {
  try { await db.query(sql) } catch (e) { if (/permission denied/.test(e.message)) anonRefused++ }
}
await db.exec('reset role')
check('anon may call neither RPC', anonRefused === 2)
check('a member cannot write the new columns around the RPC (RLS on scouting stays staff only)',
  /row-level security|permission denied|violates/.test(await fails(MANAGER, `insert into public.team_scouting (group_id, name, opponent_key) values ($1, 'Sneaky', 'sneaky')`, [G]) ?? ''))

// ── Rollback ─────────────────────────────────────────────────────────────────
await db.exec(rollback)
await db.exec(rollback)
check('the rollback applies twice', true)
const leftCols = await all(`select table_name || '.' || column_name c from information_schema.columns
  where (table_name = 'scrims' and column_name in ('calendar_event_id', 'kind', 'opponent_key'))
     or (table_name = 'team_scouting' and column_name in ('opponent_key', 'source', 'opgg_url'))`)
check('rollback: the new columns are gone', leftCols.length === 0, JSON.stringify(leftCols))
const leftFns = await all(`select proname from pg_proc where proname in ('save_match_event', 'update_match_detail', 'scrim_follows_its_event', 'match_kind_of', 'opponent_key_of', 'team_scouting_key', 'team_scouting_key_moved')`)
check('rollback: the new functions are gone', leftFns.length === 0, JSON.stringify(leftFns))
const body = (await one(`select prosrc from pg_proc where proname = 'run_scrim_availability_check'`)).prosrc
const original = readFileSync(join(migDir, '20261119211601_member_staff_roles.sql'), 'utf-8').replace(/\r/g, '')
const norm = (t) => t.replace(/\s+/g, ' ').trim()
check('rollback: run_scrim_availability_check is back to its 20261119211601 body', norm(original).includes(norm(body)))
check('rollback: the scrims and the slots made for them are kept', Number((await one('select count(*) n from public.scrims')).n) >= 3)
await db.exec(migration)
check('the migration applies again after the rollback', Number((await one(`select count(*) n from information_schema.columns where table_name = 'scrims' and column_name = 'calendar_event_id'`)).n) === 1)

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
