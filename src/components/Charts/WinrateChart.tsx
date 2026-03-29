import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { useTranslation } from 'react-i18next'

interface WinrateChartProps {
  wins: number
  losses: number
}

export function WinrateChart({ wins, losses }: WinrateChartProps) {
  const { t } = useTranslation()
  const total = wins + losses
  if (total === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-hextech-text-dim">
        {t('charts.noWinrate')}
      </div>
    )
  }

  const data = [
    { name: t('charts.wins'), value: wins },
    { name: t('charts.losses'), value: losses },
  ]
  const colors = ['#0ACE83', '#FF4655']
  const winrate = Math.round((wins / total) * 100)

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={65}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#0A1628',
              border: '1px solid #3C3C41',
              borderRadius: '8px',
              color: '#F0E6D2',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold text-hextech-gold-bright">{winrate}%</div>
          <div className="text-xs text-hextech-text">{total} {t('charts.games')}</div>
        </div>
      </div>
    </div>
  )
}
