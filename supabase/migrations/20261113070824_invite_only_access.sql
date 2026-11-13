-- Invite-only access. New accounts can only be created by the
-- `redeem-invite` Edge Function (service role) from a valid access invite or
-- a valid group invite; public sign-ups are disabled in Auth settings.
-- Admins are added manually by the project owner (see docs/CLOUD_SETUP.md).

create table public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
create policy "app_admins_read_self" on public.app_admins for select to authenticated
  using (user_id = (select auth.uid()));

create table public.access_invites (
  code       text primary key,
  email      text check (email is null or email = lower(email)),
  note       text check (note is null or length(note) <= 200),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses   int not null default 1 check (max_uses between 1 and 100),
  uses       int not null default 0,
  revoked    boolean not null default false
);
alter table public.access_invites enable row level security;

create or replace function private.is_app_admin(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_admins where user_id = p_user) $$;
revoke all on function private.is_app_admin(uuid) from public;
grant execute on function private.is_app_admin(uuid) to authenticated;

create policy "access_invites_admin_read" on public.access_invites for select to authenticated
  using (private.is_app_admin());
create policy "access_invites_admin_update" on public.access_invites for update to authenticated
  using (private.is_app_admin()) with check (private.is_app_admin());

create table public.access_invite_attempts (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  ok         boolean not null,
  created_at timestamptz not null default now()
);
create index access_invite_attempts_ip_idx on public.access_invite_attempts (ip_hash, created_at desc);
alter table public.access_invite_attempts enable row level security;

create or replace function public.create_access_invite(p_email text default null, p_days int default 14, p_max_uses int default 1, p_note text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  if not private.is_app_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
    into c from generate_series(1, 12);
  insert into public.access_invites (code, email, note, expires_at, max_uses)
  values (c, nullif(lower(trim(p_email)), ''), left(p_note, 200),
          now() + make_interval(days => least(greatest(p_days, 1), 90)), least(greatest(p_max_uses, 1), 100));
  return c;
end;
$$;
revoke all on function public.create_access_invite(text, int, int, text) from public, anon;
grant execute on function public.create_access_invite(text, int, int, text) to authenticated;
