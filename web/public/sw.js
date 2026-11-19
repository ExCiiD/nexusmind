// Ascend web — minimal offline shell.
// Pages: network first, cached shell as fallback. Built assets (hashed
// names): cache first. Supabase / API calls are never cached.
// WSC-25: one cache per build. The web build (web/vite.config.ts, swBuildId)
// writes the build id below into dist/sw.js, so each deployment ships a new
// worker, and 'activate' drops the previous build's cache with its assets.
const BUILD = '__ASCEND_BUILD_ID__'
const CACHE = `ascend-shell-${BUILD}`
const SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
        return res
      })),
    )
  }
})
