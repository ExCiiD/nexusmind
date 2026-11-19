-- S19-16 (docs/AUDIT_SECURITE.md, 19/11/2026): account deletion
--
-- 1. Nine columns pointed at auth.users with ON DELETE NO ACTION, so
--    auth.admin.deleteUser failed (500 delete_user_failed) for anyone who
--    had written one of those rows. They now anonymise (SET NULL, the
--    column becomes nullable and the screens show "former member"), except
--    team_session_feedback.user_id, part of that table's key: the player's
--    own feedback is deleted with them (CASCADE).
--    To delete instead of anonymising, change 'set null' to 'cascade' in
--    the list below (and nothing else): the NOT NULL is then kept.
--
-- 2. groups.created_by was ON DELETE CASCADE: the creator deleting their
--    account deleted the whole group for every member. It becomes SET NULL,
--    and before an account is deleted its groups are handed over
--    (private.hand_over_groups_of): if the group already has another owner
--    nobody is promoted. Otherwise the owner role goes to a coach, then a
--    manager, then an analyst, then the captain, then the longest-standing
--    player. A group with no other member is deleted, since nobody is left
--    to use it.
--
-- Constraint names are looked up, not hard-coded: these tables were
-- created on the production project outside this folder (WSC-05).
-- Not applied anywhere yet: production needs the user's go-ahead.

do $$
declare
  r record;
  con_name text;
  n_found int;
begin
  for r in
    select * from (values
      ('team_discussion_comments', 'author_id',    'set null'),
      ('team_session_feedback',    'user_id',      'cascade'),
      ('team_session_games',       'reported_by',  'set null'),
      ('team_session_reviews',     'recorded_by',  'set null'),
      ('team_session_objectives',  'set_by',       'set null'),
      ('calendar_event_requests',  'requested_by', 'set null'),
      ('group_fundamentals',       'created_by',   'set null'),
      ('report_shares',            'created_by',   'set null'),
      ('calendar_subscriptions',   'created_by',   'set null'),
      ('groups',                   'created_by',   'set null')
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
      raise exception 'S19-16: expected one foreign key public.%.% -> auth.users, found %', r.tbl, r.col, n_found;
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

-- Hands the user's groups over before their account goes (see 2. above).
create or replace function private.hand_over_groups_of(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
  successor uuid;
begin
  for g in
    select gm.group_id from public.group_members gm
    where gm.user_id = p_user and gm.role = 'owner'
  loop
    -- Another owner already runs the group: nobody to promote.
    if exists (
      select 1 from public.group_members o
      where o.group_id = g.group_id and o.user_id <> p_user and o.role = 'owner'
    ) then
      update public.groups set created_by = (
        select o.user_id from public.group_members o
        where o.group_id = g.group_id and o.user_id <> p_user and o.role = 'owner'
        order by o.joined_at, o.user_id limit 1
      ) where id = g.group_id and created_by = p_user;
      continue;
    end if;

    -- Staff first (coach, manager, analyst), then the captain, then the
    -- longest-standing player.
    successor := null;
    select m.user_id into successor
    from public.group_members m
    where m.group_id = g.group_id and m.user_id <> p_user
    order by case m.role when 'coach' then 0 when 'manager' then 1 when 'analyst' then 2 else 3 end,
             m.is_captain desc,
             m.joined_at, m.user_id
    limit 1;

    if successor is null then
      delete from public.groups where id = g.group_id;
    else
      update public.group_members set role = 'owner'
      where group_id = g.group_id and user_id = successor;
      update public.groups set created_by = successor
      where id = g.group_id and created_by = p_user;
    end if;
  end loop;
end
$$;
revoke execute on function private.hand_over_groups_of(uuid) from public, anon, authenticated;

-- Runs for every way an account is deleted (the delete-account function,
-- the dashboard, the admin API), before group_members cascades away.
create or replace function private.before_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.hand_over_groups_of(old.id);
  return old;
end
$$;
revoke execute on function private.before_auth_user_delete() from public, anon, authenticated;

drop trigger if exists hand_over_groups_before_delete on auth.users;
create trigger hand_over_groups_before_delete
  before delete on auth.users
  for each row execute function private.before_auth_user_delete();
