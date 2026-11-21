/**
 * Photographs and films the INSTALLED Ascend for the showcase site, with the
 * player's real data (Chief, 21/11, before the Riot production key
 * application):
 *
 *   node site/capture-app.cjs                  every shot of site/shots-app.cjs
 *   node site/capture-app.cjs solo-lab ...     only these ids
 *
 * The real profile is never opened. Ascend must be closed; the profile
 * (%APPDATA%\nexusmind) is copied to a temporary folder without its YouTube
 * tokens and upload queue, and the installed Ascend.exe runs on that copy
 * (NEXUSMIND_USER_DATA) with the cloud off (NEXUSMIND_CLOUD_DISABLED: no sync,
 * nothing sent). The real database's SHA-256 is taken before and after, and the
 * run fails if it changed. The copy is deleted at the end.
 *
 * Privacy: every other player's name and Riot ID (match participants, team
 * members, followed and scouted players) is replaced by « Joueur N »; only the
 * user's own names stay. Emails and Windows paths are masked. Riot art stays off
 * the site as before (site/DESIGN.md): Data Dragon pictures and the app's local
 * images (thumbnails, cutouts) become neutral tiles, and the game footage in
 * the player is covered by the app's schematic map.
 *
 * Output as site/capture.cjs: <id>.webp stills, <id>.mp4 clips (+ .webp poster)
 * in site/public/media. Options: CAPTURE_CLOUD=1 keeps the cloud on (team
 * screens; READ the warning in the README of this file before), ASCEND_EXE,
 * CAPTURE_OUT, CAPTURE_KEEP=1 (keep the copy for a second run).
 */
const { _electron } = require('playwright')
const { spawn, execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ffmpegPath = require('ffmpeg-static')
const SHOTS = require(process.env.SHOTS_FILE || './shots-app.cjs')

const EXE = process.env.ASCEND_EXE || path.join(process.env.LOCALAPPDATA, 'Programs', 'Ascend', 'Ascend.exe')
const PROFILE = path.join(process.env.APPDATA, 'nexusmind')
const COPY = path.join(os.tmpdir(), 'ascend-capture-profile')
const OUT = process.env.CAPTURE_OUT || path.join(__dirname, 'public', 'media')
const FPS = 25
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── The real profile stays untouched ─────────────────────────────────── */

function ascendRunning() {
  try {
    return /Ascend\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq Ascend.exe', '/NH'], { encoding: 'utf8' }))
  } catch { return false }
}

const DB_FILES = ['nexusmind.db', 'nexusmind.db-wal', 'nexusmind.db-shm', 'nexusmind.db-journal']
function hashFile(file) {
  return new Promise((resolve) => {
    if (!fs.existsSync(file)) return resolve('absent')
    const h = createHash('sha256')
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', () => resolve('unreadable'))
  })
}
async function profileHashes() {
  const out = {}
  for (const f of DB_FILES) out[f] = await hashFile(path.join(PROFILE, 'data', f))
  return out
}

/** Folders and files the copy leaves out: caches, big models, backups, and what could act outside (YouTube). */
const SKIP = new Set(['models', 'backups', 'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary', 'blob_storage',
  '.yt_tokens', 'youtube-upload-queue.json', 'lockfile', 'DevToolsActivePort', 'logs'])
function copyProfile() {
  fs.rmSync(COPY, { recursive: true, force: true })
  fs.cpSync(PROFILE, COPY, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) })
}

/* ── Names to hide, read from the copy ────────────────────────────────── */

function namesFromCopy() {
  const db = new DatabaseSync(path.join(COPY, 'data', 'nexusmind.db'), { readOnly: true })
  const q = (sql) => { try { return db.prepare(sql).all() } catch { return [] } }
  const keep = new Set()
  for (const u of q('SELECT displayName, summonerName, tagLine FROM User')) for (const v of [u.displayName, u.summonerName, u.tagLine]) if (v) keep.add(v.toLowerCase())
  for (const a of q('SELECT gameName, tagLine FROM Account')) for (const v of [a.gameName, a.tagLine]) if (v) keep.add(v.toLowerCase())
  // A name that is also a word of the app's own texts (« min », « Prêt ») or a champion stays: replacing it would
  // break the screen's text. Such a name only shows as that word anyway.
  const words = new Set()
  for (const lang of ['fr', 'en']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'locales', `${lang}.json`), 'utf8')
    for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w) words.add(w)
  }
  const others = new Set()
  const add = (v) => {
    if (typeof v !== 'string') return
    const n = v.trim(), low = n.toLowerCase()
    if (n.length >= 3 && !keep.has(low) && !words.has(low)) others.add(n)
  }
  const matches = []
  for (const r of q('SELECT matchJson FROM MatchCache')) {
    try { matches.push(JSON.parse(r.matchJson)?.info?.participants ?? []) } catch { /* a broken row: nothing to read */ }
  }
  for (const ps of matches) for (const p of ps) if (p.championName) { words.add(String(p.championName).toLowerCase()) }
  for (const ps of matches) for (const p of ps) { add(p.riotIdGameName); add(p.summonerName) }
  for (const r of q('SELECT displayName, riotId FROM TeamMember')) { add(r.displayName); add(String(r.riotId ?? '').split('#')[0]) }
  for (const r of q('SELECT gameName FROM FollowedPlayer')) add(r.gameName)
  for (const r of q('SELECT playerName FROM ExternalReview')) add(r.playerName)
  for (const r of q('SELECT participantsJson FROM CustomGame')) { try { for (const p of JSON.parse(r.participantsJson) ?? []) add(p.playerName) } catch { /* idem */ } }
  // Picks for the routes: the latest game with a recording on disk, preferably analysed (micro-review).
  const games = q(`SELECT g.id AS gameId, r.id AS recordingId, r.filePath AS filePath,
      (SELECT COUNT(*) FROM GameAnalysis a WHERE a.gameId = g.id) AS analysed
    FROM Game g JOIN Recording r ON r.gameId = g.id WHERE r.filePath IS NOT NULL ORDER BY g.gameEndAt DESC LIMIT 60`)
  const onDisk = games.filter((g) => g.filePath && fs.existsSync(g.filePath))
  const pick = onDisk.find((g) => g.analysed) || onDisk[0] || games[0] || null
  db.close()
  const sorted = [...others].sort((a, b) => b.length - a.length)
  return { names: sorted, keep: [...keep], pick }
}

/* ── In the page ──────────────────────────────────────────────────────── */

const CURSOR_SVG = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10.1 13 L16 13 Z" fill="#F5E3BE" stroke="#0D0A06" stroke-width="1.4" stroke-linejoin="round"/></svg>'
const TILE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><rect width="120" height="120" fill="#2A1D11"/><rect x="2" y="2" width="116" height="116" fill="none" stroke="#6B5330" stroke-width="4"/></svg>')
/** The app's schematic map with a fight on it (site/capture.cjs's thumbnails): the game footage's stand-in. */
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
const MAP = 'data:image/svg+xml,' + encodeURIComponent(thumbnail('review-player'))

const pageSetup = (names) => `(() => {
  if (window.__capture) return
  window.__capture = true
  // Other players: « Joueur N », stable per name; then emails and Windows paths.
  const names = ${JSON.stringify(names)}
  const alias = new Map(names.map((n, i) => [n.toLowerCase(), 'Joueur ' + (i + 1)]))
  const esc = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')
  const chunks = []
  for (let i = 0; i < names.length; i += 400) chunks.push(new RegExp('(?<![\\\\p{L}\\\\p{N}])(' + names.slice(i, i + 400).map(esc).join('|') + ')(#[\\\\p{L}\\\\p{N}]{2,5})?(?![\\\\p{L}\\\\p{N}])', 'giu'))
  const scrub = (text) => {
    let t = text
    for (const re of chunks) t = t.replace(re, (_m, n, tag) => alias.get(n.toLowerCase()) + (tag ? '#EUW' : ''))
    t = t.replace(/[\\w.+-]+@[\\w-]+\\.[\\w.]+/g, '•••@•••')
    t = t.replace(/[A-Za-z]:[\\\\/][^\\s"'<>|]+/g, '…')
    return t
  }
  const fix = (node) => { const t = scrub(node.nodeValue); if (t !== node.nodeValue) node.nodeValue = t }
  const fixAttrs = (el) => { for (const a of ['title', 'alt', 'placeholder', 'aria-label']) { const v = el.getAttribute && el.getAttribute(a); if (v) { const t = scrub(v); if (t !== v) el.setAttribute(a, t) } } if (el.tagName === 'INPUT' && el.value) { const t = scrub(el.value); if (t !== el.value) el.value = t } }
  const walk = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) fix(n)
    if (root.querySelectorAll) { fixAttrs(root); root.querySelectorAll('[title],[alt],[placeholder],[aria-label],input').forEach(fixAttrs) }
  }
  walk(document.body)
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fix(m.target)
      else if (m.type === 'attributes') fixAttrs(m.target)
      else m.addedNodes.forEach((n) => (n.nodeType === 3 ? fix(n) : n.nodeType === 1 && walk(n)))
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'alt', 'placeholder', 'aria-label'] })

  // Riot art off the site: Data Dragon / local pictures become tiles, the game footage the app's schematic map.
  const style = document.createElement('style')
  style.textContent = '::-webkit-scrollbar{width:0!important;height:0!important}*{caret-color:transparent}' +
    'img[src*="ddragon"],img[src*="communitydragon"],img[src^="nxm:"],img[src^="file:"],img[src^="blob:"]{content:url("${TILE}")!important}' +
    '[style*="ddragon"],[style*="nxm:"],[style*="communitydragon"]{background-image:none!important}' +
    'video{opacity:0!important}*:has(> video){background:#0D0A06 url("${MAP}") center/cover no-repeat!important}' +
    // beta.22 opens the clip flags towards each other (they cross on a short clip); the next version opens them
    // outwards (PlayerBarV2): the captures show it that way.
    '[data-testid="clip-handle-start"]{left:auto!important;right:0!important}[data-testid="clip-handle-end"]{right:auto!important;left:0!important}' +
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
  window.__ripple = (x, y) => { const r = document.createElement('div'); r.className = '__ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600) }
  window.__scroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p } return null }
  window.__bringIntoView = (el, block, ms) => new Promise((done) => {
    const sc = window.__scroller(el); if (!sc) return done()
    const r = el.getBoundingClientRect(), box = sc.getBoundingClientRect()
    let dy = 0
    if (block === 'start') dy = r.top - box.top - 12
    else if (block === 'center') dy = r.top + r.height / 2 - (box.top + box.height / 2)
    else if (r.top < box.top + 12) dy = r.top - box.top - 24
    else if (r.bottom > box.bottom - 12) dy = Math.min(r.bottom - box.bottom + 24, r.top - box.top - 24)
    if (Math.abs(dy) < 2) return done()
    if (!ms) { sc.scrollTop += dy; return done() }
    const from = sc.scrollTop, start = performance.now(), ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
    const step = (now) => { const t = Math.min(1, (now - start) / ms); sc.scrollTop = from + dy * ease(t); if (t < 1) requestAnimationFrame(step); else done() }
    requestAnimationFrame(step)
  })
  window.__centerEl = async (el) => { if (!el) return null; await window.__bringIntoView(el, 'nearest', 450); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } }
  window.__find = (selector, text) => { const all = [...document.querySelectorAll(selector)].filter((e) => e.offsetParent !== null || e.getClientRects().length); return text ? all.find((e) => e.textContent.trim().includes(text)) : all[0] }
  window.__center = (selector, text) => window.__centerEl(window.__find(selector, text))
  window.__scroll = (selector, dy, ms) => new Promise((done) => {
    const el = selector ? document.querySelector(selector) : (document.querySelector('main .overflow-y-auto') || document.querySelector('main') || document.scrollingElement)
    if (!el) return done()
    const from = el.scrollTop, start = performance.now(), ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
    const step = (now) => { const t = Math.min(1, (now - start) / ms); el.scrollTop = from + dy * ease(t); if (t < 1) requestAnimationFrame(step); else done() }
    requestAnimationFrame(step)
  })
})()`

/* ── Driving the app ──────────────────────────────────────────────────── */

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.slice(-600)}`))))
  })
}

class Stage {
  constructor(app, page, names, picks) { this.app = app; this.page = page; this.names = names; this.picks = picks; this.mouse = { x: 600, y: 400 }; this.missed = [] }
  js(code) { return this.page.evaluate(code) }
  route(r) { return r.replace(/\{(\w+)\}/g, (_m, k) => this.picks[k] ?? '') }
  async goto(route) { await this.js(`location.hash = ${JSON.stringify('#' + this.route(route))}`) }
  async size(w, h) {
    await this.app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; if (win.isMaximized()) win.unmaximize(); win.setContentSize(w, h) }, [w, h])
    await sleep(500)
  }
  async target(t) {
    if (Array.isArray(t)) return { x: t[0], y: t[1] }
    const [selector, text] = typeof t === 'string' ? [t, null] : [t.sel, t.text]
    return this.js(`window.__center(${JSON.stringify(selector)}, ${JSON.stringify(text)})`)
  }
  async moveTo(t, ms = 650) {
    const to = await this.target(t)
    if (!to) { this.missed.push(JSON.stringify(t)); return null }
    const from = { ...this.mouse }
    const steps = Math.max(1, Math.round(ms / 16))
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      const x = Math.round(from.x + (to.x - from.x) * e), y = Math.round(from.y + (to.y - from.y) * e)
      await this.page.mouse.move(x, y)
      await this.js(`window.__cursorAt(${x}, ${y})`)
      await sleep(16)
    }
    this.mouse = to
    return to
  }
  async click(t, ms) {
    const at = await this.moveTo(t, ms)
    if (!at) return
    await sleep(120)
    await this.js(`window.__ripple(${at.x}, ${at.y})`)
    await this.page.mouse.click(at.x, at.y)
  }
  async play(steps = []) {
    for (const s of steps) {
      if (s.wait != null) await sleep(s.wait)
      else if (s.route) { await this.goto(s.route); await sleep(s.settle ?? 1800) }
      else if (s.hover) await this.moveTo(s.hover, s.ms)
      else if (s.click) await this.click(s.click, s.ms)
      else if (s.key) await this.page.keyboard.press(s.key)
      else if (s.scroll != null) await this.js(`window.__scroll(${JSON.stringify(s.in ?? null)}, ${s.scroll}, ${s.ms ?? 900})`)
      else if (s.reveal) {
        const [selector, text] = typeof s.reveal === 'string' ? [s.reveal, null] : [s.reveal.sel, s.reveal.text]
        await this.js(`(() => { const el = window.__find(${JSON.stringify(selector)}, ${JSON.stringify(text)}); return el ? window.__bringIntoView(el, ${JSON.stringify(s.block || 'center')}, ${s.ms ?? 0}) : null })()`)
        await sleep(300)
      }
      else if (s.js) await this.js(s.js)
      else if (s.hideCursor) await this.js('window.__cursorHide()')
      else throw new Error(`unknown step ${JSON.stringify(s)}`)
    }
  }
}

async function prepare(stage, shot) {
  const [w, h] = shot.viewport
  await stage.size(w, h)
  await stage.goto('/help')
  await sleep(500)
  await stage.goto(shot.route)
  await sleep(shot.settle ?? 2600)
  await stage.js(pageSetup(stage.names))
  if (shot.setup) await stage.play(shot.setup)
}

async function still(stage, shot) {
  await prepare(stage, shot)
  await stage.js('window.__cursorHide()')
  await sleep(500)
  const [vw, vh] = shot.viewport
  const [x, y, width, height] = shot.crop || [0, 0, vw, vh]
  const tmp = path.join(os.tmpdir(), `ascend-app-${shot.id}.png`)
  await stage.page.screenshot({ path: tmp, clip: { x, y, width, height } })
  const [ow, oh] = shot.out
  await run(ffmpegPath, ['-y', '-v', 'error', '-i', tmp, '-vf', `scale=${ow}:${oh}:flags=lanczos`, '-c:v', 'libwebp', '-quality', '88', '-compression_level', '6', path.join(OUT, `${shot.id}.webp`)])
  fs.rmSync(tmp, { force: true })
}

async function clip(stage, shot) {
  await prepare(stage, shot)
  await stage.js('window.__cursorHide()')
  const [vw, vh] = shot.viewport
  const [cx, cy, cw, ch] = shot.crop || [0, 0, vw, vh]
  const [ow, oh] = shot.out
  const raw = path.join(os.tmpdir(), `ascend-app-${shot.id}.mkv`)
  const ff = spawn(ffmpegPath, ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-r', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '8', raw], { stdio: ['pipe', 'ignore', 'pipe'] })
  let ffErr = ''
  ff.stderr.on('data', (d) => { ffErr += d })
  const ffDone = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg capture exited ${code}: ${ffErr.slice(-600)}`)))))
  const cdp = await stage.page.context().newCDPSession(stage.page)
  let latest = null
  cdp.on('Page.screencastFrame', (f) => { latest = Buffer.from(f.data, 'base64'); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}) })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: vw, maxHeight: vh })
  while (!latest) await sleep(20)
  let frames = 0
  const writer = setInterval(() => { if (latest) { ff.stdin.write(latest); frames++ } }, 1000 / FPS)
  try {
    await stage.play(shot.steps)
    await sleep(shot.tail ?? 600)
  } finally {
    clearInterval(writer)
    await cdp.send('Page.stopScreencast').catch(() => {})
    ff.stdin.end()
    await ffDone
  }
  const vf = `crop=${cw}:${ch}:${cx}:${cy},scale=${ow}:${oh}:flags=lanczos`
  await run(ffmpegPath, ['-y', '-v', 'error', '-i', raw, '-vf', `${vf},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(shot.crf ?? 25), '-profile:v', 'high', '-movflags', '+faststart', '-an', path.join(OUT, `${shot.id}.mp4`)])
  await run(ffmpegPath, ['-y', '-v', 'error', '-i', raw, '-vf', vf, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', path.join(OUT, `${shot.id}.webp`)])
  fs.rmSync(raw, { force: true })
  return frames
}

/* ── Run ──────────────────────────────────────────────────────────────── */

async function main() {
  if (ascendRunning()) {
    console.error('Ascend is running: close it fully (tray icon included), then run this again. Nothing was done.')
    process.exit(2)
  }
  if (!fs.existsSync(EXE)) { console.error(`Ascend.exe not found: ${EXE}`); process.exit(2) }
  const before = await profileHashes()
  console.log('profile database hashed; copying the profile…')
  if (!(process.env.CAPTURE_KEEP && fs.existsSync(COPY))) copyProfile()
  const { names, keep, pick } = namesFromCopy()
  console.log(`${names.length} other players' names to replace; own names kept: ${keep.length}; game picked: ${pick ? 'yes' : 'none'}`)
  const picks = { gameId: pick?.gameId ?? '', recordingId: pick?.recordingId ?? '' }

  const env = { ...process.env, NEXUSMIND_USER_DATA: COPY }
  if (process.env.CAPTURE_CLOUD !== '1') env.NEXUSMIND_CLOUD_DISABLED = '1'
  const app = await _electron.launch({ executablePath: EXE, env, timeout: 60_000 })
  let code = 0
  try {
    const page = await app.firstWindow()
    // A « leave the page? » prompt (unsaved notes in the copy) is dismissed; it never blocks the run.
    page.on('dialog', (d) => { d.dismiss().catch(() => {}) })
    await page.waitForLoadState('domcontentloaded')
    await sleep(4000)
    // The copy only: French, default theme and background, for every shot.
    await page.evaluate("localStorage.setItem('nexusmind_lang', 'fr'); localStorage.setItem('ascend_color_theme', 'hextech'); localStorage.removeItem('ascend_appearance')")
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await sleep(5000)
    const stage = new Stage(app, page, names, picks)
    fs.mkdirSync(OUT, { recursive: true })
    const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'))
    const list = wanted.length ? SHOTS.filter((s) => wanted.includes(s.id)) : SHOTS
    for (const shot of list) {
      if (shot.needs && !picks[shot.needs]) { console.log(`${shot.id}: skipped (no ${shot.needs} in this profile)`); continue }
      const t0 = Date.now()
      stage.missed = []
      try {
        if (shot.steps) {
          const frames = await clip(stage, shot)
          console.log(`${shot.id}.mp4  ${frames} frames  ${((Date.now() - t0) / 1000).toFixed(1)} s${stage.missed.length ? `  (not found: ${stage.missed.join(', ')})` : ''}`)
        } else {
          await still(stage, shot)
          console.log(`${shot.id}.webp  ${((Date.now() - t0) / 1000).toFixed(1)} s${stage.missed.length ? `  (not found: ${stage.missed.join(', ')})` : ''}`)
        }
      } catch (error) {
        console.error(`${shot.id}: ${error.message}`)
        code = 1
      }
    }
  } finally {
    // Quit from the main process: no beforeunload prompt, the copy's database closed cleanly.
    await app.evaluate(({ app: a }) => { setTimeout(() => a.exit(0), 50) }).catch(() => {})
    await app.close().catch(() => {})
    await sleep(1500)
    if (!process.env.CAPTURE_KEEP) fs.rmSync(COPY, { recursive: true, force: true })
  }
  const after = await profileHashes()
  const changed = DB_FILES.filter((f) => before[f] !== after[f])
  if (changed.length) { console.error(`THE REAL PROFILE CHANGED: ${changed.join(', ')}`); code = 3 } else console.log('real profile database unchanged (SHA-256 before = after)')
  process.exit(code)
}

// Playwright reports a prompt closed by the app itself as an error: not ours.
process.on('unhandledRejection', (e) => { if (!/No dialog is showing|Target .*closed/i.test(String(e?.message ?? e))) console.error(e) })
main().catch((e) => { console.error(e); process.exit(1) })
