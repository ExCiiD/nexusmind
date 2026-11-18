/**
 * Exhibit E — Settings → Appearance: the eight built-in colour themes and the
 * custom one (three colours, every other token derived by the app's own
 * `deriveCustomTokens`). The markup is rendered once at build time; the
 * browser script only swaps the `--app-*` variables of the sample, so the
 * colour inputs are never re-created while the visitor drags them.
 *
 * Themes are told apart by a plain colour name, never by the name of a place
 * from the game's universe.
 */
import { tx } from '../lib/html.mjs'
import { styleOf } from '../lib/appVars.mjs'

export function render(d) {
  const L = d.lang
  const chip = (vars) => {
    const v = Object.fromEntries(vars)
    return `<span class="sw-chip" aria-hidden="true"><i style="background:${v['--app-bg']}"></i><i style="background:${v['--app-accent']}"></i><i style="background:${v['--app-second']}"></i></span>`
  }
  const presets = d.presets.map((p, i) => `<label class="sw">
      <input type="radio" name="theme" value="${p.id}"${i === 0 ? ' checked' : ''}>${chip(p.vars)}<span>${tx(p.name, L)}</span>
    </label>`).join('')
  const fields = ['base', 'accent', 'secondary'].map((k) => `<label class="th-field"><span>${tx(d.s.fields[k], L)}</span><input type="color" name="${k}" value="${d.custom.palette[k]}"></label>`).join('')
  const stats = d.sample.stats.map((x) => `<div><dt>${tx(x.label, L)}</dt><dd>${tx(x.value, L)}</dd></div>`).join('')
  const nav = d.sample.nav.map((label, i) => `<li${i === 0 ? ' class="is-on"' : ''}>${tx(label, L)}</li>`).join('')

  return `<div class="th">
    <div class="th-side">
      <fieldset class="th-presets">
        <legend>${tx(d.s.presets, L)}</legend>
        ${presets}
        <label class="sw sw-own">
          <input type="radio" name="theme" value="custom">${chip(d.custom.vars)}<span>${tx(d.s.custom, L)}</span>
        </label>
      </fieldset>
      <fieldset class="th-custom">
        <legend>${tx(d.s.custom, L)}</legend>
        ${fields}
      </fieldset>
    </div>
    <div class="th-sample app" data-sample role="img" aria-label="${tx(d.s.preview, L)}" style="${styleOf(d.presets[0].vars)}">
      <ul class="th-nav">${nav}</ul>
      <div class="th-main">
        <div class="panel">
          <p class="panel-kicker">${tx(d.sample.sessionTitle, L)}</p>
          <p class="th-label">${tx(d.s.sample.objective, L)}</p>
          <p class="db-objective">${tx(d.sample.objective, L)}</p>
          <div class="meter"><i style="width:${d.sample.pct}%"></i></div>
          <p class="panel-sub"><span class="mono">${tx(d.sample.xp, L)}</span> ${tx(d.sample.level, L)}</p>
          <p class="th-actions"><span class="app-btn app-btn-solid">${tx(d.s.sample.button, L)}</span><span class="th-link">${tx(d.s.sample.link, L)}</span></p>
        </div>
        <dl class="db-stats">${stats}</dl>
      </div>
    </div>
  </div>`
}
