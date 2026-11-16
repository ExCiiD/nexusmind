import { useTranslation } from 'react-i18next'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { DuelRow } from '@/lib/teamSessionStatsCore'

interface Props {
  rows: DuelRow[]
}

const ROLE_LABEL_KEY: Record<string, string> = {
  TOP: 'teamSession.role.top', JUNGLE: 'teamSession.role.jungle', MID: 'teamSession.role.mid', ADC: 'teamSession.role.adc', SUPPORT: 'teamSession.role.support',
}

/**
 * Per-lane duel comparison — a table, not a radar chart (the user's final,
 * authoritative request wording dropped "graphique" in favor of "un
 * tableau identique"; Phase 4, Planning rework). One row per lane, our
 * player's cell lit up whenever their value beats the opposing laner's.
 */
export function DuelComparisonTable({ rows }: Props) {
  const { t } = useTranslation()
  const populated = rows.filter((r) => r.our || r.enemy)
  if (populated.length === 0) return null

  return (
    <Card className="p-0 overflow-hidden">
      <CardHeader className="py-2">
        <CardTitle className="text-sm">{t('teamSession.duels', { defaultValue: 'Lane duels' })}</CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="bg-hextech-dark/70 text-hextech-text-dim">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold uppercase text-[9px] tracking-wider">{t('teamSession.lane', { defaultValue: 'Lane' })}</th>
              <th className="px-2 py-1.5 text-left font-semibold uppercase text-[9px] tracking-wider">{t('teamSession.ourPlayer', { defaultValue: 'Our player' })}</th>
              <th className="px-1.5 py-1.5 text-right font-semibold uppercase text-[9px] tracking-wider">KDA</th>
              <th className="px-1.5 py-1.5 text-right font-semibold uppercase text-[9px] tracking-wider">CS</th>
              <th className="px-1.5 py-1.5 text-right font-semibold uppercase text-[9px] tracking-wider">DMG</th>
              <th className="px-1.5 py-1.5 text-right font-semibold uppercase text-[9px] tracking-wider">Gold</th>
              <th className="px-1.5 py-1.5 text-right font-semibold uppercase text-[9px] tracking-wider">VS</th>
              <th className="px-2 py-1.5 text-right font-semibold uppercase text-[9px] tracking-wider">{t('teamSession.enemyPlayer', { defaultValue: 'Opponent' })}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hextech-border-dim/40">
            {populated.map((row) => {
              const roleLabel = t(ROLE_LABEL_KEY[row.role] ?? '', { defaultValue: row.role })
              return (
                <tr key={row.role} className="hover:bg-hextech-dark/30 transition-colors">
                  <td className="px-2 py-1.5 font-semibold text-hextech-text-bright whitespace-nowrap">{roleLabel}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{row.our?.displayName ?? '—'}</td>
                  <DuelCell our={row.our?.averages.kda} enemy={row.enemy?.averages.kda} format={(v) => v.toFixed(2)} />
                  <DuelCell our={row.our?.averages.cs} enemy={row.enemy?.averages.cs} format={(v) => Math.round(v).toString()} />
                  <DuelCell our={row.our?.averages.damage} enemy={row.enemy?.averages.damage} format={(v) => Math.round(v).toLocaleString()} />
                  <DuelCell our={row.our?.averages.gold} enemy={row.enemy?.averages.gold} format={(v) => Math.round(v).toLocaleString()} />
                  <DuelCell our={row.our?.averages.visionScore} enemy={row.enemy?.averages.visionScore} format={(v) => v.toFixed(1)} />
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">{row.enemy?.displayName ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** Renders the our/enemy pair as two stacked values in one cell pair,
 *  highlighting whichever side is ahead on this stat. */
function DuelCell({ our, enemy, format }: { our: number | undefined; enemy: number | undefined; format: (v: number) => string }) {
  const hasBoth = our !== undefined && enemy !== undefined
  const ourHigher = hasBoth && our > enemy
  const enemyHigher = hasBoth && enemy > our
  return (
    <td className="px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap">
      <span className={cn(ourHigher && 'font-semibold text-hextech-green')}>{our !== undefined ? format(our) : '—'}</span>
      <span className="mx-1 text-hextech-text-dim">/</span>
      <span className={cn(enemyHigher && 'font-semibold text-[#E24C3A]')}>{enemy !== undefined ? format(enemy) : '—'}</span>
    </td>
  )
}
