# Production schema baseline (WSC-05 / DA-4)

Read-only exports of production, taken on 20/11/2026, that `scripts/test-schema-baseline.mjs` checks the
repository against:

- `prod_migrations_20261120_beta14.txt`: every migration production recorded (`supabase_migrations.schema_migrations`),
  with the md5 of the SQL it ran (CRs removed, trimmed).
- `prod_schema_20261120_beta14.txt`: the fingerprint of every app object in production (tables with their columns,
  constraints, indexes, policies, triggers and grants; functions with their body and who may execute them;
  sequences; storage policies and buckets; pg_cron jobs), produced by `scripts/schema-snapshot.sql`.

Run the test:

```
npm install @electric-sql/pglite@0.3.16     # once, in a folder outside the project
node scripts/test-schema-baseline.mjs <that folder>
```

**PGlite is pinned to 0.3.16, which runs PostgreSQL 17 like production (17.6).** The test fails with a clear message
on any other major version (`server_version_num`): PostgreSQL 18 records NOT NULL as `'n'` constraints and 16
formats some definitions differently, both of which would show as false drift. The pin lives in
`scripts/lib/pgliteSupabase.mjs` (`PGLITE_VERSION`, `POSTGRES_MAJOR`), shared with `test-scrims-in-planning.mjs`.
When production moves to a new major version, refresh the baseline files and move the pin with it.

## What was restored

15 migrations production applied between 14 and 16/11/2026 had no file in the repository (e14, e11, e11v2, e4v2,
e7v2, e2v2, e3v2, e9v2, e6v2 ×2, phase1 to phase5). They are back in `supabase/migrations/` under **their exact
production version**, with the SQL production recorded, unchanged, below a 3-line header. Because the version is
the one in production's history, they already count as applied there: they must never run on production again.

`20261114003926_e8_notifications_v2_lock_trigger_fn` has no file of its own: its single statement is already in
`20261114003906_e8_notifications_v2.sql`. As a separate file it would run, in file order, before the function it
locks exists.

## Still open

- Done 20/11/2026: the 31 files that carried a different version in the repository than in production's history
  were renamed (git mv, content unchanged) to their production version, so `supabase db push` sees them as
  applied. Nothing was written to production's history. The test now also fails if a file's version is not the
  one production recorded.
- After the next migration reaches production, refresh both files with the read-only queries in
  `scripts/schema-snapshot.sql` and on `supabase_migrations.schema_migrations`.
