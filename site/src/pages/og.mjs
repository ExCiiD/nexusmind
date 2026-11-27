/**
 * The link-preview card (1200 × 630), one per language. build.mjs writes it
 * to site/.cache/og-<lang>.html; `npm run site:og` photographs it with the
 * repo's own Electron into site/public/assets/og-<lang>.png.
 *
 * Same ink, same three typefaces, and the one drawing that belongs to the
 * product: the performance footprint of the demonstration account.
 */
import { tx } from '../lib/html.mjs'
import { brandMark } from '../lib/mark.mjs'

export function ogCard(c, data, fontsUrl) {
  const L = c.lang
  const points = data.radar.sets.carry.points
  const n = points.length
  const C = 250
  const R = 190
  const at = (i, score) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2
    return `${(C + Math.cos(a) * R * score / 100).toFixed(1)},${(C + Math.sin(a) * R * score / 100).toFixed(1)}`
  }
  const poly = (score) => points.map((p, i) => at(i, typeof score === 'number' ? score : p[score])).join(' ')
  const rings = [25, 50, 75, 100].map((s) => `<polygon points="${poly(s)}" fill="none" stroke="#3A2C18" stroke-width="1.5"/>`).join('')
  const spokes = points.map((_, i) => `<line x1="${C}" y1="${C}" x2="${at(i, 100).split(',')[0]}" y2="${at(i, 100).split(',')[1]}" stroke="#3A2C18" stroke-width="1.5"/>`).join('')

  return `<!doctype html>
<html lang="${L}">
<head>
<meta charset="utf-8">
<style>
@font-face { font-family: 'Big Shoulders Display'; src: url('${fontsUrl}/big-shoulders-display.woff2') format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'Inter'; src: url('${fontsUrl}/inter.woff2') format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'JetBrains Mono'; src: url('${fontsUrl}/jetbrains-mono.woff2') format('woff2'); font-weight: 100 800; }
* { margin: 0; box-sizing: border-box; }
html, body { width: 1200px; height: 630px; overflow: hidden; background: #0D0A06; color: #F5E3BE; }
body { position: relative; font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
.top { position: absolute; left: 72px; right: 72px; top: 56px; display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 22px; border-bottom: 1px solid #6B5330; }
.brand { display: flex; align-items: center; gap: 14px; font: 900 44px/1 'Big Shoulders Display', sans-serif; letter-spacing: 0.06em; }
.brand-mark { width: 52px; height: 52px; margin-top: -6px; }
.ver { font: 500 20px/1 'JetBrains Mono', monospace; color: #B5A68C; }
h1 { position: absolute; left: 72px; top: 156px; width: 660px; font: 800 92px/0.9 'Big Shoulders Display', sans-serif; letter-spacing: 0.012em; text-transform: uppercase; }
h1 span { display: block; }
p { position: absolute; left: 72px; bottom: 56px; width: 620px; padding-top: 20px; border-top: 3px solid #D4A24C; font-size: 24px; line-height: 1.4; color: #B5A68C; }
.radar { position: absolute; right: 48px; bottom: 44px; width: 400px; height: 400px; }
</style>
</head>
<body>
<div class="top"><span class="brand">${brandMark({ trunk: '#F5E3BE', burst: '#D4A24C' })}ASCEND</span><span class="ver">${tx(c.brandNote, L)}</span></div>
<h1>${c.hero.title.map((s) => `<span>${tx(s, L)}</span>`).join('')}</h1>
<p>${tx(c.meta.ogDescription, L)}</p>
<svg class="radar" viewBox="0 0 500 500" aria-hidden="true">
  ${rings}${spokes}
  <polygon points="${poly('ss')}" fill="none" stroke="#B5A68C" stroke-width="2" stroke-dasharray="7 6"/>
  <polygon points="${poly('rs')}" fill="#D4A24C" fill-opacity="0.16" stroke="#D4A24C" stroke-width="3.5" stroke-linejoin="round"/>
  ${points.map((p, i) => `<circle cx="${at(i, p.rs).split(',')[0]}" cy="${at(i, p.rs).split(',')[1]}" r="6" fill="#D4A24C"/>`).join('')}
</svg>
</body>
</html>
`
}
