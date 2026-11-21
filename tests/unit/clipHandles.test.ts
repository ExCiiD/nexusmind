import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlayerBarV2 } from '../../src/components/Recording/PlayerBarV2'
import { DEFAULT_LAYERS } from '../../src/lib/playerLayers'

const noop = () => {}
/** The bar in clip mode, rendered to HTML: the handles' classes tell where each one sits. */
function bar(start: number, end: number): string {
  return renderToStaticMarkup(createElement(PlayerBarV2, {
    currentTime: start, duration: 1500, playing: false, onTogglePlay: noop, onSkip: noop, onSeek: noop,
    volume: 1, muted: false, onVolume: noop, onToggleMute: noop, speed: 1, onSpeed: noop,
    markers: [], clipWindow: null, layers: DEFAULT_LAYERS, onLayersChange: noop,
    clipEdit: { start, end, label: '0:01', hold: false, onGrab: noop, onDrag: noop, onDrop: noop },
  }))
}
const tagOf = (html: string, testid: string) => html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`))?.[0] ?? ''

// Beta.23 (« the Début and Fin flags overlap »): two levels and outward flags, the duration on a third level.
describe('clip handles', () => {
  it('« Fin » sits on top, « Début » under it, each opening away from the other, even on a 1-second clip', () => {
    const html = bar(600, 601)
    const start = tagOf(html, 'clip-handle-start'), end = tagOf(html, 'clip-handle-end')
    expect(end).toMatch(/top-0/)
    expect(end).toMatch(/left-0/)
    expect(start).toMatch(/top-\[26px\]/)
    expect(start).toMatch(/right-0/)
    expect(start).not.toMatch(/ top-0 /)
  })

  it('shows the duration in the bracket, under both flags', () => {
    const html = bar(600, 630)
    expect(tagOf(html, 'clip-bracket')).toMatch(/top-\[58px\]/)
    expect(html).toContain('data-testid="clip-duration"')
  })
})
