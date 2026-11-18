/**
 * Exhibit B — the Dashboard: recent form, the running session, the
 * Calibration flash and the low-energy card. Wording comes from the app's
 * locale files; the calibration verdicts are computed by the app's own
 * `calibrationGap` at build time (site/src/data.mjs).
 */
import { cls, tx } from '../lib/html.mjs'
import { icon } from '../lib/icons.mjs'

export const initialState = () => ({ calib: null, low: false, focus: null })

export function reduce(state, action) {
  switch (action.type) {
    case 'calib': return { ...state, calib: action.f, focus: 'calib-result' }
    case 'low': return { ...state, low: true, focus: 'low-done' }
    default: return state
  }
}

export function render(state, d) {
  const L = d.lang
  const form = d.form.map((g) => `<li class="${cls('res', g.win && 'res-w')}"><span class="vh">${tx(g.label, L)}</span><span aria-hidden="true">${g.letter}</span></li>`).join('')
  const calibButtons = d.calib.families.map((f) => `<button class="${cls('opt opt-tight', state.calib === f.id && 'is-selected')}" data-act="calib" data-f="${f.id}" aria-pressed="${state.calib === f.id}"><i class="fam fam-${f.id}"></i><span class="opt-main">${tx(f.label, L)}</span></button>`).join('')
  const calibResult = state.calib ? `<div class="${cls('calib-result', state.focus === 'calib-result' && 'is-new')}" data-k="calib-result" tabindex="-1">
      <p>${tx(d.calib.results[state.calib], L)}</p>
      <p class="calib-dist-title">${tx(d.calib.distTitle, L)}</p>
      <ul class="dist">${d.calib.dist.map((x) => `<li><span>${tx(x.label, L)}</span><span class="bar"><i style="width:${x.share}%"></i></span><b>${x.share} %</b></li>`).join('')}</ul>
    </div>` : ''
  const objectives = state.low ? d.session.objectivesLow : d.session.objectives
  const stats = d.stats.map((x) => `<div><dt>${tx(x.label, L)}</dt><dd>${tx(x.value, L)}</dd></div>`).join('')

  return `<div class="db">
    <header class="db-head">
      <div>
        <p class="db-hello">${tx(d.s.welcome, L)} <b>${tx(d.name, L)}</b></p>
        <p class="db-formline">${tx(d.s.formLine, L)} <b>${tx(d.formWinrate, L)}</b> <span>${tx(d.formDelta, L)}</span></p>
      </div>
      <div class="db-form"><span>${tx(d.s.form, L)}</span><ol aria-label="${tx(d.s.formLabel, L)}">${form}</ol><span class="db-role">${tx(d.s.mainRole, L)} <b>${tx(d.role, L)}</b></span></div>
    </header>

    <section class="panel calib" aria-live="polite">
      <h3 class="panel-title">${icon.gauge(16)}${tx(d.calib.title, L)}</h3>
      <p class="panel-sub">${tx(d.calib.due, L)}</p>
      <p class="calib-q">${tx(d.calib.question, L)}</p>
      <div class="calib-opts" role="group" aria-label="${tx(d.calib.question, L)}">${calibButtons}</div>
      ${calibResult}
    </section>

    <div class="db-cols">
      <section class="panel db-session">
        <h3 class="panel-kicker">${tx(d.session.title, L)}</h3>
        <p class="db-objective">${tx(objectives, L)}</p>
        <p class="panel-sub">${tx(d.session.games, L)}</p>
        <dl class="db-stats">${stats}</dl>
      </section>
      <section class="panel db-level">
        <h3 class="panel-kicker">${tx(d.level.title, L)}</h3>
        <p class="db-level-n"><b>${tx(d.level.level, L)}</b><span>${tx(d.level.tier, L)}</span></p>
        <div class="meter" role="img" aria-label="${tx(d.level.xp, L)}"><i style="width:${d.level.pct}%"></i></div>
        <p class="panel-sub"><span class="mono">${tx(d.level.xp, L)}</span> ${tx(d.level.toNext, L)}</p>
      </section>
      <section class="${cls('panel db-low', state.low && 'is-on')}" aria-live="polite">
        <h3 class="panel-title">${icon.battery(16)}${tx(state.low ? d.low.active : d.low.title, L)}</h3>
        ${state.low
          ? `<p class="${cls('db-low-done', state.focus === 'low-done' && 'is-new')}" data-k="low-done" tabindex="-1">${tx(d.low.done, L)}</p><p class="panel-sub">${tx(d.low.rules, L)}</p>`
          : `<p>${tx(d.low.reason, L)}</p><p class="panel-sub">${tx(d.low.rules, L)}</p>
             <button class="app-btn app-btn-solid" data-act="low">${icon.battery(14)}${tx(d.low.activate, L)}</button>`}
      </section>
    </div>
  </div>`
}
