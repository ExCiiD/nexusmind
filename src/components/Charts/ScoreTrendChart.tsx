import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslation } from 'react-i18next'

interface ScoreTrendData {
  label: string
  score: number
  previousScore?: number
}

interface ScoreTrendChartProps {
  data: ScoreTrendData[]
}

export function ScoreTrendChart({ data }: ScoreTrendChartProps) {
  const { t } = useTranslation()

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-hextech-text-dim">
        {t('charts.noAssessment')}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E2328" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#A09B8C', fontSize: 10 }}
          angle={-35}
          textAnchor="end"
          height={60}
        />
        <YAxis domain={[0, 10]} tick={{ fill: '#A09B8C', fontSize: 11 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#0A1628',
            border: '1px solid #3C3C41',
            borderRadius: '8px',
            color: '#F0E6D2',
          }}
        />
        {data.some((d) => d.previousScore !== undefined) && (
          <Bar dataKey="previousScore" fill="#3C3C41" radius={[4, 4, 0, 0]} name={t('charts.previous')} />
        )}
        <Bar dataKey="score" fill="#C8AA6E" radius={[4, 4, 0, 0]} name={t('charts.current')} />
      </BarChart>
    </ResponsiveContainer>
  )
}
