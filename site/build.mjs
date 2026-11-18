/**
 * Builds the showcase site into site/public (the folder Cloudflare serves,
 * see wrangler.toml).
 *
 *   npm run site:build          then        npm run site:preview
 *
 * What it does:
 *   1. bundles the app modules the previews are made of (site/src/engine.ts)
 *      and reads the app's own tier, theme and detector definitions;
 *   2. computes the demonstration view-models in French and English with that
 *      code and the app's locale files (site/src/data.mjs);
 *   3. renders every page, bundles the browser script and the stylesheet;
 *   4. checks the result (see `verify` below) and fails loudly on any miss.
 *
 * It only writes the files it owns; fonts, favicon and icons in site/public
 * are left alone. No dependency beyond the repo's own esbuild.
 */
import { build, transform } from 'esbuild'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { SITE_URL as CONFIG_URL } from './site.config.mjs'
import fr from './src/copy/fr.mjs'
import en from './src/copy/en.mjs'
import { buildData } from './src/data.mjs'
import { appVars, styleOf } from './src/lib/appVars.mjs'
import { isNewer } from './src/lib/version.mjs'
import { RELEASE, WEB_APP_URL, releaseUrls } from './src/release.mjs'
import { shell } from './src/pages/shell.mjs'
import { home } from './src/pages/home.mjs'
import { LEGAL, legalPage, notFoundPage } from './src/pages/legal.mjs'
import { ogCard } from './src/pages/og.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const out = path.join(here, 'public')
const cache = path.join(here, '.cache')
const src = (...p) => path.join(repo, 'src', ...p)
const read = async (file) => (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')
const siteUrl = (process.env.SITE_URL ?? CONFIG_URL).replace(/\/+$/, '')
/** No public address yet: the site is a preview and asks search engines not to index it. */
const preview = !siteUrl
const COPY = { fr, en }
const problems = []
const check = (ok, message) => { if (!ok) problems.push(message) }

/* ── 1 · The app's own code and definitions ─────────────────────────── */

await mkdir(cache, { recursive: true })
await build({
  entryPoints: [path.join(here, 'src', 'engine.ts')],
  outfile: path.join(cache, 'engine.mjs'),
  bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
  alias: { '@': path.join(repo, 'src') },
})
const engine = await import(`${pathToFileURL(path.join(cache, 'engine.mjs')).href}?t=${Date.now()}`)

/** Practice tiers and icon unlocks, read from src/lib/profile.ts (not importable: it globs image assets). */
const profile = await read(src('lib', 'profile.ts'))
const block = (text, from, to) => {
  const a = text.indexOf(from)
  const b = text.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`cannot find "${from}" in the app source`)
  return text.slice(a, b)
}
const tierDefs = [...block(profile, 'export const TIERS', '] as const').matchAll(/id: '(\w+)', minLevel: (\d+)/g)].map((m) => ({ id: m[1], minLevel: Number(m[2]) }))
const iconUnlocks = [...block(profile, 'const ICON_UNLOCKS', '\n]').matchAll(/\['([\w-]+)', '(\w+)'\]/g)].map((m) => [m[1], m[2]])
if (tierDefs.length < 2 || !iconUnlocks.length) throw new Error('practice tiers not found in src/lib/profile.ts')

/** Built-in colour themes, read from src/index.css in the order of COLOR_THEMES. */
const appCss = await read(src('index.css'))
const tokensOf = (selector) => {
  const start = appCss.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`theme block not found in src/index.css: ${selector}`)
  const body = appCss.slice(appCss.indexOf('{', start) + 1, appCss.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]))
}
const themeIds = [...block(await read(src('lib', 'theme.ts')), 'export const COLOR_THEMES', ']').matchAll(/'(\w+)'/g)].map((m) => m[1]).filter((id) => id !== 'custom')
const baseTokens = tokensOf(':root')
const themeBlocks = themeIds.map((id, i) => ({ id, tokens: i === 0 ? baseTokens : { ...baseTokens, ...tokensOf(`:root[data-theme="${id}"]`) } }))

/** Tags the app detects on its own: electron/main/mistakeDetector.ts + mistakeRules.ts. */
const detector = await read(path.join(repo, 'electron', 'main', 'mistakeDetector.ts'))
const rules = await read(path.join(repo, 'electron', 'main', 'mistakeRules.ts'))
const quoted = (text) => [...text.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
const autoTags = new Set([
  ...quoted(detector.slice(detector.indexOf('tagSlug:'), detector.indexOf('\n', detector.indexOf('tagSlug:')))),
  ...quoted(block(rules, 'export type AdvancedTag', '\n\n')),
])
const catalogue = new Set(engine.BUILT_IN_MISTAKE_TAGS.map((t) => t.slug))
for (const slug of autoTags) check(catalogue.has(slug), `auto-detected tag "${slug}" is not in the built-in catalogue`)
check(autoTags.size >= 4, `only ${autoTags.size} auto-detected tags found in the detector sources`)

/* ── 2 · View-models, per language ──────────────────────────────────── */

const data = {}
for (const lang of ['fr', 'en']) {
  const app = JSON.parse(await read(src('i18n', 'locales', `${lang}.json`)))
  data[lang] = buildData({ engine, app, copy: COPY[lang], lang, locale: COPY[lang].locale, tierDefs, iconUnlocks, themeBlocks, autoDetected: autoTags.size })
  // Source of the link-preview image; `npm run site:og` turns it into a PNG.
  await writeFile(path.join(cache, `og-${lang}.html`), ogCard(COPY[lang], data[lang], pathToFileURL(path.join(out, 'assets', 'fonts')).href))
}

/* ── 3 · Assets and pages ───────────────────────────────────────────── */

const emitted = []
async function emit(rel, content) {
  const file = path.join(out, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
  emitted.push([rel, Buffer.byteLength(content)])
}
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 10)
/** Public address of a page file, as Cloudflare serves it: /index.html is /, /en/terms.html is /en/terms. */
const urlOf = (file) => `/${file}`.replace(/index\.html$/, '').replace(/\.html$/, '')

const cssParts = await Promise.all(['base.css', 'layout.css', 'app.css'].map((f) => read(path.join(here, 'src', 'styles', f))))
const cssSource = `${cssParts[0]}\n/* App theme defaults, from src/index.css */\n.app{${styleOf(appVars(baseTokens))}}\n${cssParts[1]}\n${cssParts[2]}`
const css = (await transform(cssSource, { loader: 'css', minify: true, legalComments: 'none' })).code

const jsBundle = await build({
  entryPoints: [path.join(here, 'src', 'client', 'main.js')],
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2019', minify: true, legalComments: 'none', logLevel: 'warning',
  alias: { '@': path.join(repo, 'src') },
})
const js = jsBundle.outputFiles[0].text

await emit('assets/site.css', css)
await emit('assets/site.js', js)

const ctxFor = (c) => ({
  siteUrl,
  preview,
  release: RELEASE,
  urls: releaseUrls(),
  webApp: WEB_APP_URL,
  contentsId: c.rail.id,
  assets: {
    css: `/assets/site.css?v=${hash(css)}`,
    js: `/assets/site.js?v=${hash(js)}`,
    og: existsSync(path.join(out, 'assets', `og-${c.lang}.png`)) ? `/assets/og-${c.lang}.png` : null,
  },
})

const pages = []
for (const lang of ['fr', 'en']) {
  const c = COPY[lang]
  const ctx = ctxFor(c)
  const body = home(c, ctx, data[lang])
  const local = (x) => ({ href: `#${x.id}`, label: x.label })
  pages.push({
    file: lang === 'fr' ? 'index.html' : 'en/index.html',
    kind: 'home',
    lang,
    html: shell(c, ctx, {
      path: c.home,
      title: c.meta.title,
      description: c.meta.description,
      alternates: { fr: fr.home, en: en.home, 'x-default': fr.home },
      og: { title: c.meta.ogTitle, description: c.meta.ogDescription },
      jsonLd: {
        '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Ascend', applicationCategory: 'GameApplication',
        operatingSystem: 'Windows 10, Windows 11', softwareVersion: RELEASE.version, downloadUrl: ctx.urls.download, inLanguage: lang,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }, description: c.meta.jsonLd,
      },
      rail: [
        { title: c.rail.sections, numbered: true, items: c.nav.map(local) },
        { title: c.rail.annexes, items: c.annexes.map(local) },
      ],
      langSwitch: c.langSwitch,
      footerLinks: [...c.nav, ...c.annexes].map(local),
      main: body.main,
      data: body.data,
    }),
  })
}
for (const doc of LEGAL) {
  const c = COPY[doc.lang]
  const text = await read(path.join(here, 'src', 'legal', `${doc.source}.html`))
  pages.push({ file: `${doc.path.slice(1)}.html`, kind: 'legal', lang: doc.lang, html: shell(c, ctxFor(c), legalPage(c, doc, text)) })
}
pages.push({ file: '404.html', kind: 'notfound', lang: 'fr', html: shell(fr, ctxFor(fr), notFoundPage(fr, en)) })
for (const p of pages) await emit(p.file, p.html)

/* Headers: a strict policy, the same as before the rebuild. The exhibits need
 * inline style attributes (bar widths, theme variables), nothing else inline.
 * A preview adds X-Robots-Tag, and robots.txt keeps allowing the crawl on
 * purpose: a crawler that may not fetch a page never reads its "noindex". */
await emit('_headers', `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
${preview ? '  X-Robots-Tag: noindex\n' : ''}
/assets/*
  Cache-Control: public, max-age=604800
`)
await emit('robots.txt', `User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${siteUrl}/sitemap.xml\n` : ''}`)
if (siteUrl) {
  const urls = pages.filter((p) => p.kind !== 'notfound').map((p) => `  <url><loc>${siteUrl}${urlOf(p.file)}</loc></url>`)
  await emit('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`)
} else {
  await rm(path.join(out, 'sitemap.xml'), { force: true })
}

/* ── 4 · Verify ─────────────────────────────────────────────────────── */

// Both languages say the same things: same keys, same list lengths.
const shape = (v, at = '') => (Array.isArray(v) ? [`${at}[${v.length}]`, ...v.flatMap((x, i) => shape(x, `${at}.${i}`))]
  : v && typeof v === 'object' ? Object.keys(v).flatMap((k) => shape(v[k], `${at}.${k}`)) : [at])
const frShape = new Set(shape(fr))
const enShape = new Set(shape(en))
for (const k of frShape) check(enShape.has(k), `copy: ${k} exists in French only`)
for (const k of enShape) check(frShape.has(k), `copy: ${k} exists in English only`)

// Release metadata: the numbers on the page are the ones published with the installer.
const latest = path.join(repo, 'release', 'latest.yml')
if (existsSync(latest)) {
  const yml = await read(latest)
  const field = (name) => (yml.match(new RegExp(`^${name}:\\s*(.+)$`, 'm')) ?? [])[1]?.trim()
  if (field('version') === RELEASE.version) {
    check(yml.includes(RELEASE.sha512), 'release.mjs: sha512 differs from release/latest.yml')
    check(yml.includes(`size: ${RELEASE.bytes}`), 'release.mjs: size differs from release/latest.yml')
    check(yml.includes(RELEASE.file), 'release.mjs: file name differs from release/latest.yml')
  }
}
const appVersion = JSON.parse(await read(path.join(repo, 'package.json'))).version
const versionNote = appVersion === RELEASE.version ? '' : `note: package.json is at ${appVersion}, the download button points at ${RELEASE.version} (site/src/release.mjs)`
check(isNewer('1.0.0-beta.2', '1.0.0-beta.1') && isNewer('1.0.0', '1.0.0-beta.9') && isNewer('1.0.0-beta.10', '1.0.0-beta.9') && isNewer('1.1.0-beta.1', '1.0.0')
  && !isNewer('1.0.0-beta.1', '1.0.0-beta.1') && !isNewer('0.2.0-beta.112', '1.0.0-beta.1') && !isNewer('1.0.0-beta.1', '1.0.0'), 'isNewer: version comparison is wrong')

// Contrast (WCAG 2.1) of every text/background pair the stylesheet uses.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const siteTokens = Object.fromEntries([...cssParts[0].matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]))
const appTokens = Object.fromEntries(appVars(baseTokens))
const colour = { ...siteTokens, ...appTokens }
const pairs = [
  ['--text-hi', '--ink'], ['--text', '--ink'], ['--text-low', '--ink'], ['--accent', '--ink'], ['--ink', '--accent'],
  ['--text-hi', '--surface'], ['--text', '--surface'], ['--text-low', '--surface'], ['--accent', '--surface'],
  ['--app-text', '--app-surface'], ['--app-text', '--app-panel'], ['--app-text', '--app-bg'], ['--app-text-hi', '--app-panel'],
  ['--app-accent', '--app-panel'], ['--app-accent', '--app-bg'], ['--app-bg', '--app-accent'], ['--app-bg', '--app-text-hi'],
]
for (const [fg, bg] of pairs) {
  check(colour[fg] && colour[bg], `contrast: unknown token in ${fg} / ${bg}`)
  if (colour[fg] && colour[bg]) check(contrast(colour[fg], colour[bg]) >= 4.5, `contrast: ${fg} on ${bg} is ${contrast(colour[fg], colour[bg]).toFixed(2)}:1 (needs 4.5:1)`)
}
// The brief pins the palette: the page ink, the surface and the single accent.
check(siteTokens['--ink'] === '#0D0A06' && siteTokens['--surface'] === '#1C140C' && siteTokens['--accent'] === '#D4A24C', 'tokens: ink / surface / accent no longer match the brief')
check(appTokens['--app-bg'] === siteTokens['--ink'] && appTokens['--app-accent'] === siteTokens['--accent'], 'tokens: the app default theme and the site palette have diverged')

// The stylesheet stays flat: no gradient, no glow, no blur.
for (const banned of ['gradient(', 'box-shadow', 'text-shadow', 'backdrop-filter', 'blur(']) check(!css.includes(banned), `css: "${banned}" is not allowed on this site`)

const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
/** What a visitor reads on arrival: markup and data blocks removed. */
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
/** Everything a visitor can end up reading, including what the exhibits print after an interaction. */
const everything = (html) => html.replace(/<[^>]+>/g, ' ')
/** Bracketed placeholders a visitor would read, such as "[PUBLISHER NAME]". */
const bracketed = (html) => text(html).match(/\[[^\]]{2,}\]/g) ?? []
const known = new Set(pages.map((p) => urlOf(p.file)))
for (const p of pages) {
  const where = p.file
  const all = ids(p.html)
  for (const id of new Set(all)) check(all.filter((x) => x === id).length === 1, `${where}: duplicate id "${id}"`)
  for (const m of p.html.matchAll(/\shref="#([^"]+)"/g)) check(all.includes(m[1]), `${where}: link to #${m[1]} leads nowhere`)
  for (const m of p.html.matchAll(/\s(?:href|src)="(\/[^"#?]*)(?:\?[^"#]*)?(#[^"]*)?"/g)) {
    const target = m[1]
    check(known.has(target) || existsSync(path.join(out, target)), `${where}: ${target} does not exist`)
    check(!target.endsWith('.html'), `${where}: ${target} is served through a redirect, link to ${urlOf(target.slice(1))} instead`)
    if (m[2] && known.has(target)) {
      const dest = pages.find((q) => urlOf(q.file) === target)
      check(ids(dest.html).includes(m[2].slice(1)), `${where}: ${target}${m[2]} leads nowhere`)
    }
  }
  const noindex = p.html.includes('<meta name="robots" content="noindex">')
  check(noindex === (preview || p.kind === 'notfound'), `${where}: ${noindex ? 'is marked noindex although the site has a public address' : 'is not marked noindex although no public address is set'}`)
  check((p.html.match(/<h1[\s>]/g) ?? []).length === 1, `${where}: expected exactly one h1`)
  check(/Ascend isn[’']t endorsed by Riot Games/.test(p.html), `${where}: the Riot Games notice is missing`)
  check(!/\p{Extended_Pictographic}/u.test(everything(p.html)), `${where}: contains an emoji or pictograph`)
  check(!/[dl]['’]trade/i.test(p.html), `${where}: French elision glitch (d'trade / l'trade)`)
  check(!/\{\{|\}\}|undefined|\bNaN\b|\[object /.test(text(p.html)), `${where}: an unfilled slot or a stray value is printed`)
  // A legal page may wait for the publisher's details while the site is a preview, never once it is public.
  if (p.kind === 'legal' && !preview) {
    const left = bracketed(p.html)
    check(!left.length, `${where}: ${left.length} bracketed placeholder${left.length > 1 ? 's' : ''} left (${left.join(', ')}); complete the legal pages before giving the site a public address`)
  }
  if (p.kind === 'home') {
    check(!bracketed(p.html).length, `${where}: a bracketed placeholder is printed on a marketing page`)
    // Riot policy: no official rank names, no place names from the game's universe.
    // (The radar's "Gold/m" and "Gold@15" axes are the in-game currency, as the app labels them.)
    const prose = everything(p.html).replace(/Gold(?:\/m|@15)/g, '')
    const rank = prose.match(/\b(iron|bronze|silver|platinum|emerald|diamond|grandmaster|challenger|argent|platine|émeraude|diamant)\b/i) ?? prose.match(/\b(Gold|Master|Maître|Fer)\b/)
    check(!rank, `${where}: official rank name printed: "${rank?.[0]}"`)
    const place = p.html.match(/\b(hextech|piltover|noxus|ionia|shurima|freljord|zaun|demacia|runeterra)\b/i)
    check(!place, `${where}: universe name in the page source: "${place?.[0]}"`)
  }
}
const placeholders = pages.filter((p) => p.kind === 'legal').map((p) => [p.file, bracketed(p.html).length]).filter(([, n]) => n)

if (problems.length) {
  console.error(`\nSite build failed, ${problems.length} problem${problems.length > 1 ? 's' : ''}:\n${problems.map((x) => `  - ${x}`).join('\n')}\n`)
  process.exit(1)
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`
console.log(`Ascend site built in ${path.relative(repo, out)}${siteUrl ? ` for ${siteUrl}` : ' (preview: no public address set, so no canonical link, no sitemap, and every page asks not to be indexed)'}`)
for (const [rel, bytes] of emitted) console.log(`  ${rel.padEnd(26)} ${kb(bytes).padStart(9)}`)
console.log(`  download → ${releaseUrls().download}`)
console.log(`  facts    → ${Object.entries(data.fr.facts).map(([k, v]) => `${k} ${v}`).join(', ')}`)
console.log(placeholders.length
  ? `  legal placeholders still to fill by the publisher → ${placeholders.map(([file, n]) => `${file}: ${n}`).join(', ')}`
  : '  legal pages → no placeholder left')
if (versionNote) console.log(`  ${versionNote}`)
for (const f of ['assets/fonts/big-shoulders-display.woff2', 'assets/fonts/inter.woff2', 'assets/fonts/jetbrains-mono.woff2', 'favicon.svg']) {
  if (!(await stat(path.join(out, f)).catch(() => null))) { console.error(`missing static file: ${f}`); process.exit(1) }
}
