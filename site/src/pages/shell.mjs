/**
 * The document every page shares: head, the top bar (brand, the two product
 * pages, language, "request access"), the closing call to action and the
 * footer with the Riot Games notice.
 */
import { esc, tx } from '../lib/html.mjs'
import { icon } from '../lib/icons.mjs'
import { brandMark } from '../lib/mark.mjs'
import { megabytes } from '../release.mjs'
import { num } from '../lib/html.mjs'

/** JSON that can sit inside a <script> data block: no `<`, no line separators. */
export const jsonBlock = (id, value) =>
  `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}</script>`

export function downloadButton(c, ctx, { short = false, small = false } = {}) {
  const L = c.lang
  return `<a class="btn btn-primary${small ? ' btn-sm' : ''}" data-download href="${esc(ctx.urls.download)}">${icon.download(small ? 14 : 16)}<span>${tx(short ? c.download.ctaShort : c.download.cta, L)}</span></a>`
}

/** `mailto:` link that asks for an invite, subject and body filled in. */
export const accessHref = (c, ctx) =>
  `mailto:${ctx.contact}?subject=${encodeURIComponent(c.access.mailSubject)}&body=${encodeURIComponent(c.access.mailBody)}`

/** Where "request access" leads: this page's closing section, or the home page's. */
const accessAnchor = (c, page) => (page.hasAccess ? `#${c.access.id}` : `${c.home}#${c.access.id}`)

function head(c, ctx, page) {
  const L = c.lang
  const abs = (p) => (ctx.siteUrl ? ctx.siteUrl + p : p)
  const links = [
    ctx.siteUrl && !page.noindex ? `<link rel="canonical" href="${esc(abs(page.path))}">` : '',
    ...Object.entries(page.alternates ?? {}).map(([hl, p]) => `<link rel="alternate" hreflang="${hl}" href="${esc(abs(p))}">`),
  ].filter(Boolean).join('\n')
  const og = page.og ? `<meta property="og:type" content="website">
<meta property="og:site_name" content="Ascend">
<meta property="og:title" content="${tx(page.og.title, L)}">
<meta property="og:description" content="${tx(page.og.description, L)}">
<meta property="og:locale" content="${L === 'fr' ? 'fr_FR' : 'en_US'}">
${ctx.siteUrl ? `<meta property="og:url" content="${esc(abs(page.path))}">\n` : ''}${ctx.assets.og ? `<meta property="og:image" content="${esc(abs(ctx.assets.og))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">` : ''}` : ''
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${tx(page.title, L)}</title>
<meta name="description" content="${tx(page.description, L)}">
${page.noindex || ctx.preview ? '<meta name="robots" content="noindex">' : ''}
${links}
<meta name="theme-color" content="#0D0A06">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${og}
<link rel="preload" href="/assets/fonts/big-shoulders-display.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${esc(ctx.assets.css)}">
${page.jsonLd ? `<script type="application/ld+json">${JSON.stringify(page.jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
<script src="${esc(ctx.assets.js)}" defer></script>`.replace(/\n{2,}/g, '\n')
}

function topBar(c, ctx, page) {
  const L = c.lang
  const item = (key) => `<a href="${esc(c.pages[key].path)}"${page.current === key ? ' aria-current="page"' : ''}>${tx(c.navbar[key], L)}</a>`
  const lang = `<a class="lang" href="${esc(page.langSwitch.href)}" hreflang="${page.langSwitch.hreflang}" lang="${page.langSwitch.hreflang}" aria-label="${tx(page.langSwitch.label, L)}">${page.langSwitch.code}</a>`
  return `<header class="top" data-top>
  <div class="top-in">
    <a class="brand" href="${esc(c.home)}" aria-label="Ascend">${brandMark()}ASCEND</a>
    <nav class="top-nav" id="top-nav" aria-label="${tx(c.navbar.label, L)}">
      ${item('solo')}
      ${item('team')}
    </nav>
    <div class="top-tools">
      ${lang}
      <a class="btn btn-primary btn-sm top-cta" href="${esc(accessAnchor(c, page))}">${tx(c.navbar.access, L)}</a>
      <button type="button" class="top-toggle" aria-controls="top-nav" aria-expanded="false" hidden>${icon.menu(18)}<span class="vh">${tx(c.navbar.menu, L)}</span></button>
    </div>
  </div>
</header>`
}

/** Closing section of every product page: the invitation, and the download for those who have a code. */
export function accessSection(c, ctx) {
  const L = c.lang
  const size = `${num(megabytes(ctx.release.bytes), c.locale)} ${c.download.sizeUnit}`
  return `<section class="cta" id="${esc(c.access.id)}" aria-labelledby="h-${esc(c.access.id)}">
  <div class="wrap">
    <h2 id="h-${esc(c.access.id)}">${c.access.title.map((s) => `<span class="ln">${tx(s, L)}</span>`).join(' ')}</h2>
    <p class="lead">${tx(c.access.lead, L)}</p>
    <div class="cta-row">
      <a class="btn btn-primary" href="${esc(accessHref(c, ctx))}">${tx(c.access.request, L)}</a>
      <span class="cta-note mono">${tx(c.access.note, L)}</span>
    </div>
    <p class="cta-code">${tx(c.access.haveCode, L)} <a data-download href="${esc(ctx.urls.download)}">${tx(c.download.cta, L)}</a> <span class="mono">v<span data-version>${esc(ctx.release.version)}</span> · <span data-size>${tx(size, L)}</span></span></p>
  </div>
</section>`
}

function footer(c, ctx, page) {
  const L = c.lang
  const li = (href, label) => `<li><a href="${esc(href)}">${tx(label, L)}</a></li>`
  return `<footer class="foot">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <p class="brand" aria-hidden="true">${brandMark()}ASCEND</p>
        <p>${tx(c.footer.tagline, L)}</p>
      </div>
      <nav aria-labelledby="foot-product">
        <h2 class="foot-h" id="foot-product">${tx(c.footer.product, L)}</h2>
        <ul class="foot-list">${li(c.pages.solo.path, c.navbar.solo)}${li(c.pages.team.path, c.navbar.team)}${li(accessAnchor(c, page), c.navbar.access)}</ul>
      </nav>
      <nav aria-labelledby="foot-resources">
        <h2 class="foot-h" id="foot-resources">${tx(c.footer.resources, L)}</h2>
        <ul class="foot-list">${li(`${c.home}#${c.faq.id}`, c.footer.questions)}${li(`mailto:${ctx.contact}`, c.footer.contact)}${li(ctx.urls.all, c.footer.releaseNotes)}${li(ctx.webApp, c.download.webApp)}</ul>
      </nav>
      <nav aria-labelledby="foot-legal">
        <h2 class="foot-h" id="foot-legal">${tx(c.footer.legal, L)}</h2>
        <ul class="foot-list">${li(c.footer.termsHref, c.footer.terms)}${li(c.footer.privacyHref, c.footer.privacy)}</ul>
      </nav>
    </div>
    <p class="riot-notice" lang="en">${tx(c.footer.riot, 'en')}</p>
    ${c.footer.riotFr ? `<p class="riot-notice">${tx(c.footer.riotFr, L)}</p>` : ''}
  </div>
</footer>`
}

export function shell(c, ctx, page) {
  return `<!doctype html>
<html lang="${c.lang}">
<head>
${head(c, ctx, page)}
</head>
<body${page.bodyClass ? ` class="${page.bodyClass}"` : ''}>
<a class="skip" href="#main">${tx(c.skip, c.lang)}</a>
${topBar(c, ctx, page)}
<main id="main" tabindex="-1">
${page.main}
${page.hasAccess ? accessSection(c, ctx) : ''}
</main>
${footer(c, ctx, page)}
${(page.data ?? []).join('\n')}
</body>
</html>
`
}
