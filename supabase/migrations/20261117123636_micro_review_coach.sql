-- Micro-review — coach side (docs/PLAN_MICRO_REVIEW.md, "Coaching / Équipe").
--
-- Applied to production on 17/11/2026 with the user's approval (migration
-- "micro_review_coach"). The desktop/web clients still tolerate the tables
-- being absent (empty lists + "not enabled yet" hint) on other environments.
--
--   micro_review_answers   one row per QCM answer, written by the player
--                          (copy of the local MicroReviewAnswer, keyed by its
--                          local id). Readable by the player and by staff of
--                          a group the player shares reviews with (same
--                          consent gate as Mistake rows in sync_records).
--   micro_review_verdicts  a coach validates or corrects an answer.
--   team_codex_rules       team rules a coach adds to the AscendCodex; read
--                          by every member, written by staff.

create table public.micro_review_answers (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_id       text not null check (length(local_id) between 1 and 64),
  match_id       text check (match_id is null or length(match_id) <= 40),
  champion       text not null default '' check (length(champion) <= 40),
  role           text not null default '' check (length(role) <= 16),
  game_time_sec  int not null check (game_time_sec between 0 and 36000),
  -- Video second where the excerpt starts (game time − 12 s + recording offset), for "jump to".
  video_time_sec int check (video_time_sec is null or video_time_sec between 0 and 36000),
  trigger        text not null check (trigger in ('critical-death', 'absent-objective', 'early-deficit')),
  outcome        text not null check (outcome in ('mistake', 'justified', 'custom')),
  tag_slug       text check (tag_slug is null or tag_slug ~ '^[a-z0-9-]{1,64}$'),
  reason         text check (reason is null or length(reason) <= 40),
  note           text check (note is null or length(note) <= 1000),
  -- Structured one-line summary (keys + params), rendered by the client in its language.
  summary        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (player_id, local_id)
);
create index micro_review_answers_player_idx on public.micro_review_answers (player_id, created_at desc);

create table public.micro_review_verdicts (
  id                uuid primary key default gen_random_uuid(),
  answer_id         uuid not null references public.micro_review_answers (id) on delete cascade,
  group_id          uuid not null references public.groups (id) on delete cascade,
  coach_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status            text not null check (status in ('validated', 'corrected')),
  corrected_outcome text check (corrected_outcome is null or corrected_outcome in ('mistake', 'justified')),
  corrected_tag     text check (corrected_tag is null or corrected_tag ~ '^[a-z0-9-]{1,64}$'),
  note              text check (note is null or length(note) <= 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (answer_id, coach_id)
);
create index micro_review_verdicts_answer_idx on public.micro_review_verdicts (answer_id);

create table public.team_codex_rules (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups (id) on delete cascade,
  role            text not null default 'any' check (role in ('any', 'TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')),
  mistake_slug    text not null check (mistake_slug ~ '^[a-z0-9-]{1,64}$'),
  phase           text not null default 'any' check (phase in ('any', 'early', 'mid', 'late')),
  radar_axis      text not null default '' check (length(radar_axis) <= 16),
  fundamental_id  text not null check (length(fundamental_id) between 1 and 64),
  headline        text not null check (length(trim(headline)) between 1 and 140),
  tactical_rule   text not null check (length(trim(tactical_rule)) between 1 and 1000),
  drill_objective text not null check (length(trim(drill_objective)) between 1 and 300),
  video_ref       text check (video_ref is null or length(video_ref) <= 500),
  created_by      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now()
);
create index team_codex_rules_group_idx on public.team_codex_rules (group_id, mistake_slug);

-- Player of an answer, for RLS without recursion.
create or replace function private.micro_answer_player(p_answer uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select player_id from public.micro_review_answers where id = p_answer $$;
revoke all on function private.micro_answer_player(uuid) from public;
grant execute on function private.micro_answer_player(uuid) to authenticated;

alter table public.micro_review_answers enable row level security;
alter table public.micro_review_verdicts enable row level security;
alter table public.team_codex_rules enable row level security;

-- Answers: the player owns them; staff read them under the share_reviews consent.
create policy "micro_answers_read" on public.micro_review_answers for select to authenticated
  using (player_id = auth.uid() or private.can_read_player_table(player_id, 'Mistake'));
create policy "micro_answers_insert_own" on public.micro_review_answers for insert to authenticated
  with check (player_id = auth.uid());
create policy "micro_answers_update_own" on public.micro_review_answers for update to authenticated
  using (player_id = auth.uid()) with check (player_id = auth.uid());
create policy "micro_answers_delete_own" on public.micro_review_answers for delete to authenticated
  using (player_id = auth.uid());

-- Verdicts: written by staff of a group the player belongs to and shares reviews with.
create policy "micro_verdicts_read" on public.micro_review_verdicts for select to authenticated
  using (
    private.micro_answer_player(answer_id) = auth.uid()
    or private.is_group_staff(group_id)
  );
create policy "micro_verdicts_write_staff" on public.micro_review_verdicts for insert to authenticated
  with check (
    coach_id = auth.uid()
    and private.is_group_staff(group_id)
    and private.can_read_player_table(private.micro_answer_player(answer_id), 'Mistake')
    and exists (select 1 from public.group_members m where m.group_id = micro_review_verdicts.group_id and m.user_id = private.micro_answer_player(answer_id))
  );
create policy "micro_verdicts_update_own" on public.micro_review_verdicts for update to authenticated
  using (coach_id = auth.uid() and private.is_group_staff(group_id))
  with check (coach_id = auth.uid() and private.is_group_staff(group_id));
create policy "micro_verdicts_delete_own" on public.micro_review_verdicts for delete to authenticated
  using (coach_id = auth.uid());

-- Team Codex: every member reads, staff writes.
create policy "team_codex_read" on public.team_codex_rules for select to authenticated
  using (private.group_role(group_id) is not null);
create policy "team_codex_write_staff" on public.team_codex_rules for all to authenticated
  using (private.is_group_staff(group_id)) with check (private.is_group_staff(group_id));

create trigger micro_review_answers_touch before update on public.micro_review_answers
  for each row execute function public.touch_updated_at();
create trigger micro_review_verdicts_touch before update on public.micro_review_verdicts
  for each row execute function public.touch_updated_at();
