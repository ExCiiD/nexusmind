/**
 * Mistake Library — aggregated stats page.
 *
 * Three views over the user's tagged mistakes:
 *   - Top tags bar chart (how often each mistake was tagged in window)
 *   - Trend line chart (per-day count for selected tag(s))
 *   - Heatmap (tag × day, opacity = count)
 *
 * All three respond to a shared filter: time window (7/14/30/90 j), role,
 * champion. Pure read-side; never mutates anything.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Filter } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { MistakeTag, MistakeTopTagEntry, MistakeTrendEntry, MistakeHeatmapEntry } from '@/lib/ipc'

type WindowDays = 7 | 14 | 30 | 90
const WINDOWS: WindowDays[] = [7, 14, 30, 90]
const ROLES: Array<{ id: string; label: string }> = [
  { id: '',         label: 'Any role' },
  { id: 'TOP',      label: 'Top' },
  { id: 'JUNGLE',   label: 'Jungle' },
  { id: 'MIDDLE',   label: 'Mid' },
  { id: 'BOTTOM',   label: 'ADC' },
  { id: 'UTILITY',  label: 'Support' },
]

export function MistakeStatsPage() {
  const [windowDays, setWindowDays] = useState<WindowDays>(30)
  const [role, setRole] = useState<string>('')
  const [champion, setChampion] = useState<string>('')
  const [allTags, setAllTags] = useState<MistakeTag[]>([])
  const [topTags, setTopTags] = useState<MistakeTopTagEntry[]>([])
  const [trend, setTrend] = useState<MistakeTrendEntry[]>([])
  const [heatmap, setHeatmap] = useState<MistakeHeatmapEntry[]>([])
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    window.api.listMistakeTags()
      .then(setAllTags)
      .catch(() => setAllTags([]))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      window.api.getMistakeTopTags({ days: windowDays, role: role || null, champion: champion || null }),
      window.api.getMistakeHeatmap({ days: windowDays, role: role || null, champion: champion || null }),
    ])
      .then(([top, hm]) => {
        if (cancelled) return
        setTopTags(top)
        setHeatmap(hm)
        // Default trend to the top 3 slugs so the user sees data immediately.
        if (selectedSlugs.length === 0 && top.length > 0) {
          setSelectedSlugs(top.slice(0, 3).map((t) => t.tag.slug))
        }
      })
      .catch(() => { /* swallow — empty state already handles missing data */ })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [windowDays, role, champion])

  useEffect(() => {
    if (selectedSlugs.length === 0) {
      setTrend([])
      return
    }
    window.api.getMistakeTrend({ tagSlugs: selectedSlugs, days: windowDays, role: role || null, champion: champion || null })
      .then(setTrend)
      .catch(() => setTrend([]))
  }, [selectedSlugs, windowDays, role, champion])

  const trendData = useMemo(() => {
    // Recharts wants [{ date, slug1: n, slug2: n }, …]
    return trend.map((row) => ({
      date: row.date.slice(5), // MM-DD
      ...row.counts,
    }))
  }, [trend])

  const heatmapDays = useMemo(() => {
    const days = new Set<string>()
    for (const h of heatmap) days.add(h.date)
    return [...days].sort()
  }, [heatmap])

  const heatmapTags = useMemo(() => {
    const byTag = new Map<string, { id: string; slug: string; label: string }>()
    for (const h of heatmap) {
      if (!byTag.has(h.tagId)) byTag.set(h.tagId, { id: h.tagId, slug: h.tagSlug, label: h.tagLabel })
    }
    return [...byTag.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [heatmap])

  function heatmapCount(date: string, tagId: string): number {
    return heatmap.find((h) => h.date === date && h.tagId === tagId)?.count ?? 0
  }
  const maxCount = useMemo(() => heatmap.reduce((m, h) => Math.max(m, h.count), 0), [heatmap])

  return (
    <div className="space-y-4 p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-300" />
        <h1 className="text-xl font-semibold text-hextech-text-bright">Mistake Library</h1>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3 px-4 flex items-center gap-3 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-hextech-text-dim" />
          <div className="flex items-center rounded-md border border-hextech-border-dim bg-hextech-elevated p-0.5">
            {WINDOWS.map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={cn(
                  'rounded px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                  windowDays === d ? 'bg-hextech-gold/20 text-hextech-gold' : 'text-hextech-text-dim hover:text-hextech-text-bright',
                )}
              >
                {d}d
              </button>
            ))}
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded border border-hextech-border-dim bg-hextech-elevated text-[11px] text-hextech-text-bright px-2 py-1"
          >
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <input
            type="text"
            value={champion}
            onChange={(e) => setChampion(e.target.value)}
            placeholder="Champion (e.g. Renekton)"
            className="rounded border border-hextech-border-dim bg-hextech-elevated text-[11px] text-hextech-text-bright px-2 py-1 w-44"
          />
          {loading && <span className="text-[10px] text-hextech-text-dim">Loading…</span>}
        </CardContent>
      </Card>

      {/* Top tags */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Top mistakes — last {windowDays} days</CardTitle></CardHeader>
        <CardContent className="pt-0 pb-4">
          {topTags.length === 0 ? (
            <p className="text-xs text-hextech-text-dim py-2">No tagged mistakes in this window.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.min(40 * topTags.length + 30, 360)}>
              <BarChart data={topTags.map((t) => ({ name: t.tag.label, count: t.count, color: t.tag.color }))} layout="vertical" margin={{ left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E2328" />
                <XAxis type="number" tick={{ fill: '#A09B8C', fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#C8AA6E', fontSize: 11 }} width={160} />
                <RTooltip
                  contentStyle={{ background: '#0a0e13', border: '1px solid #1E2328', borderRadius: 6, fontSize: 11 }}
                  cursor={{ fill: '#ffffff10' }}
                />
                <Bar dataKey="count" fill="#FFB454" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Trend */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-sm">Trend</CardTitle>
          <div className="flex flex-wrap gap-1 max-w-[60%] justify-end">
            {allTags.map((t) => {
              const active = selectedSlugs.includes(t.slug)
              return (
                <button
                  key={t.slug}
                  onClick={() => setSelectedSlugs((sel) => sel.includes(t.slug) ? sel.filter((s) => s !== t.slug) : [...sel, t.slug])}
                  style={active ? { borderColor: t.color ?? '#FFB454', backgroundColor: `${t.color ?? '#FFB454'}20` } : undefined}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                    active ? 'text-hextech-text-bright' : 'border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                  )}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          {selectedSlugs.length === 0 ? (
            <p className="text-xs text-hextech-text-dim py-2">Pick at least one tag above to see its trend.</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E2328" />
                <XAxis dataKey="date" tick={{ fill: '#A09B8C', fontSize: 11 }} />
                <YAxis tick={{ fill: '#A09B8C', fontSize: 11 }} allowDecimals={false} />
                <RTooltip contentStyle={{ background: '#0a0e13', border: '1px solid #1E2328', borderRadius: 6, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {selectedSlugs.map((slug, i) => {
                  const tag = allTags.find((t) => t.slug === slug)
                  const color = tag?.color ?? `hsl(${(i * 67) % 360}, 70%, 60%)`
                  return (
                    <Line key={slug} type="monotone" dataKey={slug} stroke={color} name={tag?.label ?? slug} dot={{ r: 2 }} strokeWidth={2} connectNulls />
                  )
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Heatmap */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Heatmap — tag × day</CardTitle></CardHeader>
        <CardContent className="pt-0 pb-4 overflow-x-auto">
          {heatmap.length === 0 ? (
            <p className="text-xs text-hextech-text-dim py-2">No data yet for this window.</p>
          ) : (
            <div className="inline-block min-w-full">
              <div className="grid" style={{ gridTemplateColumns: `160px repeat(${heatmapDays.length}, minmax(20px, 1fr))` }}>
                <div />
                {heatmapDays.map((d) => (
                  <div key={d} className="text-[8px] text-hextech-text-dim text-center pt-1 transform rotate-[-65deg] origin-bottom-left h-10 whitespace-nowrap">{d.slice(5)}</div>
                ))}
                {heatmapTags.map((tag) => (
                  <>
                    <div key={`${tag.id}-label`} className="text-[10px] text-hextech-text px-2 py-1 truncate">{tag.label}</div>
                    {heatmapDays.map((d) => {
                      const count = heatmapCount(d, tag.id)
                      const opacity = count === 0 ? 0 : Math.max(0.15, Math.min(1, count / Math.max(1, maxCount)))
                      return (
                        <div
                          key={`${tag.id}-${d}`}
                          title={count > 0 ? `${tag.label} on ${d}: ${count}` : `${tag.label} on ${d}: 0`}
                          className="border border-hextech-border-dim/40 h-5 mx-px my-px rounded-sm"
                          style={{ backgroundColor: count > 0 ? `rgba(255, 180, 84, ${opacity})` : 'transparent' }}
                        />
                      )
                    })}
                  </>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default MistakeStatsPage
