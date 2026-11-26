-- WSC-18 (docs/audits/AUDIT_APP_2026-11.md): the web app overwrote the tiers the coach picked by hand, because
-- team_pool_entries kept no trace of what the rule said. auto_tier records the tier the rule computed, so a refresh
-- can tell a hand-picked tier (tier <> auto_tier) from an automatic one, as the desktop already does.
-- Nullable, no default: existing rows read as "never tiered by the rule" and keep their tier. Re-runnable.
-- No semicolon inside a comment.

alter table public.team_pool_entries add column if not exists auto_tier text;
alter table public.team_pool_entries drop constraint if exists team_pool_entries_auto_tier_check;
alter table public.team_pool_entries add constraint team_pool_entries_auto_tier_check
  check (auto_tier is null or auto_tier in ('main', 'comfort', 'flex', 'learning'));
