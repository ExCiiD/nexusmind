/**
 * The Ascend mark, "A d’éclats": a solid A whose top bursts into gold fragments. Same shapes as
 * src/components/Brand/AscendMark.tsx and the masters in src/assets/brand (Penpot page "Logo — Ascend").
 * The site only shows it small, so this is the simplified version (no chips). Fixed brand colours:
 * the trunk takes the text colour, the fragments the one signal colour.
 */
const SMALL = [
  ['trunk', 'M69.87 98.83 L130.13 98.83 L167.6 196 L133.8 196 L122.74 157.98 L77.26 157.98 L66.2 196 L32.4 196 Z M82.18 141.08 L117.82 141.08 L105.53 98.83 L94.47 98.83 Z'],
  ['burst', 'M104.04 4 L108.3 23.92 L96.91 30.78 L96.38 17.22 Z'],
  ['burst', 'M80.01 32.02 L85.15 44.58 L91.78 58.79 L92.84 69.23 L91.22 86.98 L69.49 91.2 Z'],
  ['burst', 'M119.54 34.37 L132 87.95 L110.07 84.87 L107.52 67.24 L109.92 57.01 L108.27 41.42 Z'],
]

export function brandMark({ cls = 'brand-mark', trunk = 'var(--text-hi)', burst = 'var(--accent)' } = {}) {
  return `<svg class="${cls}" viewBox="0 0 200 200" aria-hidden="true" focusable="false">${SMALL.map(([role, d]) => `<path d="${d}" fill="${role === 'trunk' ? trunk : burst}"/>`).join('')}</svg>`
}
