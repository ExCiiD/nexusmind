-- Preparing a team session ahead (user's decision of 20/11/2026, docs/DECISIONS.md, spec DESIGN_STATE.md § 17, contract
-- docs/contracts/session-prep.md): each player's objectives for the session, the coach's message to the players, and
-- drafts of the Draft Sim attached to it. The collective objectives already exist (team_session_objectives) and stay as
-- they are.
--
--   - who prepares: the session's managers (private.can_manage_session) or the group's staff (private.is_group_staff),
--     while the session is scheduled (private.can_prepare_session). Once it started the preparation is read only
--     ("Session en cours : les objectifs ne se modifient plus"), and an ended session is frozen for its history.
--   - team_session_player_objectives: one row per (session, player), up to 2 objectives, KPIs and a short note (140).
--     Read by the group: each player sees theirs first and the others' folded (§ 17).
--   - team_session_prep_notes: the coach's message shown at the top of the players' view (280 characters), read by the
--     group.
--   - the analyst writes the collective objectives too (user's choice on the liaisons audit, 20/11/2026,
--     docs/AUDIT_LIAISONS.md): team_session_objectives_write accepts the group's staff besides the session's managers.
--   - team_session_drafts: a COPY of a draft (the team's publish rewrites team_drafts and changes their ids, and the
--     Draft Sim is local to each PC). source_id names the original so the same draft attached again replaces its copy.
--     Read by the group.
--   - CyberSecurity (20/11/2026, docs/AUDIT_SECURITE.md beta.13): a shared draft (source "team:<id>") must belong to the
--     session's group, and every objective, KPI id and champion of a draft slot is bounded in size.
-- Re-runnable: if not exists, create or replace, drop ... if exists. No semicolon inside a comment.

-- Size bounds (CyberSecurity) --------------------------------------------------------------------------------

-- Every element of a text array is 1 to p_max characters.
create or replace function private.text_items_within(p text[], p_max int)
returns boolean language sql immutable set search_path = ''
as $$ select coalesce(bool_and(length(x) between 1 and p_max), true) from unnest(p) x $$;
revoke all on function private.text_items_within(text[], int) from public, anon;
grant execute on function private.text_items_within(text[], int) to authenticated;

-- A list of draft slots: at most 5, each a champion key (1 to 40 characters) or a list of at most 10 of them.
create or replace function private.is_draft_slots(p jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 5
     and coalesce((select bool_and(
           case jsonb_typeof(s)
             when 'string' then length(s #>> '{}') between 1 and 40
             when 'array' then jsonb_array_length(s) <= 10
               and coalesce((select bool_and(jsonb_typeof(c) = 'string' and length(c #>> '{}') between 1 and 40) from jsonb_array_elements(s) c), true)
             else false
           end) from jsonb_array_elements(p) s), true)
$$;
revoke all on function private.is_draft_slots(jsonb) from public, anon;
grant execute on function private.is_draft_slots(jsonb) to authenticated;

create or replace function private.can_prepare_session(p_session uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_sessions s
    where s.id = p_session and s.status = 'scheduled'
      and (private.can_manage_session(s.group_id, p_user) or private.is_group_staff(s.group_id, p_user))
  )
$$;
revoke all on function private.can_prepare_session(uuid, uuid) from public, anon;
grant execute on function private.can_prepare_session(uuid, uuid) to authenticated;

-- The screen asks whether the reader may prepare (shows the edit controls).
create or replace function public.can_prepare_team_session(p_session uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.can_prepare_session(p_session, (select auth.uid())) $$;
revoke all on function public.can_prepare_team_session(uuid) from public, anon;
grant execute on function public.can_prepare_team_session(uuid) to authenticated;

-- The collective objectives: the session's managers, and now the group's staff (the analyst) ---------------------

drop policy if exists team_session_objectives_write on public.team_session_objectives;
create policy team_session_objectives_write on public.team_session_objectives
  for all
  using (private.can_manage_session(private.team_session_group(session_id)) or private.is_group_staff(private.team_session_group(session_id)))
  with check (private.can_manage_session(private.team_session_group(session_id)) or private.is_group_staff(private.team_session_group(session_id)));

-- Each player's objectives -------------------------------------------------------------------------------

create table if not exists public.team_session_player_objectives (
  session_id uuid not null references public.team_sessions (id) on delete cascade,
  player_id uuid not null references auth.users (id) on delete cascade,
  objective_ids text[] not null default '{}' check (cardinality(objective_ids) <= 2 and private.text_array_is_distinct(objective_ids) and private.text_items_within(objective_ids, 64)),
  kpi_ids text[] not null default '{}' check (cardinality(kpi_ids) <= 10 and private.text_items_within(kpi_ids, 64)),
  note text check (note is null or length(note) between 1 and 140),
  set_by uuid default auth.uid() references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (session_id, player_id),
  constraint team_session_player_objectives_not_empty check (cardinality(objective_ids) > 0 or note is not null)
);

alter table public.team_session_player_objectives enable row level security;
drop policy if exists team_session_player_objectives_read on public.team_session_player_objectives;
create policy team_session_player_objectives_read on public.team_session_player_objectives for select to authenticated
  using (private.group_role(private.team_session_group(session_id)) is not null);
drop policy if exists team_session_player_objectives_write on public.team_session_player_objectives;
create policy team_session_player_objectives_write on public.team_session_player_objectives for all to authenticated
  using (private.can_prepare_session(session_id))
  with check (private.can_prepare_session(session_id)
              and private.group_role(private.team_session_group(session_id), player_id) is not null);
revoke all on public.team_session_player_objectives from anon;
grant select, insert, update, delete on public.team_session_player_objectives to authenticated;

-- The coach's message ---------------------------------------------------------------------------------------

create table if not exists public.team_session_prep_notes (
  session_id uuid primary key references public.team_sessions (id) on delete cascade,
  message text not null check (length(btrim(message)) between 1 and 280),
  set_by uuid default auth.uid() references auth.users (id) on delete set null,
  set_at timestamptz not null default now()
);

alter table public.team_session_prep_notes enable row level security;
drop policy if exists team_session_prep_notes_read on public.team_session_prep_notes;
create policy team_session_prep_notes_read on public.team_session_prep_notes for select to authenticated
  using (private.group_role(private.team_session_group(session_id)) is not null);
drop policy if exists team_session_prep_notes_write on public.team_session_prep_notes;
create policy team_session_prep_notes_write on public.team_session_prep_notes for all to authenticated
  using (private.can_prepare_session(session_id))
  with check (private.can_prepare_session(session_id));
revoke all on public.team_session_prep_notes from anon;
grant select, insert, update, delete on public.team_session_prep_notes to authenticated;

-- Drafts attached to the session ----------------------------------------------------------------------------

create table if not exists public.team_session_drafts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.team_sessions (id) on delete cascade,
  source_id text check (source_id is null or length(source_id) between 1 and 128),
  name text not null check (length(btrim(name)) between 1 and 80),
  blue_picks jsonb not null default '[]'::jsonb check (private.is_draft_slots(blue_picks)),
  blue_bans jsonb not null default '[]'::jsonb check (private.is_draft_slots(blue_bans)),
  red_picks jsonb not null default '[]'::jsonb check (private.is_draft_slots(red_picks)),
  red_bans jsonb not null default '[]'::jsonb check (private.is_draft_slots(red_bans)),
  my_team_side text not null default 'blue' check (my_team_side in ('blue', 'red')),
  notes text check (notes is null or length(notes) <= 4000),
  position smallint not null default 0 check (position between 0 and 99),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_session_drafts_one_copy unique (session_id, source_id)
);
create index if not exists team_session_drafts_session on public.team_session_drafts (session_id, position, created_at);

-- A copy of a shared draft (source "team:<id>") comes from the session's own group (CyberSecurity): a staff member of two
-- groups cannot show group B's draft to group A.
create or replace function private.session_draft_same_group()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_draft uuid;
begin
  if new.source_id like 'team:%' then
    begin
      v_draft := substr(new.source_id, 6)::uuid;
    exception when others then
      raise exception 'INVALID_SOURCE' using errcode = '22023';
    end;
    if not exists (
      select 1 from public.team_drafts d join public.team_sessions s on s.group_id = d.group_id
      where d.id = v_draft and s.id = new.session_id
    ) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.session_draft_same_group() from public, anon, authenticated;
drop trigger if exists team_session_drafts_same_group on public.team_session_drafts;
create trigger team_session_drafts_same_group before insert or update of source_id, session_id on public.team_session_drafts
  for each row execute function private.session_draft_same_group();

drop trigger if exists team_session_drafts_touch on public.team_session_drafts;
create trigger team_session_drafts_touch before update on public.team_session_drafts
  for each row execute function private.touch_updated_at();

alter table public.team_session_drafts enable row level security;
drop policy if exists team_session_drafts_read on public.team_session_drafts;
create policy team_session_drafts_read on public.team_session_drafts for select to authenticated
  using (private.group_role(private.team_session_group(session_id)) is not null);
drop policy if exists team_session_drafts_write on public.team_session_drafts;
create policy team_session_drafts_write on public.team_session_drafts for all to authenticated
  using (private.can_prepare_session(session_id))
  with check (private.can_prepare_session(session_id));
revoke all on public.team_session_drafts from anon;
grant select, insert, update, delete on public.team_session_drafts to authenticated;
