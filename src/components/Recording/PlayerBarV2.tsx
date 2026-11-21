import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, Ban, Bookmark, Bug, Castle, ChevronDown, Crown, Eye, Flame, Pause, Pencil, Play, RotateCcw, RotateCw, Scissors, SkipBack, SkipForward, Skull, Swords, Target, Volume2, VolumeX, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMs } from '@/lib/mediaCore'
import { groupMarkers, markerOpacity, rowOfLayer, type PlayerLayer, type PlayerLayers } from '@/lib/playerLayers'

/** Colours and glyphs of the markers (spec § 19). */
export const LAYER_STYLE: Record<PlayerLayer, { color: string; Icon: LucideIcon }> = {
  notes: { color: '#D4A24C', Icon: Bookmark },
  microReview: { color: '#E66556', Icon: Target },
  mistakes: { color: '#E3A35B', Icon: AlertTriangle },
  deaths: { color: '#B5A68C', Icon: Skull },
  dragon: { color: '#E08A3C', Icon: Flame },
  baron: { color: '#A97BF0', Icon: Crown },
  herald: { color: '#6FA0D8', Icon: Eye },
  grubs: { color: '#5FB38A', Icon: Bug },
  turrets: { color: '#8C96A3', Icon: Castle },
  inhibs: { color: '#D86FA0', Icon: Ban },
  fights: { color: '#E4D9C4', Icon: Swords },
}

export interface BarMarker { time: number; layer: PlayerLayer; label: string }
export interface BarClipWindow { start: number; end: number }

const fmt = (sec: number) => formatMs(Math.max(0, sec) * 1000)
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

/**
 * Player bar v2 of the Review's single player (DECISIONS 21/11, approved; spec § 19): icon markers above the
 * timeline (you on top, the game below a dotted line), grouped under 26 px into pills, a 5 px timeline with its
 * playhead, the hours line with « Filtres », then the controls: previous / −10 / play / +10 / next moment, volume,
 * time; speed, Clip (C), Erreur (E), Prise de note (N), right panel, fullscreen. In micro-review mode the moment's
 * window is highlighted, its three lines stand out, and the markers outside it fade.
 */
export function PlayerBarV2(p: {
  currentTime: number
  duration: number
  playing: boolean
  onTogglePlay: () => void
  onSkip: (deltaSec: number) => void
  onSeek: (sec: number) => void
  volume: number
  muted: boolean
  onVolume: (v: number) => void
  onToggleMute: () => void
  speed: number
  onSpeed: (s: number) => void
  markers: BarMarker[]
  clipWindow: BarClipWindow | null
  layers: PlayerLayers
  onLayersChange: (next: PlayerLayers) => void
  hideMistakes?: boolean
  /** The filter chips (beta.20), under the timeline, in place of the « Filtres » menu. */
  filters?: ReactNode
  /**
   * Clip mode (DECISIONS 21/11 « Mode clip, nouvelle interface »): the handles « Début » / « Fin » above the timeline
   * (seconds), joined by a bracket with the duration; dimmed while the clip is on hold (the playhead was used).
   */
  clipEdit?: { start: number; end: number; label: string; hold: boolean; onGrab: () => void; onDrag: (which: 'start' | 'end', sec: number) => void; onDrop: () => void }
  /** The compact clip block (duration, Valider, Annuler), under the timeline while clipping. */
  clipBlock?: ReactNode
  onClip?: () => void
  onMistake?: () => void
  onNote?: () => void
  /** Pop-overs anchored above the bar (Prise de note, Erreur). */
  overlay?: ReactNode
  /** Right end of the controls (beta.20): switch side, hide panel, fullscreen. */
  trailing?: ReactNode
}) {
  const { t } = useTranslation()
  const trackRef = useRef<HTMLDivElement>(null)
  // The track's width for the 26 px grouping (a hidden pane renders no frames: 680 px until measured).
  const [width, setWidth] = useState(680)
  const [hover, setHover] = useState<{ x: number; sec: number } | null>(null)
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => { if (el.clientWidth > 0) setWidth(el.clientWidth) }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  const [speedOpen, setSpeedOpen] = useState(false)
  const speedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!speedOpen) return
    const close = (e: MouseEvent) => { if (!speedRef.current?.contains(e.target as Node)) setSpeedOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [speedOpen])

  const d = Math.max(p.duration, 0.001)
  const pct = (s: number) => Math.min(100, Math.max(0, (s / d) * 100))
  const win = p.clipWindow ? { start: p.clipWindow.start, end: p.clipWindow.end } : null
  const self = groupMarkers(p.markers.filter((m) => rowOfLayer(m.layer) === 'self'), d, width)
  const game = groupMarkers(p.markers.filter((m) => rowOfLayer(m.layer) === 'game'), d, width)
  const sorted = [...p.markers].sort((a, b) => a.time - b.time)
  const prevMoment = [...sorted].reverse().find((m) => m.time < p.currentTime - 1)
  const nextMoment = sorted.find((m) => m.time > p.currentTime + 1)

  const seekFromEvent = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    p.onSeek(Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * d)
  }
  const row = (groups: ReturnType<typeof groupMarkers<BarMarker>>, testid: string) => (
    <div className="relative h-[22px]" data-testid={testid}>
      {groups.map((g) => {
        const first = g.items[0]
        const tip = g.items.map((m) => `${fmt(m.time)} · ${m.label}`).join('\n')
        return (
          <button key={`${testid}-${g.time}`} type="button" title={tip} aria-label={tip} onClick={() => p.onSeek(first.time)}
            className="absolute top-1/2 flex h-[18px] -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full border px-[3px] transition-transform hover:scale-110"
            style={{ left: `${pct(g.time)}%`, opacity: markerOpacity(g.time, win), borderColor: LAYER_STYLE[g.glyphs[0]].color, backgroundColor: `${LAYER_STYLE[g.glyphs[0]].color}29` }}>
            {g.glyphs.map((l) => { const { Icon, color } = LAYER_STYLE[l]; return <Icon key={l} className="h-[11px] w-[11px]" style={{ color }} strokeWidth={2.5} /> })}
            {g.count > 1 && <span className="font-mono text-[9px] font-bold leading-none text-hextech-text-bright">{g.count}</span>}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="relative bg-hextech-black p-3" data-testid="player-bar-v2">
      {p.overlay}
      {/* Clip mode: the handles' zone covers the markers and the track, their lines go down to the bar. */}
      <div className={cn('relative', p.clipEdit && 'pt-10')} data-testid={p.clipEdit ? 'clip-zone' : undefined}>
      {p.clipEdit && (() => {
        const c = p.clipEdit
        const secAt = (clientX: number) => {
          const box = trackRef.current?.getBoundingClientRect()
          return box && box.width > 0 ? Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * d : 0
        }
        const handle = (which: 'start' | 'end', sec: number) => (
          <div key={which} className="absolute top-0 bottom-2 z-20 w-0" style={{ left: `${pct(sec)}%` }}>
            <button type="button" data-testid={`clip-handle-${which}`} aria-label={t(which === 'start' ? 'recording.clip.handleStart' : 'recording.clip.handleEnd')}
              title={`${t(which === 'start' ? 'recording.clip.handleStart' : 'recording.clip.handleEnd')} · ${fmt(sec)}`}
              className={cn('absolute top-0 flex h-6 cursor-ew-resize touch-none items-center gap-1 whitespace-nowrap rounded px-1.5 text-[10px] font-bold uppercase tracking-wider shadow',
                which === 'start' ? 'left-0 rounded-bl-none' : 'right-0 rounded-br-none',
                c.hold ? 'bg-hextech-gold/35 text-hextech-black/70' : 'bg-hextech-gold text-hextech-black')}
              onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); c.onGrab() }}
              onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture?.(e.pointerId)) c.onDrag(which, secAt(e.clientX)) }}
              onPointerUp={() => c.onDrop()}>
              {t(which === 'start' ? 'recording.clip.handleStart' : 'recording.clip.handleEnd')}
              <span className="font-mono font-semibold normal-case opacity-70">{fmt(sec)}</span>
            </button>
            <span aria-hidden className={cn('pointer-events-none absolute bottom-0 top-0 w-[2px] -translate-x-1/2', c.hold ? 'bg-hextech-gold/35' : 'bg-hextech-gold')} />
          </div>
        )
        return (
          <>
            {/* The bracket between the handles, with the duration. */}
            <div aria-hidden data-testid="clip-bracket" className={cn('pointer-events-none absolute top-7 z-10 h-2 border-x-2 border-t-2', c.hold ? 'border-hextech-gold/35' : 'border-hextech-gold')}
              style={{ left: `${pct(c.start)}%`, width: `${Math.max(0, pct(c.end) - pct(c.start))}%` }}>
              <span className={cn('absolute -top-2.5 left-1/2 -translate-x-1/2 rounded bg-hextech-black px-1 font-mono text-[10px] font-semibold', c.hold ? 'text-hextech-gold/50' : 'text-hextech-gold-bright')}>{c.label}</span>
            </div>
            <div aria-hidden className={cn('pointer-events-none absolute bottom-[3px] z-[5] h-[11px] rounded-sm', c.hold ? 'bg-hextech-gold/10' : 'bg-hextech-gold/25')}
              style={{ left: `${pct(c.start)}%`, width: `${Math.max(0, pct(c.end) - pct(c.start))}%` }} />
            {handle('start', c.start)}
            {handle('end', c.end)}
          </>
        )
      })()}
      {/* Markers: you on top, the game below a dotted line; the micro-review window as a gold band. */}
      <div className="relative">
        {win && <div aria-hidden className="absolute inset-y-0 rounded bg-hextech-gold/[0.08]" style={{ left: `${pct(win.start)}%`, width: `${pct(win.end) - pct(win.start)}%` }} />}
        {row(self, 'bar-row-self')}
        {game.length > 0 && <><div className="border-t border-dashed border-hextech-border-dim" />{row(game, 'bar-row-game')}</>}
      </div>

      {/* Timeline 5 px: played in gold, the playhead with its thin line up to the markers. */}
      <div ref={trackRef} className="relative mt-1 h-4 cursor-pointer touch-none"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); seekFromEvent(e.clientX) }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) seekFromEvent(e.clientX)
          // Beta.20: the time under the pointer, in a small label above the track.
          const r = e.currentTarget.getBoundingClientRect()
          if (r.width > 0) setHover({ x: Math.max(0, Math.min(r.width, e.clientX - r.left)), sec: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d })
        }}
        onPointerLeave={() => setHover(null)}
        role="slider" tabIndex={0} aria-label={t('recording.bar.timeline')} aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(p.currentTime)} aria-valuetext={fmt(p.currentTime)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); p.onSkip(-5) }
          if (e.key === 'ArrowRight') { e.preventDefault(); p.onSkip(5) }
        }}>
        <div className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 rounded-[2.5px] bg-hextech-border-dim" />
        <div className="absolute left-0 top-1/2 h-[5px] -translate-y-1/2 rounded-[2.5px] bg-hextech-gold" style={{ width: `${pct(p.currentTime)}%` }} />
        {p.clipWindow && (
          <>
            <div aria-hidden data-testid="clip-window" className="absolute top-1/2 h-[11px] -translate-y-1/2 rounded-sm border border-hextech-gold-bright bg-hextech-gold/[0.18]"
              style={{ left: `${pct(p.clipWindow.start)}%`, width: `${pct(p.clipWindow.end) - pct(p.clipWindow.start)}%` }} />
          </>
        )}
        {hover && (
          <span aria-hidden data-testid="bar-hover-time" className="pointer-events-none absolute bottom-full z-30 mb-1.5 -translate-x-1/2 rounded bg-black/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white shadow"
            style={{ left: hover.x }}>{fmt(hover.sec)}</span>
        )}
        <span aria-hidden className="pointer-events-none absolute bottom-1/2 w-px bg-[#E4C285]/70" style={{ left: `${pct(p.currentTime)}%`, height: 56 }} />
        <span aria-hidden className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E4C285] shadow" style={{ left: `${pct(p.currentTime)}%` }} />
      </div>
      </div>
      {p.clipBlock}
      {p.clipWindow && !p.clipEdit && (
        <p className="mt-0.5 text-center font-mono text-[10px] text-hextech-gold">{t('recording.bar.microReview', { from: fmt(p.clipWindow.start), to: fmt(p.clipWindow.end) })}</p>
      )}

      {/* Hours line + Filtres. */}
      <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-hextech-text-dim">
        <span className="text-xs" data-testid="bar-time" aria-live="off"><span className="text-hextech-gold-bright">{fmt(p.currentTime)}</span> / {fmt(p.duration)}</span>
        <span className="flex-1" />
        {p.filters && <div className="min-w-0 font-sans">{p.filters}</div>}
      </div>

      {/* Controls. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 basis-0 items-center gap-1.5" data-testid="bar-transport">
        <IconBtn label={t('recording.bar.prevMoment')} disabled={!prevMoment} onClick={() => prevMoment && p.onSeek(prevMoment.time)}><SkipBack className="h-4 w-4" /></IconBtn>
        <IconBtn label={t('recording.bar.back10')} onClick={() => p.onSkip(-10)}><RotateCcw className="h-4 w-4" /></IconBtn>
        <button type="button" onClick={p.onTogglePlay} aria-label={p.playing ? t('recording.bar.pause') : t('recording.bar.play')}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-hextech-gold text-hextech-black shadow hover:bg-hextech-gold-bright">
          {p.playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <IconBtn label={t('recording.bar.fwd10')} onClick={() => p.onSkip(10)}><RotateCw className="h-4 w-4" /></IconBtn>
        <IconBtn label={t('recording.bar.nextMoment')} disabled={!nextMoment} onClick={() => nextMoment && p.onSeek(nextMoment.time)}><SkipForward className="h-4 w-4" /></IconBtn>
        <div className="group flex items-center">
          <IconBtn label={p.muted ? t('recording.bar.unmute') : t('recording.bar.mute')} onClick={p.onToggleMute}>
            {p.muted || p.volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </IconBtn>
          <input type="range" min={0} max={1} step={0.05} value={p.muted ? 0 : p.volume} onChange={(e) => p.onVolume(Number(e.target.value))}
            aria-label={t('recording.bar.volume')} className="w-0 opacity-0 transition-all group-hover:w-20 group-hover:opacity-100 focus:w-20 focus:opacity-100 accent-[var(--hextech-gold)]" />
        </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5" data-testid="bar-actions">
        <div ref={speedRef} className="relative">
          <button type="button" onClick={() => setSpeedOpen((v) => !v)} aria-expanded={speedOpen} aria-label={t('recording.bar.speed')}
            className="flex items-center gap-0.5 rounded-md border border-hextech-border-dim px-2 py-1.5 font-mono text-xs text-hextech-text hover:border-hextech-gold/50">
            {p.speed}× <ChevronDown className="h-3 w-3" />
          </button>
          {speedOpen && (
            <div role="menu" className="absolute bottom-full right-0 z-40 mb-1 rounded-md border border-hextech-border bg-hextech-elevated py-1 shadow-xl">
              {SPEEDS.map((s) => (
                <button key={s} type="button" role="menuitemradio" aria-checked={p.speed === s} onClick={() => { p.onSpeed(s); setSpeedOpen(false) }}
                  className={cn('block w-full px-3 py-1 text-left font-mono text-xs hover:bg-hextech-gold/10', p.speed === s ? 'text-hextech-gold-bright' : 'text-hextech-text')}>
                  {s}×
                </button>
              ))}
            </div>
          )}
        </div>
        {p.onClip && (
          <button type="button" onClick={p.onClip} title={t('recording.clip.buttonHint')} data-testid="clip-button"
            className="flex h-[34px] items-center gap-1.5 rounded-lg border border-hextech-border px-3 text-sm text-hextech-text hover:border-hextech-gold/60 hover:text-hextech-gold-bright">
            <Scissors className="h-4 w-4" />{t('recording.clip.button')}
          </button>
        )}
        {p.onMistake && (
          <button type="button" onClick={p.onMistake} title={t('recording.bar.mistakeHint')} data-testid="mistake-button"
            className="flex h-[34px] items-center gap-1.5 rounded-lg border border-[#E3A35B] px-3 text-sm text-[#E3A35B] hover:bg-[#E3A35B]/10">
            <AlertTriangle className="h-4 w-4" />{t('recording.bar.mistake')}
            <kbd className="rounded bg-black/25 px-1 font-mono text-[10px]">E</kbd>
          </button>
        )}
        {p.onNote && (
          <button type="button" onClick={p.onNote} title={t('recording.note.hint')} data-testid="take-note-button"
            className="flex h-[34px] items-center gap-1.5 rounded-lg bg-hextech-gold px-[14px] text-sm font-semibold text-hextech-black hover:bg-hextech-gold-bright">
            <Pencil className="h-4 w-4" />{t('recording.note.button')}
            <kbd className="rounded bg-black/25 px-1 font-mono text-[10px]">N</kbd>
          </button>
        )}
        </div>

        <div className="flex flex-1 basis-0 items-center justify-end gap-1" data-testid="bar-trailing">{p.trailing}</div>
      </div>
    </div>
  )
}

export function IconBtn({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} aria-pressed={pressed}
      className={cn('flex h-8 w-8 items-center justify-center rounded-md text-hextech-text transition-colors hover:bg-white/5 hover:text-hextech-gold-bright disabled:opacity-30',
        pressed && 'text-hextech-gold-bright')}>
      {children}
    </button>
  )
}
