-- sync_push: skip re-pushes that change nothing (19 November 2026).
--
-- A device that signs in to a cloud account (new install, reconnect) queues
-- every local row and pushes it again, stamped with the row's own last
-- modification time. The upsert's guard was `s.updated_at <= excluded.updated_at`,
-- so a row identical to the stored one (same time, same content) was still
-- rewritten: the bump_seq trigger then gave it a new seq and every other
-- device of the account downloaded it again — the whole history, each time.
--
-- Now an equal timestamp only rewrites when the content or the deleted flag
-- actually differs. A strictly newer push behaves exactly as before
-- (last write wins); an older one is still ignored. The returned count is
-- the number of rows really written, as before.

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
    where s.updated_at < excluded.updated_at
       or (s.updated_at = excluded.updated_at
           and (s.deleted is distinct from excluded.deleted or s.data is distinct from excluded.data));

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
