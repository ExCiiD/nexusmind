/**
 * Exhibit A — the guided micro-review, as in the app's Review page: queue of
 * moments, position on the map, three diagnosis buttons + "Autre cause…",
 * then the Codex entry. Markup, wording and flow follow
 * src/components/MicroReview/MicroReviewPanel.tsx; the options and entries
 * come from the app's own generator (see site/src/data.mjs).
 *
 * `render` is used by the build (first paint) and by the browser (after each
 * action), `reduce` is the whole behaviour.
 */
import { cls, fill, tx } from '../lib/html.mjs'
import { icon } from '../lib/icons.mjs'

export const initialState = (d) => ({ i: d.first, answers: {}, picking: false, family: 'deaths', prepared: {}, focus: null })

const outcomeOf = (m, a) => (a.kind === 'assumed' ? 'justified' : a.kind === 'other' ? 'mistake' : m.options.find((o) => o.id === a.id)?.outcome ?? 'mistake')
const ficheOf = (d, m, a) => {
  const id = a.kind === 'other' ? m.other[a.slug] : a.kind === 'option' ? m.options.find((o) => o.id === a.id)?.fiche : null
  return id ? d.fiches[id] : null
}

export function reduce(state, action, d) {
  const m = d.moments[state.i]
  const s = { ...state, focus: null }
  const answer = (a) => ({ ...s, picking: false, answers: { ...s.answers, [m.key]: a }, focus: 'after' })
  switch (action.type) {
    case 'go': return { ...s, i: Number(action.i), picking: false, focus: `q-${action.i}` }
    case 'answer': return answer({ kind: 'option', id: action.id })
    case 'pick': return { ...s, picking: true, focus: `fam-${s.family}` }
    case 'family': return { ...s, family: action.f, focus: `fam-${action.f}` }
    case 'tag': return answer({ kind: 'other', slug: action.slug })
    case 'assume': return answer({ kind: 'assumed' })
    case 'cancel': return { ...s, picking: false, focus: 'other' }
    case 'prepare': return { ...s, prepared: { ...s.prepared, [m.key]: true }, focus: 'prepared' }
    case 'next': {
      const n = d.moments.length
      const order = d.moments.map((_, k) => (s.i + 1 + k) % n)
      const open = order.find((k) => !s.answers[d.moments[k].key])
      return { ...s, i: open ?? s.i, focus: 'summary' }
    }
    case 'restart': return { ...initialState(d), focus: 'summary' }
    default: return state
  }
}

/** Summoner's Rift as the app draws it: lanes, river, both pits with their 2800-unit zone, the player. */
function mapSvg(m, d) {
  const S = 300
  const k = S / 15000
  const X = (x) => (x * k).toFixed(1)
  const Y = (y) => (S - y * k).toFixed(1)
  const pit = (p) => `<circle class="map-zone" cx="${X(p.x)}" cy="${Y(p.y)}" r="${(d.pits.radius * k).toFixed(1)}"/><circle class="map-pit" cx="${X(p.x)}" cy="${Y(p.y)}" r="4"/>`
  return `<svg class="map" viewBox="0 0 ${S} ${S}" role="img" aria-label="${tx(d.s.mapLabel, d.lang)}">
    <path class="map-river" d="M52 36 L36 52 L248 264 L264 248 Z"/>
    <path class="map-lane" d="M22 278 L22 22 L278 22 M22 278 L278 278 L278 22 M30 270 L270 30"/>
    <rect class="map-frame" x="8" y="8" width="284" height="284"/>
    <rect class="map-base map-own" x="8" y="244" width="48" height="48"/>
    <rect class="map-base" x="244" y="8" width="48" height="48"/>
    ${pit(d.pits.baron)}${pit(d.pits.dragon)}
    <circle class="map-ring" cx="${X(m.map.x)}" cy="${Y(m.map.y)}" r="11"/>
    <circle class="map-you" cx="${X(m.map.x)}" cy="${Y(m.map.y)}" r="5"/>
    <text class="map-label" x="${(Number(X(m.map.x)) + 16).toFixed(1)}" y="${(Number(Y(m.map.y)) + 4).toFixed(1)}">${tx(d.s.you, d.lang)}</text>
  </svg>`
}

function ficheHtml(f, d, m, state) {
  const prepared = state.prepared[m.key]
  return `<article class="${cls('fiche', state.focus === 'after' && 'is-new')}" data-k="after" tabindex="-1">
    <p class="fiche-kind">${icon.book(14)}${tx(d.s.codexTitle, d.lang)}</p>
    <h4 class="fiche-title">${tx(f.headline, d.lang)}</h4>
    <p class="fiche-rule">${tx(f.rule, d.lang)}</p>
    <div class="fiche-drill"><span>${tx(d.s.drill, d.lang)}</span><p>${tx(f.drill, d.lang)}</p></div>
    ${f.video ? `<p class="fiche-note">${tx(d.s.codexVideo, d.lang)}</p>` : ''}
    ${prepared
      ? `<p class="fiche-prepared" data-k="prepared" tabindex="-1">${icon.calendar(14)}${tx(fill(d.s.prepareDone, { objective: f.objective }), d.lang)}</p>`
      : `<button class="app-btn app-btn-line" data-act="prepare" data-k="prepare">${icon.calendar(14)}${tx(d.s.prepare, d.lang)}</button>`}
  </article>`
}

function pickerHtml(state, d) {
  const tabs = d.families.map((f) => `<button aria-pressed="${state.family === f.id}" class="chip" data-act="family" data-f="${f.id}" data-k="fam-${f.id}"><i class="fam fam-${f.id}"></i>${tx(f.label, d.lang)}</button>`).join('')
  const tags = d.tags.filter((t) => t.family === state.family).map((t) => `<button class="tag" data-act="tag" data-slug="${t.slug}">${tx(t.label, d.lang)}</button>`).join('')
  return `<div class="picker">
    <p class="picker-title">${tx(d.s.otherTitle, d.lang)}</p>
    <div class="chips" role="group" aria-label="${tx(d.s.familiesLabel, d.lang)}">${tabs}</div>
    <div class="tags">${tags}</div>
    <button class="assume" data-act="assume">${icon.shield(16)}<span><b>${tx(d.s.otherJustified, d.lang)}</b><small>${tx(d.s.justifiedBadge, d.lang)}</small></span></button>
    <div class="picker-foot"><button class="app-btn app-btn-ghost" data-act="cancel">${tx(d.s.cancel, d.lang)}</button></div>
  </div>`
}

export function render(state, d) {
  const m = d.moments[state.i]
  const a = state.answers[m.key]
  const done = d.moments.filter((x) => state.answers[x.key]).length
  const allDone = done === d.moments.length
  const justified = d.moments.filter((x) => state.answers[x.key] && outcomeOf(x, state.answers[x.key]) === 'justified').length
  const hasNext = d.moments.some((x, k) => k !== state.i && !state.answers[x.key])

  const queue = d.moments.map((x, k) => `<li><button class="${cls('q', k === state.i && 'is-current')}" data-act="go" data-i="${k}" data-k="q-${k}"${k === state.i ? ' aria-current="true"' : ''}>
      <span class="${cls('q-n', state.answers[x.key] && 'is-done')}">${state.answers[x.key] ? icon.check(12) : k + 1}</span>
      <span class="q-clock">${x.clock}</span><span class="q-label">${tx(x.label, d.lang)}</span></button></li>`).join('')

  const options = m.options.map((o) => {
    const selected = a?.kind === 'option' && a.id === o.id
    return `<button class="${cls('opt', selected && 'is-selected', o.outcome === 'justified' && 'opt-ok')}" data-act="answer" data-id="${o.id}" aria-pressed="${selected}">
      <i class="${cls('dot', o.outcome === 'justified' && 'dot-ok')}"></i>
      <span><span class="opt-main">${tx(o.main, d.lang)}</span><small>${tx(o.sub, d.lang)}</small></span></button>`
  }).join('')
  const otherSelected = a && a.kind !== 'option'
  const otherLabel = !otherSelected ? d.s.other : a.kind === 'assumed' ? d.s.assumed : d.tags.find((t) => t.slug === a.slug)?.label ?? d.s.other

  let after = ''
  if (a && !state.picking) {
    const f = outcomeOf(m, a) === 'justified' ? null : ficheOf(d, m, a)
    after = (outcomeOf(m, a) === 'justified'
      ? `<p class="${cls('justified', state.focus === 'after' && 'is-new')}" data-k="after" tabindex="-1">${icon.shield(16)}${tx(d.s.justifiedDone, d.lang)}</p>`
      : f ? ficheHtml(f, d, m, state) : '')
      + (hasNext ? `<button class="app-btn app-btn-solid" data-act="next" data-k="next">${tx(d.s.next, d.lang)}${icon.chevron(14)}</button>` : '')
  }

  return `<div class="mr">
    <header class="mr-head">
      <div><h3 class="mr-title">${icon.timer(16)}${tx(d.s.title, d.lang)}</h3><p class="mr-sub">${tx(d.s.subtitle, d.lang)}</p></div>
      <span class="mr-count" aria-label="${done} / ${d.moments.length}">${done}/${d.moments.length}</span>
    </header>
    <ol class="mr-queue" aria-label="${tx(d.s.queue, d.lang)}">${queue}</ol>
    <div class="mr-body">
      <div class="mr-map">${mapSvg(m, d)}<p class="mr-note">${icon.map(13)}${tx(d.s.noVod, d.lang)}</p></div>
      <div class="mr-qcm">
        <p class="mr-summary" data-k="summary" tabindex="-1"><span class="mr-clock">${m.clock}</span><span class="mr-zone">${tx(m.zone, d.lang)}</span>${tx(m.line, d.lang)}</p>
        ${state.picking ? pickerHtml(state, d) : `<p class="mr-question">${tx(d.s.question, d.lang)}</p>
        <div class="opts" role="group" aria-label="${tx(d.s.question, d.lang)}">${options}
          <button class="${cls('opt opt-other', otherSelected && 'is-selected')}" data-act="pick" data-k="other" aria-pressed="${!!otherSelected}"><span class="opt-main">${tx(otherLabel, d.lang)}</span>${icon.chevron(14)}</button>
        </div>`}
        <div class="mr-after" aria-live="polite">${after}</div>
      </div>
    </div>
    ${allDone ? `<div class="mr-done"><div><p class="mr-done-title">${tx(d.s.done, d.lang)}</p><p>${tx(fill(d.s.doneSummary, { mistakes: done - justified, justified }), d.lang)}</p></div>
      <span class="mr-xp">${tx(fill(d.s.doneXp, { xp: d.xp }), d.lang)}</span>
      <button class="app-btn app-btn-ghost" data-act="restart" data-k="restart">${tx(d.s.restart, d.lang)}</button></div>` : ''}
  </div>`
}
