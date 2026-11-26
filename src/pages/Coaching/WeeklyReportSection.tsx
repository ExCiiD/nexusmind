import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardCopy, FileBarChart, Link2, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import { reportToText } from '@/lib/reportCore'
import type { ReportShare, TeamWeeklyReport } from '@/lib/report'
import type { CalendarEvent } from '@/lib/calendar'

function startOfWeek(d: Date): Date {
  const out = new Date(d)
  const day = out.getUTCDay()
  const diff = (day === 0 ? -6 : 1) - day
  out.setUTCDate(out.getUTCDate() + diff)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

const DAY_MS = 86_400_000
const MAX_PERIOD_DAYS = 92 // same bound as periodRange (reportCore)
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/** Days in [from, to] both inclusive, or null when a date is missing/invalid. */
function periodDays(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / DAY_MS) + 1
}

/** E9 (docs/PLAN_GESTION_EQUIPE.md): weekly team/player report, computed on demand (no stored snapshot). */
export function WeeklyReportSection({ staffGroups }: { staffGroups: Group[] }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const groupId = staffGroups[0]?.id ?? null
  const group = staffGroups.find((g) => g.id === groupId)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()).toISOString().slice(0, 10))
  const [mode, setMode] = useState<'week' | 'tournament' | 'period'>('week')
  const [tournaments, setTournaments] = useState<CalendarEvent[]>([])
  const [tournamentId, setTournamentId] = useState('')
  // Period report (PROPOSITION_ANALYSTE § 5): any window of 1-92 days, last 7 days by default.
  const [periodTo, setPeriodTo] = useState(() => isoDay(new Date()))
  const [periodFrom, setPeriodFrom] = useState(() => isoDay(new Date(Date.now() - 6 * DAY_MS)))
  const [conclusions, setConclusions] = useState('')
  const [report, setReport] = useState<TeamWeeklyReport | null>(null)
  const [share, setShare] = useState<ReportShare | null>(null)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    if (!groupId) return
    const from = new Date(); from.setDate(from.getDate() - 180)
    const to = new Date(); to.setDate(to.getDate() + 180)
    window.api.calendarListEvents(groupId, from.toISOString(), to.toISOString())
      .then((evs) => {
        const list = evs.filter((e) => e.kind === 'tournament')
        setTournaments(list)
        setTournamentId((prev) => (prev && list.some((e) => e.id === prev)) ? prev : (list[0]?.id ?? ''))
      })
      .catch(() => setTournaments([]))
  }, [groupId])

  const load = useCallback(async () => {
    if (!groupId) return
    if (mode === 'tournament' && !tournamentId) { setReport(null); return }
    if (mode === 'period') {
      const days = periodDays(periodFrom, periodTo)
      if (days === null || days < 1 || days > MAX_PERIOD_DAYS) { setReport(null); return }
    }
    setReport(null)
    setShare(null)
    try {
      setReport(
        mode === 'week' ? await window.api.reportGetWeekly(groupId, weekStart)
        : mode === 'period' ? await window.api.reportGetForPeriod(groupId, periodFrom, periodTo)
        : await window.api.reportGetForEvent(groupId, tournamentId),
      )
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [groupId, weekStart, mode, tournamentId, periodFrom, periodTo, t, toast])

  useEffect(() => { load() }, [load])

  if (staffGroups.length === 0) return null

  const days = periodDays(periodFrom, periodTo)
  const periodInvalid = mode === 'period' && (days === null || days < 1 || days > MAX_PERIOD_DAYS)
  // The analyst's conclusions travel with the copied text and the shared snapshot (period mode only).
  const outgoing = (r: TeamWeeklyReport): TeamWeeklyReport => (mode === 'period' && conclusions.trim() ? { ...r, analystConclusions: conclusions.trim() } : r)

  const copyText = () => {
    if (!report || !group) return
    navigator.clipboard.writeText(reportToText(outgoing(report), group.name))
    toast({ title: t('weeklyReport.copied', { defaultValue: 'Report copied — paste it in Discord or a message' }), variant: 'gold' })
  }

  const shareLink = async () => {
    if (!report || !group) return
    setSharing(true)
    try {
      setShare(await window.api.reportCreateShare(group.id, group.name, outgoing(report)))
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setSharing(false)
    }
  }

  const copyShareUrl = async () => {
    if (!share) return
    await navigator.clipboard.writeText(share.url).catch(() => {})
    toast({ title: t('weeklyReport.linkCopied', { defaultValue: 'Link copied' }), variant: 'gold' })
  }

  const revokeShare = async () => {
    if (!share) return
    try { await window.api.reportRevokeShare(share.id); setShare(null) }
    catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) }
  }

  // Period shortcut: fill the dates from a tournament of the calendar (the window stays editable).
  const applyTournament = (id: string) => {
    const ev = tournaments.find((e) => e.id === id)
    if (!ev) return
    const start = new Date(ev.startsAt), end = new Date(ev.endsAt)
    setPeriodFrom(isoDay(start))
    // Never beyond the 92-day bound, never before the start.
    setPeriodTo(isoDay(new Date(Math.min(Math.max(end.getTime(), start.getTime()), start.getTime() + (MAX_PERIOD_DAYS - 1) * DAY_MS))))
  }

  const shiftWeek = (deltaDays: number) => {
    const d = new Date(`${weekStart}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + deltaDays)
    setWeekStart(d.toISOString().slice(0, 10))
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileBarChart className="h-5 w-5 text-hextech-gold" />{t('weeklyReport.title', { defaultValue: 'Weekly report' })}
          </CardTitle>
        </div>
        <CardDescription>{t('weeklyReport.desc', { defaultValue: 'Volume, form, objectives, experiment verdicts, and mistake trends — computed on demand, not stored.' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={mode} onValueChange={(v) => setMode(v as 'week' | 'tournament' | 'period')}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="week">{t('weeklyReport.modeWeek', { defaultValue: 'Weekly' })}</SelectItem>
            <SelectItem value="period">{t('weeklyReport.modePeriod', { defaultValue: 'Period' })}</SelectItem>
            <SelectItem value="tournament">{t('weeklyReport.modeTournament', { defaultValue: 'Post-tournament' })}</SelectItem>
          </SelectContent>
        </Select>

        {mode === 'week' ? (
          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={() => shiftWeek(-7)}>←</Button>
            <span className="text-sm text-hextech-text-dim">
              {new Date(`${weekStart}T00:00:00Z`).toLocaleDateString(i18n.language)} – {report ? new Date(`${report.weekEnd}T00:00:00Z`).toLocaleDateString(i18n.language) : '…'}
            </span>
            <Button size="sm" variant="outline" onClick={() => shiftWeek(7)}>→</Button>
          </div>
        ) : mode === 'period' ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm text-hextech-text-dim">
              <label className="flex items-center gap-2">
                {t('weeklyReport.periodFrom', { defaultValue: 'From' })}
                <Input type="date" value={periodFrom} max={periodTo} onChange={(e) => setPeriodFrom(e.target.value)} className="w-40" />
              </label>
              <label className="flex items-center gap-2">
                {t('weeklyReport.periodTo', { defaultValue: 'To' })}
                <Input type="date" value={periodTo} min={periodFrom} onChange={(e) => setPeriodTo(e.target.value)} className="w-40" />
              </label>
            </div>
            {tournaments.length > 0 && (
              <Select value="" onValueChange={applyTournament}>
                <SelectTrigger className="w-full md:w-96"><SelectValue placeholder={t('weeklyReport.periodFromTournament', { defaultValue: 'Fill the dates from a tournament…' })} /></SelectTrigger>
                <SelectContent>
                  {tournaments.map((ev) => (
                    <SelectItem key={ev.id} value={ev.id}>{ev.title} — {new Date(ev.startsAt).toLocaleDateString(i18n.language)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className={`text-xs ${periodInvalid ? 'text-hextech-red' : 'text-hextech-text-dim'}`}>
              {periodInvalid
                ? t('weeklyReport.periodInvalid', { defaultValue: 'Pick a window of 1 to {{max}} days, the end not before the start.', max: MAX_PERIOD_DAYS })
                : t('weeklyReport.periodHint', { defaultValue: 'Compared with the {{days}} days before.', days })}
            </p>
          </div>
        ) : tournaments.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">{t('weeklyReport.noTournaments', { defaultValue: 'No tournament on the calendar yet — add one as an event in Planning.' })}</p>
        ) : (
          <Select value={tournamentId} onValueChange={setTournamentId}>
            <SelectTrigger className="w-full md:w-96"><SelectValue /></SelectTrigger>
            <SelectContent>
              {tournaments.map((ev) => (
                <SelectItem key={ev.id} value={ev.id}>{ev.title} — {new Date(ev.startsAt).toLocaleDateString(i18n.language)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {periodInvalid ? null : report === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
        ) : report.players.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">{t('weeklyReport.noPlayers', { defaultValue: 'No players in this group yet.' })}</p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg bg-hextech-elevated/30 px-3 py-2 text-sm">
              <span className="text-hextech-text">
                {t('weeklyReport.teamSummary', { defaultValue: '{{games}} games, {{rate}}% average winrate', games: report.totalGames, rate: report.avgWinrate ?? '—' })}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={copyText}>
                  <ClipboardCopy className="mr-1 h-3.5 w-3.5" />{t('weeklyReport.copy', { defaultValue: 'Copy as text' })}
                </Button>
                <Button size="sm" variant="outline" onClick={shareLink} disabled={sharing}>
                  {sharing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1 h-3.5 w-3.5" />}
                  {t('weeklyReport.share', { defaultValue: 'Share link' })}
                </Button>
              </div>
            </div>
            {share && (
              <div className="flex items-center gap-2 rounded-lg border border-hextech-border-dim p-2">
                <Input readOnly value={share.url} className="flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" variant="outline" onClick={copyShareUrl}><ClipboardCopy className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={revokeShare} className="text-hextech-text-dim">{t('weeklyReport.revokeLink', { defaultValue: 'Revoke' })}</Button>
              </div>
            )}
            {mode === 'period' && (
              <div className="rounded-lg border border-hextech-border-dim p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-hextech-text-dim">{t('weeklyReport.recurring.title', { defaultValue: 'Recurring mistakes' })}</p>
                {!report.recurringMistakes?.length ? (
                  <p className="text-sm text-hextech-text-dim">{t('weeklyReport.recurring.none', { defaultValue: 'No mistake recorded over this period.' })}</p>
                ) : (
                  <ul className="space-y-1 text-sm text-hextech-text">
                    {report.recurringMistakes.map((m) => (
                      <li key={m.label} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-hextech-text-bright">{m.label}</span>
                        <span className="text-hextech-text-dim">
                          {t('weeklyReport.recurring.line', { defaultValue: '{{count}} (before: {{previous}}) · {{players}} player(s)', count: m.count, previous: m.previousCount, players: m.players })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hextech-border-dim text-left text-xs uppercase tracking-wide text-hextech-text-dim">
                    <th className="py-2 pr-3">{t('weeklyReport.col.player', { defaultValue: 'Player' })}</th>
                    <th className="py-2 pr-3">{t('weeklyReport.col.games', { defaultValue: 'Games' })}</th>
                    <th className="py-2 pr-3">{t('weeklyReport.col.winrate', { defaultValue: 'Winrate' })}</th>
                    <th className="py-2 pr-3">{t('weeklyReport.col.reviews', { defaultValue: 'Reviews' })}</th>
                    <th className="py-2 pr-3">{t('weeklyReport.col.topMistake', { defaultValue: 'Top mistake' })}</th>
                    <th className="py-2 pr-3">{t('weeklyReport.col.objectives', { defaultValue: 'Objectives' })}</th>
                    <th className="py-2">{t('weeklyReport.col.experiments', { defaultValue: 'Experiments' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.players.map((p) => {
                    const top = p.mistakeTrends[0]
                    const arrow = top ? (top.direction === 'up' ? '↑' : top.direction === 'down' ? '↓' : '→') : ''
                    return (
                      <tr key={p.playerId} className="border-b border-hextech-border-dim/50">
                        <td className="py-2 pr-3 font-medium text-hextech-text-bright">{p.displayName}</td>
                        <td className="py-2 pr-3 text-hextech-text">{p.gamesPlayed}</td>
                        <td className="py-2 pr-3 text-hextech-text">{p.winrate === null ? '—' : `${p.winrate}%`}</td>
                        <td className="py-2 pr-3 text-hextech-text">{p.reviewsDone}/{p.gamesPlayed}</td>
                        <td className="py-2 pr-3 text-hextech-text">{top ? `${top.label} ${arrow} (${top.lastWeek}→${top.thisWeek})` : '—'}</td>
                        <td className="py-2 pr-3 text-hextech-text">{p.objectivesAssigned > 0 ? `${p.objectivesCompleted}/${p.objectivesAssigned}` : '—'}</td>
                        <td className="py-2 text-hextech-text">
                          {p.experimentVerdicts.length === 0 ? '—' : p.experimentVerdicts.map((e) => `${e.problemId}: ${e.verdict ?? t('weeklyReport.inProgress', { defaultValue: 'in progress' })}`).join(', ')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {mode === 'period' && (
              <div className="space-y-1">
                <label htmlFor="period-conclusions" className="text-xs uppercase tracking-wide text-hextech-text-dim">{t('weeklyReport.conclusions.label', { defaultValue: 'Analyst conclusions' })}</label>
                <Textarea
                  id="period-conclusions" value={conclusions} maxLength={2000} rows={4}
                  onChange={(e) => setConclusions(e.target.value)}
                  placeholder={t('weeklyReport.conclusions.placeholder', { defaultValue: 'What the team should take from this period…' })}
                />
                <p className="text-xs text-hextech-text-dim">{t('weeklyReport.conclusions.hint', { defaultValue: 'Added to the copied text and the shared link.' })}</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
