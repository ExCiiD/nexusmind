import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { GameFilter } from '@/components/TeamSession/GameFilter'
import { PlayerSheet } from '@/components/TeamSession/PlayerSheet'
import { buildSoloPlayerStatsSheet, type SoloGameInput } from '@/lib/playerStatsSheetCore'
import type { IndivState } from '@/components/TeamSession/PlayerIndivBlocks'
import type { PlayerSessionStats } from '@/lib/playerSessionStatsCore'
import { sheetFromPlayerStats } from '@/lib/playerSheetView'
import { useUserStore } from '@/store/useUserStore'
import { formatClock } from '@/lib/teamSessionHistoryView'

/** Rank (1-based) of a stored solo game in the order played, as buildSoloPlayerStatsSheet numbers them. */
export function soloGameRank(games: ReadonlyArray<Pick<SoloGameInput, 'id' | 'gameEndAt'>>, id: string): number {
  return [...games].sort((a, b) => Date.parse(a.gameEndAt) - Date.parse(b.gameEndAt)).findIndex((g) => g.id === id) + 1
}

/**
 * The player sheet of the signed-in player for the current solo session (docs/DESIGN_STATE.md § 24.2): shown by
 * SessionPage when `?sheet=1` is in the URL (`&game=N` for one game). Same full sheet as a team's, from
 * `window.api.soloSessionPlayerStats` (local match + timeline cache, never a Riot call; docs/contracts/player-session-stats.md § B7).
 * Without that API (older build) it falls back to the stored games (buildSoloPlayerStatsSheet): the fields it lists in
 * `missing` are hidden, not shown as 0, and the timeline blocks say why they are empty.
 */
export function SoloPlayerSheet({ games, onBack, sessionId = null, live = true, backLabel }: { games: SoloGameInput[]; onBack: () => void; sessionId?: string | null; live?: boolean; backLabel?: string }) {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const [params, setParams] = useSearchParams()
  const userId = user?.id ?? 'me'
  const name = user ? `${user.summonerName}${user.tagLine ? `#${user.tagLine}` : ''}` : t('playerSheet.me')
  const raw = Number(params.get('game'))
  const gameIndex = Number.isInteger(raw) && raw >= 1 && raw <= games.length ? raw : null
  const hasApi = typeof window.api?.soloSessionPlayerStats === 'function'
  const [stats, setStats] = useState<PlayerSessionStats | null>(null)
  const [state, setState] = useState<IndivState>(hasApi ? 'loading' : 'unavailable')
  const [reload, setReload] = useState(0)
  // One call per session; the games count is a dependency so a game that just ended shows up.
  useEffect(() => {
    const load = window.api.soloSessionPlayerStats
    if (!hasApi || !load) { setState('unavailable'); return }
    let alive = true
    setState('loading')
    load(sessionId).then((rows) => { if (alive) { setStats(rows.find((r) => r.memberId === userId) ?? rows[0] ?? null); setState('ready') } })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [hasApi, sessionId, userId, games.length, reload])
  const sheet = useMemo(
    () => (stats ? sheetFromPlayerStats(stats, gameIndex) : buildSoloPlayerStatsSheet(games, userId, gameIndex)),
    [stats, games, userId, gameIndex],
  )
  const pick = (index: number | null) => setParams((p) => {
    const n = new URLSearchParams(p)
    if (index == null) n.delete('game'); else n.set('game', String(index))
    return n
  }, { replace: true })

  const played = sheet.series.filter((p) => p.played)
  const wins = played.filter((p) => p.win === true).length, losses = played.filter((p) => p.win === false).length
  const champs = [...played.reduce((m, p) => m.set(p.championKey ?? '', (m.get(p.championKey ?? '') ?? 0) + 1), new Map<string, number>())].filter(([c]) => c).map(([c, n]) => `${c} ×${n}`).join(' · ')
  const seconds = played.reduce((n, p) => n + (p.durationSec ?? 0), 0)
  const role = sheet.line?.role ?? games[0]?.role ?? ''

  return (
    <div className="space-y-4 animate-fade-in">
      <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm">
        <button type="button" onClick={onBack} className="rounded text-hextech-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">← {backLabel ?? t('playerSheet.soloBack')}</button>
        <span aria-hidden className="text-hextech-text-dim">/</span>
        <span aria-current="page" className="text-hextech-text-bright">{t('playerSheet.mySheet')}{gameIndex != null ? ` · G${gameIndex}` : ''}</span>
      </nav>

      <header className="flex flex-wrap items-center gap-4 rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4">
        <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-hextech-gold font-mono text-xs font-bold text-hextech-gold">{role === 'SUPPORT' ? 'SUP' : role === 'JUNGLE' ? 'JGL' : role || '—'}</span>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-bold text-hextech-text-bright">{name}</h1>
            <span className="rounded bg-hextech-gold/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-hextech-gold">{t(live ? 'playerSheet.soloLive' : 'playerSheet.soloEnded')}</span>
          </div>
          <p className="font-mono text-xs text-hextech-text-dim">
            {[champs, t('teamSessions.detail.gamesCount', { count: played.length }), `${wins} ${t('teamSessions.winShort')} – ${losses} ${t('teamSessions.lossShort')}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      </header>

      {games.length > 0 && <GameFilter games={sheet.series} value={gameIndex} onPick={pick} right={seconds > 0 ? formatClock(seconds) ?? undefined : undefined} />}

      {state === 'error' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hextech-red/40 bg-hextech-red/10 p-3">
          <p className="text-sm text-hextech-text-bright">{t('playerSheet.errorTitle', { name })}</p>
          <Button size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}>{t('dataState.retry')}</Button>
        </div>
      )}

      <PlayerSheet sheet={sheet} name={name} role={role} teamPlayers={[]} indiv={stats} indivState={state} onPickGame={pick} />

      <Button variant="outline" size="sm" onClick={onBack}>{backLabel ?? t('playerSheet.soloBack')}</Button>
    </div>
  )
}
