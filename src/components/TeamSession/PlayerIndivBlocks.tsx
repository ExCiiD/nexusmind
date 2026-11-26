import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PlayerStatsSheet } from '@/lib/playerStatsSheetCore'
import type { PlayerGameStats, PlayerSessionStats } from '@/pages/TeamSessions/historyContract'
import { PlayerRadar } from './PlayerRadar'

export const panel = 'rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4'
export const num = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))
export const kfmt = (n: number | null | undefined) => (n == null ? '—' : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))
export const signed = (v: number | null, f: (n: number) => string = kfmt, suffix = '') => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${f(Math.abs(v))}${suffix}`)
export const tone = (v: number | null) => (v == null || v === 0 ? 'text-hextech-text-dim' : v > 0 ? 'text-hextech-green' : 'text-hextech-red')

export type IndivState = 'loading' | 'ready' | 'unavailable' | 'error'

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className={cn(panel, 'space-y-3')} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-hextech-gold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Tile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-md border border-hextech-border-dim bg-hextech-black/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{label}</p>
      <p className={cn('mt-0.5 font-mono text-lg tabular-nums text-hextech-text-bright', className)}>{value}</p>
    </div>
  )
}

/** Why a block is empty and what to do about it (never a silent empty block). */
export function WhyEmpty({ text, action, onAction, busy }: { text: string; action?: string; onAction?: () => void; busy?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-hextech-text-dim">
      <span>{text}</span>
      {action && onAction && (
        <Button size="sm" variant="outline" disabled={busy} onClick={onAction}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{action}
        </Button>
      )}
    </div>
  )
}

export interface IndivCtx {
  sheet: PlayerStatsSheet
  role: string
  indiv: PlayerSessionStats | null
  state: IndivState
  onExtract?: () => void
  extracting?: boolean
  /** Team sessions: team game id → Riot match id, to find a game's recording in the local library (solo ids are local already). */
  gameMatchIds?: Record<string, string>
}

/** What the timeline-based blocks read: the picked game, or the session's totals. */
export function useIndivView({ sheet, indiv }: Pick<IndivCtx, 'sheet' | 'indiv'>) {
  const single = sheet.gameIndex != null
  const g: PlayerGameStats | null = single ? indiv?.games.find((x) => x.gameIndex === sheet.gameIndex) ?? null : null
  const tot = indiv?.total ?? null
  const hasTimeline = single ? g?.timelineStatus === 'ready' : (tot?.gamesWithTimeline ?? 0) > 0
  return { single, g, tot, hasTimeline }
}

/** Shared empty-reason for every timeline block. */
export function useReason(ctx: IndivCtx) {
  const { t } = useTranslation()
  const { single, g, hasTimeline } = useIndivView(ctx)
  if (ctx.state === 'loading') return { text: t('teamSessions.detail.indiv.loading') }
  if (ctx.state === 'unavailable') return { text: t('teamSessions.detail.indiv.unavailable') }
  if (ctx.state === 'error') return { text: t('teamSessions.detail.indiv.error') }
  if (hasTimeline) return null
  const status = single ? g?.timelineStatus : undefined
  return {
    text: ctx.sheet.source === 'solo'
      ? t(status === 'no-players' ? 'playerSheet.soloNoPlayers' : 'playerSheet.soloNoTimeline')
      : t(single && !g ? 'teamSessions.detail.indiv.noPlayer' : status === 'no-timeline' || !single ? 'teamSessions.detail.indiv.noTimelineWhy' : 'teamSessions.detail.indiv.noPlayersWhy'),
    action: ctx.onExtract ? t(ctx.extracting ? 'teamSessions.detail.indiv.enriching' : 'teamSessions.detail.indiv.extract') : undefined,
  }
}

export function RadarBlock(ctx: IndivCtx) {
  const { t } = useTranslation()
  const { single, g } = useIndivView(ctx)
  const reason = useReason(ctx)
  const axes = single ? g?.radar ?? [] : ctx.indiv?.radar ?? []
  const opp = g?.vsOpponent
  return (
    <Section title={t('teamSessions.detail.indiv.radarTitle')} right={single && opp ? <span className="font-mono text-[11px] text-hextech-text-dim">{t('teamSessions.detail.indiv.vsName', { name: opp.opponentName })}</span> : undefined}>
      {axes.length >= 3 ? <PlayerRadar axes={axes} />
        : <WhyEmpty text={reason?.text ?? t('teamSessions.detail.indiv.radarNoOpponent')} action={reason?.action} onAction={ctx.onExtract} busy={ctx.extracting} />}
    </Section>
  )
}

export function IsolationBlock(ctx: IndivCtx) {
  const { t } = useTranslation()
  const { single, g, tot } = useIndivView(ctx)
  const reason = useReason(ctx)
  const src = single ? g : tot
  const v = (k: 'deathsBefore14' | 'isolatedDeathsAfter14' | 'isolatedKills' | 'plates') => (src && !reason ? num(src[k]) : '—')
  return (
    <Section title={t('teamSessions.detail.indiv.isolation')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={t('teamSessions.detail.indiv.deathsBefore14')} value={v('deathsBefore14')} />
        <Tile label={t('teamSessions.detail.indiv.isolatedDeathsAfter14')} value={v('isolatedDeathsAfter14')} />
        <Tile label={t('teamSessions.detail.indiv.isolatedKills')} value={v('isolatedKills')} />
        <Tile label={t('teamSessions.detail.indiv.plates')} value={v('plates')} />
      </div>
      {reason && <WhyEmpty text={reason.text} action={reason.action} onAction={ctx.onExtract} busy={ctx.extracting} />}
      {!reason && !single && <p className="text-[11px] text-hextech-text-dim">{t('teamSessions.detail.indiv.sumNote', { count: tot?.gamesWithTimeline ?? 0 })}</p>}
    </Section>
  )
}

export function VsOpponentBlock(ctx: IndivCtx) {
  const { t } = useTranslation()
  const { single, g, tot } = useIndivView(ctx)
  const reason = useReason(ctx)
  const opp = g?.vsOpponent ?? null
  const at = (w: 'at10' | 'at15' | 'end', f: 'goldDiff' | 'xpDiff') => (single ? opp?.[w][f] ?? null : tot?.[w][f] ?? null)
  // The end-of-game diffs come from the match itself (no timeline needed): shown whenever they exist.
  return (
    <Section title={t('teamSessions.detail.indiv.vsOpponent')} right={single && opp ? <span className="font-mono text-[11px] text-hextech-text-dim">{opp.opponentName} · {opp.opponentChampion}</span> : undefined}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-hextech-text">
          <thead className="text-[10px] uppercase tracking-wider text-hextech-text-dim">
            <tr>
              <th scope="col" className="px-2 py-1.5 text-left font-semibold"><span className="sr-only">{t('playerSheet.metric')}</span></th>
              {(['at10', 'at15', 'atEnd'] as const).map((k) => <th key={k} scope="col" className="px-2 py-1.5 text-right font-semibold">{t(`teamSessions.detail.indiv.${k}`)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-hextech-border-dim/40">
            {(['goldDiff', 'xpDiff'] as const).map((f) => (
              <tr key={f} className="h-9">
                <th scope="row" className="px-2 text-left font-medium">{t(`teamSessions.detail.indiv.${f}`)}</th>
                {(['at10', 'at15', 'end'] as const).map((w) => { const x = at(w, f); return <td key={w} className={cn('px-2 text-right font-mono tabular-nums', tone(x))}>{signed(x)}</td> })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reason ? <WhyEmpty text={reason.text} />
        : !single && <p className="text-[11px] text-hextech-text-dim">{t('teamSessions.detail.indiv.avgNote')}</p>}
    </Section>
  )
}

export function VsTeamBlock(ctx: IndivCtx) {
  const { t } = useTranslation()
  const { single, g, tot } = useIndivView(ctx)
  const reason = useReason(ctx)
  const support = ctx.role === 'SUPPORT'
  const gold = single ? g?.goldVsTeamAvgPct ?? null : tot?.goldVsTeamAvgPct ?? null
  const xp = single ? g?.xpVsTeamAvgPct ?? null : tot?.xpVsTeamAvgPct ?? null
  const show = (v: number | null) => (support || v == null ? '—' : signed(v, (n) => n.toFixed(1), ' %'))
  return (
    <Section title={t('teamSessions.detail.indiv.vsTeam')}>
      <div className="grid grid-cols-2 gap-2">
        <Tile label={t('teamSessions.detail.indiv.goldVsTeam')} value={show(gold)} className={support ? undefined : tone(gold)} />
        <Tile label={t('teamSessions.detail.indiv.xpVsTeam')} value={show(xp)} className={support ? undefined : tone(xp)} />
      </div>
      <p className="text-[11px] text-hextech-text-dim">{support ? t('teamSessions.detail.indiv.vsTeamSupport') : t('teamSessions.detail.indiv.vsTeamNote')}</p>
      {!support && gold == null && reason && <WhyEmpty text={reason.text} />}
    </Section>
  )
}
