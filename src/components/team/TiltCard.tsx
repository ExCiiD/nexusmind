/**
 * A two-sided card that tilts in 3D under the pointer and flips to show its
 * back (the player cards of Espace d'équipe).
 *
 * - Tilt: the card turns toward the pointer (±9°), a glare follows it, and
 *   the faces can move their layers with the pointer for a parallax: the
 *   tilt element sets `--px` / `--py` (−0.5…0.5) and `--gx` / `--gy` (%) for
 *   them to read, and `--glare` (0…1) while hovered.
 * - Flip: `flipped` turns the card over; the hidden face is inert, so focus
 *   and screen readers stay on the visible one.
 * - `around` is drawn with the front face, outside its clipping (the award
 *   frame); `behind` sits under the card and doesn't tilt (the aura).
 * - Reduced motion: no tilt, no parallax, the flip is instant.
 *
 * Lengths inside the faces can use `cqw` (1 % of the card's width): the
 * scene is a size container.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const MAX_TILT_DEG = 9

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** React 18 doesn't type `inert`; the attribute itself works in Chromium. */
const inertIf = (hidden: boolean) => (hidden ? ({ inert: '' } as Record<string, string>) : {})

interface TiltCardProps {
  front: ReactNode
  back: ReactNode
  flipped: boolean
  around?: ReactNode
  behind?: ReactNode
  className?: string
}

export function TiltCard({ front, back, flipped, around, behind, className }: TiltCardProps) {
  const reduced = usePrefersReducedMotion()
  const tiltRef = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const setPointer = (px: number, py: number, glare: number, fast: boolean) => {
    const el = tiltRef.current
    if (!el) return
    el.style.transitionDuration = fast ? '80ms' : '450ms'
    el.style.transform = glare > 0 ? `rotateX(${(-py * 2 * MAX_TILT_DEG).toFixed(2)}deg) rotateY(${(px * 2 * MAX_TILT_DEG).toFixed(2)}deg)` : ''
    el.style.setProperty('--px', px.toFixed(3))
    el.style.setProperty('--py', py.toFixed(3))
    el.style.setProperty('--gx', `${((px + 0.5) * 100).toFixed(1)}%`)
    el.style.setProperty('--gy', `${((py + 0.5) * 100).toFixed(1)}%`)
    el.style.setProperty('--glare', String(glare))
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType === 'touch') return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = Math.min(0.5, Math.max(-0.5, (e.clientX - rect.left) / rect.width - 0.5))
    const py = Math.min(0.5, Math.max(-0.5, (e.clientY - rect.top) / rect.height - 0.5))
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => setPointer(px, py, 1, true))
  }
  const onPointerLeave = () => {
    cancelAnimationFrame(frame.current)
    setPointer(0, 0, 0, false)
  }

  return (
    <div
      className={cn('group/card relative isolate [container-type:inline-size] [perspective:1100px] hover:z-10 focus-within:z-10', className)}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {behind}
      <div
        ref={tiltRef}
        className="card-motion relative aspect-[1/1.75] transition-transform ease-out [transform-style:preserve-3d] [will-change:transform]"
      >
        <div
          className={cn(
            'card-motion absolute inset-0 [transform-style:preserve-3d]',
            reduced ? '' : 'transition-transform duration-700 ease-[cubic-bezier(0.3,0.9,0.3,1)]',
          )}
          style={{ transform: flipped ? 'rotateY(180deg)' : undefined }}
        >
          <div className="absolute inset-0 [backface-visibility:hidden]" aria-hidden={flipped || undefined} {...inertIf(flipped)}>
            {front}
          </div>
          {around && (
            <div className="pointer-events-none absolute inset-0 [backface-visibility:hidden]" style={{ transform: 'translateZ(2px)' }}>
              {around}
            </div>
          )}
          <div
            className="absolute inset-0 [backface-visibility:hidden]"
            style={{ transform: 'rotateY(180deg)' }}
            aria-hidden={!flipped || undefined}
            {...inertIf(!flipped)}
          >
            {back}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The light that follows the pointer over a tilted face: put it last in the face. */
export function CardGlare() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 mix-blend-soft-light transition-opacity duration-300"
      style={{
        opacity: 'var(--glare, 0)',
        background: 'radial-gradient(circle at var(--gx, 50%) var(--gy, 50%), rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.12) 28%, transparent 60%)',
      }}
    />
  )
}

/** Parallax offset for a layer of a tilted face: `depth` px at the edges
 *  (negative moves against the pointer, as if further back). */
export function parallax(depth: number, extra = ''): string {
  return `translate3d(calc(var(--px, 0) * ${depth}px), calc(var(--py, 0) * ${depth}px), 0) ${extra}`.trim()
}
