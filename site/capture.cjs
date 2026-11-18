/**
 * Photographs and films the app for the showcase site, from the UI harness
 * (the `ui-harness` preview, http://localhost:5199, with its mock data):
 *
 *   npx electron site/capture.cjs                 every shot of site/shots.cjs
 *   npx electron site/capture.cjs dashboard lab   only these ids
 *
 * A still becomes site/public/media/<id>.webp; a clip becomes <id>.mp4
 * (H.264, muted, cut to loop) with a <id>.webp poster, its first frame.
 * Nothing is shown on screen: the app renders off screen, a drawn cursor
 * stands in for the mouse, and the harness user's own name is replaced by a
 * demo identity. The harness must be running first.
 */
const { app, BrowserWindow, protocol, session } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ffmpegPath = require('ffmpeg-static')
const SHOTS = require('./shots.cjs')

const HARNESS = (process.env.HARNESS_URL || 'http://localhost:5199').replace(/\/+$/, '')
const OUT = process.env.CAPTURE_OUT || path.join(__dirname, 'public', 'media')
const FPS = 25

/** The harness speaks as its developer; the site shows a demo player and the released version. */
const VERSION = require('../package.json').version
const DEMO_NAMES = [['Coach ExCiiD', 'Coach Sora'], ['ExCiiD#AIGRI', 'Nova#EUW'], ['ExCiiD', 'Nova'], ['AIGRI', 'EUW'], ['0.2.0-beta.107', VERSION]]

/** Same starting point for every shot: French, jungle main, default theme and background. */
const BASE_STORAGE = { nexusmind_lang: 'fr', harness_role: 'JUNGLE', ascend_color_theme: 'hextech' }

const CURSOR_SVG = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10.1 13 L16 13 Z" fill="#F5E3BE" stroke="#0D0A06" stroke-width="1.4" stroke-linejoin="round"/></svg>'

/** Runs in the page once it has loaded: demo names, drawn cursor, no scrollbars, smooth scroll helper. */
const PAGE_SETUP = `(() => {
  if (window.__capture) return
  window.__capture = true
  const pairs = ${JSON.stringify(DEMO_NAMES)}
  const fix = (node) => {
    let text = node.nodeValue
    let changed = false
    for (const [a, b] of pairs) if (text.includes(a)) { text = text.split(a).join(b); changed = true }
    if (changed) node.nodeValue = text
  }
  const walk = (root) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) fix(n) }
  walk(document.body)
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fix(m.target)
      else m.addedNodes.forEach((n) => (n.nodeType === 3 ? fix(n) : n.nodeType === 1 && walk(n)))
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true })

  const style = document.createElement('style')
  style.textContent = '::-webkit-scrollbar{width:0!important;height:0!important}*{caret-color:transparent}' +
    '#__cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:22px;height:22px;margin:-2px 0 0 -3px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}' +
    '.__ripple{position:fixed;z-index:2147483646;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #D4A24C;animation:__ripple .45s ease-out forwards}' +
    '@keyframes __ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.25);opacity:0}}'
  document.head.appendChild(style)
  const cursor = document.createElement('div')
  cursor.id = '__cursor'
  cursor.innerHTML = ${JSON.stringify(CURSOR_SVG)}
  cursor.style.display = 'none'
  document.documentElement.appendChild(cursor)
  window.__cursorAt = (x, y) => { cursor.style.display = 'block'; cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)' }
  window.__cursorHide = () => { cursor.style.display = 'none' }
  window.__ripple = (x, y) => {
    const r = document.createElement('div')
    r.className = '__ripple'
    r.style.left = x + 'px'
    r.style.top = y + 'px'
    document.documentElement.appendChild(r)
    setTimeout(() => r.remove(), 600)
  }
  /** Closest ancestor that scrolls vertically (overflow auto/scroll, with something to scroll). */
  window.__scroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p
    }
    return null
  }
  /**
   * Brings an element into view by scrolling only its scroll container, eased
   * (scrollIntoView would also move overflow-hidden ancestors, i.e. the whole
   * app frame). block: 'nearest' (default), 'start' or 'center'.
   */
  window.__bringIntoView = (el, block, ms) => new Promise((done) => {
    const sc = window.__scroller(el)
    if (!sc) return done()
    const r = el.getBoundingClientRect()
    const box = sc.getBoundingClientRect()
    let dy = 0
    if (block === 'start') dy = r.top - box.top - 12
    else if (block === 'center') dy = r.top + r.height / 2 - (box.top + box.height / 2)
    else if (r.top < box.top + 12) dy = r.top - box.top - 24
    else if (r.bottom > box.bottom - 12) dy = Math.min(r.bottom - box.bottom + 24, r.top - box.top - 24)
    if (Math.abs(dy) < 2) return done()
    if (!ms) { sc.scrollTop += dy; return done() }
    const from = sc.scrollTop
    const start = performance.now()
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms)
      sc.scrollTop = from + dy * ease(t)
      if (t < 1) requestAnimationFrame(step); else done()
    }
    requestAnimationFrame(step)
  })
  /** Center of an element, brought into view first (eased, so a clip shows the scroll). */
  window.__centerEl = async (el) => {
    if (!el) return null
    await window.__bringIntoView(el, 'nearest', 450)
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }
  /** Center of the first element matching the selector (and containing the text, if given). */
  window.__center = (selector, text) => {
    const all = [...document.querySelectorAll(selector)]
    return window.__centerEl(text ? all.find((e) => e.textContent.trim().includes(text)) : all[0])
  }
  /** Box of the card holding a heading (or any text): the closest bordered, rounded block around it. */
  window.__card = (text, card) => {
    const tags = [...document.querySelectorAll('h1, h2, h3, h4, p, span, button, div')]
    const hit = tags.filter((e) => e.children.length < 4 && e.textContent.trim().startsWith(text))
      .sort((a, b) => a.textContent.length - b.textContent.length)[0]
    if (!hit) return null
    const el = hit.closest(card || '[class*="rounded"][class*="border"]') || hit
    const r = el.getBoundingClientRect()
    return [r.left, r.top, r.right, r.bottom]
  }
  /** Eased scroll of the page's scroll container (or of a given element) by dy px over ms. */
  window.__scroll = (selector, dy, ms) => new Promise((done) => {
    const el = selector ? document.querySelector(selector) : (document.querySelector('main .overflow-y-auto') || document.scrollingElement)
    if (!el) return done()
    const from = el.scrollTop
    const start = performance.now()
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms)
      el.scrollTop = from + dy * ease(t)
      if (t < 1) requestAnimationFrame(step); else done()
    }
    requestAnimationFrame(step)
  })
})()`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Thumbnails for the recordings the harness lists (it has no video files):
 * the app's own schematic map (MiniMap.tsx, no game art) with the moment of
 * a fight, a different one per file. Served to the page on the app's media
 * scheme, `nxm://`.
 */
function thumbnail(seed) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296 }
  const tilt = (rnd() - 0.5) * 16
  const zoom = 1.6 + rnd() * 0.9
  const fx = 22 + rnd() * 56
  const fy = 22 + rnd() * 56
  const dots = Array.from({ length: 7 }, (_, i) => {
    const a = rnd() * Math.PI * 2
    const d = 2 + rnd() * 9
    const ours = i < 3
    return `<circle cx="${(fx + Math.cos(a) * d).toFixed(1)}" cy="${(fy + Math.sin(a) * d).toFixed(1)}" r="1.6" fill="${ours ? '#D4A24C' : '#E24C3A'}" stroke="#F5E3BE" stroke-width="0.35"/>`
  }).join('')
  const map = `<g transform="translate(${50 - fx * zoom} ${50 - fy * zoom}) scale(${zoom}) rotate(${tilt.toFixed(1)} ${fx} ${fy})">` +
    '<rect width="100" height="100" rx="3" fill="#120D08"/>' +
    '<path d="M 0 0 L 100 100" stroke="#E4C285" stroke-opacity="0.18" stroke-width="9"/>' +
    '<path d="M 7 93 L 7 7 L 93 7 M 7 93 L 93 93 L 93 7 M 9 91 L 91 9" fill="none" stroke="#6B5330" stroke-width="2.2"/>' +
    '<circle cx="5" cy="95" r="6" fill="#D4A24C" fill-opacity="0.3"/><circle cx="95" cy="5" r="6" fill="#E24C3A" fill-opacity="0.3"/>' +
    '<circle cx="31" cy="29" r="9" fill="none" stroke="#D4A24C" stroke-opacity="0.35" stroke-dasharray="1.5 1.5" stroke-width="0.5"/><circle cx="31" cy="29" r="2.2" fill="#D4A24C" fill-opacity="0.7"/>' +
    '<circle cx="69" cy="71" r="9" fill="none" stroke="#D4A24C" stroke-opacity="0.35" stroke-dasharray="1.5 1.5" stroke-width="0.5"/><circle cx="69" cy="71" r="2.2" fill="#D4A24C" fill-opacity="0.7"/>' +
    `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="12" fill="#D4A24C" fill-opacity="0.07"/>${dots}</g>`
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="640" height="360">' +
    '<defs><radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.7"/></radialGradient></defs>' +
    '<rect width="160" height="90" fill="#0D0A06"/>' +
    `<svg x="30" y="-25" width="100" height="140" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${map}</svg>` +
    '<rect width="160" height="90" fill="url(#v)"/></svg>'
}

/**
 * Riot art stays off the site (site/DESIGN.md, brief): every champion icon,
 * spell or item picture the app loads from Data Dragon, and every video
 * thumbnail, is swapped at capture time for a neutral tile in the app's
 * colours. A champion keeps its initials, so a list still reads.
 */
const RIOT_ART = ['*://ddragon.leagueoflegends.com/cdn/*/img/*', '*://i.ytimg.com/*', '*://img.youtube.com/*']

function artTile(source) {
  const url = decodeURIComponent(source)
  const champ = url.match(/\/img\/champion\/([A-Za-z]+)\.png/)
  if (/ytimg|youtube/.test(url)) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180"><rect width="320" height="180" fill="#1C140C"/><rect x="0.5" y="0.5" width="319" height="179" fill="none" stroke="#3A2C18"/><path d="M146 70 L178 90 L146 110 Z" fill="#6B5330"/></svg>'
  }
  const words = champ ? champ[1].replace(/([a-z])([A-Z])/g, '$1 $2').split(' ') : []
  const initials = words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 2) : (words[0] || '').slice(0, 2)
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><rect width="120" height="120" fill="#2A1D11"/><rect x="2" y="2" width="116" height="116" fill="none" stroke="#6B5330" stroke-width="4"/>' +
    (initials ? `<text x="60" y="76" text-anchor="middle" font-family="Big Shoulders Display, Arial Narrow, sans-serif" font-weight="800" font-size="46" fill="#E4C285">${initials.toUpperCase()}</text>` : '') + '</svg>'
}

protocol.registerSchemesAsPrivileged([{ scheme: 'nxm', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.slice(-600)}`))))
  })
}

/** ffmpeg filter for the shot's crop (in viewport pixels) and output size. */
function videoFilter(shot) {
  const [vw, vh] = shot.viewport
  const [cx, cy, cw, ch] = shot.crop || [0, 0, vw, vh]
  const [ow, oh] = shot.out
  return `crop=${cw}:${ch}:${cx}:${cy},scale=${ow}:${oh}:flags=lanczos`
}

class Stage {
  /** `zoom`: page zoom of the window; page coordinates (CSS px) × zoom = window coordinates. */
  constructor(win, zoom = 1) {
    this.win = win
    this.wc = win.webContents
    this.zoom = zoom
    this.mouse = { x: Math.round(win.getContentSize()[0] * 0.62), y: Math.round(win.getContentSize()[1] * 0.58) }
  }

  /** Page point → window point (what input events and the drawn cursor's parent use). */
  toWindow(c) { return { x: Math.round(c.x * this.zoom), y: Math.round(c.y * this.zoom) } }

  js(code) { return this.wc.executeJavaScript(code, true) }

  async goto(route) {
    await this.js(`location.hash = ${JSON.stringify('#' + route)}`)
  }

  /** Window point of a target ([x, y] are page coordinates). */
  async target(t) {
    if (Array.isArray(t)) return this.toWindow({ x: t[0], y: t[1] })
    let c
    if (t.js) c = await this.js(`window.__centerEl((${t.js}))`)
    else {
      const [selector, text] = typeof t === 'string' ? [t, null] : [t.sel, t.text]
      c = await this.js(`window.__center(${JSON.stringify(selector)}, ${JSON.stringify(text)})`)
    }
    if (!c) throw new Error(`no element for ${JSON.stringify(t)}`)
    return this.toWindow(c)
  }

  async moveTo(t, ms = 650) {
    const to = await this.target(t)
    const from = { ...this.mouse }
    const steps = Math.max(1, Math.round(ms / 16))
    for (let i = 1; i <= steps; i++) {
      const k = i / steps
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      const x = Math.round(from.x + (to.x - from.x) * e)
      const y = Math.round(from.y + (to.y - from.y) * e)
      this.wc.sendInputEvent({ type: 'mouseMove', x, y })
      await this.js(`window.__cursorAt(${x / this.zoom}, ${y / this.zoom})`)
      await sleep(16)
    }
    this.mouse = to
    return to
  }

  async click(t, ms) {
    const at = await this.moveTo(t, ms)
    await sleep(120)
    this.wc.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    await this.js(`window.__ripple(${at.x / this.zoom}, ${at.y / this.zoom})`)
    await sleep(70)
    this.wc.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 })
  }

  async type(text, cps = 14) {
    for (const ch of text) {
      this.wc.sendInputEvent({ type: 'char', keyCode: ch })
      await sleep(1000 / cps)
    }
  }

  async key(name) {
    this.wc.sendInputEvent({ type: 'keyDown', keyCode: name })
    this.wc.sendInputEvent({ type: 'keyUp', keyCode: name })
  }

  async play(steps = []) {
    for (const s of steps) {
      if (s.wait != null) await sleep(s.wait)
      else if (s.route) { await this.goto(s.route); await sleep(s.settle ?? 1600) }
      else if (s.hover) await this.moveTo(s.hover, s.ms)
      else if (s.click) await this.click(s.click, s.ms)
      else if (s.type != null) await this.type(s.type, s.cps)
      else if (s.key) await this.key(s.key)
      else if (s.scroll != null) await this.js(`window.__scroll(${JSON.stringify(s.in ?? null)}, ${s.scroll}, ${s.ms ?? 900})`)
      else if (s.js) await this.js(s.js)
      else if (s.reveal) {
        const [selector, text] = typeof s.reveal === 'string' ? [s.reveal, null] : [s.reveal.sel, s.reveal.text]
        await this.js(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = ${JSON.stringify(text)} ? all.find((e) => e.textContent.trim().includes(${JSON.stringify(text)})) : all[0]; return el ? window.__bringIntoView(el, ${JSON.stringify(s.block || 'center')}, ${s.ms ?? 0}) : null })()`)
        await sleep(300)
      }
      else if (s.hideCursor) await this.js('window.__cursorHide()')
      else throw new Error(`unknown step ${JSON.stringify(s)}`)
    }
  }
}

/**
 * Off-screen window for a shot. `viewport` is the size the app lays out at;
 * `scale` (stills cut out of a page) renders that same layout at a higher
 * density through the page zoom: the window is viewport × scale pixels.
 * (Forcing a device scale factor instead would clamp the window to the
 * screen's size.)
 */
async function open(shot) {
  const [vw, vh] = shot.viewport
  const zoom = shot.scale || 1
  const win = new BrowserWindow({
    show: false, width: Math.round(vw * zoom), height: Math.round(vh * zoom), useContentSize: true, frame: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, zoomFactor: zoom },
  })
  win.webContents.setFrameRate(FPS)
  // A quiet page first (the harness's catch-all route is the dashboard), to
  // set the stored preferences, then a full reload so the app starts with them.
  const storage = { ...BASE_STORAGE, ...(shot.lang ? { nexusmind_lang: shot.lang } : {}), ...(shot.storage || {}) }
  await win.loadURL(`${HARNESS}/?capture=1#/help`)
  await win.webContents.executeJavaScript(`localStorage.removeItem('ascend_appearance'); ${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('')} true`)
  await win.loadURL(`${HARNESS}/?capture=2#/help`)
  win.webContents.setZoomFactor(zoom)
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await sleep(600)
  const stage = new Stage(win, zoom)
  await stage.js(PAGE_SETUP)
  // Mock overrides apply before the page mounts: the route is reached in-app.
  if (shot.mock) await stage.js(`(() => { const m = window.__mock; ${shot.mock}; return true })()`)
  await stage.goto(shot.route)
  await sleep(shot.settle ?? 2200)
  return stage
}

/**
 * Part of the viewport a still keeps: `crop` as given, or the union of the
 * cards named in `region.cards` (their heading text), padded and widened to
 * the aspect ratio of `out`, kept inside the viewport.
 */
async function regionOf(stage, shot) {
  const [vw, vh] = shot.viewport
  if (shot.crop) return shot.crop
  if (!shot.region) return [0, 0, vw, vh]
  const boxes = []
  for (const text of shot.region.cards) {
    const b = await stage.js(`window.__card(${JSON.stringify(text)}, ${JSON.stringify(shot.region.card || null)})`)
    if (!b) throw new Error(`no card for "${text}"`)
    boxes.push(b)
  }
  const pad = shot.region.pad ?? 20
  const x0 = Math.min(...boxes.map((b) => b[0])) - pad
  const y0 = Math.min(...boxes.map((b) => b[1])) - pad
  const x1 = Math.max(...boxes.map((b) => b[2])) + pad
  const y1 = Math.max(...boxes.map((b) => b[3])) + pad
  const want = shot.out[0] / shot.out[1]
  // Smallest box of the right shape around the cards (or the given size),
  // never larger than the viewport.
  let [w, h] = shot.region.size || [x1 - x0, y1 - y0]
  if (w / h < want) w = h * want; else h = w / want
  if (w > vw) { w = vw; h = w / want }
  if (h > vh) { h = vh; w = h * want }
  // Centred on the cards, or from their top-left corner (`anchor: 'start'`).
  const start = shot.region.anchor === 'start'
  let x = start ? x0 : (x0 + x1) / 2 - w / 2
  let y = start ? y0 : (y0 + y1) / 2 - h / 2
  x = Math.min(Math.max(0, x), vw - w)
  y = Math.min(Math.max(0, y), vh - h)
  return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)]
}

async function still(shot) {
  const stage = await open(shot)
  try {
    await stage.play(shot.setup)
    await stage.js('window.__cursorHide && window.__cursorHide()')
    await sleep(400)
    const [cx, cy, cw, ch] = (await regionOf(stage, shot)).map((v) => Math.round(v * stage.zoom))
    const image = await stage.wc.capturePage({ x: cx, y: cy, width: cw, height: ch })
    const tmp = path.join(os.tmpdir(), `ascend-shot-${shot.id}.png`)
    fs.writeFileSync(tmp, image.toPNG())
    const [ow, oh] = shot.out
    await run(ffmpegPath, ['-y', '-v', 'error', '-i', tmp, '-vf', `scale=${ow}:${oh}:flags=lanczos`, '-c:v', 'libwebp', '-quality', '88', '-compression_level', '6', path.join(OUT, `${shot.id}.webp`)])
    fs.rmSync(tmp, { force: true })
  } finally {
    stage.win.destroy()
  }
}

async function clip(shot) {
  const stage = await open(shot)
  // Before the camera rolls: the clip's first frame (its poster) is the state the setup leaves.
  if (shot.setup) {
    await stage.play(shot.setup)
    await stage.js('window.__cursorHide && window.__cursorHide()')
  }
  const [vw, vh] = shot.viewport
  const raw = path.join(os.tmpdir(), `ascend-clip-${shot.id}.mkv`)
  const ff = spawn(ffmpegPath, ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${vw}x${vh}`, '-r', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', raw], { stdio: ['pipe', 'ignore', 'pipe'] })
  let ffErr = ''
  ff.stderr.on('data', (d) => { ffErr += d })
  const ffDone = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg capture exited ${code}: ${ffErr.slice(-600)}`)))))

  let latest = null
  const onPaint = (_e, _dirty, image) => {
    const size = image.getSize()
    if (size.width === vw && size.height === vh) latest = image.toBitmap()
  }
  stage.wc.on('paint', onPaint)
  stage.wc.invalidate()
  while (!latest) await sleep(20)

  let frames = 0
  const writer = setInterval(() => { if (latest) { ff.stdin.write(latest); frames++ } }, 1000 / FPS)
  try {
    await stage.play(shot.steps)
    await sleep(shot.tail ?? 600)
  } finally {
    clearInterval(writer)
    stage.wc.off('paint', onPaint)
    ff.stdin.end()
    await ffDone
    stage.win.destroy()
  }

  const mp4 = path.join(OUT, `${shot.id}.mp4`)
  await run(ffmpegPath, ['-y', '-v', 'error', '-i', raw, '-vf', `${videoFilter(shot)},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(shot.crf ?? 25), '-profile:v', 'high', '-movflags', '+faststart', '-an', mp4])
  await run(ffmpegPath, ['-y', '-v', 'error', '-i', raw, '-vf', videoFilter(shot), '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', path.join(OUT, `${shot.id}.webp`)])
  if (shot.gif) {
    const [ow, oh] = shot.gif
    const pal = path.join(os.tmpdir(), `ascend-pal-${shot.id}.png`)
    const filter = `${videoFilter(shot)},fps=15,scale=${ow}:${oh}:flags=lanczos`
    await run(ffmpegPath, ['-y', '-v', 'error', '-i', raw, '-vf', `${filter},palettegen=stats_mode=diff`, pal])
    await run(ffmpegPath, ['-y', '-v', 'error', '-i', raw, '-i', pal, '-lavfi', `${filter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`, path.join(OUT, `${shot.id}.gif`)])
    fs.rmSync(pal, { force: true })
  }
  fs.rmSync(raw, { force: true })
  return frames
}

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  protocol.handle('nxm', (request) => {
    const art = new URL(request.url).searchParams.get('art')
    return new Response(art ? artTile(art) : thumbnail(request.url), { headers: { 'content-type': 'image/svg+xml' } })
  })
  session.defaultSession.webRequest.onBeforeRequest({ urls: RIOT_ART }, (details, done) => done({ redirectURL: `nxm://art/?art=${encodeURIComponent(details.url)}` }))
  fs.mkdirSync(OUT, { recursive: true })
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.cjs'))
  const list = wanted.length ? SHOTS.filter((s) => wanted.includes(s.id)) : SHOTS
  if (wanted.length && list.length !== wanted.length) {
    console.error(`unknown shot id(s): ${wanted.filter((w) => !SHOTS.some((s) => s.id === w)).join(', ')}`)
  }
  let code = 0
  for (const shot of list) {
    const t0 = Date.now()
    try {
      if (shot.steps) {
        const frames = await clip(shot)
        console.log(`${shot.id}.mp4  ${(fs.statSync(path.join(OUT, `${shot.id}.mp4`)).size / 1024).toFixed(0)} kB  ${frames} frames  ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      } else {
        await still(shot)
        console.log(`${shot.id}.webp  ${(fs.statSync(path.join(OUT, `${shot.id}.webp`)).size / 1024).toFixed(0)} kB  ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      }
    } catch (error) {
      console.error(`${shot.id}: ${error.message}`)
      code = 1
    }
  }
  app.exit(code)
})
