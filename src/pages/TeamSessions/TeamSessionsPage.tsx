import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronRight, Filter, Hourglass, Loader2 } from 'lucide-react'
import { NoGroupNotice, TeamSectionHeader, useTeamSection } from '@/components/team/TeamSection'
import { Segmented } from '@/components/analyst/shared'
import { EmptyState, ErrorState } from '@/components/ui/data-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { KIND_STYLE } from '@/lib/planningView'
import { wrText } from '@/lib/winrate'
import { isServerNotReadyError } from '@/lib/matchEventView'
import { formatPlayed, groupByWeek, type WeekGroup } from '@/lib/teamSessionHistoryView'
import { initialsOf } from '@/lib/playerCard'
import { historyApi, type HistoryPeriod, type SessionKind, type TeamSessionHistoryPage, type TeamSessionHistoryRow } from './historyContract'
import { useCachedResource } from '@/hooks/useCachedResource'
import { groupKey } from '@/lib/groupQueries'

export const SESSION_TYPES = ['all', 'flex', 'scrim', 'tournament', 'meeting'] as const
export type SessionTypeFilter = (typeof SESSION_TYPES)[number]
export const SESSION_PERIODS = ['30d', 'season', 'all'] as const satisfies readonly HistoryPeriod[]

/** The list's filters, kept in the URL (`?type=scrim&period=season`). */
function useHistoryFilters(): [{ type: SessionTypeFilter; period: HistoryPeriod }, (patch: Partial<{ type: SessionTypeFilter; period: HistoryPeriod }>) => void] {
  const [params, setParams] = useSearchParams()
  const rawType = params.get('type') as SessionTypeFilter | null
  const rawPeriod = params.get('period') as HistoryPeriod | null
  const type = rawType && SESSION_TYPES.includes(rawType) ? rawType : 'all'
  const period = rawPeriod && (SESSION_PERIODS as readonly string[]).includes(rawPeriod) ? rawPeriod : '30d'
  const set = useCallback((patch: Partial<{ type: SessionTypeFilter; period: HistoryPeriod }>) => {
    setParams((p) => {
      const n = new URLSearchParams(p)
      for (const [k, v] of Object.entries(patch)) {
        if (!v || (k === 'type' && v === 'all') || (k === 'period' && v === '30d')) n.delete(k)
        else n.set(k, v)
      }
      return n
    }, { replace: true })
  }, [setParams])
  return [{ type, period }, set]
}

/** A row's page: by its slot, or by its id when the slot was deleted after the session started. */
export const sessionHref = (row: Pick<TeamSessionHistoryRow, 'sessionId' | 'calendarEventId' | 'eventDeleted'>): string =>
  row.eventDeleted || !row.calendarEventId ? `/team-sessions/${encodeURIComponent(row.sessionId)}` : `/team-session/${encodeURIComponent(row.calendarEventId)}`

const accentOf = (kind: SessionKind) => KIND_STYLE[kind]?.accent ?? KIND_STYLE.other.accent

/**
 * Team sessions history (docs/DESIGN_STATE.md § 15.1), desktop and web: the group's finished team sessions, filtered
 * by type and period, a 4-tile summary, the sessions grouped by week; each row opens the session's page
 * (/team-session/:calendarEventId, § 15.2). Data: teamSessionHistoryList (docs/contracts/team-session-history.md).
 */
export function TeamSessionsPage() {
  const { t } = useTranslation()
  const section = useTeamSection()
  const { available, loading, group } = section
  const [filters, setFilters] = useHistoryFilters()
  const groupId = group?.id ?? null

  const [more, setMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)

  // Perf gain 3: cached per group and filter; coming back shows the list at once and refreshes behind.
  // The method is read inside the fetcher, not held: window.api may hand out a new function on each read.
  const hasList = !!historyApi().teamSessionHistoryList
  const pageQ = useCachedResource<TeamSessionHistoryPage>(
    groupId && hasList ? groupKey(groupId, `sessions:${filters.type}:${filters.period}`) : null,
    () => historyApi().teamSessionHistoryList!(groupId!, { kind: filters.type, period: filters.period }))
  const page = pageQ.data ?? null
  const state: 'loading' | 'ready' | 'error' | 'unavailable' = !hasList ? 'unavailable'
    : moreFailed ? 'error'
    : page ? 'ready'
    : pageQ.failed ? (isServerNotReadyError(pageQ.error) ? 'unavailable' : 'error')
    : 'loading'
  const retry = () => { setMoreFailed(false); void pageQ.load() }

  const loadMore = async () => {
    const list = historyApi().teamSessionHistoryList
    if (!groupId || !page || !list) return
    setMore(true)
    try {
      const last = page.sessions[page.sessions.length - 1]
      const next = await list(groupId, { kind: filters.type, period: filters.period, before: last?.startsAt ?? null })
      pageQ.set({ ...page, sessions: [...page.sessions, ...next.sessions], hasMore: next.hasMore })
    } catch {
      setMoreFailed(true)
    } finally {
      setMore(false)
    }
  }

  const weeks = useMemo(() => (page ? groupByWeek(page.sessions, new Date()) : []), [page])
  const s = page?.summary

  return (
    <div className="w-full space-y-4 py-4">
      <TeamSectionHeader title={t('teamSessions.title')} subtitle={t('teamSessions.subtitle')} section={section} />

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
      ) : !available || !group ? (
        <NoGroupNotice />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label={t('teamSessions.filters.type')}
              value={filters.type}
              onChange={(type) => setFilters({ type })}
              options={SESSION_TYPES.map((id) => ({ id, label: t(`teamSessions.type.${id}`) }))}
            />
            <Segmented
              label={t('teamSessions.filters.period')}
              value={filters.period}
              onChange={(period) => setFilters({ period })}
              options={SESSION_PERIODS.map((id) => ({ id, label: t(`teamSessions.period.${id}`) }))}
            />
            {state === 'ready' && s && s.sessions > 0 && (
              <span className="ml-auto font-mono text-xs text-hextech-text-dim">
                {t('teamSessions.totals', { sessions: s.sessions, games: s.games, wins: s.wins, losses: s.losses })}
              </span>
            )}
          </div>

          {state === 'unavailable' ? (
            <EmptyState icon={Hourglass} title={t('analyst.common.notDeployedTitle')} description={t('teamSessions.notDeployed')} />
          ) : state === 'error' ? (
            <ErrorState title={t('teamSessions.loadFailed')} cause={t('teamSessions.loadFailedCause')} onRetry={retry} />
          ) : state === 'loading' || !page || !s ? (
            <ListSkeleton />
          ) : s.sessions === 0 ? (
            filters.type !== 'all' ? (
              <EmptyState icon={Filter} title={t('teamSessions.emptyType.title')}
                action={{ label: t('teamSessions.emptyType.showAll'), onClick: () => setFilters({ type: 'all' }) }} />
            ) : (
              <div className="rounded-lg border border-hextech-border-dim bg-hextech-dark/40 p-8 text-center">
                <CalendarDays className="mx-auto mb-2 h-6 w-6 text-hextech-gold" aria-hidden />
                <p className="text-sm text-hextech-text-bright">{t('teamSessions.empty.title')}</p>
                <p className="mt-1 text-xs text-hextech-text-dim">{t('teamSessions.empty.hint')}</p>
                <Link to="/management?tab=planning" className="mt-3 inline-block text-sm font-medium text-hextech-gold hover:text-hextech-gold-bright">
                  {t('teamSessions.empty.openPlanning')}
                </Link>
              </div>
            )
          ) : (
            <>
              {filters.type === 'meeting' ? <MeetingTiles summary={s} /> : <SummaryTiles summary={s} />}
              <div className="space-y-5">
                {weeks.map((w) => <WeekBlock key={w.start.toISOString()} week={w} />)}
              </div>
              {page.hasMore && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" disabled={more} onClick={() => { void loadMore() }}>
                    {more && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    {t('teamSessions.showOlder')}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy>
      {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-[68px] animate-pulse rounded-lg bg-hextech-elevated/60" />)}
    </div>
  )
}

function Tile({ label, value, foot, valueClass }: { label: string; value: string; foot?: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-hextech-border-dim bg-hextech-dark/50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{label}</p>
      <p className={cn('mt-1 font-display text-2xl text-hextech-text-bright tabular-nums', valueClass)}>{value}</p>
      {foot && <p className="mt-0.5 text-xs text-hextech-text-dim">{foot}</p>}
    </div>
  )
}

function SummaryTiles({ summary: s }: { summary: TeamSessionHistoryPage['summary'] }) {
  const { t } = useTranslation()
  const kinds = [
    s.byKind.scrim ? t('teamSessions.tiles.scrims', { count: s.byKind.scrim }) : null,
    s.byKind.tournament ? t('teamSessions.tiles.tournaments', { count: s.byKind.tournament }) : null,
  ].filter(Boolean).join(', ')
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label={t('teamSessions.tiles.sessions')} value={String(s.sessions)} foot={kinds ? t('teamSessions.tiles.including', { list: kinds }) : undefined} />
      <Tile
        label={t('teamSessions.tiles.winRate')}
        value={s.winRate == null ? '—' : `${Math.round(s.winRate)} %`}
        valueClass={s.winRate == null ? undefined : wrText(s.winRate, s.games)}
        foot={t('teamSessions.tiles.record', { wins: s.wins, losses: s.losses })}
      />
      <Tile
        label={t('teamSessions.tiles.objectives')}
        value={s.objectivesTotal ? t('teamSessions.tiles.objectivesValue', { held: s.objectivesHeld, total: s.objectivesTotal }) : '—'}
        valueClass={s.objectivesTotal ? wrText((s.objectivesHeld / s.objectivesTotal) * 100, s.objectivesTotal) : undefined}
        foot={s.objectivesTotal && s.objectivesHeld === 0 ? t('teamSessions.tiles.noVerdict') : undefined}
      />
      <Tile
        label={t('teamSessions.tiles.reviews')}
        value={`${s.reviewed} / ${s.sessions}`}
        foot={s.withoutReview ? t('teamSessions.tiles.withoutReview', { count: s.withoutReview }) : undefined}
      />
    </div>
  )
}

function WeekBlock({ week }: { week: WeekGroup<TeamSessionHistoryRow> }) {
  const { t, i18n } = useTranslation()
  // « 17 – 23 nov. » / « Nov 17 – 23 », the month once when both days share it.
  // formatRange is in every Chromium the app runs on, not yet in this TypeScript lib.
  const fmt = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }) as Intl.DateTimeFormat & { formatRange: (a: Date, b: Date) => string }
  const range = fmt.formatRange(week.start, week.end)
  const title = week.weeksAgo === 0 ? t('teamSessions.week.this') : week.weeksAgo === 1 ? t('teamSessions.week.last') : t('teamSessions.week.of')
  return (
    <section aria-label={`${title} · ${range}`}>
      <h2 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{title} · {range}</h2>
      <ul className="space-y-2">{week.rows.map((r) => (r.kind === 'meeting' && r.meeting ? <MeetingRow key={r.sessionId} row={r} /> : <SessionRow key={r.sessionId} row={r} />))}</ul>
    </section>
  )
}

function SessionRow({ row }: { row: TeamSessionHistoryRow }) {
  const { t, i18n } = useTranslation()
  const start = new Date(row.startsAt)
  const time = (d: Date) => d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const day = start.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })
  const played = formatPlayed(row.playedSec)
  const o = row.objectives
  const href = sessionHref(row)
  return (
    <li>
      <Link
        to={href}
        className="group flex items-center gap-4 rounded-lg border border-hextech-border-dim bg-hextech-dark/40 py-3 pl-4 pr-3 transition-colors hover:border-hextech-border hover:bg-hextech-elevated hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold"
        style={{ borderLeft: `3px solid ${accentOf(row.kind)}` }}
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate">
            <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: accentOf(row.kind), backgroundColor: `${accentOf(row.kind)}22` }}>
              {t(`teamSessions.type.${row.kind}`)}
            </span>
            <span className="truncate text-sm font-semibold text-hextech-text-bright">{row.title}</span>
          </p>
          <p className="mt-1 font-mono text-[11px] text-hextech-text-dim">
            {day} · {time(start)} – {time(new Date(row.endsAt))}{row.format && ` · ${row.format.toUpperCase()}`}
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <span className="flex gap-1">
            {row.games.map((g, i) => (
              <span key={g.gameId}
                title={t('teamSessions.gameN', { n: i + 1 })}
                className={cn('flex h-5 w-5 items-center justify-center rounded font-mono text-[10px] font-bold',
                  g.win === true ? 'bg-hextech-green/20 text-hextech-green' : g.win === false ? 'bg-hextech-red/20 text-hextech-red' : 'bg-hextech-elevated text-hextech-text-dim')}>
                {g.win === true ? t('teamSessions.winShort') : g.win === false ? t('teamSessions.lossShort') : '?'}
              </span>
            ))}
          </span>
          <span className="font-mono text-xs text-hextech-text tabular-nums">
            {row.games.length ? `${row.wins} – ${row.losses}` : t('teamSessions.noGames')}
            {played && <span className="text-hextech-text-dim"> · {t('teamSessions.played', { time: played })}</span>}
          </span>
        </div>

        <span className={cn('hidden w-24 shrink-0 text-right font-mono text-xs md:block',
          o.total === 0 || o.judged === 0 ? 'text-hextech-text-dim' : wrText((o.held / o.total) * 100, o.total))}>
          {o.total === 0 ? '—' : o.judged === 0 ? t('teamSessions.objectivesNotJudged', { count: o.total }) : t('teamSessions.objectivesHeld', { held: o.held, total: o.total })}
        </span>

        <span className="hidden shrink-0 gap-1.5 lg:flex">
          {row.hasNotes && <span className="rounded border border-hextech-border-dim px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-hextech-text-dim">{t('teamSessions.badge.notes')}</span>}
          {row.review === 'done'
            ? <span className="rounded bg-hextech-green/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-hextech-green">{t('teamSessions.badge.reviewDone')}</span>
            : <span className="rounded bg-hextech-gold/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-hextech-gold">{t('teamSessions.badge.reviewPending')}</span>}
        </span>

        <ChevronRight className="h-4 w-4 shrink-0 text-hextech-text-dim transition-colors group-hover:text-hextech-gold" aria-hidden />
      </Link>
    </li>
  )
}

/* ─── Meetings (§ 15.2 bis) ─── */

function MeetingTiles({ summary }: { summary: TeamSessionHistoryPage['summary'] }) {
  const { t } = useTranslation()
  const m = summary.meetings
  const recorded = m.recordedSec != null ? formatPlayed(m.recordedSec) : null
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label={t('teamSessions.meeting.tiles.count')} value={String(m.count)} />
      <Tile label={t('teamSessions.meeting.tiles.attendance')} value={m.averageAttendancePct == null ? '—' : `${Math.round(m.averageAttendancePct)} %`} />
      <Tile label={t('teamSessions.meeting.tiles.summaries')} value={`${m.summariesDone} / ${m.count}`} />
      <Tile label={t('teamSessions.meeting.tiles.recorded')} value={recorded ?? '—'} foot={recorded ? undefined : t('teamSessions.meeting.tiles.recordedSoon')} />
    </div>
  )
}

const badge = 'rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider'

/** A meeting in the list: the same row, attendance instead of the result, the people concerned instead of the objectives. */
function MeetingRow({ row }: { row: TeamSessionHistoryRow }) {
  const { t, i18n } = useTranslation()
  const m = row.meeting!
  const start = new Date(row.startsAt)
  const time = (d: Date) => d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const day = start.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })
  const accent = KIND_STYLE.meeting.accent
  const who = m.scope === 'custom' ? t('teamSessions.meeting.people', { count: m.concerned }) : t(`teamSessions.meeting.scope.${m.scope}`)
  return (
    <li>
      <Link
        to={sessionHref(row)}
        className="group flex items-center gap-4 rounded-lg border border-hextech-border-dim bg-hextech-dark/40 py-3 pl-4 pr-3 transition-colors hover:border-hextech-border hover:bg-hextech-elevated hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold"
        style={{ borderLeft: `3px solid ${accent}` }}
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate">
            <span className={badge} style={{ color: accent, backgroundColor: `${accent}22` }}>{t('teamSessions.type.meeting')}</span>
            <span className="truncate text-sm font-semibold text-hextech-text-bright">{row.title}</span>
          </p>
          <p className="mt-1 font-mono text-[11px] text-hextech-text-dim">
            {day} · {time(start)} – {time(new Date(row.endsAt))}{formatPlayed(m.durationSec) && ` · ${formatPlayed(m.durationSec)}`}
          </p>
        </div>
        <span className="hidden shrink-0 items-center gap-2 sm:flex">
          {(m.people ?? []).length > 0 && (
            <span className="flex -space-x-1" aria-hidden>
              {m.people.slice(0, 6).map((p) => (
                <span key={p.userId} title={`${p.name ?? '—'} · ${t(`teamSessions.meeting.status.${p.status}`)}`}
                  className={cn('flex h-5 w-5 items-center justify-center rounded-full border border-hextech-black font-mono text-[8px] font-bold',
                    p.status === 'present' ? 'bg-hextech-green/30 text-hextech-green' : p.status === 'absent' ? 'bg-hextech-red/30 text-hextech-red' : 'bg-hextech-elevated text-hextech-text-dim')}>
                  {initialsOf(p.name ?? '?')}
                </span>
              ))}
              {m.people.length > 6 && <span className="flex h-5 items-center pl-1.5 font-mono text-[9px] text-hextech-text-dim">+{m.people.length - 6}</span>}
            </span>
          )}
          <span className={cn('font-mono text-xs', m.concerned && m.present === m.concerned ? 'text-hextech-green' : 'text-hextech-text')}>
            {m.concerned ? t('teamSessions.meeting.present', { present: m.present, concerned: m.concerned }) : '—'}
          </span>
        </span>
        <span className="hidden w-28 shrink-0 text-right text-xs text-hextech-text-dim md:block">{who}</span>
        <span className="hidden shrink-0 gap-1.5 lg:flex">
          {m.recorded && <span className={cn(badge, 'border border-hextech-border-dim text-hextech-text-dim')}>{t('teamSessions.meeting.badge.recorded')}</span>}
          {m.transcript && <span className={cn(badge, 'border border-hextech-border-dim text-hextech-text-dim')}>{t('teamSessions.meeting.badge.transcript')}</span>}
          {m.summary === 'done'
            ? <span className={cn(badge, 'bg-hextech-green/15 text-hextech-green')}>{t('teamSessions.meeting.badge.summaryDone')}</span>
            : <span className={cn(badge, 'bg-hextech-gold/15 text-hextech-gold')}>{t('teamSessions.meeting.badge.summaryPending')}</span>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-hextech-text-dim transition-colors group-hover:text-hextech-gold" aria-hidden />
      </Link>
    </li>
  )
}
