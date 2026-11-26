-- Rollback of 20261126100000_pool_auto_tier: the column goes (its values are only a memo of the rule). Re-runnable.
alter table public.team_pool_entries drop constraint if exists team_pool_entries_auto_tier_check;
alter table public.team_pool_entries drop column if exists auto_tier;
