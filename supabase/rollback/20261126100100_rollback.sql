-- Rollback of 20261126100100_purge_sync_tombstones: the function goes. Rows already purged are not restored.
drop function if exists private.purge_sync_tombstones(int);
