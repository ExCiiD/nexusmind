import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, FilterX, Plus, X, BarChart3, Film, ClipboardCopy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/data-state'
import { wrText } from '@/lib/winrate'
import type { DraftChampionRow, DraftLogEntry, DraftLogFilters, DraftLogSummary, DraftPick } from '@/lib/analyst'
import { PICK_SEQUENCE, clock } from '@/lib/analystViews'
import { PickOrderEditor } from './PickOrderEditor'
import { filterDrafts, summarizeDrafts } from '@/lib/draftLogCore'
import { AnalystTile, ChampIcon, ResultBadge, Segmented, SidePill, analystPanel } from './shared'

/**
 * #40 · 2/3, Coaching → Draft Sim → « Journal » (docs/DESIGN_STATE.md § 11), on the Back-end contract
 * (DraftLogEntry, DraftLogFilters, DraftLogSummary in src/lib/analyst.ts), filtered and summed up by draftLogCore
 * (filterDrafts, summarizeDrafts). Shares and win rates are 0-1.
 */

const ROLE_SHORT: Record<string, string> = { TOP: 'TOP', JUNGLE: 'JGL', MID: 'MID', ADC: 'ADC', SUPPORT: 'SUP' }
const pctOf = (v: number | null) => (v == null ? null : Math.round(v * 100))

// ── Filters ──────────────────────────────────────────────────────────────────

export const DEFAULT_DRAFT_FILTERS: DraftLogFilters = { opponentKey: null, side: 'both', patch: null, champion: null, result: 'all' }

type SourceChoice = 'all' | 'scrim' | 'tournament' | 'manual'

export function DraftLogFiltersBar({ entries, value, onChange, summary }: {
  entries: DraftLogEntry[]
  value: DraftLogFilters
  onChange: (v: DraftLogFilters) => void
  summary: Pick<DraftLogSummary, 'count' | 'wins' | 'losses'>
}) {
  const { t } = useTranslation()
  const opponents = [...new Map(entries.filter((e) => e.opponentKey).map((e) => [e.opponentKey!, e.opponentName ?? e.opponentKey!])).entries()]
  const patches = [...new Set(entries.map((e) => e.patch).filter((p): p is string => !!p))]
  const source: SourceChoice = value.sources?.length === 1 ? (value.sources[0] as SourceChoice) : 'all'
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hextech-border-dim bg-hextech-dark p-2">
      <Select value={value.opponentKey ?? 'all'} onValueChange={(v) => onChange({ ...value, opponentKey: v === 'all' ? null : v })}>
        <SelectTrigger className="h-7 w-40 text-xs" aria-label={t('analyst.draftLog.filters.opponent')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('analyst.draftLog.filters.allOpponents')}</SelectItem>
          {opponents.map(([key, name]) => <SelectItem key={key} value={key}>{name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Segmented label={t('analyst.filters.source')} value={source} onChange={(s) => onChange({ ...value, sources: s === 'all' ? undefined : [s] })}
        options={[
          { id: 'all', label: t('analyst.draftLog.filters.allSources') },
          { id: 'scrim', label: t('analyst.common.source.scrim') },
          { id: 'tournament', label: t('analyst.common.source.tournament') },
          { id: 'manual', label: t('analyst.common.source.manual') },
        ]} />
      <Segmented label={t('analyst.filters.side')} value={value.side ?? 'both'} onChange={(side) => onChange({ ...value, side })}
        options={(['both', 'blue', 'red'] as const).map((id) => ({ id, label: t(`analyst.filters.sides.${id}`) }))} />
      {patches.length > 0 && (
        <Select value={value.patch ?? 'all'} onValueChange={(p) => onChange({ ...value, patch: p === 'all' ? null : p })}>
          <SelectTrigger className="h-7 w-28 text-xs" aria-label={t('analyst.draftLog.filters.patch')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('analyst.draftLog.filters.allPatches')}</SelectItem>
            {patches.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Input value={value.champion ?? ''} onChange={(e) => onChange({ ...value, champion: e.target.value || null })} placeholder={t('analyst.draftLog.filters.champion')}
        aria-label={t('analyst.draftLog.filters.champion')} className="h-7 w-40 text-xs" />
      <Segmented label={t('analyst.draftLog.filters.result')} value={value.result ?? 'all'} onChange={(result) => onChange({ ...value, result })}
        options={[{ id: 'all', label: t('analyst.draftLog.filters.allResults') }, { id: 'win', label: t('analyst.common.win') }, { id: 'loss', label: t('analyst.common.loss') }]} />
      <span className="ml-auto font-mono text-xs text-hextech-text-dim">{t('analyst.draftLog.count', { count: summary.count, wins: summary.wins, losses: summary.losses })}</span>
    </div>
  )
}

// ── 1. Summary ───────────────────────────────────────────────────────────────

export function DraftSummaryTiles({ summary }: { summary: DraftLogSummary }) {
  const { t } = useTranslation()
  const rate = (s: { share: number | null; games: number }) => {
    const p = pctOf(s.share)
    return { value: p == null ? '—' : `${p} %`, valueClass: p == null ? 'text-hextech-text-dim' : wrText(p, s.games), foot: t('analyst.common.games', { count: s.games }) }
  }
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* § 11 (revn 176): the blue side always picks first, so no separate "first pick" tile. */}
      <AnalystTile label={t('analyst.draftLog.summary.blueFirstPick')} {...rate(summary.blue)} />
      <AnalystTile label={t('analyst.draftLog.summary.red')} {...rate(summary.red)} />
      {/* Our B1 / R1's win rate, only on drafts whose pick order is typed; without any, « — » and an invite. */}
      {summary.ourFirstPick
        ? <AnalystTile label={t('analyst.draftLog.summary.firstPicked')} {...rate(summary.ourFirstPick)}
            foot={t('analyst.draftLog.summary.firstPickedFoot', { count: summary.ourFirstPick.games })} />
        : <AnalystTile label={t('analyst.draftLog.summary.firstPicked')} value="—" valueClass="text-hextech-text-dim"
            foot={t('analyst.draftLog.summary.firstPickedNone')} />}
      <div className={cn(analystPanel, 'p-4')}>
        <p className="mb-2 text-xs font-medium text-hextech-text">{t('analyst.draftLog.summary.bannedAgainst')}</p>
        <div className="flex items-center gap-3">
          {summary.bannedAgainstUs.slice(0, 3).map((b) => (
            <span key={b.champion} className="flex items-center gap-1 font-mono text-xs text-hextech-text-bright">
              <ChampIcon championKey={b.champion} size={28} />×{b.count}
            </span>
          ))}
          {summary.bannedAgainstUs.length === 0 && <span className="text-xs text-hextech-text-dim">—</span>}
        </div>
      </div>
    </div>
  )
}

// ── 2. Table ─────────────────────────────────────────────────────────────────

function Bans({ bans }: { bans: string[] | null }) {
  const { t } = useTranslation()
  if (!bans || bans.length === 0) {
    return <span className="font-mono text-hextech-text-dim" title={t('analyst.draftLog.noBans')} aria-label={t('analyst.draftLog.noBans')}>—</span>
  }
  return <span className="flex gap-0.5">{bans.map((c, i) => <ChampIcon key={c + i} championKey={c} size={24} banned />)}</span>
}

function Picks({ picks }: { picks: DraftPick[] }) {
  return <span className="flex gap-1">{picks.map((p, i) => <ChampIcon key={p.champion + i} championKey={p.champion} size={28} role={p.role ? ROLE_SHORT[p.role] : undefined} />)}</span>
}

export function DraftLogTable({ rows, selectedId, onSelect, onOpenOpponent }: {
  rows: DraftLogEntry[]
  selectedId: string | null
  onSelect?: (id: string) => void
  onOpenOpponent?: (opponentKey: string) => void
}) {
  const { t, i18n } = useTranslation()
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })
  return (
    <div className={cn(analystPanel, 'overflow-x-auto')}>
      <table className="w-full min-w-[900px] text-xs">
        <thead>
          <tr className="border-b border-hextech-border-dim text-left text-hextech-text-dim">
            {(['date', 'opponent', 'side', 'ourBans', 'ourPicks', 'theirPicks', 'theirBans', 'result'] as const).map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap px-2 py-2 font-medium">{t(`analyst.draftLog.cols.${c}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={onSelect ? () => onSelect(r.id) : undefined}
              className={cn('border-b border-hextech-border-dim/40 transition-colors hover:bg-hextech-elevated', onSelect && 'cursor-pointer', selectedId === r.id && 'bg-hextech-elevated')}
            >
              <td className="whitespace-nowrap px-2 py-1.5 font-mono text-hextech-text">
                {onSelect ? (
                  // The row opens the detail; this button keeps it reachable from the keyboard.
                  <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(r.id) }} aria-expanded={selectedId === r.id}
                    aria-label={t('analyst.draftLog.rowLabel', {
                      date: date(r.playedAt),
                      opponent: r.opponentName ?? t('analyst.common.unknownOpponent'),
                      result: r.win === null ? t('analyst.draftLog.manual.noResult') : t(r.win ? 'analyst.common.win' : 'analyst.common.loss'),
                    })}
                    className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
                    {date(r.playedAt)}
                  </button>
                ) : date(r.playedAt)}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">
                {r.opponentKey && onOpenOpponent ? (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onOpenOpponent(r.opponentKey!) }}
                    className="text-left text-hextech-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
                    {r.opponentName ?? r.opponentKey}
                  </button>
                ) : <span className="text-hextech-text-bright">{r.opponentName ?? t('analyst.common.unknownOpponent')}</span>}
              </td>
              <td className="px-2 py-1.5"><SidePill side={r.side} /></td>
              <td className="px-2 py-1.5"><Bans bans={r.ourBans} /></td>
              <td className="px-2 py-1.5"><Picks picks={r.ourPicks} /></td>
              <td className="px-2 py-1.5"><Picks picks={r.theirPicks} /></td>
              <td className="px-2 py-1.5"><Bans bans={r.theirBans} /></td>
              <td className="px-2 py-1.5">
                <span className="flex items-center gap-1.5"><ResultBadge win={r.win} />{r.durationSec != null && <span className="font-mono text-hextech-text-dim">{clock(r.durationSec)}</span>}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DraftLogTableSkeleton() {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t('common.loading')} className={cn(analystPanel, 'space-y-2 p-3')}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-24" />
          {Array.from({ length: 10 }, (_, j) => <Skeleton key={j} className="h-7 w-7 rounded-full" />)}
          <Skeleton className="ml-auto h-4 w-14" />
        </div>
      ))}
    </div>
  )
}

// ── Detail panel ─────────────────────────────────────────────────────────────

export function DraftDetailPanel({ entry, canEdit, onClose, onSaveNotes, onSavePickOrder, onOpenStats, onOpenVod, onOpenInPrep }: {
  entry: DraftLogEntry
  canEdit: boolean
  onClose: () => void
  onSaveNotes?: (notes: string | null) => void
  /** § 11: the staff types the pick order (null removes it). */
  onSavePickOrder?: (pickOrder: string[] | null) => void
  onOpenStats?: () => void
  onOpenVod?: () => void
  onOpenInPrep?: () => void
}) {
  const { t } = useTranslation()
  const [notes, setNotes] = useState(entry.notes ?? '')
  return (
    <aside aria-label={t('analyst.draftLog.detail.title')} className={cn(analystPanel, 'w-full space-y-4 p-4 xl:w-[360px] xl:shrink-0')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-hextech-text-bright">{t('analyst.draftLog.detail.vs', { name: entry.opponentName ?? t('analyst.common.unknownOpponent') })}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs"><SidePill side={entry.side} /><ResultBadge win={entry.win} /></p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded p-1 text-hextech-text-dim hover:text-hextech-text-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-hextech-text">{t('analyst.draftLog.detail.pickOrder')}</p>
        {canEdit && onSavePickOrder
          ? <PickOrderEditor key={(entry.pickOrder ?? []).join('|')} entry={entry} onSave={onSavePickOrder} />
          : entry.pickOrder?.length
          ? <ol className="flex flex-wrap gap-1">{entry.pickOrder.map((c, i) => (
              <li key={i} className="flex items-center gap-1 font-mono text-[10px] text-hextech-text-dim">
                {PICK_SEQUENCE[i] ?? i + 1}<ChampIcon championKey={c} size={22} />
              </li>
            ))}</ol>
          : <p className="text-xs text-hextech-text-dim">{t('analyst.draftLog.detail.pickOrderUnknown')}</p>}
      </div>
      <div>
        <label htmlFor={`draft-notes-${entry.id}`} className="mb-1 block text-xs font-medium text-hextech-text">{t('analyst.draftLog.detail.notes')}</label>
        {canEdit ? (
          <Textarea id={`draft-notes-${entry.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={2000}
            onBlur={() => notes !== (entry.notes ?? '') && onSaveNotes?.(notes.trim() ? notes : null)} placeholder={t('analyst.draftLog.detail.notesPlaceholder')} />
        ) : <p id={`draft-notes-${entry.id}`} className="whitespace-pre-wrap text-xs text-hextech-text">{entry.notes || '—'}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {onOpenStats && entry.matchId && <Button variant="outline" size="sm" className="gap-1.5" onClick={onOpenStats}><BarChart3 className="h-3.5 w-3.5" />{t('analyst.draftLog.detail.stats')}</Button>}
        {onOpenVod && entry.matchId && <Button variant="outline" size="sm" className="gap-1.5" onClick={onOpenVod}><Film className="h-3.5 w-3.5" />{t('analyst.draftLog.detail.vod')}</Button>}
        {canEdit && onOpenInPrep && <Button size="sm" className="gap-1.5" onClick={onOpenInPrep}><ClipboardCopy className="h-3.5 w-3.5" />{t('analyst.draftLog.detail.openInPrep')}</Button>}
      </div>
    </aside>
  )
}

// ── 3. Champions ─────────────────────────────────────────────────────────────

function ChampionList({ title, rows }: { title: string; rows: DraftChampionRow[] }) {
  const { t } = useTranslation()
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium text-hextech-text">{title}</h4>
      {rows.length === 0 ? <p className="text-xs text-hextech-text-dim">—</p> : (
        <ul className="space-y-1">
          {[...rows].sort((a, b) => b.games - a.games).map((c) => {
            const p = pctOf(c.winRate)
            return (
              <li key={c.champion} className="flex items-center gap-2 text-xs">
                <ChampIcon championKey={c.champion} size={22} />
                <span className="min-w-0 flex-1 truncate text-hextech-text-bright">{c.champion}{c.role && <span className="ml-1 text-hextech-text-dim">· {ROLE_SHORT[c.role] ?? c.role}</span>}</span>
                <span className="font-mono text-hextech-text-dim">{t('analyst.common.games', { count: c.games })}</span>
                <span className={cn('w-10 text-right font-mono font-semibold', p == null ? 'text-hextech-text-dim' : wrText(p, c.games))}>{p == null ? '—' : `${p} %`}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function DraftChampionsCard({ summary }: { summary: Pick<DraftLogSummary, 'ourPicks' | 'theirPicks'> }) {
  const { t } = useTranslation()
  return (
    <section className={cn(analystPanel, 'grid gap-6 p-4 md:grid-cols-2')} aria-label={t('analyst.draftLog.champions.title')}>
      <ChampionList title={t('analyst.draftLog.champions.ours')} rows={summary.ourPicks} />
      <ChampionList title={t('analyst.draftLog.champions.theirs')} rows={summary.theirPicks} />
    </section>
  )
}

// ── The sub-tab, with its states ─────────────────────────────────────────────

export type DraftLogState = { kind: 'loading' } | { kind: 'error'; cause: string } | { kind: 'ready'; entries: DraftLogEntry[] }

export function DraftLogView({ state, canEdit, onRetry, onAddManual, onOpenOpponent, onSaveNotes, onSavePickOrder, onOpenInPrep, onOpenStats, onOpenVod }: {
  state: DraftLogState
  canEdit: boolean
  onRetry?: () => void
  onAddManual?: () => void
  onOpenOpponent?: (opponentKey: string) => void
  onSaveNotes?: (id: string, notes: string | null) => void
  onSavePickOrder?: (id: string, pickOrder: string[] | null) => void
  onOpenInPrep?: (entry: DraftLogEntry) => void
  onOpenStats?: (entry: DraftLogEntry) => void
  onOpenVod?: (entry: DraftLogEntry) => void
}) {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<DraftLogFilters>(DEFAULT_DRAFT_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (state.kind === 'loading') return <DraftLogTableSkeleton />
  if (state.kind === 'error') return <ErrorState title={t('analyst.draftLog.error')} cause={state.cause} onRetry={onRetry} />
  if (state.entries.length === 0) {
    return (
      <EmptyState icon={BookOpen} title={t('analyst.draftLog.empty.title')} description={t('analyst.draftLog.empty.desc')}
        action={canEdit && onAddManual ? { label: t('analyst.draftLog.empty.addManual'), onClick: onAddManual, icon: Plus } : undefined} />
    )
  }
  const shown = filterDrafts(state.entries, filters)
  const summary = summarizeDrafts(shown)
  const selected = shown.find((r) => r.id === selectedId) ?? null
  return (
    <div className="space-y-4">
      <DraftLogFiltersBar entries={state.entries} value={filters} onChange={setFilters} summary={summary} />
      <DraftSummaryTiles summary={summary} />
      {shown.length === 0 ? (
        <EmptyState icon={FilterX} title={t('analyst.draftLog.noMatch.title')}
          action={{ label: t('analyst.draftLog.noMatch.clear'), onClick: () => setFilters(DEFAULT_DRAFT_FILTERS), icon: FilterX }} />
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            <DraftLogTable rows={shown} selectedId={selectedId} onSelect={(id) => setSelectedId(id === selectedId ? null : id)} onOpenOpponent={onOpenOpponent} />
          </div>
          {selected && (
            <DraftDetailPanel key={selected.id} entry={selected} canEdit={canEdit} onClose={() => setSelectedId(null)}
              onSaveNotes={onSaveNotes ? (n) => onSaveNotes(selected.id, n) : undefined}
              onSavePickOrder={onSavePickOrder ? (o) => onSavePickOrder(selected.id, o) : undefined}
              onOpenInPrep={onOpenInPrep ? () => onOpenInPrep(selected) : undefined}
              onOpenStats={onOpenStats ? () => onOpenStats(selected) : undefined}
              onOpenVod={onOpenVod ? () => onOpenVod(selected) : undefined} />
          )}
        </div>
      )}
      <DraftChampionsCard summary={summary} />
    </div>
  )
}
