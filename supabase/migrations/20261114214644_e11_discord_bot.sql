-- Restored 20/11/2026 (WSC-05 / DA-4): applied in production on 14/11/2026 under this exact version, but missing
-- from the repository. The SQL below is the statement production recorded (supabase_migrations.schema_migrations),
-- unchanged. Already applied in production: never run it there again.

-- E11: team Discord bot (docs/PLAN_GESTION_EQUIPE.md). The bot runs as a
-- Cloudflare Worker with NO per-request Supabase user session (Discord
-- interactions carry no Ascend auth) — it talks to Postgres with the
-- SERVICE ROLE key and enforces "who may act as whom" in its own code by
-- resolving discord_user_id -> user_id (discord_user_links) and
-- guild_id -> group_id (discord_guild_links) before touching any other
-- table, instead of relying on RLS (which service_role bypasses).
--
-- Linking is code-based, mirroring the app's existing invite-code UX but
-- deliberately NOT reusing group_invites/join_group: those create a new
-- group_members row for a brand-new human member, which is the wrong
-- shape for "map this Discord server to my existing group" or "map my
-- existing Discord identity to my existing Ascend account".

create table public.discord_guild_links (
  guild_id          text primary key,
  group_id          uuid not null references public.groups (id) on delete cascade,
  notify_channel_id text,
  linked_by         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  linked_at         timestamptz not null default now()
);
create index discord_guild_links_group_idx on public.discord_guild_links (group_id);

-- One-time, short-lived code a staff member generates in-app; redeemed via
-- "/link-team <code>" in the target Discord server.
create table public.discord_guild_link_codes (
  code       text primary key check (length(code) between 4 and 16),
  group_id   uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- One-time, short-lived code a player generates in-app; redeemed via
-- "/link-me <code>" to link their own Discord identity.
create table public.discord_user_link_codes (
  code       text primary key check (length(code) between 4 and 16),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Resolved identity, once a discord_user_link_codes entry is redeemed.
create table public.discord_user_links (
  discord_user_id text primary key,
  user_id         uuid not null unique references auth.users (id) on delete cascade,
  linked_at       timestamptz not null default now()
);

-- Dedupe so the reminder cron never announces the same item twice.
create table public.discord_notifications_sent (
  guild_id  text not null references public.discord_guild_links (guild_id) on delete cascade,
  item_type text not null check (item_type in ('event', 'scrim', 'common_availability')),
  item_id   text not null,
  sent_at   timestamptz not null default now(),
  primary key (guild_id, item_type, item_id)
);

-- Scrim info display wants Bo format + opponent OP.GG links. OP.GG links
-- are DERIVED (from the scouted opponent's roster ign/tagLine/region,
-- already in team_rosters since E14) rather than stored, so this only
-- needs a link to which scouted team this scrim is against.
alter table public.scrims add column bo_format text check (bo_format is null or bo_format in ('bo1', 'bo3', 'bo5'));
alter table public.scrims add column opponent_scouting_id uuid references public.team_scouting (id) on delete set null;

alter table public.discord_guild_links enable row level security;
alter table public.discord_guild_link_codes enable row level security;
alter table public.discord_user_link_codes enable row level security;
alter table public.discord_user_links enable row level security;
alter table public.discord_notifications_sent enable row level security;

-- guild_links: any group member can see it's linked (and to which
-- channel); only staff create/update/remove it.
create policy "discord_guild_links_read" on public.discord_guild_links for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "discord_guild_links_write_staff" on public.discord_guild_links for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

-- guild_link_codes: staff manage only their own group's codes.
create policy "discord_guild_link_codes_staff" on public.discord_guild_link_codes for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

-- user_link_codes / user_links: a user manages/reads only their own.
create policy "discord_user_link_codes_own" on public.discord_user_link_codes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "discord_user_links_read_own" on public.discord_user_links for select to authenticated
  using (user_id = (select auth.uid()));

-- discord_notifications_sent: bot-internal bookkeeping only — RLS enabled,
-- zero policies for `authenticated`, so the app can never read/write it;
-- only the service-role key (which bypasses RLS) can.
