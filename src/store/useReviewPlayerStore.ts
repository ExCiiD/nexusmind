import { create } from 'zustand'
import { parseLayers, parsePanelPrefs, readLayers, readPanelPrefs, sameLayers, saveLayers, savePanelPrefs, type PlayerLayer, type PlayerLayers } from '@/lib/playerLayers'
import { useUserStore } from '@/store/useUserStore'

/** A detected mistake as the side panel lists it. */
export interface DetectedMarker { id: string; gameTimeSec: number; videoTimeMs: number | null; label: string }

/** A micro-review moment's clip, in game time (vodTiming.clipWindow). */
export interface ReviewClip {
  momentKey: string
  startSec: number
  endSec: number
}

/** The right panel of the Review player (spec § 19): micro-review or the marked notes. */
export type ReviewPanelTab = 'microReview' | 'notes'

interface ReviewPlayerState {
  /** The recording's bookmarks (« Notes marquées »: micro-review moments and « Prise de note »), loaded by the player. */
  bookmarks: import('@/lib/ipc').Bookmark[]
  setBookmarks: (list: import('@/lib/ipc').Bookmark[]) => void
  /** Ask the player to reload its bookmarks (a micro-review answer adds one on the server). */
  bookmarksNonce: number
  reloadBookmarks: () => void
  /** A seek in video time, from the marked notes. */
  videoSeek: { ms: number; nonce: number } | null
  requestVideoSeek: (ms: number) => void
  panelOpen: boolean
  /** The panel's side (spec § 19 « Coin de la vidéo »), saved with `panelOpen` in the user setting `reviewPanel`. */
  panelSide: 'left' | 'right'
  toggleSide: () => void
  panelTab: ReviewPanelTab | null
  /** The tab the right panel shows (its default included): micro-review mode only while it is the micro-review. */
  activeTab: ReviewPanelTab | null
  togglePanel: () => void
  setPanelTab: (tab: ReviewPanelTab) => void
  /** The Review player's current time as game time (seconds), null without a playable recording. */
  playerGameTime: (() => number) | null
  /** Beta.20: the Review player's height in px (the side panel takes the same height), null when unknown. */
  playerHeight: number | null
  /** Beta.20 « AUTO »: the game's detected mistakes, listed in the side panel while the AUTO chip is on. */
  detectedMistakes: DetectedMarker[]
  /** The micro-review's progress, for the selector « Micro-review 2 / 3 ». */
  microReviewCount: { done: number; total: number } | null
  setMicroReviewCount: (c: { done: number; total: number } | null) => void
  /** The last seek asked for (game time); the nonce makes the same time seekable twice. */
  seek: { gameSec: number; nonce: number } | null
  /** The micro-review moment shown in the player (micro-review mode), or none. */
  clip: ReviewClip | null
  /** « Clipper ce moment »: the player opens its clip mode on this window (game time). */
  clipRequest: { startSec: number; endSec: number; nonce: number } | null
  requestClip: (win: { startSec: number; endSec: number }) => void
  /**
   * Beta.20 (« it comes back at a random older time »): the seek / note / clip requests are one-shot. They lived on
   * in this store after the player left, and the next player re-applied the last one when it opened. Cleared when
   * the Review player closes or changes game: opening a recording starts at 0, or at the moment asked for.
   */
  clearRequests: () => void
  layers: PlayerLayers
  requestSeek: (gameSec: number) => void
  setClip: (clip: ReviewClip | null) => void
  toggleLayer: (layer: PlayerLayer) => void
  /** The « Filtres » menu: the whole set (reset, « Objectifs · tous »). */
  setLayers: (layers: PlayerLayers) => void
}

/**
 * The Review's single video player (DECISIONS 21/11): the micro-review box no longer has its own video; it drives the
 * recording player (GameRecordingPanel) through this store: seek to the moment's window, its 3 markers, the layers.
 */
export const useReviewPlayerStore = create<ReviewPlayerState>((set, get) => ({
  seek: null,
  clip: null,
  bookmarks: [],
  setBookmarks: (bookmarks) => set({ bookmarks }),
  bookmarksNonce: 0,
  reloadBookmarks: () => set({ bookmarksNonce: get().bookmarksNonce + 1 }),
  videoSeek: null,
  requestVideoSeek: (ms) => set({ videoSeek: { ms: Math.max(0, ms), nonce: (get().videoSeek?.nonce ?? 0) + 1 } }),
  panelOpen: !readPanelPrefs().hidden,
  panelSide: readPanelPrefs().side,
  toggleSide: () => {
    set({ panelSide: get().panelSide === 'right' ? 'left' : 'right' })
    persistPanel()
  },
  panelTab: null,
  activeTab: null,
  togglePanel: () => { set({ panelOpen: !get().panelOpen }); persistPanel() },
  setPanelTab: (panelTab) => { const reopen = !get().panelOpen; set({ panelTab, panelOpen: true }); if (reopen) persistPanel() },
  microReviewCount: null,
  playerGameTime: null,
  playerHeight: null,
  detectedMistakes: [],
  setMicroReviewCount: (microReviewCount) => set({ microReviewCount }),
  clipRequest: null,
  requestClip: (win) => set({ clipRequest: { ...win, nonce: (get().clipRequest?.nonce ?? 0) + 1 } }),
  clearRequests: () => set({ seek: null, videoSeek: null, clipRequest: null }),
  layers: readLayers(),
  requestSeek: (gameSec) => set({ seek: { gameSec: Math.max(0, gameSec), nonce: (get().seek?.nonce ?? 0) + 1 } }),
  setClip: (clip) => set({ clip }),
  toggleLayer: (layer) => get().setLayers({ ...get().layers, [layer]: !get().layers[layer] }),
  setLayers: (layers) => {
    saveLayers(layers)
    set({ layers })
    persistRemote(layers)
  },
}))

/**
 * 21/11 (Chief, final): the filters are a user setting (`playerFilters`, getUser / updateUser; Back-end stores it in
 * the synced UserPreference table), the same on every device and never reset when a page opens. Written on each
 * change (best effort; the local copy stays), and taken from the user when it loads or changes.
 */
function persistRemote(layers: PlayerLayers) {
  const user = useUserStore.getState().user
  if (!user) return
  useUserStore.setState({ user: { ...user, playerFilters: layers } })
  window.api?.updateUser?.({ playerFilters: layers })?.catch?.(() => { /* the local copy stays */ })
}

/** The panel's layout to the user setting `reviewPanel` (and the local copy). */
function persistPanel() {
  const { panelOpen, panelSide } = useReviewPlayerStore.getState()
  const prefs = { hidden: !panelOpen, side: panelSide }
  savePanelPrefs(prefs)
  const user = useUserStore.getState().user
  if (!user) return
  useUserStore.setState({ user: { ...user, reviewPanel: prefs } })
  window.api?.updateUser?.({ reviewPanel: prefs })?.catch?.(() => { /* the local copy stays */ })
}

function syncFromUser(user: { playerFilters?: unknown; reviewPanel?: unknown } | null | undefined) {
  const panel = parsePanelPrefs(user?.reviewPanel)
  if (panel) {
    const st = useReviewPlayerStore.getState()
    if (st.panelOpen === panel.hidden || st.panelSide !== panel.side) {
      savePanelPrefs(panel)
      useReviewPlayerStore.setState({ panelOpen: !panel.hidden, panelSide: panel.side })
    }
  }
  const remote = parseLayers(user?.playerFilters)
  if (!remote || sameLayers(remote, useReviewPlayerStore.getState().layers)) return
  saveLayers(remote)
  useReviewPlayerStore.setState({ layers: remote })
}
useUserStore.subscribe((s) => syncFromUser(s.user))
// The user may already be loaded when this module is first imported.
syncFromUser(useUserStore.getState().user)
