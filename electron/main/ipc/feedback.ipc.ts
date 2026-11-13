import { app } from 'electron'
import { release, arch } from 'os'
import { z } from 'zod'
import { validatedHandle } from './validate'
import { getSupabase, getAccessToken } from '../cloud/supabase'
import { getSyncStatus } from '../sync/syncService'
import { sendFeedback, listMyFeedback } from '../../../src/lib/feedback'

async function me(): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new Error('LOGIN_REQUIRED')
  const { data } = await getSupabase().auth.getUser(token)
  if (!data.user) throw new Error('LOGIN_REQUIRED')
  return data.user.id
}

const input = z.object({
  kind: z.enum(['bug', 'feature']),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(8000),
  expected: z.string().max(4000).nullable().optional(),
  route: z.string().max(200).nullable().optional(),
  diagnostics: z.record(z.unknown()).nullable().optional(),
  contactOk: z.boolean().optional(),
})

/** Bug reports / feature requests → public.feedback_reports (read by the developer). */
export function registerFeedbackHandlers() {
  validatedHandle('feedback:send', z.tuple([input]), async (_e, report) => {
    const diagnostics = report.diagnostics
      ? {
          ...report.diagnostics,
          // Main-process facts the renderer can't see.
          electron: process.versions.electron,
          os: `Windows ${release()} ${arch()}`,
          sync: getSyncStatus(),
        }
      : null
    return sendFeedback(getSupabase(), await me(), { ...report, diagnostics }, {
      source: 'desktop',
      appVersion: app.getVersion(),
      platform: `${process.platform} ${release()} ${arch()}`,
    })
  })
  validatedHandle('feedback:list', z.tuple([]), async () => listMyFeedback(getSupabase(), await me()))
}
