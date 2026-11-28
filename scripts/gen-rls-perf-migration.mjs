// Generates supabase/migrations/20261128120000_rls_performance.sql, its rollback and the before/after policy
// table (docs/audits/SUPABASE_RLS_PERF_2026-11-28.md) from the ORIGINAL production policies below, copied
// verbatim from pg_policies on 28/11/2026 (project zwubyzrfpelhxjjezvrh). Run: node scripts/gen-rls-perf-migration.mjs
//
// Rules (health check 28/11/2026, "without changing who can access what"):
// - Postgres ORs permissive policies of one command, USING with USING and WITH CHECK with WITH CHECK, and an ALL
//   policy is exactly a SELECT + INSERT + UPDATE + DELETE policy with the same expressions (INSERT and UPDATE check
//   = WITH CHECK, or USING when there is none). So, per table, every policy that overlaps another is split into
//   per-command atoms and the atoms of one command are ORed into ONE policy: same rows, same checks.
// - Merged policies are TO authenticated. Some originals were TO public (anon too), but every one of their
//   expressions needs a row matching auth.uid() (private.group_role / is_group_staff / can_edit_calendar /
//   can_manage_session / can_prepare_session all filter group_members on user_id = auth.uid(), or the row's own
//   user column = auth.uid()), and auth.uid() is NULL for anon: anon never had access through them.
// - auth.uid() becomes (select auth.uid()) everywhere (evaluated once per statement instead of once per row).
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = '20261128120000_rls_performance'

const GR = (x) => `(private.group_role(${x}) IS NOT NULL)`
const TSG = 'private.team_session_group(session_id)'

// ── Original policies (verbatim) ─────────────────────────────────────────────────────────────────────────────────
// Each table: the policies that are rewritten. p(name, roles, cmd, using, check)
const p = (n, roles, cmd, q, c = null) => ({ n, roles, cmd, q, c })
const auth = ['authenticated']
const pub = ['public']
const readWrite = (t, readName, readRoles, readQ, writeName, writeRoles, writeQ, writeC = writeQ, extra = []) =>
  ({ t, merge: true, policies: [p(readName, readRoles, 'SELECT', readQ), p(writeName, writeRoles, 'ALL', writeQ, writeC), ...extra] })

const MERGED = [
  readWrite('announcements', 'announcements_read', auth, GR('group_id'), 'announcements_write', pub, 'private.can_edit_calendar(group_id)'),
  readWrite('availability_exceptions', 'availability_exceptions_read', auth, GR('group_id'), 'availability_exceptions_write', pub,
    '((user_id = auth.uid()) OR private.can_edit_calendar(group_id))',
    '((private.group_role(group_id, user_id) IS NOT NULL) AND ((user_id = auth.uid()) OR private.can_edit_calendar(group_id)))'),
  readWrite('availability_rules', 'availability_rules_read', auth, GR('group_id'), 'availability_rules_write', pub,
    '((user_id = auth.uid()) OR private.can_edit_calendar(group_id))',
    '((private.group_role(group_id, user_id) IS NOT NULL) AND ((user_id = auth.uid()) OR private.can_edit_calendar(group_id)))'),
  readWrite('calendar_event_attendees', 'calendar_event_attendees_read', pub,
    '(EXISTS ( SELECT 1 FROM calendar_events e WHERE ((e.id = calendar_event_attendees.event_id) AND (private.group_role(e.group_id) IS NOT NULL))))',
    'calendar_event_attendees_write', pub,
    '(EXISTS ( SELECT 1 FROM calendar_events e WHERE ((e.id = calendar_event_attendees.event_id) AND private.can_edit_calendar(e.group_id))))'),
  readWrite('calendar_events', 'calendar_events_read', auth, GR('group_id'), 'calendar_events_write', pub, 'private.can_edit_calendar(group_id)'),
  readWrite('dev_plan_axes', 'dev_plan_axes_read', auth,
    '(EXISTS ( SELECT 1 FROM dev_plans p WHERE ((p.id = dev_plan_axes.plan_id) AND ((p.player_id = ( SELECT auth.uid() AS uid)) OR private.is_group_staff(p.group_id)))))',
    'dev_plan_axes_write_staff', auth,
    '(EXISTS ( SELECT 1 FROM dev_plans p WHERE ((p.id = dev_plan_axes.plan_id) AND private.is_group_staff(p.group_id))))'),
  readWrite('dev_plan_checkins', 'dev_plan_checkins_read', auth,
    '(EXISTS ( SELECT 1 FROM dev_plans p WHERE ((p.id = dev_plan_checkins.plan_id) AND ((p.player_id = ( SELECT auth.uid() AS uid)) OR private.is_group_staff(p.group_id)))))',
    'dev_plan_checkins_write_staff', auth,
    '(EXISTS ( SELECT 1 FROM dev_plans p WHERE ((p.id = dev_plan_checkins.plan_id) AND private.is_group_staff(p.group_id))))'),
  readWrite('dev_plan_progress', 'dev_plan_progress_read', auth,
    '(EXISTS ( SELECT 1 FROM (dev_plan_axes a JOIN dev_plans p ON ((p.id = a.plan_id))) WHERE ((a.id = dev_plan_progress.axis_id) AND ((p.player_id = ( SELECT auth.uid() AS uid)) OR private.is_group_staff(p.group_id)))))',
    'dev_plan_progress_write_own', auth,
    '(EXISTS ( SELECT 1 FROM (dev_plan_axes a JOIN dev_plans p ON ((p.id = a.plan_id))) WHERE ((a.id = dev_plan_progress.axis_id) AND (p.player_id = ( SELECT auth.uid() AS uid)))))'),
  readWrite('dev_plans', 'dev_plans_read', auth, '((player_id = ( SELECT auth.uid() AS uid)) OR private.is_group_staff(group_id))',
    'dev_plans_write_staff', auth, 'private.is_group_staff(group_id)'),
  readWrite('discord_guild_links', 'discord_guild_links_read', auth, GR('group_id'), 'discord_guild_links_write_staff', auth, 'private.is_group_staff(group_id)'),
  readWrite('group_fundamentals', 'group_fundamentals_read', pub, GR('group_id'), 'group_fundamentals_write', pub, 'private.can_manage_session(group_id)'),
  { t: 'group_sharing', merge: true, policies: [
    p('sharing_own_rows', auth, 'ALL', '(user_id = ( SELECT auth.uid() AS uid))', '((user_id = ( SELECT auth.uid() AS uid)) AND (private.group_role(group_id) IS NOT NULL))'),
    p('sharing_staff_read', auth, 'SELECT', 'private.is_group_staff(group_id)'),
  ] },
  readWrite('scrim_availability', 'availability_read_members', auth, '(private.group_role(private.scrim_group(scrim_id)) IS NOT NULL)',
    'availability_write_own', auth, '(user_id = ( SELECT auth.uid() AS uid))',
    '((user_id = ( SELECT auth.uid() AS uid)) AND (private.group_role(private.scrim_group(scrim_id)) IS NOT NULL))'),
  readWrite('staff_notes', 'staff_notes_read_staff', auth, 'private.is_group_staff(group_id)', 'staff_notes_write_staff', auth, 'private.is_group_staff(group_id)'),
  readWrite('tasks', 'tasks_read', auth, GR('group_id'), 'tasks_write_staff', auth, 'private.is_group_staff(group_id)', 'private.is_group_staff(group_id)', [
    p('tasks_update_own_assignment', auth, 'UPDATE', '(assignee_id = ( SELECT auth.uid() AS uid))', '(assignee_id = ( SELECT auth.uid() AS uid))'),
  ]),
  readWrite('team_codex_rules', 'team_codex_read', auth, GR('group_id'), 'team_codex_write_staff', auth, 'private.is_group_staff(group_id)'),
  readWrite('team_custom_games', 'team_custom_games_read', auth, GR('group_id'), 'team_custom_games_write_staff', auth, 'private.is_group_staff(group_id)'),
  readWrite('team_drafts', 'team_drafts_read', auth, GR('group_id'), 'team_drafts_write_staff', auth, 'private.is_group_staff(group_id)'),
  readWrite('team_pool_entries', 'team_pool_read', auth,
    '(EXISTS ( SELECT 1 FROM team_rosters r WHERE ((r.id = team_pool_entries.roster_id) AND (private.group_role(r.group_id) IS NOT NULL))))',
    'team_pool_write', auth,
    '(EXISTS ( SELECT 1 FROM team_rosters r WHERE ((r.id = team_pool_entries.roster_id) AND (private.is_group_staff(r.group_id) OR (r.user_id = ( SELECT auth.uid() AS uid))))))'),
  readWrite('team_rosters', 'team_rosters_read', auth, GR('group_id'), 'team_rosters_write_staff', auth, 'private.is_group_staff(group_id)'),
  readWrite('team_scouting', 'team_scouting_read', auth, GR('group_id'), 'team_scouting_write_staff', auth, 'private.is_group_staff(group_id)'),
  readWrite('team_session_attendance', 'team_session_attendance_read', auth, GR(TSG), 'team_session_attendance_write', auth, `private.can_manage_session(${TSG})`),
  readWrite('team_session_drafts', 'team_session_drafts_read', auth, GR(TSG), 'team_session_drafts_write', auth, 'private.can_prepare_session(session_id)'),
  readWrite('team_session_objectives', 'team_session_objectives_read', pub, GR(TSG), 'team_session_objectives_write', pub,
    `(private.can_manage_session(${TSG}) OR private.is_group_staff(${TSG}))`),
  readWrite('team_session_player_objectives', 'team_session_player_objectives_read', auth, GR(TSG), 'team_session_player_objectives_write', auth,
    'private.can_prepare_session(session_id)', `(private.can_prepare_session(session_id) AND (private.group_role(${TSG}, player_id) IS NOT NULL))`),
  readWrite('team_session_prep_notes', 'team_session_prep_notes_read', auth, GR(TSG), 'team_session_prep_notes_write', auth, 'private.can_prepare_session(session_id)'),
  readWrite('team_session_reviews', 'team_session_reviews_read', pub, GR(TSG), 'team_session_reviews_write', pub, `private.can_manage_session(${TSG})`),
  readWrite('vod_review_assignments', 'vod_assignments_read', auth, '(private.group_role(private.vod_session_group(session_id)) IS NOT NULL)',
    'vod_assignments_write_staff', auth, 'private.is_group_staff(private.vod_session_group(session_id))', 'private.is_group_staff(private.vod_session_group(session_id))', [
      p('vod_assignments_update_own_status', auth, 'UPDATE', '(player_id = ( SELECT auth.uid() AS uid))', '(player_id = ( SELECT auth.uid() AS uid))'),
    ]),
  readWrite('vod_review_sessions', 'vod_sessions_read', auth, GR('group_id'), 'vod_sessions_write_staff', auth, 'private.is_group_staff(group_id)'),
  // Two SELECT policies.
  { t: 'sync_records', merge: true, policies: [
    p('sync_records_read_shared', auth, 'SELECT', 'private.can_read_synced_row(user_id, table_name, data)'),
    p('sync_records_select_own', auth, 'SELECT', '(user_id = ( SELECT auth.uid() AS uid))'),
  ] },
  // Two DELETE policies.
  { t: 'micro_review_verdicts', merge: true, policies: [
    p('micro_verdicts_delete_orphaned', auth, 'DELETE', '((coach_id IS NULL) AND private.is_group_staff(group_id))'),
    p('micro_verdicts_delete_own', auth, 'DELETE', '(coach_id = auth.uid())'),
  ] },
]

// Only auth.uid() per row (auth_rls_initplan): same policy, same roles, expression rewritten in place.
const INITPLAN = [
  { t: 'team_discussion_comments', policies: [
    p('team_discussion_insert', pub, 'INSERT', null, '((author_id = auth.uid()) AND (private.group_role(group_id) IS NOT NULL))'),
    p('team_discussion_delete', pub, 'DELETE', '((author_id = auth.uid()) OR private.is_group_staff(group_id))'),
  ] },
  { t: 'calendar_event_requests', policies: [
    p('calendar_event_requests_insert', pub, 'INSERT', null, '((requested_by = auth.uid()) AND (private.group_role(group_id) IS NOT NULL))'),
    p('calendar_event_requests_read', pub, 'SELECT', '((requested_by = auth.uid()) OR private.can_edit_calendar(group_id))'),
    p('calendar_event_requests_delete', pub, 'DELETE', '((requested_by = auth.uid()) OR private.can_edit_calendar(group_id))'),
  ] },
  { t: 'announcement_dismissals', policies: [p('announcement_dismissals_own', pub, 'ALL', '(user_id = auth.uid())', '(user_id = auth.uid())')] },
  { t: 'team_session_feedback', policies: [
    p('team_session_feedback_write', pub, 'INSERT', null, `((user_id = auth.uid()) AND (private.group_role(${TSG}) IS NOT NULL))`),
    p('team_session_feedback_update', pub, 'UPDATE', '(user_id = auth.uid())', '(user_id = auth.uid())'),
  ] },
  { t: 'micro_review_answers', policies: [
    p('micro_answers_read', auth, 'SELECT', "((player_id = auth.uid()) OR private.can_read_player_table(player_id, 'Mistake'::text))"),
    p('micro_answers_insert_own', auth, 'INSERT', null, '(player_id = auth.uid())'),
    p('micro_answers_update_own', auth, 'UPDATE', '(player_id = auth.uid())', '(player_id = auth.uid())'),
    p('micro_answers_delete_own', auth, 'DELETE', '(player_id = auth.uid())'),
  ] },
  { t: 'micro_review_verdicts', policies: [
    p('micro_verdicts_read', auth, 'SELECT', '((private.micro_answer_player(answer_id) = auth.uid()) OR private.is_group_staff(group_id))'),
    p('micro_verdicts_write_staff', auth, 'INSERT', null,
      "((coach_id = auth.uid()) AND private.is_group_staff(group_id) AND private.can_read_player_table(private.micro_answer_player(answer_id), 'Mistake'::text) AND (EXISTS ( SELECT 1 FROM group_members m WHERE ((m.group_id = micro_review_verdicts.group_id) AND (m.user_id = private.micro_answer_player(micro_review_verdicts.answer_id))))))"),
    p('micro_verdicts_update_own', auth, 'UPDATE', '((coach_id = auth.uid()) AND private.is_group_staff(group_id))', '((coach_id = auth.uid()) AND private.is_group_staff(group_id))'),
  ] },
]
// availability_rules_write / availability_exceptions_write (also flagged) are rewritten by their merge above.

const FK_INDEXES = `access_invites created_by
announcement_dismissals user_id
announcements created_by
assigned_objectives assigned_by
assigned_objectives group_id
availability_exceptions user_id
availability_rules user_id
calendar_event_attendees user_id
calendar_event_requests group_id
calendar_event_requests requested_by
calendar_events created_by
calendar_events linked_scrim_id
calendar_subscriptions created_by
dev_plan_checkins created_by
dev_plans created_by
dev_plans player_id
discord_guild_link_codes created_by
discord_guild_link_codes group_id
discord_guild_links linked_by
discord_user_link_codes user_id
draft_log created_by
event_response_reminders sent_by
event_response_reminders user_id
group_fundamentals created_by
group_fundamentals group_id
group_invites created_by
group_sharing user_id
groups created_by
micro_review_verdicts coach_id
micro_review_verdicts group_id
opponent_dossiers updated_by
report_shares created_by
review_comments author_id
review_comments parent_id
scrim_availability user_id
scrim_availability_reminders user_id
scrims created_by
scrims opponent_scouting_id
staff_notes created_by
staff_notes player_id
tasks assignee_id
tasks created_by
team_codex_rules created_by
team_custom_games created_by
team_discussion_comments author_id
team_discussion_comments group_id
team_drafts created_by
team_drafts vs_scouting_id
team_rosters created_by
team_rosters user_id
team_scouting created_by
team_session_attendance marked_by
team_session_attendance user_id
team_session_drafts created_by
team_session_feedback user_id
team_session_games reported_by
team_session_objective_results set_by
team_session_objectives set_by
team_session_player_objectives player_id
team_session_player_objectives set_by
team_session_prep_notes set_by
team_session_reviews recorded_by
trial_candidates created_by
trial_candidates user_id
trial_evaluations created_by
vod_review_action_items created_by
vod_review_action_items done_by
vod_review_comments author_id
vod_review_sessions created_by
vod_review_sessions scrim_id`.split('\n').map((l) => l.trim().split(' '))

// ── Expression helpers ──────────────────────────────────────────────────────────────────────────────────────────
const KEEP = '\u0000UID\u0000'
/** auth.uid() → (select auth.uid()), leaving the already wrapped ones alone. */
const initplan = (e) => e == null ? e
  : e.split('( SELECT auth.uid() AS uid)').join(KEEP).split('auth.uid()').join('(select auth.uid())').split(KEEP).join('(select auth.uid())')
const or = (exprs) => {
  const uniq = [...new Set(exprs.map(initplan))]
  return uniq.length === 1 ? uniq[0] : uniq.map((e) => `(${e})`).join('\n      OR ')
}
const roleList = (r) => r.join(', ')

/** The per-command atoms of a policy: what it contributes to each command. */
function atoms(pol) {
  const cmds = pol.cmd === 'ALL' ? ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] : [pol.cmd]
  return cmds.map((cmd) => ({
    cmd, from: pol.n, roles: pol.roles,
    using: cmd === 'INSERT' ? null : pol.q,
    check: cmd === 'SELECT' || cmd === 'DELETE' ? null : (pol.c ?? pol.q),
  }))
}

// ── Migration ───────────────────────────────────────────────────────────────────────────────────────────────────
const out = []
const back = []
const table = []
out.push(`-- ${VERSION} (health check 28/11/2026): Supabase performance advisor.
-- Generated by scripts/gen-rls-perf-migration.mjs from the production policies of 28/11/2026, which it holds
-- verbatim: edit the generator, not this file. Rollback: supabase/rollback/${VERSION.slice(0, 14)}_rollback.sql.
-- Before/after policies per table: docs/audits/SUPABASE_RLS_PERF_2026-11-28.md.
--
-- 1. multiple_permissive_policies (45): on each table, the policies that overlapped for one command are merged
--    into one policy per command, ORing the same expressions Postgres already ORed. Same rows readable, same rows
--    writable, same checks on written rows. Merged policies are TO authenticated: the TO public originals only
--    ever granted rows matching auth.uid(), which anon does not have.
-- 2. auth_rls_initplan (18): auth.uid() becomes (select auth.uid()), evaluated once per statement.
-- 3. unindexed_foreign_keys (70): one btree index per foreign key with no covering index.
-- 4. unused_index (9): KEPT. The app is weeks old and most cover a foreign key used by ON DELETE CASCADE or
--    by a join of a screen that is little used yet. Dropping them would bring back unindexed_foreign_keys.

`)
back.push(`-- Rollback of ${VERSION}: the original policies (verbatim) and no FK indexes.
-- Generated by scripts/gen-rls-perf-migration.mjs. Run by hand: one transaction (Cyber R2, 28/11/2026), so a stop
-- halfway never leaves a table without its policies.
begin;
`)

// Cyber R1 (28/11/2026): every policy this migration drops or rewrites must exist as reviewed, by table and name.
// A policy renamed or removed in production since the review aborts the whole migration instead of leaving an old
// policy next to the new one unreviewed.
const expected = [...MERGED, ...INITPLAN].flatMap((tbl) => tbl.policies.map((pol) => [tbl.t, pol.n]))
const expectedRows = expected.map(([t, n]) => `    ('${t}', '${n}')`).join(',\n')
out.push(`-- ── 0. Guard: the ${expected.length} reviewed policies are all there (Cyber R1) ─────────────────────────────
do $guard$
declare
  missing text;
begin
  select string_agg(e.t || '.' || e.n, ', ' order by e.t, e.n) into missing
  from (values
${expectedRows}
  ) as e(t, n)
  where not exists (
    select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = e.t and p.policyname = e.n
  );
  if missing is not null then
    raise exception 'rls_performance: policies changed since the review of 28/11/2026, missing: %', missing;
  end if;
end
$guard$;
`)

out.push('-- ── 1. Merged policies ─────────────────────────────────────────────────────────────────────────────\n')
for (const tbl of MERGED) {
  const all = tbl.policies.flatMap(atoms)
  const byCmd = new Map()
  for (const a of all) byCmd.set(a.cmd, [...(byCmd.get(a.cmd) ?? []), a])
  out.push(`-- ${tbl.t}`)
  for (const pol of tbl.policies) out.push(`drop policy if exists ${pol.n} on public.${tbl.t};`)
  const after = []
  for (const cmd of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const list = byCmd.get(cmd)
    if (!list) continue
    const name = `${tbl.t}_${cmd.toLowerCase()}`
    const using = list.some((a) => a.using) ? or(list.map((a) => a.using).filter(Boolean)) : null
    const check = list.some((a) => a.check) ? or(list.map((a) => a.check).filter(Boolean)) : null
    out.push(`create policy ${name} on public.${tbl.t} for ${cmd.toLowerCase()} to authenticated` +
      (using ? `\n  using (${using})` : '') + (check ? `\n  with check (${check})` : '') + ';')
    after.push(`\`${name}\` (${list.map((a) => a.from).join(' + ')})`)
  }
  out.push('')
  for (const cmd of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) if (byCmd.has(cmd)) back.push(`drop policy if exists ${tbl.t}_${cmd.toLowerCase()} on public.${tbl.t};`)
  for (const pol of tbl.policies) {
    back.push(`create policy ${pol.n} on public.${tbl.t} as permissive for ${pol.cmd.toLowerCase()} to ${roleList(pol.roles)}` +
      (pol.q ? `\n  using (${pol.q})` : '') + (pol.c ? `\n  with check (${pol.c})` : '') + ';')
  }
  back.push('')
  table.push(`| \`${tbl.t}\` | ${tbl.policies.map((x) => `\`${x.n}\` ${x.cmd} → ${roleList(x.roles)}`).join('<br>')} | ${after.join('<br>')} → authenticated |`)
}

out.push('-- ── 2. auth.uid() evaluated once per statement ─────────────────────────────────────────────────────\n')
const initRows = []
for (const tbl of INITPLAN) {
  for (const pol of tbl.policies) {
    out.push(`alter policy ${pol.n} on public.${tbl.t}` +
      (pol.q ? `\n  using (${initplan(pol.q)})` : '') + (pol.c ? `\n  with check (${initplan(pol.c)})` : '') + ';')
    back.push(`alter policy ${pol.n} on public.${tbl.t}` + (pol.q ? `\n  using (${pol.q})` : '') + (pol.c ? `\n  with check (${pol.c})` : '') + ';')
    initRows.push(`| \`${tbl.t}\` | \`${pol.n}\` ${pol.cmd} → ${roleList(pol.roles)} | same, \`(select auth.uid())\` |`)
  }
}
out.push('')
back.push('')

out.push('-- ── 3. Foreign key indexes ─────────────────────────────────────────────────────────────────────────\n')
for (const [t, col] of FK_INDEXES) {
  const name = `${t}_${col}_fk_idx`.slice(0, 63)
  out.push(`create index if not exists ${name} on public.${t} (${col});`)
  back.push(`drop index if exists public.${name};`)
}
out.push('')
back.push('', 'commit;', '')

writeFileSync(join(ROOT, 'supabase', 'migrations', `${VERSION}.sql`), out.join('\n'))
writeFileSync(join(ROOT, 'supabase', 'rollback', `${VERSION.slice(0, 14)}_rollback.sql`), back.join('\n'))

const md = `# Supabase : performance advisor, migration \`${VERSION}\` (28/11/2026)

Généré par \`scripts/gen-rls-perf-migration.mjs\` à partir des politiques de production du 28/11 (copiées telles quelles).
**Non appliquée.** Revue Cyber, puis production seulement sur accord explicite de l'utilisateur.

## Principe : mêmes accès

- Postgres combine les politiques *permissive* d'une même commande par **OU** (USING avec USING, WITH CHECK avec
  WITH CHECK). Une politique \`ALL\` équivaut exactement à SELECT + INSERT + UPDATE + DELETE avec les mêmes
  expressions (pour INSERT et UPDATE, le WITH CHECK, ou le USING s'il n'y en a pas).
- Donc chaque politique en doublon est découpée par commande, et les morceaux d'une même commande sont réunis
  par OU dans **une** politique : mêmes lignes lisibles, mêmes lignes modifiables, mêmes contrôles à l'écriture.
- Les politiques fusionnées visent \`authenticated\`. Certaines d'origine visaient \`public\` (donc aussi \`anon\`),
  mais toutes leurs expressions exigent une ligne liée à \`auth.uid()\` (\`private.group_role\`, \`is_group_staff\`,
  \`can_edit_calendar\`, \`can_manage_session\`, \`can_prepare_session\` filtrent \`group_members\` sur
  \`user_id = auth.uid()\`, ou la colonne utilisateur de la ligne = \`auth.uid()\`). Pour \`anon\`, \`auth.uid()\`
  vaut NULL : \`anon\` n'a jamais eu d'accès par elles. Point à confirmer par Cyber.
- \`auth.uid()\` devient \`(select auth.uid())\` partout (évalué une fois par requête au lieu d'une fois par ligne).

## Politiques fusionnées (multiple_permissive_policies, 45 alertes sur ${MERGED.length} tables)

| Table | Avant | Après |
|---|---|---|
${table.join('\n')}

## auth.uid() en initplan (auth_rls_initplan, 18 alertes)

Les politiques \`availability_rules_write\` et \`availability_exceptions_write\` sont traitées par la fusion ci-dessus.

| Table | Politique (inchangée sauf l'expression) | Après |
|---|---|---|
${initRows.join('\n')}

## Index

- **${FK_INDEXES.length} index** de clés étrangères (\`<table>_<colonne>_fk_idx\`) : accélèrent les \`ON DELETE\` en
  cascade et les jointures. Base de 23 Mo : création instantanée, quelques centaines de Ko au total.
- **9 index « inutilisés » gardés** : l'app a quelques semaines et peu de trafic sur ces écrans ; la plupart
  couvrent une clé étrangère, les supprimer ferait revenir l'alerte \`unindexed_foreign_keys\`.

## Hors migration

- \`auth_db_connections_absolute\` : réglage du serveur Auth (10 connexions fixes) dans le tableau de bord, sans
  effet tant que l'instance ne change pas de taille.
`
writeFileSync(join(ROOT, 'docs', 'audits', 'SUPABASE_RLS_PERF_2026-11-28.md'), md)
console.log('written', VERSION)
