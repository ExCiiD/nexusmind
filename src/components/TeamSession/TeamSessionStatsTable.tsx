import { useTranslation } from 'react-i18next'
import { StatsTable } from '@/pages/Team/DashboardLayout'
import type { SynergyPlayerStats } from '@/lib/ipc'

interface Props {
  ourSide: SynergyPlayerStats[]
  enemySide: SynergyPlayerStats[]
  ourTeamName: string
  enemyTeamName: string
}

/** Full 24-column stats table, our 5 rows then enemy 5 rows — reuses
 *  StatsTable (exported from DashboardLayout.tsx) rather than rebuilding
 *  it, so a single game renders with the exact same columns as the
 *  multi-game dashboard (Phase 4, Planning rework). */
export function TeamSessionStatsTable({ ourSide, enemySide, ourTeamName, enemyTeamName }: Props) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      {ourSide.length > 0 && <StatsTable players={ourSide} matchCount={1} basedOnLabel={ourTeamName} />}
      {enemySide.length > 0 && <StatsTable players={enemySide} matchCount={1} basedOnLabel={enemyTeamName} />}
      {ourSide.length === 0 && enemySide.length === 0 && (
        <p className="text-sm text-hextech-text-dim">
          {t('teamSession.noStatsYet', { defaultValue: 'No stats to show for this game yet.' })}
        </p>
      )}
    </div>
  )
}
