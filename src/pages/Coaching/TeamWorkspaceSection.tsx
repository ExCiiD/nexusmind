import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Shield, Swords, Target, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Group } from '@/lib/collab'
import type { SharedDraft, SharedRosterMember, SharedScoutingEntry } from '@/lib/team'

/**
 * E1 read view: the team a player has published (desktop → "Publish to a
 * group…") shown to the group's staff here, on both desktop and web —
 * this is what makes the web useful as the "tour de contrôle du staff"
 * for team data, not just coaching comments (docs/PLAN_GESTION_EQUIPE.md).
 * Read-only for v1; editing from here is a follow-up.
 */
export function TeamWorkspaceSection({ staffGroups }: { staffGroups: Group[] }) {
  const { t } = useTranslation()
  const [groupId, setGroupId] = useState(staffGroups[0]?.id ?? null)
  const [data, setData] = useState<{ roster: SharedRosterMember[]; drafts: SharedDraft[]; scouting: SharedScoutingEntry[] } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!groupId) return
    setLoading(true)
    window.api.teamGetShared(groupId).then(setData).catch(() => setData({ roster: [], drafts: [], scouting: [] })).finally(() => setLoading(false))
  }, [groupId])

  if (staffGroups.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-hextech-gold" />
            {t('team.workspace.title', { defaultValue: 'Team workspace' })}
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
      <CardContent className="space-y-4">
        {loading || !data ? (
          <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
        ) : data.roster.length === 0 && data.drafts.length === 0 && data.scouting.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">
            {t('team.workspace.empty', { defaultValue: 'Nothing published yet for this group — a player publishes their team from the desktop app (Team → Publish to a group…).' })}
          </p>
        ) : (
          <>
            {data.roster.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-hextech-text-dim">
                  <Shield className="h-3.5 w-3.5" />{t('team.workspace.roster', { defaultValue: 'Roster' })}
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {data.roster.map((m) => (
                    <div key={m.id} className="rounded-lg border border-hextech-border-dim bg-hextech-elevated px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-hextech-text-bright">{m.displayName}</span>
                        <span className="text-[10px] uppercase text-hextech-text-dim">{m.role}</span>
                      </div>
                      {m.ign && <div className="text-xs text-hextech-text-dim">{m.ign}{m.tagLine ? `#${m.tagLine}` : ''}</div>}
                      {m.pool.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {m.pool.slice(0, 6).map((p) => (
                            <span key={p.id} className="rounded bg-hextech-gold/10 px-1.5 py-0.5 text-[10px] text-hextech-gold">{p.championKey}</span>
                          ))}
                          {m.pool.length > 6 && <span className="text-[10px] text-hextech-text-dim">+{m.pool.length - 6}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {data.drafts.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-hextech-text-dim">
                  <Swords className="h-3.5 w-3.5" />{t('team.workspace.drafts', { defaultValue: 'Drafts' })}
                </h3>
                <ul className="space-y-1">
                  {data.drafts.map((d) => (
                    <li key={d.id} className="rounded-lg border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text">
                      {d.name}
                      <span className="ml-2 text-xs text-hextech-text-dim">
                        {d.myTeamSide === 'blue' ? d.bluePicks.length : d.redPicks.length} {t('team.workspace.picks', { defaultValue: 'picks' })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {data.scouting.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-hextech-text-dim">
                  <Target className="h-3.5 w-3.5" />{t('team.workspace.scouting', { defaultValue: 'Scouting' })}
                </h3>
                <ul className="space-y-1">
                  {data.scouting.map((s) => (
                    <li key={s.id} className="rounded-lg border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text">
                      {s.name}{s.tag ? ` [${s.tag}]` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
