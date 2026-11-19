-- Team logos (Coaching & Management → Groupes, player cards of Espace
-- d'équipe): one image per group, set by the group's management (owner,
-- coach, manager, captain: private.can_edit_calendar), stored in a public
-- bucket (every member sees it, exported cards carry it).

-- 1. Column, set through set_group_logo only (groups stay owner-updatable).
alter table public.groups add column if not exists logo_url text
  check (logo_url is null or length(logo_url) <= 512);

-- 2. Bucket: public read, small images only (the app sends a 256 px WebP).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('group-logos', 'group-logos', true, 524288, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A group's files live under "<group id>/". Writing there takes the
-- group's management. A folder that isn't a uuid is refused before the cast.
create or replace function private.can_edit_group_logo(p_name text)
returns boolean
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  folder text := (storage.foldername(p_name))[1];
begin
  if folder is null or folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_edit_calendar(folder::uuid);
end;
$$;
revoke all on function private.can_edit_group_logo(text) from public;
grant execute on function private.can_edit_group_logo(text) to authenticated;

drop policy if exists "group_logos_select" on storage.objects;
drop policy if exists "group_logos_insert" on storage.objects;
drop policy if exists "group_logos_update" on storage.objects;
drop policy if exists "group_logos_delete" on storage.objects;
create policy "group_logos_select" on storage.objects for select to authenticated
  using (bucket_id = 'group-logos' and private.can_edit_group_logo(name));
create policy "group_logos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'group-logos' and private.can_edit_group_logo(name));
create policy "group_logos_update" on storage.objects for update to authenticated
  using (bucket_id = 'group-logos' and private.can_edit_group_logo(name))
  with check (bucket_id = 'group-logos' and private.can_edit_group_logo(name));
create policy "group_logos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'group-logos' and private.can_edit_group_logo(name));

-- 3. Pointing a group at its logo (or clearing it). Only a file of this
-- group's folder in the bucket is accepted.
create or replace function public.set_group_logo(p_group uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_edit_calendar(p_group) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_url is not null
     and p_url !~ ('^https://[^/]+/storage/v1/object/public/group-logos/' || p_group::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'invalid logo url' using errcode = '22023';
  end if;
  update public.groups set logo_url = p_url where id = p_group;
end;
$$;
revoke all on function public.set_group_logo(uuid, text) from public, anon;
grant execute on function public.set_group_logo(uuid, text) to authenticated;
