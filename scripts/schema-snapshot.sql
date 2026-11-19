-- Read-only schema fingerprint of the app's database objects (WSC-05 / DA-4). The same query runs on production
-- (execute_sql) and on PGlite after replaying supabase/migrations (scripts/test-schema-baseline.mjs), and the two
-- results must match. One line per object, "kind|name|fingerprint", all in one text value.
--   table     public/private tables: columns, constraints, indexes, policies, triggers, grants, RLS flags,
--             each hashed apart so a mismatch says which part differs (c k i p t g r)
--   function  public/private functions: result, language, security definer, volatility, settings, argument
--             defaults, body (whitespace collapsed), and who may execute it (a = anon, u = authenticated,
--             s = service_role)
--   sequence  public sequences and their grants
--   storage   policies on storage.objects, and buckets
--   cron      pg_cron jobs
-- Fingerprints are the first 8 characters of an md5: enough to compare, short enough to keep the export small.
with
tabs as (
  select c.oid, n.nspname || '.' || c.relname as name, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
),
cols as (
  select t.oid, string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
    || case when a.attnotnull then ' nn' else '' end
    || coalesce(' d=' || pg_get_expr(d.adbin, d.adrelid), '')
    || coalesce(' acl=' || a.attacl::text, ''), ',' order by a.attname) s
  from tabs t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = t.oid and d.adnum = a.attnum
  group by t.oid
),
cons as (
  select t.oid, string_agg(co.conname || ' ' || pg_get_constraintdef(co.oid), ',' order by co.conname) s
  from tabs t join pg_constraint co on co.conrelid = t.oid group by t.oid
),
idx as (
  select t.oid, string_agg(pg_get_indexdef(i.indexrelid), ',' order by pg_get_indexdef(i.indexrelid)) s
  from tabs t join pg_index i on i.indrelid = t.oid group by t.oid
),
pol as (
  select t.oid, string_agg(p.polname || ' ' || p.polcmd::text || ' ' || p.polpermissive::text
    || ' ' || coalesce((select string_agg(case when r = 0 then 'public' else pg_get_userbyid(r) end, '+' order by 1) from unnest(p.polroles) r), '')
    || ' u=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
    || ' w=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ',' order by p.polname) s
  from tabs t join pg_policy p on p.polrelid = t.oid group by t.oid
),
trg as (
  select t.oid, string_agg(pg_get_triggerdef(tg.oid), ',' order by tg.tgname) s
  from tabs t join pg_trigger tg on tg.tgrelid = t.oid and not tg.tgisinternal group by t.oid
),
grt as (
  select t.oid, string_agg(r.rolname || ':' || p.priv, ',' order by r.rolname, p.priv) s
  from tabs t
  cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (priv)
  where has_table_privilege(r.rolname, t.oid, p.priv)
  group by t.oid
),
rows as (
  select 'table' kind, t.name,
    'c' || left(md5(coalesce(c.s, '')), 6) || ' k' || left(md5(coalesce(k.s, '')), 6) || ' i' || left(md5(coalesce(i.s, '')), 6)
    || ' p' || left(md5(coalesce(p.s, '')), 6) || ' t' || left(md5(coalesce(tr.s, '')), 6) || ' g' || left(md5(coalesce(g.s, '')), 6)
    || ' r' || (case when t.relrowsecurity then '1' else '0' end) || (case when t.relforcerowsecurity then '1' else '0' end) fp
  from tabs t
  left join cols c on c.oid = t.oid left join cons k on k.oid = t.oid left join idx i on i.oid = t.oid
  left join pol p on p.oid = t.oid left join trg tr on tr.oid = t.oid left join grt g on g.oid = t.oid
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    left(md5(concat_ws('|', pg_get_function_result(p.oid), l.lanname, p.prosecdef::text, p.provolatile::text,
      coalesce(array_to_string(p.proconfig, ','), ''), coalesce(pg_get_expr(p.proargdefaults, 0), ''),
      btrim(regexp_replace(replace(p.prosrc, chr(13), ''), '\s+', ' ', 'g')))), 8)
    || ' ' || (case when has_function_privilege('anon', p.oid, 'execute') then 'a' else '-' end)
    || (case when has_function_privilege('authenticated', p.oid, 'execute') then 'u' else '-' end)
    || (case when has_function_privilege('service_role', p.oid, 'execute') then 's' else '-' end)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
  where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'sequence', n.nspname || '.' || c.relname,
    (case when has_sequence_privilege('anon', c.oid, 'usage') then 'a' else '-' end)
    || (case when has_sequence_privilege('authenticated', c.oid, 'usage') then 'u' else '-' end)
    || (case when has_sequence_privilege('service_role', c.oid, 'usage') then 's' else '-' end)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind = 'S'
  union all
  select 'storage', 'policy ' || p.polname,
    left(md5(p.polcmd::text || ' ' || p.polpermissive::text
      || ' ' || coalesce((select string_agg(case when r = 0 then 'public' else pg_get_userbyid(r) end, '+' order by 1) from unnest(p.polroles) r), '')
      || ' u=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
      || ' w=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')), 8)
  from pg_policy p where p.polrelid = 'storage.objects'::regclass
  union all
  select 'storage', 'bucket ' || b.id,
    left(md5(concat_ws('|', b.public::text, coalesce(b.file_size_limit::text, ''), coalesce(array_to_string(b.allowed_mime_types, ','), ''))), 8)
  from storage.buckets b
  union all
  select 'cron', j.jobname, left(md5(j.schedule || ' ' || j.command), 8) from cron.job j
)
select string_agg(kind || '|' || name || '|' || fp, chr(10) order by kind, name) as snapshot from rows;
