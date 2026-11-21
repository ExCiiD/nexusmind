import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RotateCw, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatMs, parseMmSs } from '@/lib/mediaCore'
import { CLIP_PRESETS_SEC, MAX_CLIP_MS, MIN_CLIP_MS, clipZoomWindow, presetClipRange, type ClipRange } from '@/lib/clipEdit'

/**
 * Clip mode of the Review player (DECISIONS 21/11 « interface clip user friendly », approved; spec § 19 « Mode clip »):
 * gold-outlined bar with the game's overview (zoomed zone framed, clip in gold-bright), a timeline zoomed about ± 2 min
 * around the clip with two grooved handles and the duration bubble, then the « Nouveau clip » panel: Début / Fin
 * (I / O), DURÉE presets and the micro-review moment, title, ↻ Aperçu, Annuler (Échap), Enregistrer le clip (Entrée).
 */
export function ClipModePanel({
  range, onChange, durationMs, playheadMs, title, onTitle, previewing, onTogglePreview, momentRange, onSeek, onCancel, onSave, saving,
}: {
  range: ClipRange
  onChange: (r: ClipRange) => void
  durationMs: number
  playheadMs: number
  title: string
  onTitle: (s: string) => void
  previewing: boolean
  onTogglePreview: () => void
  /** The micro-review moment's window (video ms), when one is open. */
  momentRange: ClipRange | null
  onSeek: (ms: number) => void
  onCancel: () => void
  onSave: () => void
  saving: boolean
}) {
  const { t } = useTranslation()
  // The zoomed window: set when the clip opens or jumps, kept while a handle is dragged (no jumping track).
  const [zoom, setZoom] = useState(() => clipZoomWindow(range, durationMs))
  const dragging = useRef<'start' | 'end' | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (dragging.current) return
    if (range.startMs < zoom.fromMs || range.endMs > zoom.toMs || zoom.toMs - zoom.fromMs < 1) setZoom(clipZoomWindow(range, durationMs))
  }, [range.startMs, range.endMs, durationMs]) // eslint-disable-line react-hooks/exhaustive-deps -- only when the clip leaves the window

  const [startText, setStartText] = useState(formatMs(range.startMs))
  const [endText, setEndText] = useState(formatMs(range.endMs))
  useEffect(() => { setStartText(formatMs(range.startMs)); setEndText(formatMs(range.endMs)) }, [range.startMs, range.endMs])

  const span = Math.max(1, zoom.toMs - zoom.fromMs)
  const pct = (ms: number) => ((ms - zoom.fromMs) / span) * 100
  const overviewPct = (ms: number) => (durationMs > 0 ? (ms / durationMs) * 100 : 0)
  const lengthMs = range.endMs - range.startMs

  const msAt = (clientX: number) => {
    const el = trackRef.current
    if (!el) return 0
    const box = el.getBoundingClientRect()
    return zoom.fromMs + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * span
  }
  const startDrag = (which: 'start' | 'end') => (e: ReactPointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    dragging.current = which
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent) => {
    if (!dragging.current) return
    const ms = Math.round(msAt(e.clientX))
    if (dragging.current === 'start') {
      const startMs = Math.min(Math.max(ms, range.endMs - MAX_CLIP_MS, 0), range.endMs - MIN_CLIP_MS)
      onChange({ startMs, endMs: range.endMs })
    } else {
      const endMs = Math.max(Math.min(ms, range.startMs + MAX_CLIP_MS, durationMs || Infinity), range.startMs + MIN_CLIP_MS)
      onChange({ startMs: range.startMs, endMs })
    }
  }
  const endDrag = () => { dragging.current = null }

  const applyText = (which: 'start' | 'end') => {
    const ms = parseMmSs(which === 'start' ? startText : endText)
    if (ms == null) { setStartText(formatMs(range.startMs)); setEndText(formatMs(range.endMs)); return }
    if (which === 'start') onChange({ startMs: Math.min(Math.max(0, ms, range.endMs - MAX_CLIP_MS), range.endMs - MIN_CLIP_MS), endMs: range.endMs })
    else onChange({ startMs: range.startMs, endMs: Math.max(Math.min(ms, range.startMs + MAX_CLIP_MS), range.startMs + MIN_CLIP_MS) })
  }
  const presetActive = (s: number) => Math.abs(lengthMs - s * 1000) < 500
  const momentActive = !!momentRange && Math.abs(range.startMs - momentRange.startMs) < 500 && Math.abs(range.endMs - momentRange.endMs) < 500

  return (
    <div className="space-y-3 rounded-lg border border-hextech-gold bg-hextech-black p-3" data-testid="clip-mode">
      {/* Overview of the whole game: the zoomed zone framed in gold, the clip in gold-bright. */}
      <div className="relative h-[3px] w-full rounded-full bg-hextech-border-dim" aria-hidden>
        <div className="absolute -inset-y-[3px] rounded-sm border border-hextech-gold" style={{ left: `${overviewPct(zoom.fromMs)}%`, width: `${overviewPct(zoom.toMs) - overviewPct(zoom.fromMs)}%` }} />
        <div className="absolute inset-y-0 rounded-full bg-hextech-gold-bright" style={{ left: `${overviewPct(range.startMs)}%`, width: `${Math.max(0.3, overviewPct(range.endMs) - overviewPct(range.startMs))}%` }} />
      </div>

      {/* The zoomed timeline: selection, two grooved handles, duration bubble, playhead. */}
      <div className="pt-6">
        <div ref={trackRef} className="relative h-[34px] cursor-pointer touch-none select-none rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold" data-testid="clip-track"
          role="slider" tabIndex={0} aria-label={t('recording.clip.track')}
          aria-valuemin={Math.round(zoom.fromMs / 1000)} aria-valuemax={Math.round(zoom.toMs / 1000)} aria-valuenow={Math.round(playheadMs / 1000)} aria-valuetext={formatMs(playheadMs)}
          onKeyDown={(e) => {
            // ← / → move the playhead by 1 s inside the zoomed window.
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault(); e.stopPropagation()
            onSeek(Math.min(zoom.toMs, Math.max(zoom.fromMs, playheadMs + (e.key === 'ArrowLeft' ? -1000 : 1000))))
          }}
          onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onClick={(e) => { if (!dragging.current) onSeek(Math.round(msAt(e.clientX))) }}>
          <div className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 rounded-[2.5px] bg-hextech-border-dim" />
          <div className="absolute top-1/2 h-[26px] -translate-y-1/2 rounded-sm border border-hextech-gold-bright bg-hextech-gold-bright/[0.22]"
            style={{ left: `${pct(range.startMs)}%`, width: `${pct(range.endMs) - pct(range.startMs)}%` }}>
            <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-hextech-elevated px-1.5 py-0.5 font-mono text-[10px] font-bold text-hextech-gold-bright">
              {formatMs(lengthMs)}
            </span>
          </div>
          {(['start', 'end'] as const).map((which) => (
            <button key={which} type="button" aria-label={t(which === 'start' ? 'recording.clip.start' : 'recording.clip.end')}
              data-testid={`clip-handle-${which}`} onPointerDown={startDrag(which)} onClick={(e) => e.stopPropagation()}
              className="absolute top-1/2 z-10 flex h-[26px] w-[10px] -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center gap-[2px] rounded-sm bg-hextech-gold-bright shadow"
              style={{ left: `${pct(which === 'start' ? range.startMs : range.endMs)}%` }}>
              <span className="h-3 w-px bg-hextech-black/60" /><span className="h-3 w-px bg-hextech-black/60" />
            </button>
          ))}
          {playheadMs >= zoom.fromMs && playheadMs <= zoom.toMs && (
            <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-[#E4C285]" style={{ left: `${pct(playheadMs)}%` }}>
              <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E4C285]" />
            </div>
          )}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-hextech-text-dim">
          <span>{formatMs(zoom.fromMs)}</span>
          <span>{t('recording.clip.zoomHint')}</span>
          <span>{formatMs(zoom.toMs)}</span>
        </div>
      </div>

      {/* « Nouveau clip » */}
      <div className="space-y-3 rounded-md bg-hextech-elevated p-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-hextech-text-bright"><Scissors className="h-4 w-4 text-hextech-gold" />{t('recording.clip.new')}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(['start', 'end'] as const).map((which) => (
            <label key={which} className="flex items-center gap-1.5 text-hextech-text-dim">
              {t(`recording.clip.${which}`)}
              <input value={which === 'start' ? startText : endText} aria-label={t(`recording.clip.${which}`)}
                onChange={(e) => (which === 'start' ? setStartText : setEndText)(e.target.value)}
                onBlur={() => applyText(which)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); applyText(which) } }}
                className="w-16 rounded border border-hextech-border-dim bg-hextech-black px-2 py-1 text-center font-mono text-hextech-text-bright focus:border-hextech-gold focus:outline-none" />
              <kbd className="rounded bg-hextech-black px-1 font-mono text-[10px] text-hextech-text-dim">{which === 'start' ? 'I' : 'O'}</kbd>
            </label>
          ))}
          <span className="font-mono text-hextech-text">= {formatMs(lengthMs)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('recording.clip.duration')}>
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('recording.clip.duration')}</span>
          {CLIP_PRESETS_SEC.map((s) => (
            <button key={s} type="button" aria-pressed={presetActive(s)} onClick={() => onChange(presetClipRange(playheadMs, s, durationMs))}
              className={cn('rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-colors',
                presetActive(s) ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-gold/50')}>
              {s < 60 ? `${s} s` : `${s / 60} min`}
            </button>
          ))}
          {momentRange && (
            <button type="button" aria-pressed={momentActive} onClick={() => onChange(momentRange)}
              className={cn('rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                momentActive ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text hover:border-hextech-gold/50')}>
              {t('recording.clip.moment')}
            </button>
          )}
        </div>
        <input value={title} onChange={(e) => onTitle(e.target.value)} maxLength={120} placeholder={t('recording.clip.title')} aria-label={t('recording.clip.title')}
          className="w-full rounded border border-hextech-border-dim bg-hextech-black px-3 py-1.5 text-sm text-hextech-text placeholder:text-hextech-text-dim focus:border-hextech-gold focus:outline-none" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" variant="outline" aria-pressed={previewing} onClick={onTogglePreview}
            className={cn('gap-1.5', previewing && 'border-hextech-gold text-hextech-gold-bright')}>
            <RotateCw className="h-3.5 w-3.5" />{t('recording.clip.preview')}
          </Button>
          <span className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              {t('common.cancel')} <kbd className="ml-1.5 rounded bg-hextech-black px-1 font-mono text-[10px] text-hextech-text-dim">{t('recording.clip.escKey')}</kbd>
            </Button>
            <Button type="button" size="sm" onClick={onSave} disabled={saving} data-testid="clip-save">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
              <span className="ml-1.5">{t('recording.clip.save')}</span>
              <kbd className="ml-1.5 rounded bg-black/20 px-1 font-mono text-[10px]">↵</kbd>
            </Button>
          </span>
        </div>
      </div>
    </div>
  )
}
