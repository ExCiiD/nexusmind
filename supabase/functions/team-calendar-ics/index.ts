// Supabase Edge Function: team-calendar-ics (E4 v2 — live calendar subscription).
// GET /team-calendar-ics/<token>.ics — a stable, unauthenticated URL calendar
// apps (Google/Apple/Outlook) can subscribe to and re-fetch on their own
// schedule, unlike the v1 point-in-time "Export .ics" download. The token
// (public.calendar_subscriptions) is the only secret: a calendar app can't
// send an Ascend session header, so this can't be gated by a normal RLS
// read — the service role resolves token -> group_id itself, then only ever
// reads that one group's own calendar/scrim rows.
//
// verify_jwt is off for this function (set at deploy time) for the same
// reason: the caller is a calendar app with no Supabase session.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const TOKEN = /^[a-f0-9]{40}$/
const WINDOW_PAST_DAYS = 7
const WINDOW_FUTURE_DAYS = 180

function fold(s: string): string {
  return s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
}
function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

interface IcsEvent {
  id: string
  title: string
  startsAt: string
  endsAt: string
  notes?: string | null
  updatedAt: string
}

function buildIcs(calendarName: string, events: IcsEvent[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ascend//Planning//EN', `X-WR-CALNAME:${fold(calendarName)}`]
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@ascend`,
      `DTSTAMP:${stamp(e.updatedAt)}`,
      `DTSTART:${stamp(e.startsAt)}`,
      `DTEND:${stamp(e.endsAt)}`,
      `SUMMARY:${fold(e.title)}`,
      ...(e.notes ? [`DESCRIPTION:${fold(e.notes)}`] : []),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405 })

  const url = new URL(req.url)
  const last = url.pathname.split('/').filter(Boolean).pop() ?? ''
  const token = last.replace(/\.ics$/i, '')
  if (!TOKEN.test(token)) return new Response('not found', { status: 404 })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: sub } = await admin.from('calendar_subscriptions').select('group_id').eq('token', token).maybeSingle()
  if (!sub) return new Response('not found', { status: 404 })

  const { data: group } = await admin.from('groups').select('name').eq('id', sub.group_id).maybeSingle()

  const now = Date.now()
  const from = new Date(now - WINDOW_PAST_DAYS * 86_400_000).toISOString()
  const to = new Date(now + WINDOW_FUTURE_DAYS * 86_400_000).toISOString()

  const [{ data: events }, { data: scrims }] = await Promise.all([
    admin.from('calendar_events').select('id, title, starts_at, ends_at, notes, updated_at')
      .eq('group_id', sub.group_id).gte('starts_at', from).lte('starts_at', to),
    admin.from('scrims').select('id, title, opponent, scheduled_at, duration_min, updated_at')
      .eq('group_id', sub.group_id).gte('scheduled_at', from).lte('scheduled_at', to),
  ])

  const icsEvents: IcsEvent[] = [
    ...(events ?? []).map((e) => ({ id: e.id, title: e.title, startsAt: e.starts_at, endsAt: e.ends_at, notes: e.notes, updatedAt: e.updated_at })),
    ...(scrims ?? []).map((s) => ({
      id: s.id,
      title: s.opponent ? `${s.title} vs ${s.opponent}` : s.title,
      startsAt: s.scheduled_at,
      endsAt: new Date(new Date(s.scheduled_at).getTime() + (s.duration_min ?? 60) * 60_000).toISOString(),
      updatedAt: s.updated_at,
    })),
  ]

  const ics = buildIcs(group?.name ?? 'Ascend', icsEvents)
  return new Response(ics, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'no-cache, max-age=0',
      'content-disposition': 'inline; filename="ascend.ics"',
    },
  })
})
