/**
 * Pieces of the Champion Pool board (Penpot "Équipe — Champion Pool v2"):
 * the player selector, the pool header, the share of games per champion,
 * one lane per tier with its champion tiles, the folded Learning lane and
 * the "add a champion" dialog. Assembled by ChampPoolTab.tsx; the numbers
 * come from src/lib/poolView.ts, the tier rules from src/lib/threatCore.ts.
 */
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import type { MemberLook } from '@/lib/collab'
import type { ChampionPoolEntry, TeamMember } from '@/lib/ipc'
import { iconUrl } from '@/lib/profile'
import { initialsOf, type Look } from '@/lib/playerCard'
import {
  MANUAL_TIERS,
  TIER_COLOR,
  gamesOf,
  inactiveDays,
  newSinceDays,
  ruleTierIfHandPicked,
  tierOf,
  type PoolSummary,
} from '@/lib/poolView'
import type { Tier } from '@/lib/threatCore'
import { cn } from '@/lib/utils'
import { RenamedHint } from '@/components/team/RenamedNote'
import { wrBar } from '@/lib/winrate'
import { ROLES, type Role } from '@/lib/championRoles'

export const POOL_ROLES = ROLES
export const isPoolRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r)

/** Looks the members of my cloud groups shared (empty when signed out or on
 *  a build without the call). */
export function useMemberLooks(): MemberLook[] {
  const [looks, setLooks] = useState<MemberLook[]>([])
  useEffect(() => {
    let alive = true
    window.api.collabListMemberLooks?.()
      .then((l) => { if (alive) setLooks(Array.isArray(l) ? l : []) })
      .catch(() => { /* signed out or offline: initials */ })
    return () => { alive = false }
  }, [])
  return looks
}

/** "3 main · 1 new · 5 comfort" — tier names stay in English, like the pills. */
export function countsLabel(counts: Record<Tier, number>): string {
  return (['main', 'new', 'comfort'] as Tier[])
    .filter((t) => counts[t] > 0)
    .map((t) => `${counts[t]} ${t}`)
    .join(' · ')
}

// ── Player selector ─────────────────────────────────────────────────────────

export function PlayerSelector({ members, selectedId, onSelect, lookOf, countsOf }: {
  members: TeamMember[]
  selectedId: string | null
  onSelect: (id: string) => void
  lookOf: (m: TeamMember) => Look | null
  /** Tier counts line, or null when nothing was fetched for the member yet. */
  countsOf: (m: TeamMember) => string | null
}) {
  const { t } = useTranslation()
  return (
    <div role="tablist" aria-label={t('team.pool.player')} className="grid grid-cols-[repeat(auto-fit,minmax(172px,1fr))] gap-3">
      {members.map((m) => {
        const on = m.id === selectedId
        const look = lookOf(m)
        const role = (m.role || '').toUpperCase()
        const counts = countsOf(m)
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={on}
            title={`${m.displayName} · ${counts ?? t('team.pool.board.notFetched')}`}
            onClick={() => onSelect(m.id)}
            className={cn(
              'flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold',
              on ? 'border-hextech-gold bg-hextech-elevated' : 'panel-surface border-hextech-border-dim hover:border-hextech-border',
            )}
          >
            {look?.iconId ? (
              <img
                src={iconUrl(look.iconId)}
                alt=""
                draggable={false}
                className={cn('h-11 w-11 shrink-0 rounded-full border-2 border-hextech-black object-cover ring-2', on ? 'ring-hextech-gold' : 'ring-hextech-border')}
              />
            ) : (
              <span
                aria-hidden
                className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hextech-elevated font-display text-lg text-hextech-text-bright ring-2',
                  on ? 'ring-hextech-gold' : 'ring-hextech-border',
                )}
              >
                {initialsOf(m.displayName)}
              </span>
            )}
            <span className="min-w-0">
              <span className="flex items-baseline gap-2">
                <span className={cn('truncate font-display text-lg uppercase leading-none', on ? 'text-hextech-text-bright' : 'text-hextech-text')}>
                  {m.displayName}
                </span>
                {isPoolRole(role) && (
                  <span className={cn('shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wider', on ? 'text-hextech-gold' : 'text-hextech-text-dim')}>
                    {t(`team.pool.board.role.${role}`)}
                  </span>
                )}
              </span>
              <span className="mt-1 block truncate font-mono text-[10px] text-hextech-text-dim">
                {counts ?? t('team.pool.board.notFetched')}
              </span>
              <RenamedHint member={m} className="mt-0.5" />
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Pool header ─────────────────────────────────────────────────────────────

export function PoolHeader({ title, summary, children }: {
  title: string
  summary: PoolSummary
  /** Action buttons, right-aligned. */
  children: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const updated = useMemo(() => {
    if (summary.updatedAt == null) return null
    const days = Math.floor((Date.now() - summary.updatedAt) / 86_400_000)
    return new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(-Math.max(0, days), 'day')
  }, [summary.updatedAt, i18n.language])
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="truncate text-3xl leading-none text-hextech-text-bright">{title}</h2>
        <p className="mt-2 font-mono text-[11px] text-hextech-text-dim">
          {summary.fetched
            ? [t('team.pool.board.analysed', { count: summary.games }), updated && t('team.pool.board.updated', { when: updated })].filter(Boolean).join(' · ')
            : t('team.pool.board.notFetchedLong')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

// ── Share of games per champion ─────────────────────────────────────────────

export function GamesDistribution({ summary, nameOf }: { summary: PoolSummary; nameOf: (key: string) => string }) {
  const { t } = useTranslation()
  if (summary.games === 0) return null
  const pct = (share: number) => Math.round(share * 100)
  return (
    <Card className="space-y-2.5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-hextech-text-dim">{t('team.pool.board.distribution')}</p>
        {summary.segments.length > 3 && (
          <p className="font-mono text-[10px] font-semibold text-hextech-text">{t('team.pool.board.top3', { pct: pct(summary.top3Share) })}</p>
        )}
      </div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded" role="img" aria-label={t('team.pool.board.distribution')}>
        {summary.segments.map((s) => (
          <span
            key={s.entry.id}
            title={`${nameOf(s.entry.championKey)} · ${t('team.pool.board.gamesShort', { count: s.games })} · ${pct(s.share)} %`}
            className="h-full min-w-[3px] basis-0 first:rounded-l last:rounded-r"
            style={{ flexGrow: s.games, backgroundColor: TIER_COLOR[s.tier] }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {(Object.keys(summary.tierShare) as Tier[]).filter((tier) => summary.tierShare[tier] > 0).map((tier) => (
          <li key={tier} className="flex items-center gap-1.5 text-[11px]">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: TIER_COLOR[tier] }} />
            <span className="font-semibold capitalize text-hextech-text">{tier}</span>
            <span className="font-mono text-[10px] text-hextech-text-dim">{pct(summary.tierShare[tier])} %</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ── Tier menu (click on a tile, or on a champion in the add dialog) ─────────

function TierMenu({ current, onPick, onRemove, onClose, className }: {
  current?: Tier
  onPick: (tier: Tier) => void
  onRemove?: () => void
  onClose: () => void
  className?: string
}) {
  const { t } = useTranslation()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- event barrier only: keeps clicks inside the menu from reaching the click-away backdrop. */}
      <div
        role="menu"
        tabIndex={-1}
        className={cn('absolute z-40 flex min-w-[150px] flex-col gap-px rounded-md border border-hextech-border bg-hextech-dark p-1 shadow-2xl', className)}
        onClick={(e) => e.stopPropagation()}
      >
        {MANUAL_TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            role="menuitemradio"
            aria-checked={current === tier}
            onClick={() => onPick(tier)}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-hextech-text hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TIER_COLOR[tier] }} />
            <span className="flex-1" style={current === tier ? { color: TIER_COLOR[tier] } : undefined}>{tier}</span>
            {current === tier && <Check className="h-3 w-3" style={{ color: TIER_COLOR[tier] }} />}
          </button>
        ))}
        {onRemove && (
          <button
            type="button"
            role="menuitem"
            onClick={onRemove}
            className="mt-1 flex items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-red-300 hover:bg-red-500/20 focus-visible:bg-red-500/20 focus-visible:outline-none"
          >
            <Trash2 className="h-3 w-3" />
            {t('team.pool.board.remove')}
          </button>
        )}
      </div>
    </>
  )
}

// ── Champion tile ───────────────────────────────────────────────────────────

function Badge({ color, children, title }: { color: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center truncate rounded border px-1.5 font-mono text-[9px] font-semibold uppercase leading-4 tracking-wide"
      style={{ color, borderColor: `${color}99`, backgroundColor: `${color}1F` }}
    >
      {children}
    </span>
  )
}

function ChampionTile({ entry, name, latestPlay, onMove, onRemove, onDragStart, onDragEnd }: {
  entry: ChampionPoolEntry
  name: string
  latestPlay: number | null
  onMove: (tier: Tier) => void
  onRemove: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const { t, i18n } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const icon = useChampionIconUrl(entry.championKey)
  const tier = tierOf(entry)
  const color = TIER_COLOR[tier]
  const games = gamesOf(entry)
  const fromRiot = entry.playRate != null
  const kda = entry.kda != null
    ? new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(entry.kda)
    : null
  const mastery = entry.masteryPoints ? Math.round(entry.masteryPoints / 1000) : null
  const stats = !fromRiot
    ? t('team.pool.board.manual')
    : games > 0 && entry.winRate != null
      ? kda
        ? t('team.pool.board.stats', { games, wr: entry.winRate, kda })
        : t('team.pool.board.statsNoKda', { games, wr: entry.winRate })
      : mastery
        ? t('team.pool.board.masteryOnly', { k: mastery })
        : t('team.pool.board.gamesShort', { count: games })
  const since = newSinceDays(entry)
  const idle = tier === 'main' || tier === 'comfort' ? inactiveDays(entry, latestPlay) : null
  const ruleTier = ruleTierIfHandPicked(entry)
  const wins = games > 0 && entry.winRate != null ? Math.round((games * entry.winRate) / 100) : null
  const details = [
    name,
    wins != null ? t('team.pool.board.record', { wins, losses: games - wins }) : null,
    mastery ? t('team.pool.board.masteryLine', { k: mastery }) : null,
    ruleTier ? t('team.pool.handPicked', { tier: ruleTier }) : null,
    t('team.pool.board.tileHint'),
  ].filter(Boolean).join('\n')

  return (
    <li className="relative min-w-0">
      <button
        type="button"
        draggable
        onDragStart={(e: DragEvent) => { e.dataTransfer.setData('text/plain', entry.id); e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
        onDragEnd={onDragEnd}
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={details}
        className="flex w-full cursor-grab items-center gap-3 rounded-lg border border-hextech-border-dim bg-hextech-elevated/70 p-3 text-left transition-colors hover:border-hextech-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold active:cursor-grabbing"
      >
        {icon ? (
          <img src={icon} alt="" draggable={false} className="h-12 w-12 shrink-0 rounded-md border-2 object-cover" style={{ borderColor: color }} />
        ) : (
          <span className="h-12 w-12 shrink-0 rounded-md border-2 bg-hextech-black/40" style={{ borderColor: color }} />
        )}
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-hextech-text-bright">{name}</span>
            {ruleTier && <Badge color="#E4C285" title={t('team.pool.handPicked', { tier: ruleTier })}>{t('team.pool.board.handPickedBadge')}</Badge>}
          </span>
          <span className="block truncate font-mono text-[11px] text-hextech-text">{stats}</span>
          {games > 0 && entry.winRate != null && (
            <span className="block h-1 overflow-hidden rounded-full bg-hextech-border-dim">
              <span className={cn('block h-full rounded-full', wrBar(entry.winRate, games))} style={{ width: `${Math.min(100, entry.winRate)}%` }} />
            </span>
          )}
          {(since != null || idle != null) && (
            <span className="flex min-w-0 flex-wrap gap-1">
              {since != null && <Badge color={TIER_COLOR.new}>{t('team.pool.board.newBadge', { games, days: since })}</Badge>}
              {idle != null && <Badge color={TIER_COLOR.learning}>{t('team.pool.board.inactiveBadge', { days: idle })}</Badge>}
            </span>
          )}
        </span>
      </button>
      {menuOpen && (
        <TierMenu
          className="left-3 top-full mt-1"
          current={tier}
          onPick={(next) => { setMenuOpen(false); if (next !== tier) onMove(next) }}
          onRemove={() => { setMenuOpen(false); onRemove() }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </li>
  )
}

// ── Tier lanes ──────────────────────────────────────────────────────────────

interface LaneProps {
  tier: Tier
  entries: ChampionPoolEntry[]
  nameOf: (key: string) => string
  latestPlay: number | null
  /** A tile is being dragged: lanes that can take it light up. */
  dragging: boolean
  onDropEntry: (entryId: string, tier: Tier) => void
  onMove: (entry: ChampionPoolEntry, tier: Tier) => void
  onRemove: (entry: ChampionPoolEntry) => void
  onDragStart: (entryId: string) => void
  onDragEnd: () => void
}

function useDropTarget(tier: Tier, onDropEntry: LaneProps['onDropEntry']) {
  const [over, setOver] = useState(false)
  const droppable = MANUAL_TIERS.includes(tier)
  return {
    over: droppable && over,
    handlers: droppable
      ? {
          onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true) },
          onDragLeave: () => setOver(false),
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            setOver(false)
            const id = e.dataTransfer.getData('text/plain')
            if (id) onDropEntry(id, tier)
          },
        }
      : {},
  }
}

function TileGrid({ entries, nameOf, latestPlay, onMove, onRemove, onDragStart, onDragEnd }: Omit<LaneProps, 'tier' | 'dragging' | 'onDropEntry'>) {
  return (
    <ul className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start gap-2.5">
      {entries.map((e) => (
        <ChampionTile
          key={e.id}
          entry={e}
          name={nameOf(e.championKey)}
          latestPlay={latestPlay}
          onMove={(tier) => onMove(e, tier)}
          onRemove={() => onRemove(e)}
          onDragStart={() => onDragStart(e.id)}
          onDragEnd={onDragEnd}
        />
      ))}
    </ul>
  )
}

export function TierLane(props: LaneProps) {
  const { t } = useTranslation()
  const { tier, entries, dragging, onDropEntry } = props
  const { over, handlers } = useDropTarget(tier, onDropEntry)
  const color = TIER_COLOR[tier]
  const droppable = MANUAL_TIERS.includes(tier)
  return (
    <section
      aria-label={tier}
      {...handlers}
      className={cn(
        'panel-surface flex flex-col gap-5 rounded-lg border p-4 transition-colors md:flex-row',
        over ? 'border-hextech-gold' : dragging && droppable ? 'border-hextech-border' : 'border-hextech-border-dim',
      )}
    >
      <header className="shrink-0 md:w-[200px]">
        <span className="block h-[3px] w-7 rounded" style={{ backgroundColor: color }} />
        <Tooltip>
          <TooltipTrigger asChild>
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable so keyboard users can open the tier tooltip. */}
            <h3 tabIndex={0} className="mt-2 w-fit cursor-help text-2xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold" style={{ color }}>
              {tier}
            </h3>
          </TooltipTrigger>
          <TooltipContent side="right" align="start" className="max-w-xs px-3 py-2 leading-relaxed">
            {t(`team.pool.tierHelp.${tier}`)}
          </TooltipContent>
        </Tooltip>
        <p className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-hextech-text-dim">
          {t('team.pool.board.champions', { count: entries.length })}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-hextech-text-dim">{t(`team.pool.board.rule.${tier}`)}</p>
      </header>
      {entries.length > 0 ? (
        <TileGrid {...props} />
      ) : (
        <p className="flex min-h-[4.5rem] flex-1 items-center justify-center rounded-lg border border-dashed border-hextech-border-dim px-4 text-center text-xs text-hextech-text-dim">
          {droppable ? t('team.pool.board.emptyLane') : t('team.pool.board.emptyNew')}
        </p>
      )}
    </section>
  )
}

export function LearningLane(props: Omit<LaneProps, 'tier'>) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { over, handlers } = useDropTarget('learning', props.onDropEntry)
  const color = TIER_COLOR.learning
  return (
    <section
      aria-label="learning"
      {...handlers}
      className={cn(
        'panel-surface rounded-lg border px-4 py-3 transition-colors',
        over ? 'border-hextech-gold' : props.dragging ? 'border-hextech-border' : 'border-hextech-border-dim',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-[18px] w-[3px] shrink-0 rounded" style={{ backgroundColor: color }} />
          <Tooltip>
            <TooltipTrigger asChild>
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable so keyboard users can open the tier tooltip. */}
              <h3 tabIndex={0} className="cursor-help text-xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold" style={{ color }}>
                learning
              </h3>
            </TooltipTrigger>
            <TooltipContent side="right" align="start" className="max-w-xs px-3 py-2 leading-relaxed">
              {t('team.pool.tierHelp.learning')}
            </TooltipContent>
          </Tooltip>
          <p className="min-w-0 text-xs text-hextech-text-dim">{t('team.pool.board.learningSummary', { count: props.entries.length })}</p>
        </div>
        {props.entries.length > 0 && (
          <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? t('team.pool.board.hide') : t('team.pool.board.show')}
          </Button>
        )}
      </div>
      {open && props.entries.length > 0 && (
        <div className="mt-3 flex">
          <TileGrid {...props} />
        </div>
      )}
    </section>
  )
}

// ── Add a champion ──────────────────────────────────────────────────────────

function PickableChampion({ champion, entry, onPick, onRemove }: {
  champion: { key: string; name: string }
  entry?: ChampionPoolEntry
  onPick: (tier: Tier) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const icon = useChampionIconUrl(champion.key)
  const tier = entry ? tierOf(entry) : undefined
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={tier ? `${champion.name} (${tier})` : champion.name}
        className="flex w-full flex-col items-center gap-1 rounded-md p-1 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold"
      >
        <span className="relative block aspect-square w-full overflow-hidden rounded-md border-2" style={{ borderColor: tier ? TIER_COLOR[tier] : 'transparent' }}>
          {icon && <img src={icon} alt="" draggable={false} className="h-full w-full object-cover" />}
          {tier && (
            <span className="absolute right-0.5 top-0.5 rounded px-1 font-mono text-[8px] font-bold uppercase leading-tight text-hextech-black" style={{ backgroundColor: TIER_COLOR[tier] }}>
              {tier[0]}
            </span>
          )}
        </span>
        <span className="w-full truncate text-center text-[10px] text-hextech-text">{champion.name}</span>
      </button>
      {open && (
        <TierMenu
          className="left-1/2 top-full mt-1 -translate-x-1/2"
          current={tier}
          onPick={(next) => { setOpen(false); onPick(next) }}
          onRemove={entry ? () => { setOpen(false); onRemove() } : undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

export function AddChampionDialog({ open, onOpenChange, memberName, champions, loading, entryOf, onPick, onRemove }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  memberName: string
  champions: { key: string; name: string }[]
  loading: boolean
  entryOf: (championKey: string) => ChampionPoolEntry | undefined
  onPick: (championKey: string, tier: Tier) => void
  onRemove: (entry: ChampionPoolEntry) => void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [poolOnly, setPoolOnly] = useState(false)
  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return champions.filter((c) => (!q || c.name.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)) && (!poolOnly || !!entryOf(c.key)))
  }, [champions, search, poolOnly, entryOf])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('team.pool.board.addTitle', { name: memberName })}</DialogTitle>
          <DialogDescription>{t('team.pool.board.addHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">{t('team.pool.searchPlaceholder')}</span>
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-hextech-text-dim" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('team.pool.searchPlaceholder')}
              className="w-full rounded border border-hextech-border bg-hextech-dark py-1.5 pl-7 pr-7 text-sm"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label={t('team.pool.board.clearSearch')} className="absolute right-2 top-1/2 -translate-y-1/2 text-hextech-text-dim hover:text-hextech-text-bright">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-hextech-text-dim">
            <input type="checkbox" checked={poolOnly} onChange={(e) => setPoolOnly(e.target.checked)} className="accent-hextech-gold" />
            {t('team.pool.showPicked')}
          </label>
        </div>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {loading && <p className="text-sm italic text-hextech-text-dim">{t('common.loading')}</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1.5">
            {list.map((c) => {
              const entry = entryOf(c.key)
              return (
                <PickableChampion
                  key={c.key}
                  champion={c}
                  entry={entry}
                  onPick={(tier) => onPick(c.key, tier)}
                  onRemove={() => { if (entry) onRemove(entry) }}
                />
              )
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

