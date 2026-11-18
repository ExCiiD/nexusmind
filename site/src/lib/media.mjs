/**
 * Captures and clips of the app (site/public/media), made by site/capture.cjs
 * from site/shots.cjs with the app's own screens and a demonstration account.
 *
 * A clip is a muted MP4 made to loop, with its first frame as a WebP poster.
 * It starts only while it is on screen and stops otherwise; with reduced
 * motion, or without script, the poster stays (site/src/client/main.js).
 */
import { esc, tx } from './html.mjs'

/**
 * `media` is the table the build makes from site/shots.cjs: id → { w, h, clip }.
 * `alt` describes what the picture shows, for someone who cannot see it.
 */
export function shot(media, id, alt, lang, { eager = false } = {}) {
  const m = media[id]
  if (!m) throw new Error(`no media "${id}" in site/shots.cjs`)
  const label = tx(alt, lang)
  if (m.clip) {
    return `<video class="shot-media" src="/media/${esc(id)}.mp4" poster="/media/${esc(id)}.webp" width="${m.w}" height="${m.h}" muted loop playsinline preload="none" aria-label="${label}" data-clip></video>`
  }
  return `<img class="shot-media" src="/media/${esc(id)}.webp" alt="${label}" width="${m.w}" height="${m.h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
}

/** A framed capture: the app's window edge, the picture, nothing else. */
export const frame = (media, id, alt, lang, opts) => `<div class="shot">${shot(media, id, alt, lang, opts)}</div>`
