import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslation } from 'react-i18next'

interface ScoreTrendData {
  label: string
  score: number
  previousScore?: number
}

interface ScoreTrendChartProps {
  data: ScoreTrendData[]
  scoreName?: string
  previousScoreName?: string
}

export function ScoreTrendChart({ data, scoreName, previousScoreName }: ScoreTrendChartProps) {
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
        <CartesianGrid strokeDasharray="3 3" stroke="#2A1D11" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#B5A68C', fontSize: 10 }}
          angle={-35}
          textAnchor="end"
          height={60}
        />
        <YAxis domain={[0, 10]} tick={{ fill: '#B5A68C', fontSize: 11 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1C140C',
            border: '1px solid #4A3A24',
            borderRadius: '8px',
            color: '#F5E3BE',
          }}
        />
        {data.some((d) => d.previousScore !== undefined) && (
          <Bar dataKey="previousScore" fill="#4A3A24" radius={[4, 4, 0, 0]} name={previousScoreName ?? t('charts.previous')} />
        )}
        <Bar dataKey="score" fill="#D4A24C" radius={[4, 4, 0, 0]} name={scoreName ?? t('charts.current')} />
      </BarChart>
    </ResponsiveContainer>
  )
}
