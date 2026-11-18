/**
 * The mini demonstration window of the solo and team pages: an app window
 * whose chapters play one after the other (a clip until its end, a capture
 * for a few seconds), with the chapters listed under it as tabs.
 *
 * Rendered whole here; site/src/client/main.js plays it. Without script the
 * first chapter shows and the list reads as a summary. With reduced motion
 * nothing plays by itself: a chapter shows when it is chosen.
 */
import { esc, tx } from './html.mjs'
import { brandMark } from './mark.mjs'
import { shot } from './media.mjs'

/** chapters: [{ name, sub, media, alt }] */
export function tour(media, { id, title, chapters, lang, label }) {
  const L = lang
  const tabs = chapters.map((ch, i) => `<button type="button" class="tour-tab" role="tab" id="${id}-t${i}" aria-controls="${id}-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">
          <span class="tour-n mono">${String(i + 1).padStart(2, '0')}</span>
          <span class="tour-name">${tx(ch.name, L)}</span>
          <span class="tour-sub">${tx(ch.sub, L)}</span>
          <span class="tour-time" aria-hidden="true"><i></i></span>
        </button>`).join('\n        ')
  const panels = chapters.map((ch, i) => `<div class="tour-panel${i === 0 ? ' is-on' : ''}" role="tabpanel" id="${id}-p${i}" aria-labelledby="${id}-t${i}">${shot(media, ch.media, ch.alt, L, { eager: i === 0 })}</div>`).join('\n          ')
  return `<figure class="tour" id="${esc(id)}" data-tour aria-label="${tx(label, L)}">
      <div class="tour-win">
        <div class="tour-bar" aria-hidden="true">
          <span class="tour-app">${brandMark({ cls: 'tour-mark' })}Ascend</span>
          <span class="tour-title">${tx(title, L)}</span>
          <span class="tour-ctl"><i></i><i></i><i></i></span>
        </div>
        <div class="tour-stage">
          ${panels}
        </div>
      </div>
      <div class="tour-tabs" role="tablist" aria-label="${tx(title, L)}">
        ${tabs}
      </div>
    </figure>`
}
