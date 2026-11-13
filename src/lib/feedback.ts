import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Bug reports & feature requests (table public.feedback_reports). Shared by
 * the desktop main process and the web app.
 */

export type FeedbackKind = 'bug' | 'feature'
export type FeedbackStatus = 'new' | 'seen' | 'planned' | 'in_progress' | 'done' | 'wont_do' | 'duplicate'

export interface FeedbackInput {
  kind: FeedbackKind
  title: string
  description: string
  expected?: string | null
  route?: string | null
  /** Only sent when the user agreed to attach technical info. */
  diagnostics?: Record<string, unknown> | null
  contactOk?: boolean
}

export interface FeedbackContext {
  source: 'desktop' | 'web'
  appVersion: string | null
  platform: string | null
}

export interface FeedbackItem {
  id: string
  kind: FeedbackKind
  title: string
  status: FeedbackStatus
  devNote: string | null
  createdAt: string
}

/** Slice of window.api, implemented by the desktop preload and the web adapter. */
export interface FeedbackApi {
  feedbackSend: (report: FeedbackInput) => Promise<FeedbackItem>
  feedbackList: () => Promise<FeedbackItem[]>
}

export async function sendFeedback(sb: SupabaseClient, uid: string, input: FeedbackInput, ctx: FeedbackContext): Promise<FeedbackItem> {
  const { data, error } = await sb.from('feedback_reports').insert({
    user_id: uid,
    kind: input.kind,
    title: input.title.trim().slice(0, 140),
    description: input.description.trim().slice(0, 8000),
    expected: input.kind === 'bug' ? (input.expected?.trim().slice(0, 4000) || null) : null,
    source: ctx.source,
    app_version: ctx.appVersion?.slice(0, 40) ?? null,
    platform: ctx.platform?.slice(0, 200) ?? null,
    route: input.route?.slice(0, 200) ?? null,
    diagnostics: input.diagnostics ?? null,
    contact_ok: input.contactOk ?? true,
  }).select('id, kind, title, status, dev_note, created_at').single()
  if (error) {
    if (/rate limit/i.test(error.message)) throw new Error('FEEDBACK_RATE_LIMITED')
    throw new Error(error.message)
  }
  return mapItem(data)
}

export async function listMyFeedback(sb: SupabaseClient, uid: string): Promise<FeedbackItem[]> {
  const { data, error } = await sb.from('feedback_reports')
    .select('id, kind, title, status, dev_note, created_at')
    .eq('user_id', uid).order('created_at', { ascending: false }).limit(20)
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapItem)
}

const mapItem = (r: any): FeedbackItem => ({
  id: r.id, kind: r.kind, title: r.title, status: r.status, devNote: r.dev_note, createdAt: r.created_at,
})
