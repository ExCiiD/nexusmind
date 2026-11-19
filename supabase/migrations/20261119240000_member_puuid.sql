-- #38 (19/11/2026): a renamed player ("ore wa ayura") lost their role,
-- champions and rank in their group: the group only knew their Riot ID,
-- which changes on a rename, and only updated it when they joined.
--
-- group_members gets the member's Riot puuid (it never changes). It is NOT
-- written by the client (CyberSecurity review: a self-reported puuid lets a
-- member pass as another player, and teammates' apps would then show the
-- victim's real name). The server derives it from the Riot ID the member
-- declared: the verify-member-puuid Edge Function resolves riot_id through
-- the Riot proxy and writes puuid with the service role. Changing riot_id
-- clears puuid until it is verified again, so the two always agree. Two
-- members of a group can never hold the same puuid.
-- The real fix (Riot Sign-On, proving account ownership) needs Riot's
-- production key.
-- Not applied anywhere yet: production needs the user's go-ahead. Until
-- then the apps read without the column (error 42703 is handled).

alter table public.group_members
  add column if not exists puuid text
    check (puuid is null or puuid ~ '^[A-Za-z0-9_-]{20,100}$');

-- One player per group: a duplicate puuid is refused (the function reports it).
create unique index if not exists group_members_group_puuid_uniq
  on public.group_members (group_id, puuid) where puuid is not null;

-- Where the verification stands, for the staff's screens: null (never
-- verified), 'verified', 'not_found' (no such Riot ID) or 'conflict'
-- (another member of the group already holds that puuid: two members claim
-- the same player). Written by the function only, readable like the row.
alter table public.group_members
  add column if not exists puuid_status text
    check (puuid_status is null or puuid_status in ('verified', 'not_found', 'conflict'));

-- Clients may update their display name and Riot ID (20261118200000), never
-- the puuid: only the service role writes it.
revoke update (puuid, puuid_status) on public.group_members from anon, authenticated;

-- A new Riot ID means the old puuid is unproven for it: cleared until the
-- function verifies the new one.
create or replace function private.group_members_riot_id_resets_puuid()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.riot_id is distinct from old.riot_id and new.puuid is not distinct from old.puuid then
    new.puuid := null;
    new.puuid_status := null;
  end if;
  return new;
end
$$;
revoke all on function private.group_members_riot_id_resets_puuid() from public, anon, authenticated;
drop trigger if exists group_members_riot_id_resets_puuid on public.group_members;
create trigger group_members_riot_id_resets_puuid
  before update of riot_id on public.group_members
  for each row execute function private.group_members_riot_id_resets_puuid();
