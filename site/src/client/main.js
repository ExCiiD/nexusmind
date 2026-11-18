/**
 * Browser script of the showcase site. Everything on the page is already
 * rendered and readable without it; this file adds what needs a browser:
 *
 *   - the top bar's menu on small screens;
 *   - the app's clips, which play only while they are on screen (never with
 *     reduced motion), each with a pause control;
 *   - the mini demonstration windows of the product pages;
 *   - the download link, moved to a newer release if GitHub knows one.
 *
 * No framework, no network call except the release lookup.
 */
import { isNewer } from '../lib/version.mjs'

const root = document.documentElement
root.classList.add('js')
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
const lang = root.lang === 'fr' ? 'fr' : 'en'
const WORDS = {
  fr: { pause: 'Pause', play: 'Lecture', pauseLabel: 'Mettre la vidéo en pause', playLabel: 'Lire la vidéo' },
  en: { pause: 'Pause', play: 'Play', pauseLabel: 'Pause the video', playLabel: 'Play the video' },
}[lang]

const read = (id) => {
  const el = document.getElementById(id)
  return el ? JSON.parse(el.textContent) : null
}

/* ── Top bar: the two pages fold into a menu on small screens ─────────── */

const top = document.querySelector('[data-top]')
const toggle = top && top.querySelector('.top-toggle')
if (toggle) {
  toggle.hidden = false
  const set = (open) => {
    top.classList.toggle('is-open', open)
    toggle.setAttribute('aria-expanded', String(open))
  }
  toggle.addEventListener('click', () => set(!top.classList.contains('is-open')))
  top.querySelector('.top-nav').addEventListener('click', (e) => { if (e.target.closest('a')) set(false) })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !top.classList.contains('is-open')) return
    set(false)
    toggle.focus()
  })
}

/* ── Clips: play on screen, pause off screen, a control to stop them ──── */

const inTour = (video) => !!video.closest('[data-tour]')
const visible = new WeakSet()
/** Videos the visitor paused: they stay paused until played again. */
const held = new WeakSet()

function playIfAllowed(video) {
  if (reduced.matches || held.has(video) || !visible.has(video)) return
  const p = video.play()
  if (p && p.catch) p.catch(() => { /* autoplay refused: the poster stays */ })
}

const clips = [...document.querySelectorAll('video[data-clip]')]
const clipObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) { visible.add(target); if (!inTour(target)) playIfAllowed(target) } else { visible.delete(target); target.pause() }
    }
  }, { threshold: 0.35 })
  : null

for (const video of clips) {
  if (inTour(video)) continue
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'clip-toggle'
  const paint = () => {
    const playing = !video.paused
    button.textContent = playing ? WORDS.pause : WORDS.play
    button.setAttribute('aria-label', playing ? WORDS.pauseLabel : WORDS.playLabel)
    button.setAttribute('aria-pressed', String(!playing && held.has(video)))
  }
  button.addEventListener('click', () => {
    if (video.paused) { held.delete(video); visible.add(video); const p = video.play(); if (p && p.catch) p.catch(() => {}) } else { held.add(video); video.pause() }
  })
  video.addEventListener('play', paint)
  video.addEventListener('pause', paint)
  paint()
  video.parentElement.appendChild(button)
  if (clipObserver) clipObserver.observe(video)
}

/* ── Mini demonstration windows ───────────────────────────────────────── */

/** How long a still chapter stays on screen. */
const STILL_MS = 6000

function mountTour(tour) {
  const tabs = [...tour.querySelectorAll('[role="tab"]')]
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')))
  let index = 0
  let timer = 0
  let auto = !reduced.matches
  let onScreen = false

  const mediaOf = (i) => panels[i].querySelector('video, img')
  for (const p of panels) {
    const v = p.querySelector('video')
    if (!v) continue
    v.loop = false
    v.preload = 'metadata'
    if (reduced.matches) v.controls = true
    v.addEventListener('ended', () => { if (auto && panels[index] === p) show(index + 1) })
  }

  function run() {
    clearTimeout(timer)
    tour.classList.toggle('is-playing', auto && onScreen)
    if (!auto || !onScreen) return
    const m = mediaOf(index)
    if (m.tagName === 'VIDEO') {
      const start = () => {
        tour.style.setProperty('--dur', `${Math.max(1, m.duration || STILL_MS / 1000)}s`)
        m.currentTime = 0
        const p = m.play()
        if (p && p.catch) p.catch(() => { timer = setTimeout(() => show(index + 1), STILL_MS) })
      }
      if (m.readyState >= 1) start(); else m.addEventListener('loadedmetadata', start, { once: true })
    } else {
      tour.style.setProperty('--dur', `${STILL_MS / 1000}s`)
      timer = setTimeout(() => show(index + 1), STILL_MS)
    }
  }

  function show(i, { focus = false } = {}) {
    const next = (i + tabs.length) % tabs.length
    const before = mediaOf(index)
    if (before.tagName === 'VIDEO') before.pause()
    index = next
    tabs.forEach((t, k) => {
      const on = k === index
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
      panels[k].classList.toggle('is-on', on)
    })
    // Restart the progress bar of the chosen tab.
    tour.classList.remove('is-playing')
    void tour.offsetWidth
    if (focus) tabs[index].focus()
    run()
  }

  tabs.forEach((t, k) => t.addEventListener('click', () => {
    // A chapter chosen by hand stays: the window stops going through the others.
    auto = false
    show(k)
    const m = mediaOf(k)
    if (m.tagName === 'VIDEO' && !reduced.matches) { m.loop = true; const p = m.play(); if (p && p.catch) p.catch(() => {}) }
  }))
  tour.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index }[e.key]
    if (step == null) return
    e.preventDefault()
    auto = false
    show(index + step, { focus: true })
  })

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      if (!onScreen) { clearTimeout(timer); const m = mediaOf(index); if (m.tagName === 'VIDEO') m.pause() }
      run()
    }, { threshold: 0.4 }).observe(tour)
  }
  tour.classList.add('is-ready')
}

document.querySelectorAll('[data-tour]').forEach(mountTour)

/* ── Download: follow a newer release if GitHub knows one ─────────────── */

const release = read('data-release')
if (release && 'fetch' in window) {
  fetch(release.api, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => {
      const isInstaller = (a) => /Setup.*\.exe$/i.test(a.name)
      const found = list.find((r) => !r.draft && r.assets.some(isInstaller))
      if (!found) return
      const version = found.tag_name.replace(/^v/, '')
      if (!isNewer(version, release.version)) return
      const asset = found.assets.find(isInstaller)
      const size = `${new Intl.NumberFormat(release.locale).format(Math.round(asset.size / 1048576))} ${release.sizeUnit}`
      document.querySelectorAll('[data-download]').forEach((a) => { a.href = asset.browser_download_url })
      document.querySelectorAll('[data-version]').forEach((el) => { el.textContent = version })
      document.querySelectorAll('[data-size]').forEach((el) => { el.textContent = size })
    })
    .catch(() => { /* the built-in link stays */ })
}
