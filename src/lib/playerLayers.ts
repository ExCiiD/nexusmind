/**
 * The Review's single video player (DECISIONS 21/11 « Un seul lecteur vidéo », « la barre actuelle, améliorée » and
 * « il y a besoin de filtres »; spec DESIGN_STATE § 19): what its timeline shows, chosen in the « Filtres » menu.
 * - TOI: my notes, micro-review, detected mistakes, deaths. PARTIE: each objective type (with an « all » tri-state),
 *   fights. Default: my notes + micro-review only. Remembered (local setting).
 * - Markers closer than 26 px merge into one pill: up to 2 glyphs by priority, and a counter.
 * - In micro-review mode, the markers outside the moment's window drop to 32 %.
 * Pure, tested.
 */

export const OBJECTIVE_LAYERS = ['baron', 'dragon', 'herald', 'inhibs', 'grubs', 'turrets'] as const
export type ObjectiveLayer = (typeof OBJECTIVE_LAYERS)[number]
export type PlayerLayer = 'notes' | 'microReview' | 'mistakes' | 'deaths' | ObjectiveLayer | 'fights'

/** The « Filtres » menu: TOI, then PARTIE (objectives in their display order, then fights). */
export const SELF_LAYERS: PlayerLayer[] = ['notes', 'microReview', 'mistakes', 'deaths']
export const GAME_LAYERS: PlayerLayer[] = ['dragon', 'baron', 'herald', 'grubs', 'turrets', 'inhibs', 'fights']
export const PLAYER_LAYERS: PlayerLayer[] = [...SELF_LAYERS, ...GAME_LAYERS]
export type PlayerLayers = Record<PlayerLayer, boolean>

export const DEFAULT_LAYERS: PlayerLayers = {
  notes: true, microReview: true, mistakes: false, deaths: false,
  dragon: false, baron: false, herald: false, grubs: false, turrets: false, inhibs: false, fights: false,
}
export const LAYERS_STORAGE_KEY = 'nm.reviewPlayer.layers'

/** Markers closer than this (pixels on the timeline) merge into one pill. */
export const GROUP_GAP_PX = 26
/** Glyphs a pill shows at most. */
export const PILL_GLYPHS = 2
/** In micro-review mode, the markers outside the moment's window. */
export const FADED_OPACITY = 0.32

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/**
 * Filters saved anywhere (the user setting `playerFilters`, 21/11: the same on every device, or the local copy): an
 * object or its JSON text. Null when there is nothing usable (the caller keeps what it has).
 */
export function parseLayers(raw: unknown): PlayerLayers | null {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return null } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Partial<Record<string, unknown>>
  const out = { ...DEFAULT_LAYERS }
  // A choice saved before the per-type objectives: « objectives » stands for all of them.
  if (typeof o.objectives === 'boolean') for (const k of OBJECTIVE_LAYERS) out[k] = o.objectives
  for (const k of PLAYER_LAYERS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean
  return out
}

export function sameLayers(a: PlayerLayers, b: PlayerLayers): boolean {
  return PLAYER_LAYERS.every((k) => a[k] === b[k])
}

/** The local copy (shown while the user setting loads, and when it can't be read). */
export function readLayers(store: Storage | null = storage()): PlayerLayers {
  try {
    return parseLayers(store?.getItem(LAYERS_STORAGE_KEY) ?? null) ?? { ...DEFAULT_LAYERS }
  } catch {
    return { ...DEFAULT_LAYERS }
  }
}

export function saveLayers(layers: PlayerLayers, store: Storage | null = storage()) {
  try { store?.setItem(LAYERS_STORAGE_KEY, JSON.stringify(layers)) } catch { /* per-device convenience */ }
}

/**
 * The player's filter chips (beta.20 feedback): each event type is shown until its chip is clicked, a second click
 * shows it again. Kept per device. The old « only these types » list (`nm.player.eventFilter`) is turned into the
 * hidden types once, then removed.
 */
export const HIDDEN_EVENTS_KEY = 'nm.player.hiddenEventTypes'
const OLD_EVENT_FILTER_KEY = 'nm.player.eventFilter'

export function toggleHidden<T extends string>(hidden: ReadonlySet<T>, type: T): Set<T> {
  const next = new Set(hidden)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  return next
}

export function readHiddenEvents<T extends string>(all: readonly T[], store: Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'> | null = storage() as never): Set<T> {
  const valid = new Set<string>(all)
  try {
    const raw = store?.getItem(HIDDEN_EVENTS_KEY)
    if (raw) {
      const v = JSON.parse(raw)
      return new Set(Array.isArray(v) ? (v as string[]).filter((x): x is T => valid.has(x)) : [])
    }
    const old = store?.getItem(OLD_EVENT_FILTER_KEY)
    if (old) {
      const shown = new Set(Array.isArray(JSON.parse(old)) ? (JSON.parse(old) as string[]) : all)
      const hidden = new Set(all.filter((x) => !shown.has(x)))
      store?.setItem(HIDDEN_EVENTS_KEY, JSON.stringify([...hidden]))
      store?.removeItem(OLD_EVENT_FILTER_KEY)
      return hidden
    }
  } catch { /* per-device convenience */ }
  return new Set()
}

export function saveHiddenEvents(hidden: ReadonlySet<string>, store: Pick<globalThis.Storage, 'setItem'> | null = storage()) {
  try { store?.setItem(HIDDEN_EVENTS_KEY, JSON.stringify([...hidden])) } catch { /* per-device convenience */ }
}

/** « Objectifs · tous »: every objective type shown, none, or some (the tri-state box). */
export function objectivesState(layers: PlayerLayers): 'all' | 'none' | 'some' {
  const on = OBJECTIVE_LAYERS.filter((k) => layers[k]).length
  return on === 0 ? 'none' : on === OBJECTIVE_LAYERS.length ? 'all' : 'some'
}

/** Ticking « Objectifs · tous »: all on, unless they already all are (then all off). */
export function toggleAllObjectives(layers: PlayerLayers): PlayerLayers {
  const on = objectivesState(layers) !== 'all'
  const out = { ...layers }
  for (const k of OBJECTIVE_LAYERS) out[k] = on
  return out
}

/** The counter on the « Filtres » button: the layers shown. */
export function activeFilterCount(layers: PlayerLayers, opts: { hideMistakes?: boolean } = {}): number {
  return PLAYER_LAYERS.filter((k) => layers[k] && !(opts.hideMistakes && k === 'mistakes')).length
}

const EVENT_LAYER: Record<string, PlayerLayer> = {
  dragon: 'dragon', baron: 'baron', herald: 'herald', voidgrub: 'grubs', turret: 'turrets', plate: 'turrets', inhibitor: 'inhibs',
}

/** The layer of a game event: an objective type, the player's deaths, or the rest of the fights (kills, assists). */
export function layerOfEvent(ev: { type: string; isPlayer: boolean }): PlayerLayer {
  if (EVENT_LAYER[ev.type]) return EVENT_LAYER[ev.type]
  if (ev.type === 'death' && ev.isPlayer) return 'deaths'
  return 'fights'
}

/** Markers of the player's own layers sit on the first row, the game's (objectives, fights) on the second. */
export function rowOfLayer(layer: PlayerLayer): 'self' | 'game' {
  return SELF_LAYERS.includes(layer) ? 'self' : 'game'
}

/** The layer of a mistake: the player's own (manual) ones are notes, the detected ones their own layer. */
export function layerOfMistake(m: { autoDetected: boolean }): PlayerLayer {
  return m.autoDetected ? 'mistakes' : 'notes'
}

/** A marker's opacity: 32 % outside the micro-review moment's window, else full. */
export function markerOpacity(time: number, window: { start: number; end: number } | null): number {
  if (!window) return 1
  return time >= window.start && time <= window.end ? 1 : FADED_OPACITY
}

/** Pill glyph priority: Nashor > Drake > Héraut > Inhib > Larves > Tours, then the other layers. */
const GLYPH_PRIORITY: PlayerLayer[] = ['baron', 'dragon', 'herald', 'inhibs', 'grubs', 'turrets', 'microReview', 'mistakes', 'deaths', 'notes', 'fights']

/**
 * Markers less than `gapPx` apart (on a timeline `widthPx` wide showing `durationSec`) merge into one group: at its
 * first marker's time (a click jumps there), with up to 2 layers to draw by priority and the count.
 */
export function groupMarkers<T extends { time: number; layer: PlayerLayer }>(
  items: T[], durationSec: number, widthPx: number, gapPx = GROUP_GAP_PX,
): Array<{ time: number; count: number; glyphs: PlayerLayer[]; items: T[] }> {
  if (durationSec <= 0 || widthPx <= 0) return items.map((it) => ({ time: it.time, count: 1, glyphs: [it.layer], items: [it] }))
  const secPerPx = durationSec / widthPx
  const sorted = [...items].sort((a, b) => a.time - b.time)
  const out: Array<{ time: number; count: number; glyphs: PlayerLayer[]; items: T[] }> = []
  for (const it of sorted) {
    const last = out[out.length - 1]
    if (last && (it.time - last.items[last.items.length - 1].time) / secPerPx < gapPx) {
      last.items.push(it)
      last.count += 1
    } else {
      out.push({ time: it.time, count: 1, glyphs: [], items: [it] })
    }
  }
  for (const g of out) {
    const layers = [...new Set(g.items.map((x) => x.layer))]
    g.glyphs = layers.sort((a, b) => GLYPH_PRIORITY.indexOf(a) - GLYPH_PRIORITY.indexOf(b)).slice(0, PILL_GLYPHS)
  }
  return out
}

/** Colours of the bookmarks the micro-review creates (Back-end's, and the spec's micro-review colour). */
const MICRO_REVIEW_BOOKMARK_COLORS = ['#c89b3c', '#e66556']
/** A bookmark is a micro-review moment (its colour), else a « Prise de note ». */
export function isMicroReviewBookmark(b: { color?: string | null }): boolean {
  return !!b.color && MICRO_REVIEW_BOOKMARK_COLORS.includes(b.color.toLowerCase())
}
/** The colour a « Prise de note » bookmark is saved with (spec § 19: notes). */
export const NOTE_BOOKMARK_COLOR = '#D4A24C'

/**
 * The Review player's panel layout (DECISIONS 21/11, spec § 19 « Coin de la vidéo »): hidden or shown, left or right.
 * A user setting (`reviewPanel`, synced like the filters), never reset; the local copy shows meanwhile.
 */
export interface ReviewPanelPrefs { hidden: boolean; side: 'left' | 'right' }
export const DEFAULT_PANEL_PREFS: ReviewPanelPrefs = { hidden: false, side: 'right' }
export const PANEL_STORAGE_KEY = 'nm.reviewPlayer.panel'

export function parsePanelPrefs(raw: unknown): ReviewPanelPrefs | null {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return null } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Partial<Record<string, unknown>>
  return { hidden: o.hidden === true, side: o.side === 'left' ? 'left' : 'right' }
}

export function readPanelPrefs(store: Storage | null = storage()): ReviewPanelPrefs {
  try { return parsePanelPrefs(store?.getItem(PANEL_STORAGE_KEY) ?? null) ?? { ...DEFAULT_PANEL_PREFS } } catch { return { ...DEFAULT_PANEL_PREFS } }
}

export function savePanelPrefs(p: ReviewPanelPrefs, store: Storage | null = storage()) {
  try { store?.setItem(PANEL_STORAGE_KEY, JSON.stringify(p)) } catch { /* per-device convenience */ }
}
