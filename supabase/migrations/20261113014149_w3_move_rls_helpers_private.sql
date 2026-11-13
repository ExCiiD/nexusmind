-- RLS helpers must not be callable through the REST API (they would leak
-- group memberships). Move them to a non-exposed schema.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.group_role(p_group uuid, p_user uuid default auth.uid())
returns text language sql stable security definer set search_path = ''
as $$ select role from public.group_members where group_id = p_group and user_id = p_user $$;

create or replace function private.is_group_staff(p_group uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.group_members
                     where group_id = p_group and user_id = p_user and role in ('owner', 'coach', 'analyst')) $$;

create or replace function private.can_read_player_table(p_owner uuid, p_table text)
returns boolean language sql stable security definer set search_path = ''
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

revoke all on function private.group_role(uuid, uuid) from public;
revoke all on function private.is_group_staff(uuid, uuid) from public;
revoke all on function private.can_read_player_table(uuid, text) from public;
grant execute on function private.group_role(uuid, uuid) to authenticated;
grant execute on function private.is_group_staff(uuid, uuid) to authenticated;
grant execute on function private.can_read_player_table(uuid, text) to authenticated;

-- Re-point every policy at the private helpers.
drop policy "groups_read_members" on public.groups;
drop policy "groups_update_owner" on public.groups;
drop policy "groups_delete_owner" on public.groups;
create policy "groups_read_members" on public.groups for select to authenticated using (private.group_role(id) is not null);
create policy "groups_update_owner" on public.groups for update to authenticated
  using (private.group_role(id) = 'owner') with check (private.group_role(id) = 'owner');
create policy "groups_delete_owner" on public.groups for delete to authenticated using (private.group_role(id) = 'owner');

drop policy "members_read_same_group" on public.group_members;
drop policy "members_update_self_profile" on public.group_members;
drop policy "members_leave_or_owner_removes" on public.group_members;
create policy "members_read_same_group" on public.group_members for select to authenticated using (private.group_role(group_id) is not null);
create policy "members_update_self_profile" on public.group_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and role = private.group_role(group_id));
create policy "members_leave_or_owner_removes" on public.group_members for delete to authenticated
  using (user_id = (select auth.uid()) or private.group_role(group_id) = 'owner');

drop policy "invites_staff_read" on public.group_invites;
drop policy "invites_staff_delete" on public.group_invites;
create policy "invites_staff_read" on public.group_invites for select to authenticated using (private.is_group_staff(group_id));
create policy "invites_staff_delete" on public.group_invites for delete to authenticated using (private.is_group_staff(group_id));

drop policy "sharing_own_rows" on public.group_sharing;
drop policy "sharing_staff_read" on public.group_sharing;
create policy "sharing_own_rows" on public.group_sharing for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.group_role(group_id) is not null);
create policy "sharing_staff_read" on public.group_sharing for select to authenticated using (private.is_group_staff(group_id));

drop policy "sync_records_read_shared" on public.sync_records;
create policy "sync_records_read_shared" on public.sync_records for select to authenticated
  using (private.can_read_player_table(user_id, table_name));

drop policy "comments_read" on public.review_comments;
drop policy "comments_insert" on public.review_comments;
drop policy "comments_delete" on public.review_comments;
create policy "comments_read" on public.review_comments for select to authenticated
  using (player_id = (select auth.uid()) or private.is_group_staff(group_id));
create policy "comments_insert" on public.review_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and private.group_role(group_id, player_id) is not null
    and (player_id = (select auth.uid())
         or (private.is_group_staff(group_id) and private.can_read_player_table(player_id, 'Review')))
  );
create policy "comments_delete" on public.review_comments for delete to authenticated
  using (author_id = (select auth.uid()) or private.group_role(group_id) = 'owner');

drop policy "assignments_read" on public.assigned_objectives;
drop policy "assignments_insert_staff" on public.assigned_objectives;
drop policy "assignments_update" on public.assigned_objectives;
drop policy "assignments_delete_staff" on public.assigned_objectives;
create policy "assignments_read" on public.assigned_objectives for select to authenticated
  using (player_id = (select auth.uid()) or private.is_group_staff(group_id));
create policy "assignments_insert_staff" on public.assigned_objectives for insert to authenticated
  with check (assigned_by = (select auth.uid()) and private.is_group_staff(group_id)
              and private.group_role(group_id, player_id) is not null);
create policy "assignments_update" on public.assigned_objectives for update to authenticated
  using (player_id = (select auth.uid()) or private.is_group_staff(group_id))
  with check (player_id = (select auth.uid()) or private.is_group_staff(group_id));
create policy "assignments_delete_staff" on public.assigned_objectives for delete to authenticated
  using (private.is_group_staff(group_id));

create or replace function public.create_group_invite(p_group uuid, p_role text default 'player', p_days int default 7, p_max_uses int default 10)
returns text language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  if not private.is_group_staff(p_group) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role = 'coach' and private.group_role(p_group) <> 'owner' then
    raise exception 'only the owner can invite coaches' using errcode = '42501';
  end if;
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
    into c from generate_series(1, 10);
  insert into public.group_invites (code, group_id, role, expires_at, max_uses)
  values (c, p_group, p_role, now() + make_interval(days => least(greatest(p_days, 1), 30)), least(greatest(p_max_uses, 1), 100));
  return c;
end;
$$;

drop function public.can_read_player_table(uuid, text);
drop function public.is_group_staff(uuid, uuid);
drop function public.group_role(uuid, uuid);
