import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, ChevronDown, ChevronUp, ClipboardCopy, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/useToast'
import { cn } from '@/lib/utils'
import { KIND_STYLE } from '@/lib/planningView'
import { toNxmUrl } from '@/lib/mediaCore'
import { youtubeVideoId } from '@/lib/microReview/codex'
import { formatPlayed, parseTranscript, searchTranscript, stampOf } from '@/lib/teamSessionHistoryView'
import type { NameOf } from '@/hooks/useCollab'
import type { TeamSessionHistoryDetail } from './historyContract'

const panel = 'rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4'

function Block({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className={cn(panel, 'space-y-3')} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-hextech-gold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

/**
 * The page of a finished meeting (docs/DESIGN_STATE.md § 15.2 bis), in the team sessions history: who was there, the
 * recording, the summary (editable by the staff), the transcript folded with a search (highlights, n / N, previous /
 * next; a time marker moves the player there), and the participants' feedback. No game filter, no stats.
 */
export function MeetingHistoryView({ detail, calendarEventId, canManage, nameOf }: {
  detail: TeamSessionHistoryDetail & { meeting: NonNullable<TeamSessionHistoryDetail['meeting']> }
  calendarEventId: string | null
  canManage: boolean
  nameOf: NameOf
}) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const m = detail.meeting
  const h = detail.header
  const accent = KIND_STYLE.meeting.accent
  const start = new Date(h.startsAt), end = new Date(h.endsAt)
  const time = (d: Date) => d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const length = formatPlayed((end.getTime() - start.getTime()) / 1000)
  const dateLine = `${start.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })} · ${time(start)} – ${time(end)}${length ? ` · ${length}` : ''}`
  const [seekTo, setSeekTo] = useState<number | null>(null)
  const [summary, setSummary] = useState(m.summary)
  const nothing = !m.recording && !m.summary && !m.transcript && m.reviewStatus !== 'processing'

  const exportSummary = async () => {
    const text = [`${m.reason} — ${t('teamSessions.type.meeting')}`, dateLine, t('teamSessions.meeting.present', { present: m.present, concerned: m.concerned }), '', summary ?? t('teamSessions.meeting.noSummary')].join('\n')
    try { await navigator.clipboard.writeText(text); toast({ title: t('teamSessions.detail.exported') }) } catch { toast({ title: t('teamSessions.detail.exportFailed'), variant: 'destructive' }) }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <Link to="/team-sessions?type=meeting" className="inline-flex items-center gap-1 text-sm text-hextech-text-dim hover:text-hextech-gold">
        <ArrowLeft className="h-3.5 w-3.5" />{t('teamSessions.title')}
      </Link>

      <header className={cn(panel, 'flex flex-wrap items-start justify-between gap-4')} style={{ borderLeft: `3px solid ${accent}` }}>
        <div className="min-w-0 space-y-1">
          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: accent, backgroundColor: `${accent}22` }}>{t('teamSessions.type.meeting')}</span>
          <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{m.reason}</h1>
          <p className="font-mono text-xs text-hextech-text-dim">{dateLine}</p>
          {m.organizerId && <p className="text-xs text-hextech-text-dim">{t('teamSessions.meeting.organizer', { name: nameOf(m.organizerId) })}</p>}
          {m.notes && <p className="whitespace-pre-wrap text-sm text-hextech-text">{m.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {calendarEventId && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/management?tab=planning&event=${encodeURIComponent(calendarEventId)}`}><CalendarDays className="mr-1.5 h-3.5 w-3.5" />{t('teamSessions.detail.openPlanning')}</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { void exportSummary() }}><ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />{t('teamSessions.detail.export')}</Button>
        </div>
      </header>

      {/* 1. People and attendance */}
      <Block title={t('teamSessions.meeting.attendance')} right={m.concerned ? <span className="font-mono text-xs text-hextech-text-dim">{t('teamSessions.meeting.present', { present: m.present, concerned: m.concerned })}</span> : undefined}>
        {m.people.length === 0 ? <p className="text-sm text-hextech-text-dim">{t('teamSessions.meeting.nobody')}</p> : (
          <ul className="divide-y divide-hextech-border-dim/40">
            {m.people.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center gap-3 py-1.5 text-sm">
                <span className="w-20 font-mono text-[10px] uppercase text-hextech-text-dim">{t(`groups.roles.${p.role}`, { defaultValue: p.role })}</span>
                <span className="min-w-0 flex-1 truncate text-hextech-text-bright">{nameOf(p.userId)}</span>
                <span className={cn('text-xs', p.status === 'present' ? 'text-hextech-green' : p.status === 'absent' ? 'text-hextech-red' : 'text-hextech-text-dim')}>
                  {t(`teamSessions.meeting.status.${p.status}`)}
                </span>
                {p.absenceNote && <span className="basis-full pl-[5.75rem] text-xs text-hextech-text-dim">{p.absenceNote}</span>}
              </li>
            ))}
          </ul>
        )}
      </Block>

      {nothing ? (
        <p className={cn(panel, 'text-sm text-hextech-text-dim')}>{t('teamSessions.meeting.nothing')}</p>
      ) : (
        <>
          {/* 2. Recording */}
          <Block title={t('teamSessions.meeting.recording')}>
            <Player recording={m.recording} seekTo={seekTo} nameOf={nameOf} />
          </Block>

          {/* 3. Summary */}
          <Block title={t('teamSessions.meeting.summary')}>
            <SummaryEditor sessionId={h.sessionId} reviewId={m.reviewId} value={summary} canEdit={canManage} onSaved={setSummary} />
          </Block>

          {/* 4. Transcript */}
          <Block title={t('teamSessions.meeting.transcript')}>
            {m.reviewStatus === 'processing' ? (
              <div className="space-y-2" role="status">
                <p className="text-sm text-hextech-text-dim">{t('teamSessions.meeting.transcribing')}</p>
                <div className="h-1.5 overflow-hidden rounded bg-hextech-elevated"><div className="h-full w-1/3 animate-pulse rounded bg-hextech-gold/70" /></div>
              </div>
            ) : m.transcript ? (
              <Transcript text={m.transcript} canSeek={!!m.recording} onSeek={setSeekTo} />
            ) : (
              <p className="text-sm text-hextech-text-dim">{t('teamSessions.meeting.noTranscript')}</p>
            )}
          </Block>
        </>
      )}

      {/* 5. Feedback */}
      {detail.feedback.length > 0 && (
        <Block title={t('teamSessions.detail.feedback')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {detail.feedback.map((f) => (
              <article key={f.userId} className="rounded-md border border-hextech-border-dim bg-hextech-black/30 p-3">
                <p className="text-xs font-semibold text-hextech-text-bright">{nameOf(f.userId)}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-hextech-text">{f.body}</p>
              </article>
            ))}
          </div>
        </Block>
      )}
    </div>
  )
}

/** The local file (desktop, nxm://) or the YouTube link; `seekTo` moves it (a transcript time marker). */
function Player({ recording, seekTo, nameOf }: { recording: NonNullable<TeamSessionHistoryDetail['meeting']>['recording']; seekTo: number | null; nameOf: NameOf }) {
  const { t, i18n } = useTranslation()
  const video = useRef<HTMLVideoElement>(null)
  // The web has no local files: only the YouTube link plays there.
  const local = recording?.localPath && window.api.cloudOpenWeb ? toNxmUrl(recording.localPath) : null
  const yt = recording?.youtubeUrl ? youtubeVideoId(recording.youtubeUrl) : null
  useEffect(() => {
    if (seekTo == null || !video.current) return
    video.current.currentTime = seekTo
    void video.current.play().catch(() => {})
  }, [seekTo])
  if (!recording || (!local && !yt)) return <p className="text-sm text-hextech-text-dim">{t('teamSessions.meeting.notRecorded')}</p>
  return (
    <div className="space-y-2">
      {local ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- a meeting recording: its transcript is below.
        <video ref={video} src={local} controls className="aspect-video w-full max-w-3xl rounded-md bg-black" />
      ) : (
        <iframe
          title={t('teamSessions.meeting.recording')}
          // A time marker reloads the embed at that second.
          src={`https://www.youtube.com/embed/${yt}?rel=0${seekTo != null ? `&start=${Math.floor(seekTo)}&autoplay=1` : ''}`}
          className="aspect-video w-full max-w-3xl rounded-md bg-black"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      )}
      <p className="text-xs text-hextech-text-dim">
        {t('teamSessions.meeting.recordedBy', {
          name: recording.recordedBy ? nameOf(recording.recordedBy) : '—',
          date: new Date(recording.recordedAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }),
        })}
      </p>
    </div>
  )
}

function SummaryEditor({ sessionId, reviewId, value, canEdit, onSaved }: {
  sessionId: string
  reviewId: string | null
  value: string | null
  canEdit: boolean
  onSaved: (s: string | null) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [id, setId] = useState(reviewId)

  const save = async () => {
    setSaving(true)
    try {
      let rid = id
      if (!rid) { rid = await window.api.teamSessionReviewCreate(sessionId, null, 'meeting', 'done'); setId(rid) }
      const next = draft.trim() ? draft : null
      await window.api.teamSessionReviewUpdate(rid, { summary: next })
      onSaved(next)
      setEditing(false)
      toast({ title: t('teamSessions.meeting.summarySaved') })
    } catch {
      toast({ title: t('teamSessions.meeting.summaryFailed'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} maxLength={8000} aria-label={t('teamSessions.meeting.summary')} autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={saving} onClick={() => { setDraft(value ?? ''); setEditing(false) }}>{t('common.cancel')}</Button>
          <Button size="sm" disabled={saving} onClick={() => { void save() }}>{t('teamSessions.meeting.saveSummary')}</Button>
        </div>
      </div>
    )
  }
  return value ? (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap text-sm text-hextech-text">{value}</p>
      {canEdit && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{t('teamSessions.meeting.editSummary')}</Button>}
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-hextech-text-dim">
      <span>{t('teamSessions.meeting.noSummary')}</span>
      {canEdit && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{t('teamSessions.meeting.writeSummary')}</Button>}
    </div>
  )
}

/** Folded transcript with a search: gold highlights, « 3 / 12 », previous / next (Enter: next, Escape: clear). */
function Transcript({ text, canSeek, onSeek }: { text: string; canSeek: boolean; onSeek: (sec: number) => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const blocks = useMemo(() => parseTranscript(text), [text])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const hits = useMemo(() => searchTranscript(blocks, query), [blocks, query])
  const list = useRef<HTMLDivElement>(null)
  const lastStamp = [...blocks].reverse().find((b) => b.atSec != null)?.atSec ?? null

  useEffect(() => { setCurrent(0) }, [query])
  useEffect(() => {
    if (!hits.length) return
    list.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'center' })
  }, [current, hits])

  const go = (delta: number) => { if (hits.length) setCurrent((c) => (c + delta + hits.length) % hits.length) }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
        {lastStamp != null ? t('teamSessions.meeting.showTranscriptLength', { length: stampOf(lastStamp) }) : t('teamSessions.meeting.showTranscript')}
      </Button>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-[320px] max-w-full">
          <span className="sr-only">{t('teamSessions.meeting.search')}</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-hextech-text-dim" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1) }
              if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery('') }
            }}
            placeholder={t('teamSessions.meeting.search')}
            className="w-full rounded border border-hextech-border bg-hextech-dark py-1.5 pl-7 pr-7 text-sm"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label={t('teamSessions.meeting.clearSearch')} className="absolute right-2 top-1/2 -translate-y-1/2 text-hextech-text-dim hover:text-hextech-text-bright">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        {query.trim() && (
          <span className="font-mono text-xs text-hextech-text-dim tabular-nums" aria-live="polite">
            {hits.length ? `${current + 1} / ${hits.length}` : t('teamSessions.meeting.noMatch')}
          </span>
        )}
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={!hits.length} onClick={() => go(-1)} aria-label={t('teamSessions.meeting.previous')}><ChevronUp className="h-3.5 w-3.5" /></Button>
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={!hits.length} onClick={() => go(1)} aria-label={t('teamSessions.meeting.next')}><ChevronDown className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(false)}>{t('teamSessions.meeting.hideTranscript')}</Button>
      </div>

      <div ref={list} className="max-h-[50vh] space-y-1.5 overflow-y-auto rounded-md border border-hextech-border-dim bg-hextech-black/30 p-3 text-sm leading-relaxed text-hextech-text">
        {blocks.map((b, i) => {
          const marks = hits.map((hit, n) => ({ ...hit, n })).filter((hit) => hit.block === i)
          const parts: ReactNode[] = []
          let at = 0
          for (const mk of marks) {
            if (mk.start > at) parts.push(b.text.slice(at, mk.start))
            parts.push(
              <mark key={mk.n} data-current={mk.n === current || undefined}
                className={cn('rounded px-0.5 text-hextech-black', mk.n === current ? 'bg-hextech-gold ring-2 ring-hextech-gold-bright' : 'bg-hextech-gold/60')}>
                {b.text.slice(mk.start, mk.end)}
              </mark>,
            )
            at = mk.end
          }
          parts.push(b.text.slice(at))
          return (
            <p key={i} className="flex gap-3">
              {b.atSec != null && (
                canSeek
                  ? <button type="button" onClick={() => onSeek(b.atSec!)} aria-label={t('teamSessions.meeting.seek', { time: stampOf(b.atSec) })}
                      className="shrink-0 font-mono text-xs text-hextech-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">{stampOf(b.atSec)}</button>
                  : <span className="shrink-0 font-mono text-xs text-hextech-text-dim">{stampOf(b.atSec)}</span>
              )}
              <span>{parts}</span>
            </p>
          )
        })}
      </div>

      <Button variant="outline" size="sm" onClick={() => {
        navigator.clipboard.writeText(text).then(() => toast({ title: t('teamSessions.meeting.copied') }), () => toast({ title: t('teamSessions.detail.exportFailed'), variant: 'destructive' }))
      }}>
        <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />{t('teamSessions.meeting.copyTranscript')}
      </Button>
    </div>
  )
}
