import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardCopy, FileBarChart, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { collabErrorKey, type Group } from '@/lib/collab'
import { reportToText } from '@/lib/reportCore'
import type { TeamWeeklyReport } from '@/lib/report'
import type { CalendarEvent } from '@/lib/calendar'

function startOfWeek(d: Date): Date {
  const out = new Date(d)
  const day = out.getUTCDay()
  const diff = (day === 0 ? -6 : 1) - day
  out.setUTCDate(out.getUTCDate() + diff)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

/** E9 (docs/PLAN_GESTION_EQUIPE.md): weekly team/player report, computed on demand (no stored snapshot). */
export function WeeklyReportSection({ staffGroups }: { staffGroups: Group[] }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [groupId, setGroupId] = useState(staffGroups[0]?.id ?? null)
  const group = staffGroups.find((g) => g.id === groupId)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()).toISOString().slice(0, 10))
  const [mode, setMode] = useState<'week' | 'tournament'>('week')
  const [tournaments, setTournaments] = useState<CalendarEvent[]>([])
  const [tournamentId, setTournamentId] = useState('')
  const [report, setReport] = useState<TeamWeeklyReport | null>(null)

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
    setReport(null)
    try {
      setReport(mode === 'week' ? await window.api.reportGetWeekly(groupId, weekStart) : await window.api.reportGetForEvent(groupId, tournamentId))
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [groupId, weekStart, mode, tournamentId, t, toast])

  useEffect(() => { load() }, [load])

  if (staffGroups.length === 0) return null

  const copyText = () => {
    if (!report || !group) return
    navigator.clipboard.writeText(reportToText(report, group.name))
    toast({ title: t('weeklyReport.copied', { defaultValue: 'Report copied — paste it in Discord or a message' }), variant: 'gold' })
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
          {staffGroups.length > 1 && (
            <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value)}
              className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1 text-xs text-hextech-text">
              {staffGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>
        <CardDescription>{t('weeklyReport.desc', { defaultValue: 'Volume, form, objectives, experiment verdicts, and mistake trends — computed on demand, not stored.' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={mode} onValueChange={(v) => setMode(v as 'week' | 'tournament')}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="week">{t('weeklyReport.modeWeek', { defaultValue: 'Weekly' })}</SelectItem>
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

        {report === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
        ) : report.players.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">{t('weeklyReport.noPlayers', { defaultValue: 'No players in this group yet.' })}</p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg bg-hextech-elevated/30 px-3 py-2 text-sm">
              <span className="text-hextech-text">
                {t('weeklyReport.teamSummary', { defaultValue: '{{games}} games, {{rate}}% average winrate', games: report.totalGames, rate: report.avgWinrate ?? '—' })}
              </span>
              <Button size="sm" variant="outline" onClick={copyText}>
                <ClipboardCopy className="mr-1 h-3.5 w-3.5" />{t('weeklyReport.copy', { defaultValue: 'Copy as text' })}
              </Button>
            </div>
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
          </>
        )}
      </CardContent>
    </Card>
  )
}
