// Supabase Edge Function: team-report (E9 v2 — persistent shareable report link).
// GET /team-report/<token> — renders a read-only HTML page for a report
// snapshot taken at share time (public.report_shares). Like
// team-calendar-ics, the token is the only secret: a recipient clicking a
// Discord/message link carries no Ascend session, so the service role
// resolves token -> snapshot itself and never touches anything else.
//
// Deliberately a STATIC snapshot, not a live recomputation: the data was
// already visible to the staff member who generated the link (same RLS
// read "Copy as text" already uses) at that moment — recomputing live on
// every view would re-expose a player's CURRENT data to anyone still
// holding an old link, including after they revoke sharing consent.
//
// verify_jwt is off (set at deploy time) for the same reason as above.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const TOKEN = /^[a-f0-9]{40}$/

interface MistakeTrend { label: string; thisWeek: number; lastWeek: number; direction: 'up' | 'down' | 'flat' }
interface PlayerWeeklyReport {
  playerId: string; displayName: string; gamesPlayed: number; winrate: number | null
  reviewsDone: number; reviewsPending: number; mistakeTrends: MistakeTrend[]
  objectivesAssigned: number; objectivesCompleted: number
  experimentVerdicts: Array<{ problemId: string; verdict: string | null }>
}
interface TeamWeeklyReport {
  groupId: string; weekStart: string; weekEnd: string
  players: PlayerWeeklyReport[]; totalGames: number; avgWinrate: number | null
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
const arrow = (d: MistakeTrend['direction']) => (d === 'up' ? '↑' : d === 'down' ? '↓' : '→')

function renderPage(groupName: string, generatedAt: string, report: TeamWeeklyReport): string {
  const rows = report.players.map((p) => {
    const top = p.mistakeTrends[0]
    const topCell = top ? `${esc(top.label)} ${arrow(top.direction)} (${top.lastWeek}→${top.thisWeek})` : '—'
    const objCell = p.objectivesAssigned > 0 ? `${p.objectivesCompleted}/${p.objectivesAssigned}` : '—'
    const expCell = p.experimentVerdicts.length === 0 ? '—' : p.experimentVerdicts.map((e) => `${esc(e.problemId)}: ${esc(e.verdict ?? 'in progress')}`).join(', ')
    return `<tr>
      <td>${esc(p.displayName)}</td>
      <td>${p.gamesPlayed}</td>
      <td>${p.winrate === null ? '—' : `${p.winrate}%`}</td>
      <td>${p.reviewsDone}/${p.gamesPlayed}</td>
      <td>${topCell}</td>
      <td>${objCell}</td>
      <td>${expCell}</td>
    </tr>`
  }).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(groupName)} — team report</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0b0d12; color: #e7e9ee; margin: 0; padding: 24px 16px; }
  .wrap { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #8b93a3; font-size: 13px; margin-bottom: 20px; }
  .summary { background: #151823; border: 1px solid #262b3a; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #262b3a; white-space: nowrap; }
  th { color: #8b93a3; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
  td:first-child { font-weight: 600; color: #f1f3f8; }
  .footer { margin-top: 20px; color: #5b6376; font-size: 12px; }
  .table-scroll { overflow-x: auto; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(groupName)}</h1>
  <p class="meta">${esc(report.weekStart)} → ${esc(report.weekEnd)} · generated ${esc(new Date(generatedAt).toUTCString())}</p>
  <div class="summary">${report.totalGames} games · ${report.avgWinrate ?? '—'}% average winrate</div>
  <div class="table-scroll">
  <table>
    <thead><tr><th>Player</th><th>Games</th><th>Winrate</th><th>Reviews</th><th>Top mistake</th><th>Objectives</th><th>Experiments</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">No players in this group.</td></tr>'}</tbody>
  </table>
  </div>
  <p class="footer">Snapshot from Ascend — read-only, not live.</p>
</div>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405 })

  const url = new URL(req.url)
  const token = url.pathname.split('/').filter(Boolean).pop() ?? ''
  if (!TOKEN.test(token)) return new Response('not found', { status: 404 })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: share } = await admin.from('report_shares').select('group_name, report, created_at').eq('token', token).maybeSingle()
  if (!share) return new Response('not found', { status: 404 })

  const html = renderPage(share.group_name, share.created_at, share.report as TeamWeeklyReport)
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache, max-age=0' } })
})
