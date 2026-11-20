import { useEffect, useRef } from 'react'

/** A focus / back-to-visible run is skipped when the last run is younger than this (no bursts when switching windows). */
const MIN_EVENT_GAP_MS = 30_000

/**
 * Polls `fn` every `intervalMs` while the page is visible, and also runs it
 * when the window regains focus or the tab becomes visible again — unless
 * the last run is less than 30 s old. Nothing runs while
 * `document.visibilityState === 'hidden'` (minimised app, background tab):
 * task I, "≈ 0 requests when hidden".
 *
 * `fn` is read through a ref, so a new function each render does not
 * restart the timer.
 */
export function useVisiblePolling(fn: () => unknown, intervalMs: number, enabled = true, immediate = true) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  // Kept across effect re-runs: a new interval (e.g. Realtime going live) must not trigger an extra run.
  const lastRunRef = useRef(0)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setInterval> | null = null
    const run = () => { lastRunRef.current = Date.now(); void fnRef.current() }
    const runIfStale = () => { if (Date.now() - lastRunRef.current >= MIN_EVENT_GAP_MS) run() }
    const start = () => { if (!timer) timer = setInterval(run, intervalMs) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop()
      else { runIfStale(); start() }
    }
    const onFocus = () => { if (document.visibilityState !== 'hidden') runIfStale() }

    // First mount only, and only when the screen does not load on its own (`immediate`).
    if (!startedRef.current) {
      startedRef.current = true
      if (immediate) run()
      else lastRunRef.current = Date.now()
    }
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [intervalMs, enabled, immediate])
}
