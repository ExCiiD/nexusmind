import { z } from 'zod'
import { validatedHandle } from './validate'
import { getSyncStatus, syncNow } from '../sync/syncService'
import { auditForeignSyncRows, deleteForeignSyncRows } from '../sync/syncAudit'
import { isCloudConfigured } from '../cloud/supabase'

/** Builds without a cloud backend report DISABLED so the UI hides sync entirely. */
const status = () => (isCloudConfigured() ? getSyncStatus() : { ...getSyncStatus(), error: 'DISABLED' })

export function registerSyncHandlers() {
  validatedHandle('sync:status', z.tuple([]), () => status())
  validatedHandle('sync:now', z.tuple([]), async () => {
    if (isCloudConfigured()) await syncNow()
    return status()
  })
  // Cleanup for the sync-leak fixed in beta.104 — see syncAudit.ts.
  validatedHandle('sync:audit-foreign-rows', z.tuple([]), () => auditForeignSyncRows())
  validatedHandle('sync:delete-foreign-rows', z.tuple([]), () => deleteForeignSyncRows())
}
