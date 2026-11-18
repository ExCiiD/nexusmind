/**
 * Exhibit C — the Mistake Lab (src/pages/Stats/MistakeStatsPage.tsx): the
 * frequency ranking with its family filter, and the inspector of the selected
 * mistake. Counts, shares and win-rate gaps are computed by the app's own
 * `rankMistakes` at build time; the prescription is the app's Codex entry.
 * Families are told apart by the shape of their marker, not by a colour.
 */
import { cls, tx } from '../lib/html.mjs'
import { icon } from '../lib/icons.mjs'

export const initialState = (d) => ({ family: 'all', slug: d.rows[0].slug, focus: null })

const visible = (d, family) => d.rows.filter((r) => family === 'all' || r.family === family)

export function reduce(state, action, d) {
  switch (action.type) {
    case 'family': {
      const rows = visible(d, action.f)
      const slug = rows.some((r) => r.slug === state.slug) ? state.slug : rows[0]?.slug ?? state.slug
      return { family: action.f, slug, focus: `fam-${action.f}` }
    }
    case 'open': return { ...state, slug: action.slug, focus: `row-${action.slug}` }
    default: return state
  }
}

export function render(state, d) {
  const L = d.lang
  const rows = visible(d, state.family)
  const cur = d.rows.find((r) => r.slug === state.slug) ?? d.rows[0]
  const kpis = d.kpis.map((k) => `<div><dt>${tx(k.label, L)}</dt><dd class="${cls(k.text && 'is-text')}">${tx(k.value, L)}</dd><dd class="kpi-sub">${tx(k.sub, L)}</dd></div>`).join('')
  const chips = [{ id: 'all', label: d.s.all }, ...d.families].map((f) => `<button class="chip" aria-pressed="${state.family === f.id}" data-act="family" data-f="${f.id}" data-k="fam-${f.id}">${f.id === 'all' ? '' : `<i class="fam fam-${f.id}"></i>`}${tx(f.label, L)}</button>`).join('')
  const list = rows.length ? rows.map((r) => `<li><button class="${cls('rank', r.slug === cur.slug && 'is-current')}" data-act="open" data-slug="${r.slug}" data-k="row-${r.slug}" aria-pressed="${r.slug === cur.slug}">
      <span class="rank-name"><i class="fam fam-${r.family}"></i>${tx(r.label, L)}</span>
      <span class="rank-bar"><i style="width:${r.bar}%"></i></span>
      <span class="rank-count">${r.count}×</span><span class="rank-share">${r.share} %</span>
      <span class="${cls('rank-delta', r.delta == null && 'is-none', r.delta != null && r.delta < 0 && 'is-cost')}" title="${tx(d.s.costTitle, L)}">${tx(r.deltaLabel, L)}</span>
    </button></li>`).join('') : `<li class="rank-empty">${tx(d.s.none, L)}</li>`
  const i = cur.inspector
  const phases = i.phases.map((p) => `<div><dt>${tx(p.label, L)}<small>${tx(p.range, L)}</small></dt><dd>${p.count}</dd><dd class="bar"><i style="width:${p.pct}%"></i></dd></div>`).join('')
  const moments = i.moments.map((m) => `<li><span class="mono">${m.clock}</span><span>${tx(m.label, L)}</span><span class="${cls('res res-s', m.win && 'res-w')}">${m.letter}</span></li>`).join('')

  return `<div class="lab">
    <dl class="lab-kpis">${kpis}</dl>
    <div class="lab-cols">
      <section class="panel lab-rank">
        <h3 class="panel-title">${tx(d.s.rankingTitle, L)}</h3>
        <div class="chips" role="group" aria-label="${tx(d.s.families, L)}">${chips}</div>
        <ol class="ranks">${list}</ol>
        <p class="panel-sub">${tx(d.s.legend, L)}</p>
      </section>
      <section class="panel lab-inspect" aria-live="polite">
        <h3 class="lab-name">${tx(cur.label, L)}</h3>
        <p class="lab-family"><i class="fam fam-${cur.family}"></i>${tx(i.family, L)}</p>
        <p class="panel-sub">${tx(i.summary, L)}</p>
        ${i.cost ? `<p class="lab-cost">${tx(i.cost, L)}</p>` : `<p class="lab-cost is-none">${tx(d.s.noGap, L)}</p>`}
        <h4 class="panel-kicker">${tx(d.s.when, L)}</h4>
        <dl class="phases">${phases}</dl>
        ${i.fiche ? `<p class="panel-sub">${tx(i.prescTitle, L)}</p>
        <article class="fiche fiche-flat">
          <p class="fiche-kind">${icon.book(14)}${tx(d.s.codexTitle, L)}</p>
          <h4 class="fiche-title">${tx(i.fiche.headline, L)}</h4>
          <p class="fiche-rule">${tx(i.fiche.rule, L)}</p>
          <div class="fiche-drill"><span>${tx(d.s.drill, L)}</span><p>${tx(i.fiche.drill, L)}</p></div>
        </article>` : ''}
        <h4 class="panel-kicker">${tx(d.s.momentsTitle, L)}</h4>
        <ul class="lab-moments">${moments}</ul>
        <p class="lab-hint">${icon.target(14)}${tx(d.s.actionHint, L)}</p>
      </section>
    </div>
  </div>`
}
