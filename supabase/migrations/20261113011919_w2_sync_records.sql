-- W2: multi-device sync. One generic row per synced local record, so the
-- desktop schema can evolve without server migrations.
-- `seq` is a server-assigned cursor (no reliance on client clocks for pulls);
-- `updated_at` is the client change time used for last-write-wins.

create sequence if not exists public.sync_records_seq;

create table if not exists public.sync_records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  table_name text        not null check (table_name ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  record_id  text        not null check (length(record_id) between 1 and 128),
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null,
  device_id  text        check (device_id is null or length(device_id) <= 64),
  seq        bigint      not null default nextval('public.sync_records_seq'),
  primary key (user_id, table_name, record_id),
  constraint sync_records_payload check (deleted or data is not null),
  constraint sync_records_size check (data is null or pg_column_size(data) < 1048576)
);

create index if not exists sync_records_user_seq_idx on public.sync_records (user_id, seq);

-- Every write gets a fresh cursor value.
create or replace function public.sync_records_bump_seq()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.seq := nextval('public.sync_records_seq');
  return new;
end;
$$;

drop trigger if exists sync_records_bump_seq on public.sync_records;
create trigger sync_records_bump_seq
  before insert or update on public.sync_records
  for each row execute function public.sync_records_bump_seq();

alter table public.sync_records enable row level security;

create policy "sync_records_select_own" on public.sync_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy "sync_records_insert_own" on public.sync_records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "sync_records_update_own" on public.sync_records
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No delete policy: deletions are tombstones (deleted = true) so other devices learn about them.

-- Batched last-write-wins upsert. SECURITY INVOKER: RLS still applies.
-- p_records: [{ "t": table, "id": record id, "data": {...}|null, "del": bool, "at": iso time, "dev": device id }]
create or replace function public.sync_push(p_records jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 500 then
    raise exception 'p_records must be an array of at most 500 records' using errcode = '22023';
  end if;

  insert into public.sync_records as s (user_id, table_name, record_id, data, deleted, updated_at, device_id)
  select auth.uid(),
         r->>'t',
         r->>'id',
         case when coalesce((r->>'del')::boolean, false) then null else r->'data' end,
         coalesce((r->>'del')::boolean, false),
         (r->>'at')::timestamptz,
         r->>'dev'
  from jsonb_array_elements(p_records) as r
  on conflict (user_id, table_name, record_id) do update
    set data = excluded.data,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at,
        device_id = excluded.device_id
    where s.updated_at <= excluded.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
