/**
 * The practice tiers (src/lib/profile.ts): eight steps keyed on the Ascend
 * level, drawn as a staircase whose step heights are the level thresholds.
 * XP totals come from the app's own level curve at build time.
 */
import { cls, tx } from '../lib/html.mjs'

export const initialState = (d) => ({ id: d.current, focus: null })

export function reduce(state, action) {
  return action.type === 'tier' ? { id: action.id, focus: `tier-${action.id}` } : state
}

export function render(state, d) {
  const L = d.lang
  const cur = d.tiers.find((t) => t.id === state.id) ?? d.tiers[0]
  const steps = d.tiers.map((t) => `<li style="--h:${t.height}">
      <button class="${cls('step', t.id === cur.id && 'is-current', t.id === d.current && 'is-player')}" data-act="tier" data-id="${t.id}" data-k="tier-${t.id}" aria-pressed="${t.id === cur.id}">
        <span class="step-name">${tx(t.label, L)}</span><span class="step-level mono">${tx(t.levelShort, L)}</span>
        <span class="step-bar" aria-hidden="true"></span>
      </button></li>`).join('')
  return `<div class="tiers">
    <ol class="stairs" aria-label="${tx(d.s.scaleLabel, L)}">${steps}</ol>
    <div class="tier-detail" aria-live="polite">
      <h3 class="tier-name">${tx(cur.label, L)}</h3>
      <p class="tier-level mono">${tx(cur.level, L)}</p>
      <ul>${cur.detail.map((line) => `<li>${tx(line, L)}</li>`).join('')}</ul>
      ${cur.id === d.current ? `<p class="tier-you">${tx(d.s.you, L)}</p>` : ''}
    </div>
  </div>`
}
