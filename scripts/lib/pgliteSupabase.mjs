/**
 * A throw-away Postgres (PGlite, in memory) shaped like the Supabase project, for the migration tests. Never
 * connects to production.
 *
 *   PLATFORM          what the Supabase platform creates before any migration runs (roles, the default grants
 *                     production has in public, auth, storage, pg_cron, the extensions schema). Not part of the
 *                     app's schema.
 *   forPglite(sql)    the two statements PGlite cannot run (no such extensions here), made no-ops: the stand-in
 *                     already provides them.
 *   openPglite(dir)   a new database with PLATFORM applied.
 *   replay(db, files) runs supabase/migrations files in the given order.
 *   migrationFiles()  every file of supabase/migrations, sorted.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

export const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const migDir = join(repo, 'supabase/migrations')

export const PLATFORM = `
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function auth.role() returns text language sql stable as $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
  create function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
  grant usage on schema auth to anon, authenticated, service_role;

  create schema extensions;
  create function extensions.gen_random_bytes(n int) returns bytea language sql volatile
    as $f$ select decode(string_agg(lpad(to_hex((random() * 255)::int), 2, '0'), ''), 'hex') from generate_series(1, n) $f$;

  create schema storage;
  create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable
    as $f$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $f$;
  grant usage on schema storage to anon, authenticated, service_role;

  create schema cron;
  create table cron.job (jobid serial primary key, jobname text unique, schedule text not null, command text not null);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql
    as $f$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
          on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $f$;
  create function cron.unschedule(p_name text) returns boolean language sql
    as $f$ with d as (delete from cron.job where jobname = p_name returning 1) select exists (select 1 from d) $f$;
`

export const forPglite = (sql) => sql
  .replace(/create extension if not exists pg_cron[^;]*;/gi, 'select 1;')
  .replace(/create extension if not exists pgcrypto[^;]*;/gi, 'select 1;')

export function migrationFiles() {
  return readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
}

/**
 * The PGlite these tests are pinned to: 0.3.16 runs PostgreSQL 17, like production (17.6 on 20/11/2026). Another
 * major version shows false drift in the schema comparison (PostgreSQL 18 turns NOT NULL into 'n' constraints, 16
 * differs elsewhere), so openPglite refuses it.
 *   npm install @electric-sql/pglite@0.3.16   (in the folder passed to the tests)
 */
export const PGLITE_VERSION = '0.3.16'
export const POSTGRES_MAJOR = 17

export async function openPglite(pgliteDir) {
  const require = createRequire(join(pgliteDir, 'package.json'))
  const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite')).href)
  const db = new PGlite()
  const num = Number((await db.query('show server_version_num')).rows[0].server_version_num)
  if (Math.floor(num / 10000) !== POSTGRES_MAJOR) {
    throw new Error(`PostgreSQL ${Math.floor(num / 10000)} found (server_version_num ${num}), production runs ${POSTGRES_MAJOR}: `
      + `install @electric-sql/pglite@${PGLITE_VERSION} in ${pgliteDir}. Another major version reports false schema drift.`)
  }
  await db.exec(PLATFORM)
  return db
}

/** Runs the files in order. Throws `<file>: <message>` at the first one that fails. */
export async function replay(db, files) {
  for (const f of files) {
    try { await db.exec(forPglite(readFileSync(join(migDir, f), 'utf-8'))) }
    catch (e) { throw new Error(`${f}: ${e.message}`) }
  }
}
