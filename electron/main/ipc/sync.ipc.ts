import { z } from 'zod'
import { validatedHandle } from './validate'
import { getSyncStatus, syncNow } from '../sync/syncService'
import { isCloudConfigured } from '../cloud/supabase'

/** Builds without a cloud backend report DISABLED so the UI hides sync entirely. */
const status = () => (isCloudConfigured() ? getSyncStatus() : { ...getSyncStatus(), error: 'DISABLED' })

export function registerSyncHandlers() {
  validatedHandle('sync:status', z.tuple([]), () => status())
  validatedHandle('sync:now', z.tuple([]), async () => {
    if (isCloudConfigured()) await syncNow()
    return status()
  })
}
