import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'

interface DataPoint {
  date: string
  fundamentalId: string
  score: number
}

interface ProgressChartProps {
  data: DataPoint[]
  fundamentalIds?: string[]
}

const CHART_COLORS = ['#C8AA6E', '#0AC8B9', '#0ACE83', '#FF4655', '#576CCE', '#9D48E0', '#F4C874']

export function ProgressChart({ data, fundamentalIds }: ProgressChartProps) {
  const { t } = useTranslation()
  const allFundamentals = useLocalizedFundamentals()

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-hextech-text-dim">
        {t('charts.noProgress')}
      </div>
    )
  }

  const ids = fundamentalIds || [...new Set(data.map((d) => d.fundamentalId))]

  const dateMap = new Map<string, Record<string, number>>()
  for (const point of data) {
    if (!ids.includes(point.fundamentalId)) continue
    const dateKey = new Date(point.date).toLocaleDateString()
    if (!dateMap.has(dateKey)) dateMap.set(dateKey, {})
    dateMap.get(dateKey)![point.fundamentalId] = point.score
  }

  const chartData = [...dateMap.entries()]
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([date, scores]) => ({ date, ...scores }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E2328" />
        <XAxis dataKey="date" tick={{ fill: '#A09B8C', fontSize: 11 }} />
        <YAxis domain={[0, 5]} tick={{ fill: '#A09B8C', fontSize: 11 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#0A1628',
            border: '1px solid #3C3C41',
            borderRadius: '8px',
            color: '#F0E6D2',
          }}
        />
        <Legend wrapperStyle={{ color: '#A09B8C', fontSize: 12 }} />
        {ids.map((id, i) => (
          <Line
            key={id}
            type="monotone"
            dataKey={id}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 4, fill: CHART_COLORS[i % CHART_COLORS.length] }}
            name={allFundamentals.flatMap((c) => c.fundamentals).find((f) => f.id === id)?.label || id.replace(/_/g, ' ')}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
