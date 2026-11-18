/**
 * Browser script of the showcase site. Everything on the page is already
 * rendered and readable without it; this file makes the exhibits respond.
 *
 * Each exhibit is the same module the build used (site/src/exhibits): a
 * `reduce(state, action, data)` and a `render(state, data)`. One click
 * listener per exhibit reads `data-act` from the control that was used, asks
 * the module for the next state and paints it. No framework, no network call
 * except the release lookup at the bottom.
 */
import * as micro from '../exhibits/micro.mjs'
import * as dashboard from '../exhibits/dashboard.mjs'
import * as lab from '../exhibits/lab.mjs'
import * as radar from '../exhibits/radar.mjs'
import * as tiers from '../exhibits/tiers.mjs'
import { appVars } from '../lib/appVars.mjs'
import { isNewer } from '../lib/version.mjs'
// The app's own derivation of a full theme from three colours.
import { deriveCustomTokens } from '../../../src/lib/theme'

const EXHIBITS = { micro, dashboard, lab, radar, tiers }

const read = (id) => {
  const el = document.getElementById(id)
  return el ? JSON.parse(el.textContent) : null
}

/* ── Exhibits ─────────────────────────────────────────────────────────── */

function mount(root) {
  const name = root.dataset.exhibit
  const mod = EXHIBITS[name]
  const data = read(`data-${name}`)
  if (!mod || !data) return
  let state = mod.initialState(data)

  const dispatch = (type, el) => {
    const next = mod.reduce(state, { ...el.dataset, type }, data)
    if (next === state) return
    state = next
    root.innerHTML = mod.render(state, data)
    // The control that was used no longer exists: put the focus where the
    // module says the result is, so keyboard and screen-reader users follow.
    if (!state.focus) return
    const target = root.querySelector(`[data-k="${state.focus}"]`)
    if (!target) return
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'nearest' })
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]')
    if (el && root.contains(el)) dispatch(el.dataset.act, el)
  })
  // A mouse may inspect by hovering; touch and pen select by tapping.
  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return
    const el = e.target.closest('[data-hover]')
    if (el && root.contains(el)) dispatch(el.dataset.hover, el)
  })
}

document.querySelectorAll('[data-exhibit]').forEach(mount)

/* ── Themes: repaint the sample, never re-create the colour inputs ────── */

const themeRoot = document.querySelector('[data-themes]')
const themeData = read('data-themes')
if (themeRoot && themeData) {
  const sample = themeRoot.querySelector('[data-sample]')
  const own = themeRoot.querySelector('input[name="theme"][value="custom"]')
  const ownChip = own.parentElement.querySelectorAll('.sw-chip i')
  const field = (name) => themeRoot.querySelector(`input[name="${name}"]`)
  const customVars = () => appVars(deriveCustomTokens({ base: field('base').value, accent: field('accent').value, secondary: field('secondary').value }))
  const paint = (vars) => { for (const [k, v] of vars) sample.style.setProperty(k, v) }

  themeRoot.addEventListener('change', (e) => {
    if (e.target.name !== 'theme') return
    paint(e.target.value === 'custom' ? customVars() : themeData.presets[e.target.value])
  })
  themeRoot.addEventListener('input', (e) => {
    if (e.target.type !== 'color') return
    const vars = customVars()
    const v = Object.fromEntries(vars)
    own.checked = true
    paint(vars)
    ownChip[0].style.background = v['--app-bg']
    ownChip[1].style.background = v['--app-accent']
    ownChip[2].style.background = v['--app-second']
  })
}

/* ── Rail: contents toggle on small screens, current section on large ─── */

const rail = document.querySelector('[data-rail]')
const toggle = rail && rail.querySelector('[data-toggle]')
if (toggle) {
  const set = (open) => {
    rail.classList.toggle('is-open', open)
    toggle.setAttribute('aria-expanded', String(open))
  }
  // Without script the control is a plain link to the contents list in the
  // footer; with it, a disclosure button for the list in the bar.
  toggle.setAttribute('role', 'button')
  set(false)
  toggle.addEventListener('click', (e) => { e.preventDefault(); set(!rail.classList.contains('is-open')) })
  toggle.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); toggle.click() } })
  rail.querySelector('.rail-nav').addEventListener('click', (e) => { if (e.target.closest('a')) set(false) })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !rail.classList.contains('is-open')) return
    set(false)
    toggle.focus()
  })
}

const links = new Map()
document.querySelectorAll('.rail-nav a[href^="#"]').forEach((a) => links.set(a.getAttribute('href').slice(1), a))
const sections = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean)
if (sections.length && 'IntersectionObserver' in window) {
  const inBand = new Set()
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) inBand.add(entry.target.id)
      else inBand.delete(entry.target.id)
    }
    const current = sections.find((s) => inBand.has(s.id))
    for (const [id, a] of links) {
      if (current && current.id === id) a.setAttribute('aria-current', 'location')
      else a.removeAttribute('aria-current')
    }
  }, { rootMargin: '-20% 0px -70% 0px' })
  sections.forEach((s) => observer.observe(s))
}

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
      // The published digest belongs to the release this page was built for.
      document.querySelectorAll('[data-verify]').forEach((el) => { el.hidden = true })
    })
    .catch(() => { /* the built-in link stays */ })
}
