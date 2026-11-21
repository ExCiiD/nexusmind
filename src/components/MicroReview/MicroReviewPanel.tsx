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
import { CoachVerdictsForGame } from './CoachVerdictsForGame'
import { BookOpen, X, Check, ChevronRight, Loader2, MapPin, RotateCcw, ShieldCheck, Sparkles, Timer, ExternalLink } from 'lucide-react'
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
import { OtherCausePicker, type OtherChoice } from './OtherCausePicker'
import { summaryText, tagLabel } from './text'
import { usePrepareSession } from './usePrepareSession'
import { useTeamCodex } from './useTeamCodex'
import { toNxmUrl } from '@/lib/mediaCore'
import { clipWindow, objectiveTimeOf } from '@/lib/microReview/vodTiming'
import { isRiotRateLimited, riotErrorText } from '@/lib/riotErrors'
import { invalidateCached } from '@/lib/queryCache'
import { placeText, positionKindText, type Place, type PositionKind } from './placeText'
import { AnswerExtrasEditor } from './AnswerExtrasEditor'
import { UndetectedMistakeButton } from './UndetectedMistakeDialog'
import { answerNote, bookmarkLabelOf, extrasOfAnswer, extraTagsPayload, preciseTimesOk, preciseTimesPayload, type AnswerExtras } from './answerExtras'
import { SharedExcerpt } from './SharedExcerpt'
import { useReviewPlayerStore } from '@/store/useReviewPlayerStore'

const panel = 'panel-surface rounded-2xl border border-hextech-border-dim/70 shadow-lg backdrop-blur-sm'

const youtubeId = (url: string) => url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^&?/\s]+)/)?.[1] ?? null

/** `sharedPlayer` (21/11): the page has the recording player; the box drives it instead of showing its own video. */
export function MicroReviewPanel({ gameId, onAnswered, sharedPlayer = false, onFinish }: { gameId: string; onAnswered?: () => void; sharedPlayer?: boolean; onFinish?: () => void }) {
  // Review v2 (spec § 20): in the player's right panel, one column of 328 px; the selector above shows the counts.
  const v2 = sharedPlayer
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
  // Beta.20, the Review's box: the Codex card stays folded until « Conseil Codex » is clicked (per moment).
  const [codexShownFor, setCodexShownFor] = useState<string | null>(null)
  const [xp, setXp] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Post-game: the analysis could not load because Riot is rate-limiting (shown with its wait instead of "unavailable").
  const [loadError, setLoadError] = useState<string | null>(null)
  // 21/11: the player's reasons and extra tags, per moment, until they are sent; the extra key moments asked for.
  const [extrasByKey, setExtrasByKey] = useState<Record<string, AnswerExtras>>({})
  const [more, setMore] = useState<CriticalMoment[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  // « Not a mistake » (DECISIONS 21/11): the moments the player dismissed, and the one whose « Annuler » is still shown.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [undoKey, setUndoKey] = useState<string | null>(null)
  // Back can undo a dismissal while the app runs (NOT_UNDOABLE after a restart): then « Restaurer » goes away.
  const [notUndoable, setNotUndoable] = useState<Set<string>>(new Set())
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current) }, [])
  const [noMore, setNoMore] = useState(false)

  useEffect(() => {
    let alive = true
    setData(undefined)
    setLoadError(null)
    setMore([]); setNoMore(false); setExtrasByKey({})
    window.api.microReviewGet(gameId)
      .then((d) => {
        if (!alive) return
        setData(d)
        const isDismissed = (a: { outcome: string }) => a.outcome === 'dismissed'
        const byKey = Object.fromEntries((d?.answers ?? []).filter((a) => !isDismissed(a)).map((a) => [a.momentKey, a]))
        setAnswers(byKey)
        const gone = new Set([...(d?.dismissedMomentKeys ?? []), ...(d?.answers ?? []).filter(isDismissed).map((a) => a.momentKey)])
        setDismissed(gone)
        setUndoKey(null)
        const firstOpen = (d?.analysis?.moments ?? []).findIndex((m) => !byKey[m.key] && !gone.has(m.key))
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

  // The selector « Micro-review 2 / 3 » (spec § 19) reads the progress from the shared store.
  const setMicroReviewCount = useReviewPlayerStore((s) => s.setMicroReviewCount)
  const momentTitle = (m: CriticalMoment) => (m.facts.pattern ? t(`microReview.pattern.${m.facts.pattern}`) : t(`microReview.trigger.${m.trigger}`))
  const moments = useMemo(() => {
    const base = data?.analysis?.moments ?? []
    return [...base, ...more.filter((m) => !base.some((b) => b.key === m.key))]
  }, [data, more])
  const stats = useMemo(() => (data ? choiceStats(data.pastAnswers, data.role, data.champion) : undefined), [data])
  const cards = useMemo(() => moments.map((m) => buildQcm(m, stats)), [moments, stats])
  const moment = moments[index] ?? null
  const card = cards[index] ?? null
  const answer = moment ? answers[moment.key] : undefined
  // An answer given with a diagnosis since withdrawn is shown back as it was recorded, after the card's own options.
  const legacy = card ? retiredOption(card.options, answer) : null
  const options = card ? (legacy ? [...card.options, legacy] : card.options) : []
  // A dismissed moment counts as handled.
  const handled = (k: string) => !!answers[k] || dismissed.has(k)
  const allDone = moments.length > 0 && moments.every((m) => handled(m.key))
  const answeredCount = moments.filter((m) => handled(m.key)).length
  useEffect(() => {
    if (!v2) return
    setMicroReviewCount(data?.analysis ? { done: answeredCount, total: moments.length } : null)
  }, [v2, data, answeredCount, moments.length, setMicroReviewCount])
  // Next unanswered moment after the current one, wrapping around (-1 when all are answered).
  const nextOpen = moments.map((_, i) => (index + 1 + i) % moments.length).find((i) => i !== index && !handled(moments[i].key)) ?? -1

  // « Not a mistake »: the moment's critical mistake is erased (Back), « Retirée · Annuler » for 5 s, then the next moment.
  const [dismissBusy, setDismissBusy] = useState(false)
  const dismissMoment = async (m: CriticalMoment) => {
    if (!window.api.microReviewDismissMoment) { setError('unavailable'); return }
    setDismissBusy(true)
    setError(null)
    try {
      await window.api.microReviewDismissMoment({ gameId, momentKey: m.key, trigger: m.trigger, gameTimeSec: m.gameTimeSec })
      setDismissed((prev) => new Set(prev).add(m.key))
      setAnswers((prev) => { const next = { ...prev }; delete next[m.key]; return next })
      setPicking(false)
      setUndoKey(m.key)
      if (undoTimer.current) clearTimeout(undoTimer.current)
      const next = nextOpen
      undoTimer.current = setTimeout(() => {
        setUndoKey(null)
        if (next >= 0) setIndex(next)
      }, 5000)
      useReviewPlayerStore.getState().reloadBookmarks()
      onAnswered?.()
    } catch (err) {
      setError((err as Error)?.message ?? 'error')
    } finally {
      setDismissBusy(false)
    }
  }
  const restoreMoment = async (key: string) => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoKey(null)
    try {
      await window.api.microReviewRestoreMoment?.({ gameId, momentKey: key })
      setDismissed((prev) => { const next = new Set(prev); next.delete(key); return next })
      onAnswered?.()
    } catch (err) {
      if (String((err as Error)?.message).includes('NOT_UNDOABLE')) setNotUndoable((prev) => new Set(prev).add(key))
      else setError((err as Error)?.message ?? 'error')
    }
  }

  const submit = useCallback(async (m: CriticalMoment, c: QcmCard, choice: { option?: QcmOption; other?: OtherChoice; again?: MicroReviewAnswerView }) => {
    if (!data) return
    const option = choice.option
    const other = choice.other
    const again = choice.again
    const extras = extrasByKey[m.key] ?? extrasOfAnswer(answers[m.key])
    // A consequence before the error: the box says so under the fields, nothing is sent.
    if (!preciseTimesOk(extras)) return
    setBusy(option?.id ?? (again ? 'again' : 'other'))
    setError(null)
    const outcome = again ? again.outcome : other ? (other.justified ? 'justified' : other.customLabel ? 'custom' : 'mistake') : option!.outcome
    const tagSlug = again ? again.tagSlug : other ? (other.justified ? null : other.tagSlug ?? null) : option!.tagSlug
    const customLabel = !again && other && !other.justified ? other.customLabel ?? null : null
    // The answered moment becomes a marked note at its time: its title and the tag chosen (21/11).
    const title = m.facts.pattern ? t(`microReview.pattern.${m.facts.pattern}`) : t(`microReview.trigger.${m.trigger}`)
    const tagText = outcome === 'justified' ? t('microReview.justifiedBadge') : customLabel ?? (tagSlug ? tagLabel(t, tagSlug, tags.find((x) => x.slug === tagSlug)?.label) : null)
    try {
      const res = await window.api.microReviewAnswer({
        gameId,
        momentKey: m.key,
        trigger: m.trigger,
        gameTimeSec: m.gameTimeSec,
        outcome,
        tagSlug,
        customLabel,
        reason: again ? again.reason : other ? (other.justified ? 'assumed' : null) : option!.reason,
        viaOther: again ? again.viaOther : !!other,
        note: answerNote(again ? again.note : other?.note, extras),
        extraTags: extraTagsPayload(extras, tagSlug),
        ...preciseTimesPayload(extras),
        bookmarkLabel: bookmarkLabelOf(`${fmtClock(clipWindow(m).headerSec)} ${title}`, tagText),
        summary: c.summary,
        // Excerpt start in the VOD, so the coach can jump to it.
        videoTimeSec: data.recording ? Math.max(0, Math.round(clipWindow(m).startSec - deriveOffsetSec({
          gameEndAt: new Date(data.gameEndAt), gameDurationSec: data.durationSec, recordingCreatedAt: new Date(data.recording.createdAt),
          videoDurationSec: data.durationSec, startOffsetSec: data.recording.startOffsetSec,
        }))) : null,
      })
      setAnswers((prev) => ({ ...prev, [m.key]: res.answer }))
      // Sent: the reasons are now in the answer's note, the extra tags saved as mistakes.
      // The precise timestamps come back with the answer (MicroReviewAnswerView).
      setExtrasByKey((prev) => { const next = { ...prev }; delete next[m.key]; return next })
      // « Review courte » (20/11): one answered moment is enough (idempotent; never over a full review).
      window.api.gameMarkShortReview?.(gameId, 'microReview').then(() => invalidateCached('games:')).catch(() => {})
      setPicking(false)
      if (res.xpAwarded > 0) { setXp(res.xpAwarded); addXp(res.xpAwarded) }
      onAnswered?.()
    } catch (err) {
      setError((err as Error)?.message ?? 'error')
    } finally {
      setBusy(null)
    }
  }, [data, gameId, addXp, onAnswered, extrasByKey, answers, t, tags])

  /** « Continuer sur d'autres moments clés » (21/11): the next moments the engine kept aside. */
  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const list = (await window.api.microReviewMoreMoments?.(gameId)) ?? []
      const fresh = list.filter((m) => !moments.some((x) => x.key === m.key))
      if (fresh.length === 0) { setNoMore(true); return }
      setMore((prev) => [...prev, ...fresh])
      setIndex(moments.length)
    } catch {
      setNoMore(true)
    } finally {
      setLoadingMore(false)
    }
  }, [gameId, moments])

  if (data === undefined) {
    return <section className={cn(!v2 && panel, 'flex items-center justify-center gap-2 p-6 text-sm text-hextech-text-dim')}><Loader2 className="h-4 w-4 animate-spin" />{t('microReview.loading')}</section>
  }
  if (!data || !data.analysis) {
    return (
      <section className={cn(!v2 && panel, !v2 && 'p-4')} data-testid="micro-review-unavailable">
        {!v2 && <Header count={0} done={0} />}
        <p className="mt-2 text-xs text-hextech-text-dim">{loadError ?? t(data?.reason === 'unsupported-mode' ? 'microReview.unsupported' : data?.reason === 'previous-season' ? 'microReview.previousSeason' : 'microReview.unavailable')}</p>
      </section>
    )
  }
  if (moments.length === 0) {
    return (
      <section className={cn(!v2 && panel, !v2 && 'p-4')} data-testid="micro-review-none">
        {!v2 && <Header count={0} done={0} />}
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
    <section className={cn(!v2 && panel, !v2 && 'p-4')} data-testid="micro-review">
      {!v2 && <Header count={moments.length} done={doneCount} />}
      {/* § 18.5 L3: the coach's verdicts on my answers of this game. */}
      {data.matchId && <CoachVerdictsForGame matchId={data.matchId} />}

      {/* Queue */}
      <ol className="mt-3 flex flex-wrap gap-2" aria-label={t('microReview.queue')}>
        {moments.map((m, i) => {
          const a = answers[m.key]
          const gone = dismissed.has(m.key)
          return (
            <li key={m.key}>
              <button onClick={() => { setIndex(i); setPicking(false) }} aria-current={i === index} data-dismissed={gone || undefined}
                title={gone ? t('microReview.dismiss.pill') : undefined}
                className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors',
                  i === index ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-border',
                  gone && 'opacity-40 line-through')}>
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                  gone ? 'bg-hextech-elevated text-hextech-text-dim' : a ? 'bg-hextech-green/20 text-hextech-green' : 'bg-hextech-elevated text-hextech-text-bright')}>
                  {gone ? <X className="h-3 w-3" /> : a ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="font-mono font-semibold">{fmtClock(clipWindow(m).headerSec)}</span>
                {!v2 && <span className="hidden sm:inline">{m.facts.pattern ? t(`microReview.pattern.${m.facts.pattern}`) : t(`microReview.trigger.${m.trigger}`)}</span>}
              </button>
            </li>
          )
        })}
      </ol>

      {moment && card && (
        <div className={cn('mt-3', v2 ? 'space-y-3' : 'grid grid-cols-1 gap-4 lg:grid-cols-12')}>
          <div className={cn(v2 ? 'space-y-3' : 'lg:col-span-7')}>
            {v2 ? (
              <>
                {/* Title of the moment + OBJECTIF / MORT, the context in words, « Parcourir dans le lecteur » (spec § 20). */}
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-hextech-gold-bright">{momentTitle(moment)}</span>
                  {(objectiveTimeOf(moment) != null || moment.trigger === 'critical-death') && (
                    <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider',
                      objectiveTimeOf(moment) != null ? 'bg-hextech-gold/15 text-hextech-gold' : 'bg-hextech-red/15 text-hextech-red')}>
                      {t(objectiveTimeOf(moment) != null ? 'microReview.badge.objective' : 'microReview.badge.death')}
                    </span>
                  )}
                </p>
                <QcmHead card={card} headerSec={clipWindow(moment).headerSec} place={moment.place ?? null} positionKind={moment.positionKind ?? null} />
                {data.recording?.filePath && <SharedExcerpt moment={moment} />}
              </>
            ) : <Excerpt data={data} moment={moment} />}
          </div>

          <div className={cn('space-y-3', !v2 && 'lg:col-span-5')}>
            {!v2 && <QcmHead card={card} headerSec={clipWindow(moment).headerSec} place={moment.place ?? null} positionKind={moment.positionKind ?? null} />}
            {dismissed.has(moment.key) ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-hextech-border-dim bg-hextech-black px-3 py-2.5 text-sm" role="status" data-testid="moment-dismissed">
                <span className="text-hextech-text-dim">{t('microReview.dismiss.done')}</span>
                {!notUndoable.has(moment.key) && (
                  <button type="button" onClick={() => void restoreMoment(moment.key)} className="text-xs font-semibold text-hextech-gold hover:underline" data-testid="moment-dismiss-undo">
                    {t(undoKey === moment.key ? 'microReview.dismiss.undo' : 'microReview.dismiss.restore')}
                  </button>
                )}
              </div>
            ) : picking ? (
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
                <button type="button" disabled={!!busy || dismissBusy} onClick={() => void dismissMoment(moment)} data-testid="not-a-mistake"
                  title={t('microReview.dismiss.hint')}
                  className="flex items-center gap-1.5 px-1 pt-1 text-xs text-hextech-text-dim hover:text-hextech-gold disabled:opacity-50">
                  {dismissBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}{t('microReview.dismiss.button')}
                </button>
              </div>
            )}
            {/* 21/11: under « autre cause »: my reasons, and more error tags. */}
            {!picking && (
              <AnswerExtrasEditor key={moment.key} value={extrasByKey[moment.key] ?? extrasOfAnswer(answer)} tags={tags}
                onChange={(next) => setExtrasByKey((prev) => ({ ...prev, [moment.key]: next }))}
                answered={!!answer && answer.outcome !== 'custom'} busy={!!busy}
                onSaveAnswered={() => answer && submit(moment, card, { again: answer })} />
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
                ) : chosenEntry && v2 && codexShownFor !== moment.key ? (
                  <button type="button" onClick={() => setCodexShownFor(moment.key)} data-testid="codex-advice-toggle"
                    className="flex items-center gap-1.5 self-start text-xs text-hextech-gold hover:underline">
                    <BookOpen className="h-3.5 w-3.5" />{t('microReview.codexAdvice')}
                  </button>
                ) : chosenEntry ? (
                  <CodexCard entry={chosenEntry} onPrepare={isRetiredCodex(chosenEntry.id) ? undefined : () => prepare(chosenEntry)} />
                ) : (
                  <p className="text-xs text-hextech-text-dim">{t('codex.none')}</p>
                )}
                {v2 ? (
                  // Pied (spec § 20): the answer is a marked note at its time; « Moment suivant → ».
                  <div className="flex items-center justify-between gap-2 border-t border-hextech-border-dim pt-2">
                    <span className="font-mono text-[10px] text-hextech-text-dim">{data.recording ? t('microReview.savedAsNote', { time: fmtClock(clipWindow(moment).headerSec) }) : ''}</span>
                    {nextOpen >= 0 && <Button size="sm" variant="ghost" className="gap-1 text-hextech-gold" onClick={() => setIndex(nextOpen)}>{t('microReview.next')}<ChevronRight className="h-4 w-4" /></Button>}
                  </div>
                ) : nextOpen >= 0 && (
                  <Button size="sm" className="w-full gap-1.5" onClick={() => setIndex(nextOpen)}>{t('microReview.next')}<ChevronRight className="h-4 w-4" /></Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {allDone && v2 && (
        // Fin de la micro-review (spec § 20).
        <div className="mt-4 space-y-3" data-testid="micro-review-done">
          <p className="flex items-center gap-2 text-sm font-bold text-hextech-gold-bright"><Sparkles className="h-4 w-4" />{t('microReview.doneTitle', { count: moments.length })}</p>
          {xp > 0 && <span className="inline-block rounded-full bg-hextech-gold px-3 py-1 text-xs font-bold text-hextech-black">{t('microReview.doneXp', { xp })}</span>}
          {!noMore && window.api.microReviewMoreMoments && (
            <Button className="w-full gap-1.5" disabled={loadingMore} onClick={loadMore} data-testid="micro-review-more">
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}{t('microReview.more.button')}
            </Button>
          )}
          {noMore && <p className="text-xs text-hextech-text-dim">{t('microReview.more.none')}</p>}
          <div className="space-y-2 rounded-lg border border-hextech-gold/30 bg-hextech-gold/10 p-3">
            <p className="text-sm text-hextech-text-bright">{t('microReview.undetected.question')}</p>
            <UndetectedMistakeButton gameId={gameId} tags={tags} durationSec={data.durationSec} />
          </div>
          {onFinish && <button type="button" onClick={onFinish} className="text-xs text-hextech-gold hover:underline">{t('microReview.finish')}</button>}
        </div>
      )}

      {allDone && !v2 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hextech-gold/30 bg-gradient-to-r from-hextech-gold/15 to-transparent px-4 py-3" data-testid="micro-review-done">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-hextech-gold-bright"><Sparkles className="h-4 w-4" />{t('microReview.done')}</p>
            <p className="mt-0.5 text-xs text-hextech-text">{t('microReview.doneSummary', { mistakes: doneCount - justifiedCount, justified: justifiedCount })}</p>
          </div>
          {xp > 0 && <span className="rounded-full bg-hextech-gold px-3 py-1 text-xs font-bold text-hextech-black">{t('microReview.doneXp', { xp })}</span>}
          {/* 21/11: go on with other key moments, and add the critical mistakes the micro-review missed. */}
          <div className="flex w-full flex-wrap gap-2">
            {!noMore && window.api.microReviewMoreMoments && (
              <Button size="sm" className="gap-1.5" disabled={loadingMore} onClick={loadMore} data-testid="micro-review-more">
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}{t('microReview.more.button')}
              </Button>
            )}
            {noMore && <span className="self-center text-xs text-hextech-text-dim">{t('microReview.more.none')}</span>}
            <UndetectedMistakeButton gameId={gameId} tags={tags} durationSec={data.durationSec} />
          </div>
          <p className="w-full text-[11px] text-hextech-text-dim">{t('microReview.undetected.encourage')}</p>
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

/** `headerSec`: the objective's time on an objective card (vodTiming.clipWindow), the moment's otherwise. */
function QcmHead({ card, headerSec, place, positionKind }: { card: QcmCard; headerSec: number; place: Place | null; positionKind: PositionKind | null }) {
  const { t } = useTranslation()
  const s = summaryText(t, { ...card.summary, gameTimeSec: headerSec })
  // ANALYSIS_VERSION 12: the place in words, and whether the position is exact or estimated (older analyses: the zone).
  const where = place ? placeText(t, place) : s.zone
  const kind = place ? positionKindText(t, positionKind) : null
  return (
    <div>
      <p className="text-sm text-hextech-text-bright" data-testid="micro-review-summary">
        <span className="font-mono font-semibold text-hextech-gold">{s.clock}</span>
        {where && <> • <span className="font-medium">{where}</span></>}
        {' — '}{s.line}
      </p>
      {kind && <p className="mt-0.5 text-[11px] text-hextech-text-dim">{kind}</p>}
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('microReview.question')}</p>
    </div>
  )
}

/** The clip around the moment (vodTiming.clipWindow); its place in words when there is no VOD. */
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
  const win = clipWindow(moment)
  const start = Math.max(0, win.startSec - offset)
  const end = Math.max(start, win.endSec - offset)

  const replay = useCallback(() => {
    const v = ref.current
    if (!v) return
    v.currentTime = start
    v.play().catch(() => {})
  }, [start])
  // Beta.20: no automatic Erreur · Conséquence · Conclusion markers any more (the player sets precise times if they want).
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
          <span>{t('microReview.vod.excerpt', { from: fmtClock(win.startSec), to: fmtClock(win.endSec) })}</span>
          <span className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={replay}><RotateCcw className="h-3 w-3" />{t('microReview.vod.replay')}</Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => navigate(`/record/${rec.id}?at=${Math.round(win.startSec)}`)}><ExternalLink className="h-3 w-3" />{t('microReview.vod.openFull')}</Button>
          </span>
        </div>
      </div>
    )
  }
  const yt = rec?.youtubeUrl ? youtubeId(rec.youtubeUrl) : null
  if (yt) {
    const s = Math.round(start)
    return (
      <div>
        <div className={frame}>
          <iframe key={`${moment.key}@${s}`} title={t('microReview.vod.title')} src={`https://www.youtube.com/embed/${yt}?start=${s}&end=${Math.round(end)}&autoplay=1&mute=1`}
            className="h-full w-full" allow="autoplay; encrypted-media" allowFullScreen />
        </div>
      </div>
    )
  }
  // No recording: no mini-map on the Review (DECISIONS 21/11), the place is in words in the card's head.
  return (
    <p className="flex items-center gap-1.5 rounded-xl border border-hextech-border-dim px-3 py-2 text-[11px] text-hextech-text-dim" data-testid="micro-review-no-vod">
      <MapPin className="h-3 w-3" />{t('microReview.vod.noRecording')}
    </p>
  )
}
