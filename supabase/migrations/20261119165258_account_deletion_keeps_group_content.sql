-- #33 (docs/AUDIT_SECURITE.md, CyberSecurity's rule, 19/11/2026): what a
-- member created FOR THE GROUP survives their account deletion.
--
-- These columns were ON DELETE CASCADE: a coach deleting their account
-- deleted their scrims, events, published roster, drafts, announcements,
-- tasks, reviews and the team's Discord link for everyone. They become
-- SET NULL (column made nullable, the screens show "former member").
--
-- Left as they are, on purpose:
--   - what is ABOUT the person (user_id, player_id: memberships, sharing,
--     availability, wellbeing, notifications, the player's own plans,
--     objectives, notes and answers, backups, sync records...) stays
--     CASCADE (erasure, GDPR art. 17)
--   - short-lived invitations and link codes (group_invites, access_invites,
--     discord_guild_link_codes) stay CASCADE.
--
-- SET NULL anonymises the author, not the text: a comment can still name
-- the person. Deleting instead is a one-word change per line below
-- ('set null' to 'cascade'), the final choice is the user's (draft v0.3 § 7).
--
-- Same method as 20261119200000_account_deletion_keeps_groups: constraint
-- names are read from pg_constraint and the migration stops if a column
-- does not have exactly one foreign key to auth.users.
-- Not applied anywhere yet: production needs the user's go-ahead.

do $$
declare
  r record;
  con_name text;
  n_found int;
begin
  for r in
    select * from (values
      ('scrims',                  'created_by',  'set null'),
      ('calendar_events',         'created_by',  'set null'),
      ('team_rosters',            'created_by',  'set null'),
      ('team_scouting',           'created_by',  'set null'),
      ('team_drafts',             'created_by',  'set null'),
      ('announcements',           'created_by',  'set null'),
      ('tasks',                   'created_by',  'set null'),
      ('team_codex_rules',        'created_by',  'set null'),
      ('vod_review_sessions',     'created_by',  'set null'),
      ('vod_review_comments',     'author_id',   'set null'),
      ('vod_review_action_items', 'created_by',  'set null'),
      ('review_comments',         'author_id',   'set null'),
      ('assigned_objectives',     'assigned_by', 'set null'),
      ('dev_plans',               'created_by',  'set null'),
      ('dev_plan_checkins',       'created_by',  'set null'),
      ('micro_review_verdicts',   'coach_id',    'set null'),
      ('trial_candidates',        'created_by',  'set null'),
      ('trial_evaluations',       'created_by',  'set null'),
      ('staff_notes',             'created_by',  'set null'),
      ('discord_guild_links',     'linked_by',   'set null')
    ) as t(tbl, col, on_delete)
  loop
    select count(*), min(c.conname) into n_found, con_name
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.conrelid = format('public.%I', r.tbl)::regclass
      and c.confrelid = 'auth.users'::regclass
      and array_length(c.conkey, 1) = 1
      and a.attname = r.col;

    if n_found <> 1 then
      raise exception '#33: expected one foreign key public.%.% -> auth.users, found %', r.tbl, r.col, n_found;
    end if;

    if r.on_delete = 'set null' then
      execute format('alter table public.%I alter column %I drop not null', r.tbl, r.col);
    end if;
    execute format('alter table public.%I drop constraint %I', r.tbl, con_name);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references auth.users (id) on delete %s',
      r.tbl, con_name, r.col, r.on_delete
    );
  end loop;
end
$$;

-- A verdict whose coach deleted their account (coach_id now NULL) could
-- never be removed: micro_verdicts_delete_own only lets its author delete
-- it. The group's staff may now delete such orphaned verdicts, so a player
-- can get a fresh review (CyberSecurity review of #33).
drop policy if exists "micro_verdicts_delete_orphaned" on public.micro_review_verdicts;
create policy "micro_verdicts_delete_orphaned" on public.micro_review_verdicts for delete to authenticated
  using (coach_id is null and private.is_group_staff(group_id));
