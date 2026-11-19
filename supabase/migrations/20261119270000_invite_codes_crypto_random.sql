-- #44 (CyberSecurity review, 19 November 2026): invite codes come from a
-- cryptographic generator. random() is not one, so its output can be
-- predicted from earlier codes. gen_random_bytes (pgcrypto) is.
--
-- private.random_code draws bytes and keeps only those below 248 (8 x 31),
-- so each of the 31 characters is equally likely (no modulo bias).
-- Same alphabet and same lengths as before: 10 for group invites, 12 for
-- access invites. Re-runnable: create or replace only.

create extension if not exists pgcrypto with schema extensions;

create or replace function private.random_code(p_len integer)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  b bytea;
  v integer;
begin
  if p_len is null or p_len < 1 or p_len > 64 then
    raise exception 'invalid code length' using errcode = '22023';
  end if;
  while length(code) < p_len loop
    b := extensions.gen_random_bytes(32);
    for i in 0 .. 31 loop
      v := get_byte(b, i);
      if v < 248 and length(code) < p_len then
        code := code || substr(alphabet, 1 + (v % 31), 1);
      end if;
    end loop;
  end loop;
  return code;
end;
$$;

revoke all on function private.random_code(integer) from public, anon, authenticated;

-- Body of 20261115220127_e_phase0_invite_manager_owner_only, only the code changes.
create or replace function public.create_group_invite(p_group uuid, p_role text default 'player', p_days integer default 7, p_max_uses integer default 10)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare c text;
begin
  if not private.is_group_staff(p_group) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role in ('coach', 'manager') and private.group_role(p_group) <> 'owner' then
    raise exception 'only the owner can invite coaches or managers' using errcode = '42501';
  end if;
  c := private.random_code(10);
  insert into public.group_invites (code, group_id, role, expires_at, max_uses)
  values (c, p_group, p_role, now() + make_interval(days => least(greatest(p_days, 1), 30)), least(greatest(p_max_uses, 1), 100));
  return c;
end;
$$;

-- Body of 20261113070824_invite_only_access, only the code changes.
create or replace function public.create_access_invite(p_email text default null, p_days int default 14, p_max_uses int default 1, p_note text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  if not private.is_app_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  c := private.random_code(12);
  insert into public.access_invites (code, email, note, expires_at, max_uses)
  values (c, nullif(lower(trim(p_email)), ''), left(p_note, 200),
          now() + make_interval(days => least(greatest(p_days, 1), 90)), least(greatest(p_max_uses, 1), 100));
  return c;
end;
$$;
revoke all on function public.create_access_invite(text, int, int, text) from public, anon;
grant execute on function public.create_access_invite(text, int, int, text) to authenticated;
