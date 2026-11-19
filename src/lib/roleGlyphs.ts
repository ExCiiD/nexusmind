/**
 * The position icons of the team pages (the user's own set): one 48×48
 * drawing per role, as SVG paths. `dim` parts are the shaded half of the
 * lane icons (the map seen from the role's corner) and the centre square.
 *
 * One source for the inline component (src/components/team/RoleGlyph.tsx)
 * and the asset files (src/assets/roles/*.svg, written by
 * scripts/gen-role-icons.ts).
 */
export type GlyphRole = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'

export interface GlyphPart {
  d: string
  /** Drawn at DIM_OPACITY: the shaded half of the lane icons. */
  dim?: boolean
}

export const GLYPH_VIEWBOX = '0 0 48 48'
export const DIM_OPACITY = 0.2

const CENTRE: GlyphPart = { d: 'M18 18H30V30H18Z', dim: true }

export const ROLE_GLYPHS: Record<GlyphRole, GlyphPart[]> = {
  TOP: [
    { d: 'M4 4H40L32 12H12V32L4 40Z' },
    { d: 'M44 8V44H8L16 36H36V16Z', dim: true },
    CENTRE,
  ],
  JUNGLE: [
    { d: 'M22 46Q7 27 11 2Q21 21 28 40Z' },
    { d: 'M19 45Q4 33 3 15Q11 25 18 35Z' },
    { d: 'M25 36Q25 14 38 2Q34 20 31 34Z' },
    { d: 'M27 45Q35 22 46 14Q40 33 32 46Z' },
  ],
  MID: [
    { d: 'M4 38L38 4H44V10L10 44H4Z' },
    { d: 'M4 4H34L26 12H12V26L4 34Z', dim: true },
    { d: 'M44 14V44H14L22 36H36V22Z', dim: true },
  ],
  ADC: [
    { d: 'M44 44H8L16 36H36V16L44 8Z' },
    { d: 'M4 40V4H40L32 12H12V32Z', dim: true },
    CENTRE,
  ],
  SUPPORT: [
    { d: 'M19 4H29L31 7L24 12L17 7Z' },
    { d: 'M22 14H26L29 39L24 45L19 39Z' },
    { d: 'M20 15L2 13Q6 18 11 20H20Z' },
    { d: 'M28 15L46 13Q42 18 37 20H28Z' },
    { d: 'M11 21H19L18 29Z' },
    { d: 'M37 21H29L30 29Z' },
  ],
}

/** The hextech golds of the gold variants: flat, and the gradient's stops
 *  (light at the top left to dark at the bottom right). */
export const GOLD = '#C8AA6E'
export const GOLD_GRADIENT: ReadonlyArray<readonly [offset: number, color: string]> = [
  [0, '#F0E6D2'],
  [0.45, '#C8AA6E'],
  [1, '#785A28'],
]

/** A role's icon as a standalone SVG document (the asset files). */
export function roleGlyphSvg(role: GlyphRole, tone: 'white' | 'gold' | 'gold-gradient'): string {
  const fill = tone === 'white' ? '#FFFFFF' : tone === 'gold' ? GOLD : 'url(#g)'
  const defs = tone === 'gold-gradient'
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${GOLD_GRADIENT.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient></defs>`
    : ''
  const paths = ROLE_GLYPHS[role]
    .map((p) => p.dim
      ? `<path d="${p.d}" fill="#FFFFFF" fill-opacity="${DIM_OPACITY}"/>`
      : `<path d="${p.d}" fill="${fill}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${GLYPH_VIEWBOX}">${defs}${paths}</svg>\n`
}
