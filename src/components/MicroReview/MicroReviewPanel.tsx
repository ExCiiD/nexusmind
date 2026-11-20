/**
 * 45-second guided micro-review (docs/PLAN_MICRO_REVIEW.md, UI "Revue").
 *   top    queue of the 2–3 critical moments (AnomalyDetector);
 *   left   VOD excerpt starting 12 s before the moment (~15 s), or the
 *          schematic map when the game has no recording;
 *   right  factual one-liner + 3 diagnosis buttons + "Autre cause…"
 *          (SmartQCMGenerator), then the AscendCodex prescription.
 * Completing every moment grants Ascend XP once.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Loader2, MapPin, RotateCcw, ShieldCheck, Sparkles, Timer, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUserStore } from '@/store/useUserStore'
import { buildQcm, choiceStats, retiredOption, type QcmCard, type QcmOption } from '@/lib/microReview/smartQcm'
import { codexById, codexFor, isRetiredCodex } from '@/lib/microReview/codex'
import { phaseOf, fmtClock } from '@/lib/mistakeInsights'
import { deriveOffsetSec } from '@/lib/eventSync'
import type { CriticalMoment } from '@/lib/microReview/anomalyDetector'
import type { MicroReviewAnswerView, MicroReviewPayload } from '@/lib/microReview/types'
import type { MistakeTag } from '@/lib/ipc'
import { CodexCard, VideoExampleLink } from './CodexCard'
import { MiniMap } from './MiniMap'
import { OtherCausePicker, type OtherChoice } from './OtherCausePicker'
import { summaryText, tagLabel } from './text'
import { usePrepareSession } from './usePrepareSession'
import { useTeamCodex } from './useTeamCodex'
import { toNxmUrl } from '@/lib/mediaCore'
import { EXCERPT_SEC, PRE_ROLL_SEC } from '@/lib/microReview/vodTiming'
import { isRiotRateLimited, riotErrorText } from '@/lib/riotErrors'

const panel = 'panel-surface rounded-2xl border border-hextech-border-dim/70 shadow-lg backdrop-blur-sm'

const youtubeId = (url: string) => url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^&?/\s]+)/)?.[1] ?? null

export function MicroReviewPanel({ gameId, onAnswered }: { gameId: string; onAnswered?: () => void }) {
  const { t } = useTranslation()
  const addXp = useUserStore((s) => s.addXp)
  const prepare = usePrepareSession()
  const [data, setData] = useState<MicroReviewPayload | null | undefined>(undefined)
  const [tags, setTags] = useState<MistakeTag[]>([])
  const teamRules = useTeamCodex()
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, MicroReviewAnswerView>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [xp, setXp] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Post-game: the analysis could not load because Riot is rate-limiting (shown with its wait instead of "unavailable").
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setData(undefined)
    setLoadError(null)
    window.api.microReviewGet(gameId)
      .then((d) => {
        if (!alive) return
        setData(d)
        const byKey = Object.fromEntries((d?.answers ?? []).map((a) => [a.momentKey, a]))
        setAnswers(byKey)
        const firstOpen = (d?.analysis?.moments ?? []).findIndex((m) => !byKey[m.key])
        setIndex(firstOpen < 0 ? 0 : firstOpen)
      })
      .catch((err) => {
        if (!alive) return
        setData(null)
        if (isRiotRateLimited(err)) setLoadError(riotErrorText(err, t))
      })
    window.api.listMistakeTags().then((x) => { if (alive) setTags(x) }).catch(() => {})
    return () => { alive = false }
  }, [gameId, t])

  const moments = useMemo(() => data?.analysis?.moments ?? [], [data])
  const stats = useMemo(() => (data ? choiceStats(data.pastAnswers, data.role, data.champion) : undefined), [data])
  const cards = useMemo(() => moments.map((m) => buildQcm(m, stats)), [moments, stats])
  const moment = moments[index] ?? null
  const card = cards[index] ?? null
  const answer = moment ? answers[moment.key] : undefined
  // An answer given with a diagnosis since withdrawn is shown back as it was recorded, after the card's own options.
  const legacy = card ? retiredOption(card.options, answer) : null
  const options = card ? (legacy ? [...card.options, legacy] : card.options) : []
  const allDone = moments.length > 0 && moments.every((m) => answers[m.key])
  // Next unanswered moment after the current one, wrapping around (-1 when all are answered).
  const nextOpen = moments.map((_, i) => (index + 1 + i) % moments.length).find((i) => i !== index && !answers[moments[i].key]) ?? -1

  const submit = useCallback(async (m: CriticalMoment, c: QcmCard, choice: { option?: QcmOption; other?: OtherChoice }) => {
    if (!data) return
    const option = choice.option
    const other = choice.other
    setBusy(option?.id ?? 'other')
    setError(null)
    try {
      const res = await window.api.microReviewAnswer({
        gameId,
        momentKey: m.key,
        trigger: m.trigger,
        gameTimeSec: m.gameTimeSec,
        outcome: other ? (other.justified ? 'justified' : other.customLabel ? 'custom' : 'mistake') : option!.outcome,
        tagSlug: other ? (other.justified ? null : other.tagSlug ?? null) : option!.tagSlug,
        customLabel: other && !other.justified ? other.customLabel ?? null : null,
        reason: other ? (other.justified ? 'assumed' : null) : option!.reason,
        viaOther: !!other,
        note: other?.note ?? null,
        summary: c.summary,
        // Excerpt start in the VOD, so the coach can jump to it.
        videoTimeSec: data.recording ? Math.max(0, Math.round(m.gameTimeSec - PRE_ROLL_SEC - deriveOffsetSec({
          gameEndAt: new Date(data.gameEndAt), gameDurationSec: data.durationSec, recordingCreatedAt: new Date(data.recording.createdAt),
          videoDurationSec: data.durationSec, startOffsetSec: data.recording.startOffsetSec,
        }))) : null,
      })
      setAnswers((prev) => ({ ...prev, [m.key]: res.answer }))
      setPicking(false)
      if (res.xpAwarded > 0) { setXp(res.xpAwarded); addXp(res.xpAwarded) }
      onAnswered?.()
    } catch (err) {
      setError((err as Error)?.message ?? 'error')
    } finally {
      setBusy(null)
    }
  }, [data, gameId, addXp, onAnswered])

  if (data === undefined) {
    return <section className={cn(panel, 'flex items-center justify-center gap-2 p-6 text-sm text-hextech-text-dim')}><Loader2 className="h-4 w-4 animate-spin" />{t('microReview.loading')}</section>
  }
  if (!data || !data.analysis) {
    return (
      <section className={cn(panel, 'p-4')} data-testid="micro-review-unavailable">
        <Header count={0} done={0} />
        <p className="mt-2 text-xs text-hextech-text-dim">{loadError ?? t(data?.reason === 'unsupported-mode' ? 'microReview.unsupported' : data?.reason === 'previous-season' ? 'microReview.previousSeason' : 'microReview.unavailable')}</p>
      </section>
    )
  }
  if (moments.length === 0) {
    return (
      <section className={cn(panel, 'p-4')} data-testid="micro-review-none">
        <Header count={0} done={0} />
        <p className="mt-2 flex items-center gap-2 text-xs text-hextech-text"><ShieldCheck className="h-4 w-4 text-hextech-green" />{t('microReview.none')}</p>
      </section>
    )
  }

  const doneCount = moments.filter((m) => answers[m.key]).length
  // Counted on today's moments: an answer to a moment an older analysis had is not part of this review.
  const justifiedCount = moments.filter((m) => answers[m.key]?.outcome === 'justified').length
  // The diagnosis picked may point at a specific Codex entry (coach clips); otherwise the best one for the tag.
  const chosenCodexId = answer && !answer.viaOther ? options.find((o) => o.reason === answer.reason && o.tagSlug === answer.tagSlug)?.codexId : undefined
  const chosenEntry = (chosenCodexId ? codexById(chosenCodexId) : null) ?? (answer?.tagSlug ? codexFor(answer.tagSlug, data.role, phaseOf(moment!.gameTimeSec), teamRules) : null)

  return (
    <section className={cn(panel, 'p-4')} data-testid="micro-review">
      <Header count={moments.length} done={doneCount} />

      {/* Queue */}
      <ol className="mt-3 flex flex-wrap gap-2" aria-label={t('microReview.queue')}>
        {moments.map((m, i) => {
          const a = answers[m.key]
          return (
            <li key={m.key}>
              <button onClick={() => { setIndex(i); setPicking(false) }} aria-current={i === index}
                className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors',
                  i === index ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border')}>
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                  a ? 'bg-hextech-green/20 text-hextech-green' : 'bg-hextech-elevated text-hextech-text-bright')}>
                  {a ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="font-mono font-semibold">{fmtClock(m.gameTimeSec)}</span>
                <span className="hidden sm:inline">{m.facts.pattern ? t(`microReview.pattern.${m.facts.pattern}`) : t(`microReview.trigger.${m.trigger}`)}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {moment && card && (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Excerpt data={data} moment={moment} />
          </div>

          <div className="space-y-3 lg:col-span-5">
            <QcmHead card={card} />
            {picking ? (
              <OtherCausePicker tags={tags} busy={busy === 'other'} onCancel={() => setPicking(false)}
                onConfirm={(other) => submit(moment, card, { other })} />
            ) : (
              <div className="space-y-1.5" role="group" aria-label={t('microReview.question')}>
                {options.map((o) => {
                  // Two readings of one tag may sit on the card (a second reading, or a withdrawn diagnosis shown back): the reason tells them apart.
                  const selected = !!answer && !answer.viaOther && (o.tagSlug
                    ? answer.tagSlug === o.tagSlug && (answer.reason == null || answer.reason === o.reason || !options.some((x) => x.tagSlug === o.tagSlug && x.reason === answer.reason))
                    : answer.outcome === 'justified' && answer.reason === o.reason)
                  const main = t(`microReview.reason.${o.reason}`, { tag: tagLabel(t, o.tagSlug) })
                  const sub = o.outcome === 'justified' ? t('microReview.justifiedBadge') : o.promoted ? t('microReview.promoted') : tagLabel(t, o.tagSlug, tags.find((x) => x.slug === o.tagSlug)?.label)
                  // The tag name under the button only when it adds something to the reason.
                  const showSub = !main.toLowerCase().includes(sub.toLowerCase())
                  return (
                    <button key={o.id} disabled={!!busy || o === legacy} onClick={() => submit(moment, card, { option: o })} aria-pressed={selected}
                      className={cn('flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-60',
                        selected ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim bg-hextech-elevated/60 text-hextech-text-bright hover:border-hextech-gold/60')}>
                      {busy === o.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <span className={cn('h-2 w-2 shrink-0 rounded-full', o.outcome === 'justified' ? 'bg-hextech-green' : 'bg-hextech-red')} />}
                      <span className="min-w-0 flex-1">
                        <span className="block">{main}</span>
                        {showSub && <span className="block text-[11px] text-hextech-text-dim">{sub}</span>}
                        {o.codexId && !answer && <span className="mt-0.5 block text-[10px] font-semibold text-hextech-cyan">{t(codexById(o.codexId)?.videoExamples?.length ? 'codex.withVideo' : 'codex.withFiche')}</span>}
                      </span>
                    </button>
                  )
                })}
                <button disabled={!!busy} onClick={() => setPicking(true)} aria-pressed={!!answer?.viaOther}
                  className={cn('flex w-full items-center justify-between rounded-lg border border-dashed px-3 py-2.5 text-left text-sm transition-colors',
                    answer?.viaOther ? 'border-hextech-gold text-hextech-gold-bright' : 'border-hextech-border text-hextech-text hover:border-hextech-gold/60')}>
                  <span>{!answer?.viaOther ? t('microReview.other') : answer.outcome === 'justified' ? t('microReview.reason.assumed') : tagLabel(t, answer.tagSlug, tags.find((x) => x.slug === answer.tagSlug)?.label)}</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            {error && <p className="text-xs text-hextech-red">{t('microReview.error')}</p>}
            {!answer && !picking && (() => {
              const ref = card.options[0]?.codexId ? codexById(card.options[0].codexId) : null
              return ref?.videoExamples?.length ? (
                <div className="space-y-1.5" data-testid="qcm-reference-clips">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('codex.referenceClips')}</p>
                  <div className={cn('grid gap-2', ref.videoExamples.length > 1 && 'sm:grid-cols-2')}>
                    {ref.videoExamples.map((v) => <VideoExampleLink key={v.url} video={v} compact />)}
                  </div>
                </div>
              ) : null
            })()}

            {answer && !picking && (
              <>
                {answer.outcome === 'justified' ? (
                  <p className="flex items-start gap-2 rounded-lg border border-hextech-green/30 bg-hextech-green/10 px-3 py-2 text-xs text-hextech-text-bright">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hextech-green" />{t('microReview.justifiedDone')}
                  </p>
                ) : chosenEntry ? (
                  <CodexCard entry={chosenEntry} onPrepare={isRetiredCodex(chosenEntry.id) ? undefined : () => prepare(chosenEntry)} />
                ) : (
                  <p className="text-xs text-hextech-text-dim">{t('codex.none')}</p>
                )}
                {nextOpen >= 0 && (
                  <Button size="sm" className="w-full gap-1.5" onClick={() => setIndex(nextOpen)}>{t('microReview.next')}<ChevronRight className="h-4 w-4" /></Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {allDone && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hextech-gold/30 bg-gradient-to-r from-hextech-gold/15 to-transparent px-4 py-3" data-testid="micro-review-done">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-hextech-gold-bright"><Sparkles className="h-4 w-4" />{t('microReview.done')}</p>
            <p className="mt-0.5 text-xs text-hextech-text">{t('microReview.doneSummary', { mistakes: doneCount - justifiedCount, justified: justifiedCount })}</p>
          </div>
          {xp > 0 && <span className="rounded-full bg-hextech-gold px-3 py-1 text-xs font-bold text-hextech-black">{t('microReview.doneXp', { xp })}</span>}
        </div>
      )}
    </section>
  )
}

function Header({ count, done }: { count: number; done: number }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold text-hextech-text-bright"><Timer className="h-4 w-4 text-hextech-gold" />{t('microReview.title')}</h2>
        {count > 0 && <p className="text-xs text-hextech-text">{t('microReview.subtitle', { count })}</p>}
      </div>
      {count > 0 && <span className="font-mono text-xs text-hextech-text-dim">{done}/{count}</span>}
    </div>
  )
}

function QcmHead({ card }: { card: QcmCard }) {
  const { t } = useTranslation()
  const s = summaryText(t, card.summary)
  return (
    <div>
      <p className="text-sm text-hextech-text-bright" data-testid="micro-review-summary">
        <span className="font-mono font-semibold text-hextech-gold">{s.clock}</span>
        {s.zone && <> • <span className="font-medium">{s.zone}</span></>}
        {' — '}{s.line}
      </p>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('microReview.question')}</p>
    </div>
  )
}

/** ~15 s excerpt starting 12 s before the moment; schematic map when there is no VOD. */
function Excerpt({ data, moment }: { data: MicroReviewPayload; moment: CriticalMoment }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const ref = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(0)
  const rec = data.recording
  const offset = useMemo(() => {
    if (!rec) return 0
    return deriveOffsetSec({
      gameEndAt: new Date(data.gameEndAt), gameDurationSec: data.durationSec,
      recordingCreatedAt: new Date(rec.createdAt), videoDurationSec: duration, startOffsetSec: rec.startOffsetSec,
    })
  }, [rec, data.gameEndAt, data.durationSec, duration])
  const start = Math.max(0, moment.gameTimeSec - PRE_ROLL_SEC - offset)
  const end = start + EXCERPT_SEC

  const replay = useCallback(() => {
    const v = ref.current
    if (!v) return
    v.currentTime = start
    v.play().catch(() => {})
  }, [start])
  useEffect(() => { if (duration > 0) replay() }, [duration, replay, moment.key])

  const frame = 'relative aspect-video w-full overflow-hidden rounded-xl border border-hextech-border-dim bg-hextech-black'
  if (rec?.filePath) {
    return (
      <div>
        <div className={frame}>
          <video ref={ref} src={toNxmUrl(rec.filePath)} muted playsInline controls className="h-full w-full"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => { if (e.currentTarget.currentTime >= end) e.currentTarget.pause() }} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-hextech-text-dim">
          <span>{t('microReview.vod.excerpt', { from: fmtClock(moment.gameTimeSec - PRE_ROLL_SEC), to: fmtClock(moment.gameTimeSec - PRE_ROLL_SEC + EXCERPT_SEC) })}</span>
          <span className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={replay}><RotateCcw className="h-3 w-3" />{t('microReview.vod.replay')}</Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => navigate(`/record/${rec.id}?at=${Math.max(0, moment.gameTimeSec - PRE_ROLL_SEC)}`)}><ExternalLink className="h-3 w-3" />{t('microReview.vod.openFull')}</Button>
          </span>
        </div>
      </div>
    )
  }
  const yt = rec?.youtubeUrl ? youtubeId(rec.youtubeUrl) : null
  if (yt) {
    const s = Math.round(start)
    return (
      <div className={frame}>
        <iframe key={moment.key} title={t('microReview.vod.title')} src={`https://www.youtube.com/embed/${yt}?start=${s}&end=${s + EXCERPT_SEC}&autoplay=1&mute=1`}
          className="h-full w-full" allow="autoplay; encrypted-media" allowFullScreen />
      </div>
    )
  }
  return (
    <div>
      <div className={cn(frame, 'flex items-center justify-center p-3')}>
        <div className="aspect-square h-full max-h-full">
          <MiniMap position={moment.position} team={data.analysis?.teamId ?? 100} />
        </div>
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-hextech-text-dim"><MapPin className="h-3 w-3" />{t('microReview.vod.noRecording')}</p>
    </div>
  )
}
