import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LAYERS, FADED_OPACITY, LAYERS_STORAGE_KEY, activeFilterCount, groupMarkers, layerOfEvent, layerOfMistake,
  markerOpacity, objectivesState, parseLayers, readLayers, rowOfLayer, sameLayers, saveLayers, toggleAllObjectives,
  DEFAULT_PANEL_PREFS, parsePanelPrefs, readPanelPrefs, savePanelPrefs,
} from '../../src/lib/playerLayers'

function memoryStore() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

// DECISIONS 21/11 (« Un seul lecteur vidéo », « Filtres »), spec DESIGN_STATE § 19.
describe('review player layers', () => {
  it('shows only my notes and the micro-review by default, and remembers the filters', () => {
    const s = memoryStore()
    expect(readLayers(s)).toEqual(DEFAULT_LAYERS)
    expect(activeFilterCount(DEFAULT_LAYERS)).toBe(2)
    saveLayers({ ...DEFAULT_LAYERS, deaths: true }, s)
    expect(readLayers(s).deaths).toBe(true)
    s.setItem(LAYERS_STORAGE_KEY, '{bad')
    expect(readLayers(s)).toEqual(DEFAULT_LAYERS)
  })

  it('reads the synced user setting (object or JSON), else nothing', () => {
    expect(parseLayers({ notes: false, baron: true, zz: 1 })).toMatchObject({ notes: false, microReview: true, baron: true })
    expect(parseLayers(JSON.stringify({ deaths: true }))?.deaths).toBe(true)
    expect(parseLayers(null)).toBeNull()
    expect(parseLayers('{bad')).toBeNull()
    expect(parseLayers([1])).toBeNull()
    expect(sameLayers(DEFAULT_LAYERS, { ...DEFAULT_LAYERS })).toBe(true)
    expect(sameLayers(DEFAULT_LAYERS, { ...DEFAULT_LAYERS, fights: true })).toBe(false)
  })

  it('reads the panel layout setting (hidden, side), defaults otherwise', () => {
    expect(parsePanelPrefs({ hidden: true, side: 'left', zz: 1 })).toEqual({ hidden: true, side: 'left' })
    expect(parsePanelPrefs(JSON.stringify({ side: 'up' }))).toEqual({ hidden: false, side: 'right' })
    expect(parsePanelPrefs(null)).toBeNull()
    const s = memoryStore()
    expect(readPanelPrefs(s)).toEqual(DEFAULT_PANEL_PREFS)
    savePanelPrefs({ hidden: true, side: 'left' }, s)
    expect(readPanelPrefs(s)).toEqual({ hidden: true, side: 'left' })
  })

  it('reads a choice saved before the per-type objectives', () => {
    const s = memoryStore()
    s.setItem(LAYERS_STORAGE_KEY, JSON.stringify({ notes: true, microReview: false, objectives: true }))
    const l = readLayers(s)
    expect(l.microReview).toBe(false)
    expect(objectivesState(l)).toBe('all')
  })

  it('« Objectifs · tous » is a tri-state box', () => {
    expect(objectivesState(DEFAULT_LAYERS)).toBe('none')
    const some = { ...DEFAULT_LAYERS, baron: true }
    expect(objectivesState(some)).toBe('some')
    expect(objectivesState(toggleAllObjectives(some))).toBe('all')
    expect(objectivesState(toggleAllObjectives(toggleAllObjectives(some)))).toBe('none')
  })

  it('sorts events and mistakes into layers and rows', () => {
    expect(layerOfEvent({ type: 'death', isPlayer: true })).toBe('deaths')
    expect(layerOfEvent({ type: 'death', isPlayer: false })).toBe('fights')
    expect(layerOfEvent({ type: 'kill', isPlayer: true })).toBe('fights')
    expect(layerOfEvent({ type: 'dragon', isPlayer: false })).toBe('dragon')
    expect(layerOfEvent({ type: 'voidgrub', isPlayer: false })).toBe('grubs')
    expect(layerOfEvent({ type: 'plate', isPlayer: true })).toBe('turrets')
    expect(layerOfMistake({ autoDetected: true })).toBe('mistakes')
    expect(layerOfMistake({ autoDetected: false })).toBe('notes')
    expect(rowOfLayer('deaths')).toBe('self')
    expect(rowOfLayer('baron')).toBe('game')
    expect(activeFilterCount({ ...DEFAULT_LAYERS, mistakes: true }, { hideMistakes: true })).toBe(2)
  })

  it('fades the markers outside the micro-review window to 32 %', () => {
    expect(markerOpacity(100, null)).toBe(1)
    expect(markerOpacity(100, { start: 90, end: 120 })).toBe(1)
    expect(markerOpacity(200, { start: 90, end: 120 })).toBe(FADED_OPACITY)
  })

  it('merges markers less than 26 px apart, with 2 glyphs by priority and a counter', () => {
    // 1000 s on 1000 px: 1 s = 1 px.
    const g = groupMarkers([
      { time: 500, layer: 'turrets' as const }, { time: 510, layer: 'baron' as const }, { time: 520, layer: 'dragon' as const },
      { time: 600, layer: 'notes' as const }, { time: 625, layer: 'notes' as const }, { time: 700, layer: 'notes' as const },
    ], 1000, 1000)
    expect(g.map((x) => [x.time, x.count, x.glyphs])).toEqual([
      [500, 3, ['baron', 'dragon']],
      [600, 2, ['notes']],
      [700, 1, ['notes']],
    ])
  })
})
