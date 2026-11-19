/**
 * A position icon of the user's set (src/lib/roleGlyphs.ts) as inline SVG.
 * `current` draws in the text colour (set it with a text-* class), `white`
 * and `gold` are fixed, `gradient` is the hextech gold gradient. The shaded
 * half of the lane icons stays shaded in every tone.
 */
import { useId } from 'react'
import { DIM_OPACITY, GLYPH_VIEWBOX, GOLD, GOLD_GRADIENT, ROLE_GLYPHS, type GlyphRole } from '@/lib/roleGlyphs'
import { cn } from '@/lib/utils'

export type RoleGlyphTone = 'current' | 'white' | 'gold' | 'gradient'

interface RoleGlyphProps {
  role: GlyphRole
  tone?: RoleGlyphTone
  className?: string
  /** Accessible name; without it the icon is decorative. */
  title?: string
}

export function RoleGlyph({ role, tone = 'current', className, title }: RoleGlyphProps) {
  const gradientId = `role-glyph-${useId().replace(/:/g, '')}`
  const fill = tone === 'white' ? '#FFFFFF' : tone === 'gold' ? GOLD : tone === 'gradient' ? `url(#${gradientId})` : 'currentColor'
  const parts = ROLE_GLYPHS[role] ?? ROLE_GLYPHS.MID
  return (
    <svg
      viewBox={GLYPH_VIEWBOX}
      className={cn('h-4 w-4 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {tone === 'gradient' && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            {GOLD_GRADIENT.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
          </linearGradient>
        </defs>
      )}
      {/* The shaded half stays neutral in the fixed tones, as in the set. */}
      {parts.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.dim && tone !== 'current' ? '#FFFFFF' : fill}
          fillOpacity={p.dim ? DIM_OPACITY : undefined}
        />
      ))}
    </svg>
  )
}
