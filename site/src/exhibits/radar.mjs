/**
 * Exhibit D — "Empreinte des fondamentaux" (the Dashboard radar): nine fixed
 * axes, the last 15 games against the last 40. Axes, scales and scores come
 * from src/lib/fundamentalsRadarCore.ts at build time; laners and supports
 * each get the axis set the app gives them.
 */
import { cls, tx } from '../lib/html.mjs'

export const initialState = () => ({ role: 'carry', axis: null, focus: null })

export function reduce(state, action) {
  switch (action.type) {
    case 'role': return { role: action.r, axis: null, focus: `role-${action.r}` }
    case 'axis': return { ...state, axis: action.a, focus: `axis-${action.a}` }
    // Pointer hover: the same selection, no focus move, and no re-render when nothing changes.
    case 'hover': return state.axis === action.a ? state : { ...state, axis: action.a, focus: null }
    default: return state
  }
}

const C = 160
const R = 104
const point = (i, n, score) => {
  const a = (Math.PI * 2 * i) / n - Math.PI / 2
  const r = (R * score) / 100
  return [C + Math.cos(a) * r, C + Math.sin(a) * r]
}
const poly = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

export function render(state, d) {
  const L = d.lang
  const set = d.sets[state.role]
  const n = set.points.length
  const rings = [25, 50, 75, 100].map((s) => `<polygon class="rd-ring" points="${poly(set.points.map((_, i) => point(i, n, s)))}"/>`).join('')
  const spokes = set.points.map((p, i) => { const [x, y] = point(i, n, 100); return `<line class="${cls('rd-spoke', state.axis === p.key && 'is-on')}" x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>` }).join('')
  const labels = set.points.map((p, i) => {
    const [x, y] = point(i, n, 122)
    const anchor = Math.abs(x - C) < 12 ? 'middle' : x > C ? 'start' : 'end'
    return `<g class="${cls('rd-axis', state.axis === p.key && 'is-on')}" data-act="axis" data-hover="hover" data-a="${p.key}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="20"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}">${tx(p.label, L)}</text></g>`
  }).join('')
  const dots = set.points.map((p, i) => { const [x, y] = point(i, n, p.rs); return `<circle class="${cls('rd-dot', state.axis === p.key && 'is-on')}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${state.axis === p.key ? 5 : 3}"/>` }).join('')
  const cur = set.points.find((p) => p.key === state.axis)
  const roles = d.roles.map((r) => `<button class="seg" aria-pressed="${state.role === r.id}" data-act="role" data-r="${r.id}" data-k="role-${r.id}">${tx(r.label, L)}</button>`).join('')
  const rows = set.points.map((p) => `<tr class="${cls(state.axis === p.key && 'is-on')}">
      <th scope="row"><button data-act="axis" data-hover="hover" data-a="${p.key}" data-k="axis-${p.key}" aria-pressed="${state.axis === p.key}">${tx(p.label, L)}</button></th>
      <td>${tx(p.recent, L)}</td><td>${tx(p.snapshot, L)}</td><td class="${cls('gap', p.good && 'is-good')}">${tx(p.gap, L)}</td></tr>`).join('')

  return `<div class="rd">
    <div class="rd-chart">
      <div class="rd-top">
        <h3 class="panel-title">${tx(d.s.title, L)}</h3><span class="mono rd-score">${tx(set.score, L)}</span>
      </div>
      <svg class="rd-svg" viewBox="0 0 320 320" role="img" aria-label="${tx(d.s.title, L)}">
        ${rings}${spokes}
        <polygon class="rd-snap" points="${poly(set.points.map((p, i) => point(i, n, p.ss)))}"/>
        <polygon class="rd-recent" points="${poly(set.points.map((p, i) => point(i, n, p.rs)))}"/>
        ${dots}${labels}
      </svg>
      <p class="rd-legend"><span><i class="lg lg-recent"></i>${tx(d.s.recentLabel, L)}</span><span><i class="lg lg-snap"></i>${tx(d.s.snapshotLabel, L)}</span></p>
      <p class="rd-readout" aria-live="polite">${tx(cur ? cur.readout : d.s.readoutIdle, L)}</p>
    </div>
    <div class="rd-side">
      <div class="segs" role="group" aria-label="${tx(d.s.roleLabel, L)}">${roles}</div>
      <table class="rd-table">
        <thead><tr><th scope="col">${tx(d.s.colAxis, L)}</th><th scope="col">${tx(d.s.colRecent, L)}</th><th scope="col">${tx(d.s.colSnapshot, L)}</th><th scope="col">${tx(d.s.colGap, L)}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="panel-sub">${tx(d.s.scale, L)}</p>
    </div>
  </div>`
}
