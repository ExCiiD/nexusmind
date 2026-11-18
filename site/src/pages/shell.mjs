/**
 * The document every page shares: head, the report's rail (its table of
 * contents, which folds into a top bar on small screens) and the footer with
 * the Riot Games notice.
 */
import { esc, tx } from '../lib/html.mjs'
import { icon } from '../lib/icons.mjs'
import { brandMark } from '../lib/mark.mjs'

/** JSON that can sit inside a <script> data block: no `<`, no line separators. */
export const jsonBlock = (id, value) =>
  `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}</script>`

export function downloadButton(c, ctx, { short = false, small = false } = {}) {
  const L = c.lang
  return `<a class="btn btn-primary${small ? ' btn-sm' : ''}" data-download href="${esc(ctx.urls.download)}">${icon.download(small ? 14 : 16)}<span>${tx(short ? c.download.ctaShort : c.download.cta, L)}</span></a>`
}

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
${ctx.assets.og ? `<meta property="og:image" content="${esc(abs(ctx.assets.og))}">
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

function rail(c, ctx, page) {
  const L = c.lang
  const link = (item) => `<li><a href="${esc(item.href)}"${item.current ? ' aria-current="page"' : ''}>${tx(item.label, L)}</a></li>`
  const nav = page.rail.map((group) => `${group.title ? `<p class="rail-h">${tx(group.title, L)}</p>` : ''}
      <${group.numbered ? 'ol' : 'ul'} class="rail-list${group.numbered ? ' rail-num' : ''}">${group.items.map(link).join('')}</${group.numbered ? 'ol' : 'ul'}>`).join('\n')
  const lang = `<a class="lang" href="${esc(page.langSwitch.href)}" hreflang="${page.langSwitch.hreflang}" lang="${page.langSwitch.hreflang}" aria-label="${tx(page.langSwitch.label, L)}">${page.langSwitch.code}</a>`
  return `<header class="rail" data-rail>
    <div class="rail-top">
      <a class="brand" href="${esc(c.home)}" aria-label="Ascend">${brandMark()}ASCEND</a>
      <span class="brand-note mono">${tx(c.brandNote, L)}</span>
      <span class="rail-tools">
        ${lang}
        <a class="rail-toggle" href="#${ctx.contentsId}" data-toggle aria-controls="rail-nav">${icon.menu(16)}<span>${tx(c.rail.menu, L)}</span></a>
        ${downloadButton(c, ctx, { short: true, small: true })}
      </span>
    </div>
    <nav class="rail-nav" id="rail-nav" aria-label="${tx(c.rail.label, L)}">
      ${nav}
    </nav>
    <div class="rail-foot">
      ${downloadButton(c, ctx, { short: true })}
      <p class="rail-ver mono"><span data-version>${esc(ctx.release.version)}</span></p>
      ${lang}
    </div>
  </header>`
}

function footer(c, ctx, page) {
  const L = c.lang
  const product = page.footerLinks.map((x) => `<li><a href="${esc(x.href)}">${tx(x.label, L)}</a></li>`).join('')
  return `<footer class="foot">
    <div class="foot-grid">
      <div class="foot-brand">
        <p class="brand" aria-hidden="true">${brandMark()}ASCEND</p>
        <p>${tx(c.footer.tagline, L)}</p>
      </div>
      <nav id="${ctx.contentsId}" aria-label="${tx(c.footer.contents, L)}">
        <h2 class="foot-h">${tx(c.footer.contents, L)}</h2>
        <ul class="foot-list foot-list-2">${product}</ul>
      </nav>
      <nav aria-label="${tx(c.footer.legal, L)}">
        <h2 class="foot-h">${tx(c.footer.legal, L)}</h2>
        <ul class="foot-list">
          <li><a href="${esc(c.footer.termsHref)}">${tx(c.footer.terms, L)}</a></li>
          <li><a href="${esc(c.footer.privacyHref)}">${tx(c.footer.privacy, L)}</a></li>
          <li><a href="${esc(ctx.urls.all)}">${tx(c.download.releaseNotes, L)}</a></li>
          <li><a href="${esc(ctx.webApp)}">${tx(c.download.webApp, L)}</a></li>
        </ul>
      </nav>
    </div>
    <p class="riot-notice" lang="en">${tx(c.footer.riot, 'en')}</p>
    ${c.footer.riotFr ? `<p class="riot-notice">${tx(c.footer.riotFr, L)}</p>` : ''}
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
<div class="layout">
  ${rail(c, ctx, page)}
  <div class="page">
    <main id="main" tabindex="-1">
${page.main}
    </main>
    ${footer(c, ctx, page)}
  </div>
</div>
${(page.data ?? []).join('\n')}
</body>
</html>
`
}
