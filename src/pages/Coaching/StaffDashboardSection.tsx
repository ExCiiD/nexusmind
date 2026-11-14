import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, LayoutDashboard } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { Group } from '@/lib/collab'
import type { DashboardAlert, PlayerDashboardRow } from '@/lib/staffDashboard'

/** E2 (docs/PLAN_GESTION_EQUIPE.md): one row per player, shared by desktop + web. */
export function StaffDashboardSection({ staffGroups }: { staffGroups: Group[] }) {
  const { t } = useTranslation()
  const [groupId, setGroupId] = useState(staffGroups[0]?.id ?? null)
  const [rows, setRows] = useState<PlayerDashboardRow[] | null>(null)

  useEffect(() => {
    if (!groupId) return
    setRows(null)
    window.api.collabStaffDashboard(groupId).then(setRows).catch(() => setRows([]))
  }, [groupId])

  if (staffGroups.length === 0) return null

  const alertLabel = (a: DashboardAlert) => t(`team.dashboard.alerts.${a}`)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutDashboard className="h-5 w-5 text-hextech-gold" />
            {t('team.dashboard.title', { defaultValue: 'Staff dashboard' })}
          </CardTitle>
          {staffGroups.length > 1 && (
            <select
              value={groupId ?? ''}
              onChange={(e) => setGroupId(e.target.value)}
              className="rounded border border-hextech-border-dim bg-hextech-elevated px-2 py-1 text-xs text-hextech-text"
            >
              {staffGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">{t('team.dashboard.noPlayers', { defaultValue: 'No players in this group yet.' })}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hextech-border-dim text-left text-xs uppercase tracking-wide text-hextech-text-dim">
                  <th className="py-2 pr-3">{t('team.dashboard.col.player', { defaultValue: 'Player' })}</th>
                  <th className="py-2 pr-3">{t('team.dashboard.col.form', { defaultValue: 'Form (10)' })}</th>
                  <th className="py-2 pr-3">{t('team.dashboard.col.mood', { defaultValue: 'Mood' })}</th>
                  <th className="py-2 pr-3">{t('team.dashboard.col.perfIndex', { defaultValue: 'Perf index' })}</th>
                  <th className="py-2 pr-3">{t('team.dashboard.col.week', { defaultValue: 'This week' })}</th>
                  <th className="py-2 pr-3">{t('team.dashboard.col.reviews', { defaultValue: 'Reviews' })}</th>
                  <th className="py-2 pr-3">{t('team.dashboard.col.mistake', { defaultValue: 'Dominant mistake' })}</th>
                  <th className="py-2 pr-3">{t('team.dashboard.col.objective', { defaultValue: 'Objective' })}</th>
                  <th className="py-2">{t('team.dashboard.col.alerts', { defaultValue: 'Alerts' })}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.playerId} className="border-b border-hextech-border-dim/50">
                    <td className="py-2 pr-3 font-medium text-hextech-text-bright">{r.displayName}</td>
                    <td className="py-2 pr-3 text-hextech-text">
                      {r.winrateLast10 === null ? '—' : `${r.winrateLast10}%`}
                      {r.winrateVsTeamAvg !== null && r.winrateVsTeamAvg !== 0 && (
                        <span className={cn('ml-1 text-[10px]', r.winrateVsTeamAvg > 0 ? 'text-hextech-green' : 'text-[#E24C3A]')}>
                          ({r.winrateVsTeamAvg > 0 ? '+' : ''}{r.winrateVsTeamAvg} {t('team.dashboard.vsTeam', { defaultValue: 'vs team' })})
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-hextech-text">
                      {r.recentMood === null ? '—' : r.recentMood}
                    </td>
                    <td className="py-2 pr-3 text-hextech-text">
                      {r.perfIndex === null ? '—' : r.perfIndex}
                    </td>
                    <td className="py-2 pr-3 text-hextech-text">{t('team.dashboard.games', { count: r.gamesThisWeek, defaultValue: '{{count}} games' })}</td>
                    <td className="py-2 pr-3 text-hextech-text">
                      {r.reviewsDone}/{r.reviewsDone + r.reviewsPending}
                      {r.reviewsPending > 0 && <span className="ml-1 text-hextech-gold">({r.reviewsPending} {t('team.dashboard.pending', { defaultValue: 'pending' })})</span>}
                    </td>
                    <td className="py-2 pr-3 text-hextech-text">
                      {r.dominantMistake ? `${r.dominantMistake.label} (${r.dominantMistake.count})` : '—'}
                    </td>
                    <td className="py-2 pr-3 text-hextech-text">
                      {r.currentObjective
                        ? `${r.currentObjective.problemId}${r.currentObjective.verdict ? ` · ${t(`team.dashboard.verdict.${r.currentObjective.verdict}`)}` : ` · ${t('team.dashboard.verdict.active')}`}`
                        : '—'}
                    </td>
                    <td className="py-2">
                      {r.alerts.length === 0 ? (
                        <span className="text-hextech-text-dim">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.alerts.map((a) => (
                            <span key={a} className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', 'bg-[#E24C3A]/10 text-[#E24C3A]')}>
                              <AlertTriangle className="h-3 w-3" />{alertLabel(a)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
