import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ClipboardCopy, EyeOff, RefreshCw, Send, UserPlus, Users, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/data-state'
import { RoleGlyph } from '@/components/team/RoleGlyph'
import { wrText } from '@/lib/winrate'
import type { DossierDuo, DossierPlayerCard, DossierThreat, OpponentDossierInput, OpponentDossierView } from '@/lib/analyst'
import { GAME_PLAN_MAX } from '@/lib/analystViews'
import { ChampIcon, NoticeBanner, ProgressBanner, analystPanel } from './shared'
import { ControlTiles } from './ObjectivesView'
import { DraftLogTable } from './DraftLogView'

/**
 * #40 · 3/3, Coaching → Scouting → « Dossier » (docs/DESIGN_STATE.md § 12), on the Back-end contract
 * (OpponentDossierView in src/lib/analyst.ts). The page passes `opponentKeyOf(scouting.name)`; « Copier pour
 * Discord » uses opponentDossierCore.dossierToDiscordText (onCopy). Win rates are 0-1.
 */

const THREAT_CLASS: Record<Exclude<DossierThreat, null>, string> = {
  dominant: 'border-wr-bad/60 bg-wr-bad/15 text-wr-bad',
  threat: 'border-wr-low/60 bg-wr-low/15 text-wr-low',
  comfort: 'border-hextech-border bg-hextech-elevated text-hextech-text',
}
const pctOf = (v: number | null) => (v == null ? null : Math.round(v * 100))

/** The editable part of the dossier, pre-filled from the scouting notes when none is saved yet. */
export function dossierInputOf(view: OpponentDossierView): OpponentDossierInput {
  const d = view.dossier
  return {
    opponentName: d?.opponentName ?? view.opponentName,
    howTheyPlay: d ? d.howTheyPlay : view.scoutNotes,
    suggestedBans: d?.suggestedBans ?? [],
    gamePlan: d?.gamePlan ?? null,
  }
}

// ── Header ───────────────────────────────────────────────────────────────────

type HeaderData = Pick<OpponentDossierView, 'opponentName' | 'opponentTag' | 'dossier'>

export function DossierHeader({ data, canEdit, onBack, onRefresh, onCopy, onPublish, onUnpublish, busy }: {
  data: HeaderData
  canEdit: boolean
  onBack: () => void
  onRefresh?: () => void
  onCopy?: () => void
  onPublish?: () => void
  onUnpublish?: () => void
  busy?: boolean
}) {
  const { t, i18n } = useTranslation()
  const d = data.dossier
  const updatedAt = d?.snapshotAt ?? d?.updatedAt ?? null
  const hours = updatedAt ? Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 3_600_000)) : null
  const published = d?.status === 'published'
  return (
    <header className="space-y-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs text-hextech-text-dim hover:text-hextech-text-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
        <ArrowLeft className="h-3.5 w-3.5" />{t('analyst.dossier.back')}
      </button>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-hextech-border-dim bg-hextech-elevated font-display text-sm text-hextech-gold">{data.opponentTag ?? data.opponentName.slice(0, 3).toUpperCase()}</span>
        <div className="min-w-0">
          <h2 className="font-display text-xl text-hextech-text-bright">{data.opponentName}</h2>
          {hours != null && <p className="text-xs text-hextech-text-dim">{t('analyst.dossier.updated', { count: hours })}</p>}
        </div>
        <span className={cn('rounded px-2 py-0.5 text-[11px] font-semibold', published ? 'bg-hextech-green/15 text-hextech-green' : 'bg-hextech-elevated text-hextech-text-dim')}>
          {published && d?.publishedAt
            ? t('analyst.dossier.published', { date: new Date(d.publishedAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }) })
            : t('analyst.dossier.draft')}
        </span>
        {canEdit && (
          <span className="ml-auto flex flex-wrap gap-2">
            {onRefresh && <Button variant="outline" size="sm" className="gap-1.5" onClick={onRefresh} disabled={busy}><RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />{t('analyst.dossier.refresh')}</Button>}
            {onCopy && <Button variant="outline" size="sm" className="gap-1.5" onClick={onCopy}><ClipboardCopy className="h-3.5 w-3.5" />{t('analyst.dossier.copy')}</Button>}
            {published
              ? onUnpublish && <Button variant="outline" size="sm" className="gap-1.5" onClick={onUnpublish} disabled={busy}><EyeOff className="h-3.5 w-3.5" />{t('analyst.dossier.unpublish')}</Button>
              : onPublish && <Button size="sm" className="gap-1.5" onClick={onPublish} disabled={busy}><Send className="h-3.5 w-3.5" />{t('analyst.dossier.publish')}</Button>}
          </span>
        )}
      </div>
    </header>
  )
}

// ── 1. Analyst summary ───────────────────────────────────────────────────────

export function AnalystSummaryCard({ value, canEdit, onSave }: {
  value: OpponentDossierInput
  canEdit: boolean
  /** On blur, when something changed (opponentDossierSave). */
  onSave?: (v: OpponentDossierInput) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  const commit = () => { if (JSON.stringify(draft) !== JSON.stringify(value)) onSave?.(draft) }
  const bans = [...draft.suggestedBans, '', '', '', '', ''].slice(0, 5)
  const setBan = (i: number, v: string) => {
    const next = [...bans]; next[i] = v
    setDraft({ ...draft, suggestedBans: next.map((b) => b.trim()).filter(Boolean) })
  }
  return (
    <section className={cn(analystPanel, 'space-y-3 p-4')} aria-labelledby="dossier-summary">
      <h3 id="dossier-summary" className="text-sm font-semibold text-hextech-text-bright">{t('analyst.dossier.summary.title')}</h3>
      <div>
        <label htmlFor="dossier-how" className="mb-1 block text-xs font-medium text-hextech-text">{t('analyst.dossier.summary.how')}</label>
        {canEdit
          ? <Input id="dossier-how" value={draft.howTheyPlay ?? ''} maxLength={200} onChange={(e) => setDraft({ ...draft, howTheyPlay: e.target.value || null })} onBlur={commit} placeholder={t('analyst.dossier.summary.howPlaceholder')} />
          : <p id="dossier-how" className="text-sm text-hextech-text">{draft.howTheyPlay || '—'}</p>}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-hextech-text">{t('analyst.dossier.summary.bans')}</p>
        <div className="flex flex-wrap gap-2">
          {bans.map((c, i) => canEdit ? (
            <Input key={i} value={c} aria-label={t('analyst.dossier.summary.banSlot', { n: i + 1 })} className="h-8 w-28 text-xs"
              onChange={(e) => setBan(i, e.target.value)} onBlur={commit} />
          ) : (
            c ? <ChampIcon key={i} championKey={c} size={32} /> : <span key={i} className="h-8 w-8 rounded border border-dashed border-hextech-border-dim" aria-hidden />
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="dossier-plan" className="mb-1 block text-xs font-medium text-hextech-text">{t('analyst.dossier.summary.plan')}</label>
        {canEdit ? (
          <>
            <Textarea id="dossier-plan" rows={3} maxLength={GAME_PLAN_MAX} value={draft.gamePlan ?? ''} onChange={(e) => setDraft({ ...draft, gamePlan: e.target.value || null })} onBlur={commit} />
            <p className="mt-0.5 text-right font-mono text-[10px] text-hextech-text-dim">{(draft.gamePlan ?? '').length}/{GAME_PLAN_MAX}</p>
          </>
        ) : <p id="dossier-plan" className="whitespace-pre-wrap text-sm text-hextech-text">{draft.gamePlan || '—'}</p>}
      </div>
    </section>
  )
}

// ── 2. The five players ──────────────────────────────────────────────────────

export function PlayerDossierCard({ player, onFix }: { player: DossierPlayerCard; onFix?: () => void }) {
  const { t } = useTranslation()
  const wins = player.recentForm.filter((r) => r === 'W').length
  return (
    <article className={cn(analystPanel, 'flex flex-col gap-3 p-3')} aria-label={`${t(`team.roster.roles.${player.role}`, { defaultValue: player.role })} · ${player.displayName}`}>
      <header className="flex items-center gap-2">
        <RoleGlyph role={player.role} tone="gold" className="h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-hextech-text-bright">{player.displayName}</p>
          <p className="text-[11px] text-hextech-text-dim">{player.rank ?? t('analyst.dossier.player.unranked')}</p>
        </div>
      </header>
      {player.status === 'not_found' ? (
        <div className="space-y-2 rounded-md border border-amber-400/40 bg-amber-400/5 p-2 text-xs text-amber-200">
          <p>{t('analyst.dossier.player.notFound')}</p>
          {onFix && <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onFix}><Wrench className="h-3 w-3" />{t('analyst.dossier.player.fix')}</Button>}
        </div>
      ) : (
        <>
          <ul className="space-y-1">
            {player.topChampions.slice(0, 3).map((c) => {
              const p = pctOf(c.winRate)
              return (
                <li key={c.champion} className="flex items-center gap-2 text-xs">
                  <ChampIcon championKey={c.champion} size={24} />
                  <span className="min-w-0 flex-1 truncate text-hextech-text-bright">{c.champion}</span>
                  {c.threat && <span className={cn('rounded border px-1 text-[9px] font-semibold', THREAT_CLASS[c.threat])}>{t(`analyst.dossier.threat.${c.threat}`)}</span>}
                  {c.tier && <span className="rounded bg-hextech-elevated px-1 font-mono text-[10px] uppercase text-hextech-text">{c.tier}</span>}
                  <span className="font-mono text-hextech-text-dim">{c.games}</span>
                  <span className={cn('w-9 text-right font-mono font-semibold', p == null ? 'text-hextech-text-dim' : wrText(p, c.games))}>{p == null ? '—' : `${p} %`}</span>
                </li>
              )
            })}
            {player.topChampions.length === 0 && <li className="text-xs text-hextech-text-dim">—</li>}
          </ul>
          {player.status === 'not_refreshed' ? (
            <p className="text-[11px] text-hextech-text-dim">{t('analyst.dossier.player.notRefreshed')}</p>
          ) : player.recentForm.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] text-hextech-text-dim">{t('analyst.dossier.player.form', { wins, losses: player.recentForm.length - wins })}</p>
              {/* Oldest on the left, most recent on the right (the contract lists the most recent first). */}
              <div className="flex gap-0.5" aria-hidden>
                {[...player.recentForm].reverse().map((r, i) => <span key={i} className={cn('h-4 flex-1 rounded-sm', r === 'W' ? 'bg-hextech-green/70' : 'bg-hextech-red/60')} />)}
              </div>
            </div>
          )}
          {player.poolChange && (
            <p className="text-[11px] text-hextech-gold">{t('analyst.dossier.player.poolChange', { champion: player.poolChange.champion, count: player.poolChange.games, days: player.poolChange.days })}</p>
          )}
        </>
      )}
    </article>
  )
}

export function PlayerCardSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={cn(analystPanel, 'space-y-3 p-3')}>
          <div className="flex items-center gap-2"><Skeleton className="h-5 w-5" /><Skeleton className="h-3 w-24" /></div>
          {Array.from({ length: 3 }, (_, j) => <div key={j} className="flex items-center gap-2"><Skeleton className="h-6 w-6" /><Skeleton className="h-2.5 flex-1" /></div>)}
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  )
}

// ── 3. Against us · 4. Duos ──────────────────────────────────────────────────

export function VersusUsCard({ versus }: { versus: NonNullable<OpponentDossierView['vsUs']> }) {
  const { t } = useTranslation()
  return (
    <section className={cn(analystPanel, 'space-y-3 p-4')} aria-labelledby="dossier-versus">
      <div className="flex items-center justify-between">
        <h3 id="dossier-versus" className="text-sm font-semibold text-hextech-text-bright">{t('analyst.dossier.versus.title')}</h3>
        <span className="font-mono text-xs text-hextech-text">{t('analyst.dossier.versus.record', { wins: versus.wins, losses: versus.losses })}</span>
      </div>
      {versus.drafts.length > 0 && <DraftLogTable rows={versus.drafts} selectedId={null} />}
      {versus.objectives && versus.objectives.games > 0 && <ControlTiles tiles={versus.objectives.tiles} lowSample={versus.objectives.lowSample} compact />}
    </section>
  )
}

export function DuosCard({ duos }: { duos: DossierDuo[] }) {
  const { t } = useTranslation()
  return (
    <section className={cn(analystPanel, 'p-4')} aria-labelledby="dossier-duos">
      <h3 id="dossier-duos" className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-hextech-text-bright"><Users className="h-4 w-4 text-hextech-gold" />{t('analyst.dossier.duos.title')}</h3>
      {duos.length === 0 ? <p className="text-xs text-hextech-text-dim">{t('analyst.dossier.duos.none')}</p> : (
        <ul className="space-y-1 text-xs">
          {duos.map((d) => {
            const p = pctOf(d.winRate)
            return (
              <li key={`${d.a}+${d.b}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-hextech-text-bright">{d.a} + {d.b}</span>
                <span className="font-mono text-hextech-text-dim">{t('analyst.common.games', { count: d.games })}</span>
                <span className={cn('w-10 text-right font-mono font-semibold', p == null ? 'text-hextech-text-dim' : wrText(p, d.games))}>{p == null ? '—' : `${p} %`}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── The page, with its states ────────────────────────────────────────────────

export type DossierState =
  /** First load, or a refresh: the header shows, the players load one by one. */
  | { kind: 'loading'; header: HeaderData; done: number; total: number }
  | { kind: 'error'; cause: string }
  | { kind: 'ready'; view: OpponentDossierView }

export function DossierView({ state, canEdit, onBack, onRetry, onRefresh, onCopy, onPublish, onUnpublish, onSave, onAddPlayers, onFixPlayer }: {
  state: DossierState
  canEdit: boolean
  onBack: () => void
  onRetry?: () => void
  onRefresh?: () => void
  onCopy?: () => void
  onPublish?: () => void
  onUnpublish?: () => void
  onSave?: (input: OpponentDossierInput) => void
  onAddPlayers?: () => void
  onFixPlayer?: (p: DossierPlayerCard) => void
}) {
  const { t } = useTranslation()
  if (state.kind === 'error') {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs text-hextech-text-dim hover:text-hextech-text-bright"><ArrowLeft className="h-3.5 w-3.5" />{t('analyst.dossier.back')}</button>
        <ErrorState title={t('analyst.dossier.error')} cause={state.cause} onRetry={onRetry} />
      </div>
    )
  }
  const header = state.kind === 'ready' ? state.view : state.header
  return (
    <div className="space-y-4">
      <DossierHeader data={header} canEdit={canEdit} onBack={onBack} onRefresh={onRefresh} onCopy={onCopy} onPublish={onPublish} onUnpublish={onUnpublish} busy={state.kind === 'loading'} />
      {state.kind === 'loading' && (
        <>
          {/* total 0: one call whose progress is not known (first load, or « Actualiser les données »). */}
          {state.total > 0
            ? <ProgressBanner label={t('analyst.dossier.loading', { done: state.done, total: state.total })} done={state.done} total={state.total} />
            : <p role="status" className="text-xs text-hextech-text-dim">{t('analyst.dossier.refreshing')}</p>}
          <PlayerCardSkeletons />
        </>
      )}
      {state.kind === 'ready' && state.view.players.length === 0 && (
        <EmptyState icon={UserPlus} title={t('analyst.dossier.noPlayers.title')}
          action={canEdit && onAddPlayers ? { label: t('analyst.dossier.noPlayers.add'), onClick: onAddPlayers, icon: UserPlus } : undefined} />
      )}
      {state.kind === 'ready' && state.view.players.length > 0 && (
        <>
          {state.view.reducedMode && <NoticeBanner>{t('analyst.dossier.reduced', { count: state.view.dossier?.snapshot?.gamesPerPlayer ?? 20 })}</NoticeBanner>}
          <AnalystSummaryCard key={state.view.dossier?.updatedAt ?? 'new'} value={dossierInputOf(state.view)} canEdit={canEdit} onSave={onSave} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {state.view.players.map((p) => <PlayerDossierCard key={p.role} player={p} onFix={canEdit && onFixPlayer ? () => onFixPlayer(p) : undefined} />)}
          </div>
          {state.view.vsUs && <VersusUsCard versus={state.view.vsUs} />}
          <DuosCard duos={state.view.duos} />
        </>
      )}
    </div>
  )
}
