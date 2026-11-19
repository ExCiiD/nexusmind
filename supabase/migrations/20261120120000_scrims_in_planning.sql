-- #49 (20 November 2026, mockup validated by the user, docs/PROPOSITION_SCRIMS_PLANNING.md and docs/DESIGN_STATE.md
-- section 13): scrims are planned from the Planning. A calendar slot of kind 'scrim' (a scrim) or 'tournament' (an
-- official match) is the source, and its row in public.scrims holds the match detail (format, opponent, preparation,
-- review). The opponent is created in the group's scouting, or reused, from the slot.
--
--   - scrims.calendar_event_id links the detail to its slot (one scrim per slot). Deleting the slot deletes the
--     scrim (CHOICE 3 below), never the opponent.
--   - the opponent is identified by opponent_key (the name trimmed, inner spaces collapsed, lower case: the key of
--     the draft log and the dossiers, src/lib/analyst.ts opponentKeyOf), unique per group in team_scouting, so the
--     link survives the desktop's "publish the team" (which rewrote every scouting row and changed its id).
--   - public.save_match_event writes the slot, its attendees, the scrim and the opponent in one transaction.
--   - public.update_match_detail writes the preparation and review of a scrim.
--   - the scrim's time follows its slot (trigger), so reminders, the availability check and the bot stay right.
--   - presence: a scrim with a slot is answered through the slot's presence answers (calendar_event_responses),
--     as in the mockup. run_scrim_availability_check reads them for those scrims.
--   - existing scrims get their slot (backfill).
--
-- Three choices, confirmed by the user on 20/11/2026, each kept in one place so they stay easy to change:
--   CHOICE 1  "Official" is the existing kind 'tournament': private.match_kind_of (section 2).
--   CHOICE 2  a captain or a manager creates an opponent from a slot and fills what is empty, but does not change
--             an opponent already scouted, the staff (owner, coach, analyst) may: v_may_overwrite in
--             save_match_event (section 4).
--   CHOICE 3  deleting the slot deletes the scrim and keeps the opponent: "on delete cascade" of
--             scrims.calendar_event_id (section 1). "on delete set null" would keep the scrim instead.
--
-- Re-runnable: if not exists, create or replace, drop ... if exists. No semicolon inside a comment.

-- 1. Columns ----------------------------------------------------------------------------

create or replace function private.opponent_key_of(p_name text)
returns text language sql immutable set search_path = ''
as $$ select nullif(lower(regexp_replace(regexp_replace(coalesce(p_name, ''), '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')), '') $$;
revoke all on function private.opponent_key_of(text) from public, anon;
grant execute on function private.opponent_key_of(text) to authenticated;

alter table public.scrims add column if not exists calendar_event_id uuid;
alter table public.scrims drop constraint if exists scrims_calendar_event_id_fkey;
alter table public.scrims add constraint scrims_calendar_event_id_fkey
  foreign key (calendar_event_id) references public.calendar_events (id) on delete cascade;
create unique index if not exists scrims_calendar_event_id_key on public.scrims (calendar_event_id);

alter table public.scrims add column if not exists kind text not null default 'scrim';
alter table public.scrims drop constraint if exists scrims_kind_check;
alter table public.scrims add constraint scrims_kind_check check (kind in ('scrim', 'official'));

alter table public.scrims add column if not exists opponent_key text;
alter table public.scrims drop constraint if exists scrims_opponent_key_check;
alter table public.scrims add constraint scrims_opponent_key_check check (opponent_key is null or length(opponent_key) between 1 and 80);

alter table public.team_scouting add column if not exists opponent_key text;
alter table public.team_scouting add column if not exists source text not null default 'publish';
alter table public.team_scouting drop constraint if exists team_scouting_source_check;
alter table public.team_scouting add constraint team_scouting_source_check check (source in ('publish', 'match'));
alter table public.team_scouting add column if not exists opgg_url text;
alter table public.team_scouting drop constraint if exists team_scouting_opgg_url_check;
alter table public.team_scouting add constraint team_scouting_opgg_url_check check (opgg_url is null or (
  length(opgg_url) <= 1000
  and opgg_url ~ '^https://([a-z0-9-]+\.)*(op\.gg|blitz\.gg|u\.gg|porofessor\.gg|deeplol\.gg|mobalytics\.gg|leagueofgraphs\.com)(/|$)'
));

-- The key of every scouted team. Two teams of a group with the same key keep apart: the most recently updated
-- keeps the key, the older ones get " (2)", " (3)" so the unique index holds and nothing is lost (production had
-- no scouted team on 20/11/2026). One statement, so the order is read before the touch trigger changes updated_at.
with ranked as (
  select id, private.opponent_key_of(name) as k,
    row_number() over (partition by group_id, private.opponent_key_of(name) order by updated_at desc, id) as rn
  from public.team_scouting where opponent_key is null
)
update public.team_scouting t
set opponent_key = case when r.rn = 1 then r.k else left(r.k, 74) || ' (' || r.rn || ')' end
from ranked r where r.id = t.id;
alter table public.team_scouting alter column opponent_key set not null;
alter table public.team_scouting drop constraint if exists team_scouting_opponent_key_check;
alter table public.team_scouting add constraint team_scouting_opponent_key_check check (length(opponent_key) between 1 and 80);
create unique index if not exists team_scouting_group_opponent_key on public.team_scouting (group_id, opponent_key);

-- Writers that do not know the key (the web's Scouting tab, older desktop versions publishing their team) get it
-- from the name. A rename moves the key, and the scrims that pointed at the old key follow. Renaming to a name
-- another scouted team of the group already has is refused by the unique index.
create or replace function private.team_scouting_key()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.opponent_key := coalesce(new.opponent_key, private.opponent_key_of(new.name));
  elsif new.name is distinct from old.name and new.opponent_key is not distinct from old.opponent_key then
    new.opponent_key := private.opponent_key_of(new.name);
  end if;
  return new;
end
$$;
revoke all on function private.team_scouting_key() from public, anon, authenticated;
drop trigger if exists team_scouting_key on public.team_scouting;
create trigger team_scouting_key before insert or update of name, opponent_key on public.team_scouting
  for each row execute function private.team_scouting_key();

create or replace function private.team_scouting_key_moved()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.scrims set opponent_key = new.opponent_key
  where group_id = new.group_id and opponent_key = old.opponent_key;
  return new;
end
$$;
revoke all on function private.team_scouting_key_moved() from public, anon, authenticated;
drop trigger if exists team_scouting_key_moved on public.team_scouting;
-- Not "update of opponent_key": a key set by the trigger above is not a column of the UPDATE statement.
create trigger team_scouting_key_moved after update on public.team_scouting
  for each row when (new.opponent_key is distinct from old.opponent_key)
  execute function private.team_scouting_key_moved();

-- 2. Which calendar kinds are matches (CHOICE 1) ------------------------------------------

create or replace function private.match_kind_of(p_event_kind text)
returns text language sql immutable set search_path = ''
as $$ select case p_event_kind when 'scrim' then 'scrim' when 'tournament' then 'official' end $$;
revoke all on function private.match_kind_of(text) from public, anon;
grant execute on function private.match_kind_of(text) to authenticated;

-- 3. The scrim's time and kind follow its slot ------------------------------------------------

create or replace function private.scrim_follows_its_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.scrims set
    scheduled_at = new.starts_at,
    duration_min = least(600, greatest(15, (extract(epoch from (new.ends_at - new.starts_at)) / 60)::int)),
    title = new.title,
    kind = coalesce(private.match_kind_of(new.kind), kind),
    -- A slot moved to a later time can be reminded again.
    reminder_24h_sent = case when new.starts_at is distinct from old.starts_at then false else reminder_24h_sent end,
    reminder_1h_sent = case when new.starts_at is distinct from old.starts_at then false else reminder_1h_sent end,
    low_availability_notified = case when new.starts_at is distinct from old.starts_at then false else low_availability_notified end
  where calendar_event_id = new.id;
  return new;
end
$$;
revoke all on function private.scrim_follows_its_event() from public, anon, authenticated;

drop trigger if exists scrim_follows_its_event on public.calendar_events;
create trigger scrim_follows_its_event
  after update of starts_at, ends_at, title, kind on public.calendar_events
  for each row execute function private.scrim_follows_its_event();

-- 4. Writing a match from the Planning ------------------------------------------------------------

-- p_event: { id?, kind: 'scrim' | 'tournament', title, startsAt, endsAt, notes?, attendeeScope?, attendeeUserIds? }
-- p_match: { boFormat?: 'bo1' | 'bo3' | 'bo5' | null,
--            opponent?: { name, tag?, opggUrl?, players?: [{ role, riotId?, region? }] } | null }
-- Returns the slot's id. Errors: FORBIDDEN, NOT_FOUND, INVALID_KIND, INVALID_EVENT, INVALID_OPPONENT.
create or replace function public.save_match_event(p_group uuid, p_event jsonb, p_match jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event_id uuid := nullif(p_event->>'id', '')::uuid;
  v_kind text := p_event->>'kind';
  v_title text := btrim(coalesce(p_event->>'title', ''));
  v_starts timestamptz;
  v_ends timestamptz;
  v_scope text := coalesce(p_event->>'attendeeScope', 'custom');
  v_attendees uuid[];
  v_match jsonb := coalesce(p_match, '{}'::jsonb);
  v_bo text := nullif(v_match->>'boFormat', '');
  v_opp jsonb := case when jsonb_typeof(v_match->'opponent') = 'object' then v_match->'opponent' end;
  v_name text;
  v_key text;
  v_tag text;
  v_opgg text;
  v_players jsonb;
  v_scouting public.team_scouting;
  v_scrim_id uuid;
  -- CHOICE 2: who may change an opponent already scouted, from a slot.
  v_may_overwrite boolean := private.is_group_staff(p_group, v_uid);
  p jsonb;
  v_role text;
  v_riot text;
  v_ign text;
  v_tagline text;
  v_region text;
  v_existing public.team_rosters;
begin
  if v_uid is null or not private.can_edit_calendar(p_group, v_uid) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if private.match_kind_of(v_kind) is null then
    raise exception 'INVALID_KIND' using errcode = '22023';
  end if;
  begin
    v_starts := (p_event->>'startsAt')::timestamptz;
    v_ends := (p_event->>'endsAt')::timestamptz;
  exception when others then
    raise exception 'INVALID_EVENT' using errcode = '22023';
  end;
  if v_starts is null or v_ends is null or v_ends <= v_starts or length(v_title) not between 1 and 120
     or v_scope not in ('whole_team', 'all_players', 'all_staff', 'custom')
     or (v_bo is not null and v_bo not in ('bo1', 'bo3', 'bo5')) then
    raise exception 'INVALID_EVENT' using errcode = '22023';
  end if;
  -- Attendees: members of the group only, each once.
  select coalesce(array_agg(distinct m.user_id), '{}') into v_attendees
  from jsonb_array_elements_text(coalesce(p_event->'attendeeUserIds', '[]'::jsonb)) as a (id)
  join public.group_members m on m.group_id = p_group and m.user_id::text = a.id;

  -- The opponent, checked before anything is written.
  if v_opp is not null then
    v_name := btrim(coalesce(v_opp->>'name', ''));
    v_key := private.opponent_key_of(v_name);
    v_tag := nullif(btrim(coalesce(v_opp->>'tag', '')), '');
    v_opgg := nullif(btrim(coalesce(v_opp->>'opggUrl', '')), '');
    v_players := coalesce(v_opp->'players', '[]'::jsonb);
    if v_key is null or length(v_name) > 80 or length(v_key) > 80 or length(coalesce(v_tag, '')) > 16
       or (v_opgg is not null and (length(v_opgg) > 1000
           or v_opgg !~ '^https://([a-z0-9-]+\.)*(op\.gg|blitz\.gg|u\.gg|porofessor\.gg|deeplol\.gg|mobalytics\.gg|leagueofgraphs\.com)(/|$)'))
       or jsonb_typeof(v_players) <> 'array' or jsonb_array_length(v_players) > 5
       or exists (select 1 from jsonb_array_elements(v_players) x
                  where coalesce(x->>'role', '') not in ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT')
                     or length(coalesce(x->>'riotId', '')) > 64 or length(coalesce(x->>'region', '')) > 16)
       or (select count(*) from jsonb_array_elements(v_players) x) <> (select count(distinct x->>'role') from jsonb_array_elements(v_players) x) then
      raise exception 'INVALID_OPPONENT' using errcode = '22023';
    end if;
  end if;

  -- The slot.
  if v_event_id is null then
    insert into public.calendar_events (group_id, kind, title, starts_at, ends_at, notes, attendee_scope, created_by)
    values (p_group, v_kind, v_title, v_starts, v_ends, nullif(p_event->>'notes', ''), v_scope, v_uid)
    returning id into v_event_id;
  else
    update public.calendar_events set kind = v_kind, title = v_title, starts_at = v_starts, ends_at = v_ends,
      notes = nullif(p_event->>'notes', ''), attendee_scope = v_scope
    where id = v_event_id and group_id = p_group;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;
  if p_event ? 'attendeeUserIds' then
    delete from public.calendar_event_attendees where event_id = v_event_id;
    insert into public.calendar_event_attendees (event_id, user_id) select v_event_id, unnest(v_attendees);
  end if;

  -- The opponent: reused by its key, or created.
  if v_opp is not null then
    select * into v_scouting from public.team_scouting where group_id = p_group and opponent_key = v_key for update;
    if v_scouting.id is null then
      insert into public.team_scouting (group_id, name, tag, opgg_url, opponent_key, source, created_by)
      values (p_group, v_name, v_tag, v_opgg, v_key, 'match', v_uid)
      returning * into v_scouting;
    else
      update public.team_scouting set
        tag = case when v_may_overwrite and v_tag is not null then v_tag else coalesce(tag, v_tag) end,
        opgg_url = case when v_may_overwrite and v_opgg is not null then v_opgg else coalesce(opgg_url, v_opgg) end
      where id = v_scouting.id;
    end if;
    for p in select * from jsonb_array_elements(v_players) loop
      v_role := p->>'role';
      v_riot := nullif(btrim(coalesce(p->>'riotId', '')), '');
      v_region := nullif(btrim(coalesce(p->>'region', '')), '');
      continue when v_riot is null;
      if position('#' in v_riot) > 0 then
        v_ign := btrim(left(v_riot, length(v_riot) - position('#' in reverse(v_riot))));
        v_tagline := nullif(btrim(right(v_riot, position('#' in reverse(v_riot)) - 1)), '');
      else
        v_ign := v_riot;
        v_tagline := null;
      end if;
      continue when v_ign = '';
      select * into v_existing from public.team_rosters
      where scouting_id = v_scouting.id and role = v_role
      order by (ign is null), created_at limit 1;
      if v_existing.id is null then
        insert into public.team_rosters (group_id, scouting_id, display_name, ign, tag_line, region, role, status, created_by)
        values (p_group, v_scouting.id, left(v_ign, 64), left(v_ign, 64), v_tagline, v_region, v_role, 'starter', v_uid);
      elsif v_existing.ign is null or v_may_overwrite then
        update public.team_rosters set display_name = left(v_ign, 64), ign = left(v_ign, 64), tag_line = v_tagline,
          region = coalesce(v_region, region)
        where id = v_existing.id;
      end if;
    end loop;
  end if;

  -- The scrim, one per slot.
  select id into v_scrim_id from public.scrims where calendar_event_id = v_event_id;
  if v_scrim_id is null then
    insert into public.scrims (group_id, calendar_event_id, kind, title, opponent, opponent_key, opponent_scouting_id,
      scheduled_at, duration_min, bo_format, created_by)
    values (p_group, v_event_id, private.match_kind_of(v_kind), v_title, nullif(v_name, ''), v_key, v_scouting.id,
      v_starts, least(600, greatest(15, (extract(epoch from (v_ends - v_starts)) / 60)::int)), v_bo, v_uid)
    returning id into v_scrim_id;
  else
    update public.scrims set kind = private.match_kind_of(v_kind), title = v_title, opponent = nullif(v_name, ''),
      opponent_key = v_key, opponent_scouting_id = v_scouting.id, bo_format = v_bo
    where id = v_scrim_id;
  end if;
  -- Kept for the app versions that read the link from the slot.
  update public.calendar_events set linked_scrim_id = v_scrim_id where id = v_event_id and linked_scrim_id is distinct from v_scrim_id;
  return v_event_id;
end;
$$;
revoke all on function public.save_match_event(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_match_event(uuid, jsonb, jsonb) to authenticated;

-- The preparation and review of a scrim: { prepNotes?, reviewNotes?, checklist?, draftIds?, status?, opponentRoles? }.
-- opponentRoles: [{ riotId: "Name#TAG", role }], the roles of this scrim's opponent players, set from the detail panel.
-- Only those players' roles change, matched by Riot ID (case and surrounding spaces ignored) in the opponent's
-- scouted roster: nothing else of the scouted team. A Riot ID that is not one of its players, or a scrim without a
-- scouted opponent, is INVALID_DETAIL. Two players may swap roles in one patch.
-- The same people as the slot, plus the analyst. Errors: FORBIDDEN, NOT_FOUND, INVALID_DETAIL.
create or replace function public.update_match_detail(p_scrim uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
  v_scouting uuid;
  r jsonb;
  v_ign text;
  v_tag text;
begin
  select group_id into v_group from public.scrims where id = p_scrim;
  if v_group is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is null or not (private.can_edit_calendar(v_group, v_uid) or private.is_group_staff(v_group, v_uid)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('prepNotes', 'reviewNotes', 'checklist', 'draftIds', 'status', 'opponentRoles'))
     or (p_patch ? 'opponentRoles' and (jsonb_typeof(p_patch->'opponentRoles') <> 'array'
         or jsonb_array_length(p_patch->'opponentRoles') > 5
         or exists (select 1 from jsonb_array_elements(p_patch->'opponentRoles') x
                    where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'riotId') <> 'string' or length(x->>'riotId') > 64
                       or position('#' in x->>'riotId') = 0
                       or coalesce(x->>'role', '') not in ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'))
         or (select count(distinct x->>'role') from jsonb_array_elements(p_patch->'opponentRoles') x) <> jsonb_array_length(p_patch->'opponentRoles')
         or (select count(distinct lower(btrim(x->>'riotId'))) from jsonb_array_elements(p_patch->'opponentRoles') x) <> jsonb_array_length(p_patch->'opponentRoles')))
     or (p_patch ? 'checklist' and (jsonb_typeof(p_patch->'checklist') <> 'array'
         or exists (select 1 from jsonb_array_elements(p_patch->'checklist') c
                    where jsonb_typeof(c) <> 'object' or jsonb_typeof(c->'label') <> 'string' or jsonb_typeof(c->'done') <> 'boolean'
                       or length(c->>'label') > 200)))
     or (p_patch ? 'draftIds' and jsonb_typeof(p_patch->'draftIds') <> 'array')
     or (p_patch ? 'status' and coalesce(p_patch->>'status', '') not in ('planned', 'done', 'cancelled')) then
    raise exception 'INVALID_DETAIL' using errcode = '22023';
  end if;
  begin
    update public.scrims set
      prep_notes = case when p_patch ? 'prepNotes' then nullif(p_patch->>'prepNotes', '') else prep_notes end,
      review_notes = case when p_patch ? 'reviewNotes' then nullif(p_patch->>'reviewNotes', '') else review_notes end,
      checklist = case when p_patch ? 'checklist' then p_patch->'checklist' else checklist end,
      draft_ids = case when p_patch ? 'draftIds' then array(select jsonb_array_elements_text(p_patch->'draftIds')) else draft_ids end,
      status = case when p_patch ? 'status' then p_patch->>'status' else status end
    where id = p_scrim;
  exception when check_violation then
    raise exception 'INVALID_DETAIL' using errcode = '22023';
  end;

  if p_patch ? 'opponentRoles' and jsonb_array_length(p_patch->'opponentRoles') > 0 then
    select t.id into v_scouting
    from public.scrims s join public.team_scouting t on t.group_id = s.group_id and t.opponent_key = s.opponent_key
    where s.id = p_scrim;
    if v_scouting is null then
      raise exception 'INVALID_DETAIL' using errcode = '22023';
    end if;
    for r in select * from jsonb_array_elements(p_patch->'opponentRoles') loop
      v_ign := lower(btrim(left(r->>'riotId', length(r->>'riotId') - position('#' in reverse(r->>'riotId')))));
      v_tag := lower(btrim(right(r->>'riotId', position('#' in reverse(r->>'riotId')) - 1)));
      update public.team_rosters set role = r->>'role'
      where scouting_id = v_scouting and lower(btrim(coalesce(ign, ''))) = v_ign and lower(btrim(coalesce(tag_line, ''))) = v_tag;
      if not found then
        raise exception 'INVALID_DETAIL' using errcode = '22023';
      end if;
    end loop;
  end if;
end;
$$;
revoke all on function public.update_match_detail(uuid, jsonb) from public, anon;
grant execute on function public.update_match_detail(uuid, jsonb) to authenticated;

-- 5. Presence: a scrim with a slot is answered on the slot ----------------------------------------
-- Body of 20261119211601_member_staff_roles (staff recipients as effective roles), one change: for a scrim with a
-- slot, a starter's "yes" is a 'confirmed' presence answer on that slot, and a starter who never answered is one
-- without any answer on it. A scrim without a slot (none after the backfill below) keeps scrim_availability.

create or replace function public.run_scrim_availability_check()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s record;
declare starter record;
declare yes_count int;
declare starter_count int;
declare staffer record;
begin
  for s in
    select * from public.scrims
    where status = 'planned' and scheduled_at between now() and now() + interval '48 hours'
  loop
    select count(*) into starter_count from public.team_rosters
      where group_id = s.group_id and status = 'starter' and scouting_id is null and user_id is not null;
    if starter_count = 0 then continue; end if;

    if s.calendar_event_id is not null then
      select count(*) into yes_count from public.calendar_event_responses r
        join public.team_rosters tr on tr.user_id = r.user_id
        where tr.group_id = s.group_id and tr.status = 'starter' and tr.scouting_id is null
          and r.event_id = s.calendar_event_id and r.status = 'confirmed';
    else
      select count(*) into yes_count from public.scrim_availability sa
        join public.team_rosters tr on tr.user_id = sa.user_id
        where tr.group_id = s.group_id and tr.status = 'starter' and tr.scouting_id is null
          and sa.scrim_id = s.id and sa.status = 'yes';
    end if;

    if yes_count < 5 and not s.low_availability_notified then
      for staffer in
        select user_id from public.group_members
        where group_id = s.group_id
          and (role = any(array['owner', 'coach', 'analyst']) or staff_roles && array['coach', 'analyst'])
      loop
        perform private.notify(staffer.user_id, 'scrim_low_availability',
          jsonb_build_object('groupId', s.group_id, 'scrimId', s.id, 'title', s.title, 'yesCount', yes_count),
          '/coaching');
      end loop;
      update public.scrims set low_availability_notified = true where id = s.id;
    end if;

    for starter in
      select tr.user_id from public.team_rosters tr
      where tr.group_id = s.group_id and tr.status = 'starter' and tr.scouting_id is null and tr.user_id is not null
        and (case when s.calendar_event_id is not null
              then not exists (select 1 from public.calendar_event_responses r where r.event_id = s.calendar_event_id and r.user_id = tr.user_id)
              else not exists (select 1 from public.scrim_availability sa where sa.scrim_id = s.id and sa.user_id = tr.user_id) end)
        and not exists (select 1 from public.scrim_availability_reminders rem where rem.scrim_id = s.id and rem.user_id = tr.user_id)
    loop
      perform private.notify(starter.user_id, 'scrim_availability_missing',
        jsonb_build_object('groupId', s.group_id, 'scrimId', s.id, 'title', s.title),
        '/coaching');
      insert into public.scrim_availability_reminders (scrim_id, user_id) values (s.id, starter.user_id);
    end loop;
  end loop;
end;
$$;
revoke all on function public.run_scrim_availability_check() from public, anon, authenticated;

-- 6. Backfill: every scrim gets its slot ------------------------------------------------------------

-- a. A slot that already points at the scrim (linked_scrim_id) is adopted, one per scrim.
with adoptable as (
  select distinct on (e.linked_scrim_id) e.linked_scrim_id as scrim_id, e.id as event_id
  from public.calendar_events e
  join public.scrims s on s.id = e.linked_scrim_id and s.group_id = e.group_id
  where s.calendar_event_id is null
    and not exists (select 1 from public.scrims o where o.calendar_event_id = e.id)
  order by e.linked_scrim_id, e.created_at
)
update public.scrims s set calendar_event_id = a.event_id from adoptable a where s.id = a.scrim_id;

-- b. Otherwise a slot is created. The team session trigger is off meanwhile: a past scrim gets no session, an
--    upcoming one gets its session below, as if it had been created from the Planning.
alter table public.calendar_events disable trigger calendar_event_auto_team_session;
with created as (
  insert into public.calendar_events (group_id, kind, title, starts_at, ends_at, attendee_scope, linked_scrim_id, created_by)
  select s.group_id, case when s.kind = 'official' then 'tournament' else 'scrim' end, s.title, s.scheduled_at,
    s.scheduled_at + make_interval(mins => s.duration_min), 'whole_team', s.id, s.created_by
  from public.scrims s
  where s.calendar_event_id is null
  returning id, linked_scrim_id
)
update public.scrims s set calendar_event_id = c.id from created c where s.id = c.linked_scrim_id;
alter table public.calendar_events enable trigger calendar_event_auto_team_session;
insert into public.team_sessions (group_id, calendar_event_id)
select e.group_id, e.id from public.calendar_events e join public.scrims s on s.calendar_event_id = e.id
where e.starts_at > now()
on conflict (calendar_event_id) do nothing;

-- c. Every slot of a scrim points at it (the link older app versions read).
update public.calendar_events e set linked_scrim_id = s.id
from public.scrims s where s.calendar_event_id = e.id and e.linked_scrim_id is distinct from s.id;

-- d. The opponent's key, and its scouted team when one has that key. No scouted team is created for an old scrim
--    that only had a name.
update public.scrims set opponent_key = private.opponent_key_of(opponent) where opponent_key is null and private.opponent_key_of(opponent) is not null;
update public.scrims s set opponent_scouting_id = t.id
from public.team_scouting t
where s.opponent_scouting_id is null and t.group_id = s.group_id and t.opponent_key = s.opponent_key;
