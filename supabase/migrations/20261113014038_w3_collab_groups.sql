-- W3: collaboration. A "group" is a team or a coaching group. Members have a
-- role; players choose what coaches/teammates may read of their synced data.
-- NOTE: the public.* RLS helpers created here are moved to the `private`
-- schema by 20261113014149_w3_move_rls_helpers_private.

create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 80),
  kind       text not null default 'team' check (kind in ('team', 'coaching')),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id     uuid not null references public.groups (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('owner', 'coach', 'analyst', 'player')),
  display_name text check (display_name is null or length(display_name) <= 64),
  riot_id      text check (riot_id is null or length(riot_id) <= 64),
  joined_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.group_invites (
  code       text primary key,
  group_id   uuid not null references public.groups (id) on delete cascade,
  role       text not null check (role in ('coach', 'analyst', 'player')),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses   int not null default 10 check (max_uses between 1 and 100),
  uses       int not null default 0
);
create index group_invites_group_idx on public.group_invites (group_id);

-- What a player lets a group see. Defaults are deliberately conservative
-- for teammates and useful for coaches (see can_read_player_table).
create table public.group_sharing (
  group_id      uuid not null references public.groups (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  share_reviews boolean not null default true,   -- sessions, games, reviews, mistakes, recordings metadata
  share_stats   boolean not null default true,   -- assessments, snapshots, badges
  share_team    boolean not null default true,   -- teams, members, champion pools, drafts, custom games
  updated_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ── Helpers (SECURITY DEFINER to read memberships without RLS recursion) ──

create or replace function public.group_role(p_group uuid, p_user uuid default auth.uid())
returns text
language sql stable security definer set search_path = ''
as $$
  select role from public.group_members where group_id = p_group and user_id = p_user
$$;

create or replace function public.is_group_staff(p_group uuid, p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.group_members
                 where group_id = p_group and user_id = p_user and role in ('owner', 'coach', 'analyst'))
$$;

create or replace function public.can_read_player_table(p_owner uuid, p_table text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members viewer
    join public.group_members owner_m on owner_m.group_id = viewer.group_id and owner_m.user_id = p_owner
    left join public.group_sharing s on s.group_id = viewer.group_id and s.user_id = p_owner
    where viewer.user_id = auth.uid()
      and viewer.user_id <> p_owner
      and (
        (p_table in ('Session', 'Game', 'Review', 'Mistake', 'MistakeTag', 'Recording', 'Bookmark', 'ExternalReview')
          and viewer.role in ('owner', 'coach', 'analyst') and coalesce(s.share_reviews, true))
        or (p_table in ('Assessment', 'AssessmentScore', 'StatsSnapshot', 'Badge', 'Account')
          and viewer.role in ('owner', 'coach', 'analyst') and coalesce(s.share_stats, true))
        or (p_table in ('Team', 'TeamMember', 'ChampionPoolEntry', 'DraftPrep', 'CustomGame')
          and coalesce(s.share_team, true))
      )
  )
$$;

revoke all on function public.group_role(uuid, uuid) from public, anon;
revoke all on function public.is_group_staff(uuid, uuid) from public, anon;
revoke all on function public.can_read_player_table(uuid, text) from public, anon;
grant execute on function public.group_role(uuid, uuid) to authenticated;
grant execute on function public.is_group_staff(uuid, uuid) to authenticated;
grant execute on function public.can_read_player_table(uuid, text) to authenticated;

-- ── RLS ──

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.group_sharing enable row level security;

create policy "groups_read_members" on public.groups for select to authenticated
  using (public.group_role(id) is not null);
create policy "groups_update_owner" on public.groups for update to authenticated
  using (public.group_role(id) = 'owner') with check (public.group_role(id) = 'owner');
create policy "groups_delete_owner" on public.groups for delete to authenticated
  using (public.group_role(id) = 'owner');

create policy "members_read_same_group" on public.group_members for select to authenticated
  using (public.group_role(group_id) is not null);
create policy "members_update_self_profile" on public.group_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and role = public.group_role(group_id));
create policy "members_leave_or_owner_removes" on public.group_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.group_role(group_id) = 'owner');

create policy "invites_staff_read" on public.group_invites for select to authenticated
  using (public.is_group_staff(group_id));
create policy "invites_staff_delete" on public.group_invites for delete to authenticated
  using (public.is_group_staff(group_id));

create policy "sharing_own_rows" on public.group_sharing for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.group_role(group_id) is not null);
create policy "sharing_staff_read" on public.group_sharing for select to authenticated
  using (public.is_group_staff(group_id));

create policy "sync_records_read_shared" on public.sync_records for select to authenticated
  using (public.can_read_player_table(user_id, table_name));

-- ── RPCs ──

create or replace function public.create_group(p_name text, p_kind text default 'team')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if (select count(*) from public.group_members where user_id = auth.uid() and role = 'owner') >= 10 then
    raise exception 'too many groups' using errcode = '54000';
  end if;
  insert into public.groups (name, kind, created_by) values (trim(p_name), p_kind, auth.uid()) returning id into g;
  insert into public.group_members (group_id, user_id, role) values (g, auth.uid(), 'owner');
  return g;
end;
$$;

create or replace function public.create_group_invite(p_group uuid, p_role text default 'player', p_days int default 7, p_max_uses int default 10)
returns text
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  if not public.is_group_staff(p_group) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role = 'coach' and public.group_role(p_group) <> 'owner' then
    raise exception 'only the owner can invite coaches' using errcode = '42501';
  end if;
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
    into c from generate_series(1, 10);
  insert into public.group_invites (code, group_id, role, expires_at, max_uses)
  values (c, p_group, p_role, now() + make_interval(days => least(greatest(p_days, 1), 30)), least(greatest(p_max_uses, 1), 100));
  return c;
end;
$$;

create or replace function public.join_group(p_code text, p_display_name text default null, p_riot_id text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare inv public.group_invites;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into inv from public.group_invites where code = upper(trim(p_code)) for update;
  if inv.code is null or inv.expires_at < now() or inv.uses >= inv.max_uses then
    raise exception 'invalid or expired invite' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.group_members where group_id = inv.group_id and user_id = auth.uid()) then
    return inv.group_id;
  end if;
  insert into public.group_members (group_id, user_id, role, display_name, riot_id)
  values (inv.group_id, auth.uid(), inv.role, left(p_display_name, 64), left(p_riot_id, 64));
  update public.group_invites set uses = uses + 1 where code = inv.code;
  return inv.group_id;
end;
$$;

revoke all on function public.create_group(text, text) from public, anon;
revoke all on function public.create_group_invite(uuid, text, int, int) from public, anon;
revoke all on function public.join_group(text, text, text) from public, anon;
grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.create_group_invite(uuid, text, int, int) to authenticated;
grant execute on function public.join_group(text, text, text) to authenticated;
