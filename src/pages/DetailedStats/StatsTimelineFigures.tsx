import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { ExtrasBlock } from '@/components/TeamSession/PlayerTimelineBlocks'
import { ObjectivesBlock } from '@/components/TeamSession/PlayerTimelineBlocks'
import type { IndivState } from '@/components/TeamSession/PlayerIndivBlocks'
import type { PlayerStatsSheet } from '@/lib/playerStatsSheetCore'
import { aggregateExtras, sumObjectives, type PlayerGameStats, type PlayerSessionStats } from '@/lib/playerSessionStatsCore'
import { useUserStore } from '@/store/useUserStore'

/** The latest games the figures are made from (same window as the rest of the Analysis tab). */
const FIGURE_GAMES = 50
/** Sessions read at most, newest first (each is one local call, no Riot request). */
const MAX_SESSIONS = 12

type SessionRow = { id: string; games?: Array<{ gameEndAt?: string | Date }> }
const lastEnd = (s: SessionRow) => Math.max(0, ...(s.games ?? []).map((g) => (g.gameEndAt ? Date.parse(String(g.gameEndAt)) : 0)))

/**
 * Stats → Analysis: the timeline-based figures of the session stats (solo kills, first blood, multi-kills, time dead,
 * damage to objectives / turrets, vision per minute, objective participation) over the player's latest games.
 * No new computation: every game comes from `soloSessionPlayerStats` (the session sheet's own source) and is
 * aggregated with the sheet's own functions (aggregateExtras, sumObjectives) and drawn by the sheet's own blocks.
 * Desktop only (local match and timeline cache): hidden where the call does not exist.
 */
export function StatsTimelineFigures() {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const available = typeof window.api?.soloSessionPlayerStats === 'function' && typeof window.api?.listSessions === 'function'
  const [state, setState] = useState<IndivState>(available ? 'loading' : 'unavailable')
  const [indiv, setIndiv] = useState<PlayerSessionStats | null>(null)

  useEffect(() => {
    if (!available) return
    let alive = true
    ;(async () => {
      try {
        const rows = ((await window.api.listSessions()) as SessionRow[]).filter((s) => (s.games?.length ?? 0) > 0).sort((a, b) => lastEnd(b) - lastEnd(a))
        const picked: SessionRow[] = []
        let n = 0
        for (const s of rows) { if (picked.length >= MAX_SESSIONS || n >= FIGURE_GAMES) break; picked.push(s); n += s.games?.length ?? 0 }
        const out: PlayerSessionStats[] = []
        for (let i = 0; i < picked.length; i += 4) {
          const part = await Promise.all(picked.slice(i, i + 4).map((s) => window.api.soloSessionPlayerStats!(s.id).then((r) => r[0] ?? null).catch(() => null)))
          for (const p of part) if (p) out.push(p)
        }
        if (!alive) return
        if (out.length === 0) { setIndiv(null); setState('ready'); return }
        // Newest session first (as picked), games of each in play order; the latest FIGURE_GAMES with a timeline figure.
        const games: PlayerGameStats[] = out.flatMap((s) => [...s.games].reverse()).slice(0, FIGURE_GAMES)
        const withTimeline = games.filter((g) => g.timelineStatus === 'ready')
        const base = out[0]
        setIndiv({
          ...base,
          gamesCounted: games.length,
          // Per-event rows (hundreds over 50 games) stay in the session sheets: only the per-kind lines are shown here.
          games: games.map((g) => (g.objectives ? { ...g, objectives: { ...g.objectives, events: [] } } : g)),
          total: {
            ...base.total,
            gamesWithTimeline: withTimeline.length,
            extras: aggregateExtras(withTimeline.map((g) => g.extras)),
            objectives: sumObjectives(withTimeline.map((g) => g.objectives)),
            gamesWithObjectives: withTimeline.filter((g) => g.objectives).length,
          },
        })
        setState('ready')
      } catch {
        if (alive) setState('error')
      }
    })()
    return () => { alive = false }
  }, [available, user?.id])

  if (!available) return null
  if (state === 'loading') {
    return <div className="flex items-center gap-2 py-6 text-xs text-hextech-text-dim"><Loader2 className="h-4 w-4 animate-spin" /> {t('statsInsights.figures.loading')}</div>
  }
  if (!indiv || indiv.total.gamesWithTimeline === 0) {
    return <p className="rounded-xl border border-hextech-border-dim/60 p-4 text-xs text-hextech-text-dim">{t('statsInsights.figures.none')}</p>
  }
  // The blocks only read the sheet's source and « whole session » mode (no game picked).
  const sheet = { gameIndex: null, source: 'solo' } as unknown as PlayerStatsSheet
  const ctx = { sheet, role: indiv.role, indiv, state }
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-hextech-text-bright">{t('statsInsights.figures.title')}</h2>
        <p className="text-xs text-hextech-text-dim">{t('statsInsights.figures.basis', { count: indiv.total.gamesWithTimeline })}</p>
      </div>
      <ExtrasBlock {...ctx} note={t('statsInsights.figures.note', { count: indiv.total.gamesWithTimeline })} />
      <ObjectivesBlock {...ctx} />
    </div>
  )
}
