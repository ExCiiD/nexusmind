import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Remembers the scroll position of the app's content area for this page, and puts it back when we come BACK to it (history POP:
 * the app's back button, the mouse button). A fresh visit starts at the top. `ready` = the content is there (data loaded), so the
 * saved position exists in the page when we restore it.
 */
const KEY = (path: string) => `ascend.scroll:${path}`
const root = () => document.querySelector<HTMLElement>('[data-scroll-root]')
/** HashRouter: the route is the hash without its query. */
const currentPath = () => window.location.hash.replace(/^#/, '').split('?')[0]

export function useScrollMemory(ready: boolean): void {
  const { pathname } = useLocation()
  const type = useNavigationType()
  const restored = useRef(false)

  useEffect(() => {
    if (!ready || restored.current) return
    restored.current = true
    if (type !== 'POP') return
    try {
      const y = Number(sessionStorage.getItem(KEY(pathname)))
      if (y > 0) requestAnimationFrame(() => { const el = root(); if (el) el.scrollTop = y })
    } catch { /* storage blocked: stay at the top */ }
  }, [ready, pathname, type])

  // Saved while scrolling (not on leaving: by then the next page may already have clamped the container).
  useEffect(() => {
    const el = root()
    if (!el) return
    const save = () => {
      if (currentPath() !== pathname) return
      try { sessionStorage.setItem(KEY(pathname), String(el.scrollTop)) } catch { /* ignore */ }
    }
    el.addEventListener('scroll', save, { passive: true })
    return () => el.removeEventListener('scroll', save)
  }, [pathname])
}
