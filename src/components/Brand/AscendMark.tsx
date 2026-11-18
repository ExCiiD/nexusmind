/**
 * The Ascend mark, "A d’éclats" (chosen on 2026-11-18): a solid A whose top bursts into gold
 * fragments. Masters live in src/assets/brand/*.svg (Penpot page "Logo — Ascend").
 *
 * - variant "small" (no chips, tighter burst) is the one to use under 64 px; it is picked
 *   automatically from `size` unless `variant` is given.
 * - The brand colours are fixed on purpose: the mark does not follow the colour theme.
 *   tone "dark" = on a dark background, "light" = on a light one, "gold" = one colour.
 */
import type { SVGProps } from 'react'

type Part = readonly ['trunk' | 'burst', string]

const FULL: readonly Part[] = [
  ['trunk', 'M72.51 101.36 L127.49 101.36 L161.67 190 L130.83 190 L120.74 155.31 L79.26 155.31 L69.17 190 L38.33 190 Z M83.74 139.9 L116.26 139.9 L105.05 101.36 L94.95 101.36 Z'],
  ['burst', 'M104.18 10 L108.24 28.98 L97.38 35.52 L96.88 22.6 Z'],
  ['burst', 'M79.82 37.2 L84.72 49.16 L91.04 62.69 L92.05 72.65 L90.51 89.56 L69.8 93.58 Z'],
  ['burst', 'M119.77 38.92 L131.63 89.98 L110.74 87.04 L108.31 70.24 L110.6 60.5 L109.02 45.64 Z'],
  ['burst', 'M82.66 33.91 L87.47 28.13 L89.4 36.8 Z'],
  ['burst', 'M115.42 26.2 L121.2 31.02 L114.45 34.87 Z'],
  ['burst', 'M67.24 62.82 L72.06 57.03 L73.99 65.71 Z'],
  ['burst', 'M132.76 57.03 L138.54 61.85 L131.8 65.71 Z'],
]

const SMALL: readonly Part[] = [
  ['trunk', 'M69.87 98.83 L130.13 98.83 L167.6 196 L133.8 196 L122.74 157.98 L77.26 157.98 L66.2 196 L32.4 196 Z M82.18 141.08 L117.82 141.08 L105.53 98.83 L94.47 98.83 Z'],
  ['burst', 'M104.04 4 L108.3 23.92 L96.91 30.78 L96.38 17.22 Z'],
  ['burst', 'M80.01 32.02 L85.15 44.58 L91.78 58.79 L92.84 69.23 L91.22 86.98 L69.49 91.2 Z'],
  ['burst', 'M119.54 34.37 L132 87.95 L110.07 84.87 L107.52 67.24 L109.92 57.01 L108.27 41.42 Z'],
]

const TONES = {
  dark: { trunk: '#F5E3BE', burst: '#D4A24C' },
  light: { trunk: '#0D0A06', burst: '#9A6B22' },
  gold: { trunk: '#D4A24C', burst: '#D4A24C' },
} as const

export interface AscendMarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Rendered width and height in px. */
  size?: number
  variant?: 'full' | 'small'
  tone?: keyof typeof TONES
  /** Accessible name; without it the mark is decorative (aria-hidden). */
  title?: string
}

export function AscendMark({ size = 32, variant, tone = 'dark', title, ...rest }: AscendMarkProps) {
  const parts = (variant ?? (size >= 64 ? 'full' : 'small')) === 'full' ? FULL : SMALL
  const colors = TONES[tone]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {parts.map(([role, d], i) => (
        <path key={i} d={d} fill={role === 'trunk' ? colors.trunk : colors.burst} />
      ))}
    </svg>
  )
}
