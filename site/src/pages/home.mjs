/**
 * The home page: a scouting report on the product. Seven numbered sections,
 * three appendices, five exhibits ("pièces") that are working previews of the
 * app's screens, rendered here once and re-rendered in the browser by the same
 * modules (site/src/exhibits).
 */
import { esc, fill, num, tx } from '../lib/html.mjs'
import { megabytes } from '../release.mjs'
import { downloadButton, jsonBlock } from './shell.mjs'
import * as micro from '../exhibits/micro.mjs'
import * as dashboard from '../exhibits/dashboard.mjs'
import * as lab from '../exhibits/lab.mjs'
import * as radar from '../exhibits/radar.mjs'
import * as tiers from '../exhibits/tiers.mjs'
import * as themes from '../exhibits/themes.mjs'

export function home(c, ctx, data) {
  const L = c.lang
  /** Site copy, with the product facts measured at build time dropped into its `{{slots}}`. */
  const T = (s) => tx(fill(s, data.facts), L)
  const lines = (pair) => pair.map((s) => `<span class="ln">${T(s)}</span>`).join(' ')
  const size = `${num(megabytes(ctx.release.bytes), c.locale)} ${c.download.sizeUnit}`

  const piece = (letter, name, caption, inner, { note = false, demo = true } = {}) => `<figure class="piece" id="piece-${letter.toLowerCase()}">
      <figcaption class="piece-cap"><span class="piece-ref mono">${T(c.pieces.ref)} ${letter}</span><span class="piece-what">${T(caption)}</span>${demo && !note ? `<span class="piece-demo">${T(c.pieces.demo)}</span>` : ''}</figcaption>
      <div class="piece-frame app" data-exhibit="${name}" role="group" aria-label="${T(c.pieces.ref)} ${letter}">${inner}</div>
      ${note ? `<p class="piece-note">${T(c.pieces.synthetic)}</p>` : ''}
    </figure>`

  const section = (item, n, title, body, extra = '') => `<section class="sec${extra}" id="${item.id}" aria-labelledby="h-${item.id}">
    <header class="sec-head">${n ? `<span class="sec-n mono" aria-hidden="true">${n}</span>` : ''}<h2 id="h-${item.id}">${T(title)}</h2></header>
    <div class="sec-body">
${body}
    </div>
  </section>`

  const ledger = (rows) => `<dl class="ledger">${rows.map(([term, text]) => `<div><dt>${T(term)}</dt><dd>${T(text)}</dd></div>`).join('')}</dl>`

  const facts = [
    [c.hero.game[0], esc(c.hero.game[1])],
    [c.download.facts.version, `<span data-version>${esc(ctx.release.version)}</span>`],
    [c.download.facts.size, `<span data-size>${tx(size, L)}</span>`],
    [c.download.facts.system, T(c.download.system)],
    [c.download.facts.price, T(c.download.price)],
    [c.download.facts.access, T(c.download.access)],
  ]

  // ── Opening: the claim, the sheet, and a micro-review to play ──
  const hero = `<section class="hero" aria-labelledby="h-hero">
    <div class="hero-grid">
      <div class="hero-main">
        <h1 id="h-hero">${lines(c.hero.title)}</h1>
        <p class="lead">${T(c.hero.lead)}</p>
      </div>
      <div class="sheet" id="${c.download.id}">
        <dl class="sheet-facts">${facts.map(([k, v]) => `<div><dt>${T(k)}</dt><dd class="mono">${v}</dd></div>`).join('')}</dl>
        ${downloadButton(c, ctx)}
        <p class="sheet-note">${T(c.download.note)}</p>
        <details class="verify" data-verify>
          <summary>${T(c.download.verify)}</summary>
          <p>${T(c.download.verifyHelp)}</p>
          <code class="mono">${esc(ctx.release.sha512)}</code>
        </details>
        <p class="sheet-links"><a href="${esc(ctx.urls.all)}">${T(c.download.releaseNotes)}</a><a href="${esc(ctx.webApp)}">${T(c.download.webApp)}</a></p>
      </div>
    </div>
    ${piece('A', 'micro', c.pieces.a, micro.render(micro.initialState(data.micro), data.micro), { note: true })}
  </section>`

  // ── 1 · Method ──
  const steps = c.method.table
  const method = section(c.nav[0], 1, c.method.title, `      <p class="intro">${T(c.method.intro)}</p>
      <table class="grid-table steps">
        <caption>${T(steps.caption)}</caption>
        <thead><tr>${steps.head.map((h, i) => `<th scope="col"${i === 3 ? ' class="num"' : ''}>${T(h)}</th>`).join('')}</tr></thead>
        <tbody>${steps.rows.map((r, i) => `<tr>
          <th scope="row"><span class="step-n mono" aria-hidden="true">${i + 1}</span>${T(r[0])}</th>
          <td data-label="${T(steps.head[1])}">${T(r[1])}</td>
          <td data-label="${T(steps.head[2])}">${T(r[2])}</td>
          <td data-label="${T(steps.head[3])}" class="num mono">${T(r[3])}</td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="with-notes">
        ${piece('B', 'dashboard', c.pieces.b, dashboard.render(dashboard.initialState(data.dashboard), data.dashboard))}
        <div class="notes">${c.method.notes.map(([title, text]) => `<div class="note"><h3>${T(title)}</h3><p>${T(text)}</p></div>`).join('')}</div>
      </div>`)

  // ── 2 · Micro-review ──
  const microSec = section(c.nav[1], 2, c.micro.title, `      <p class="intro">${T(c.micro.intro)}</p>
      ${ledger(c.micro.facts)}
      <p class="back"><a href="#piece-a">${T(c.micro.back)}</a></p>`)

  // ── 3 · Mistake Lab ──
  const labSec = section(c.nav[2], 3, c.lab.title, `      <div class="split">
        <p class="intro">${T(c.lab.intro)}</p>
        <ul class="figures">${c.lab.facts.map(([figure, label]) => `<li><b class="mono">${T(figure)}</b><span>${T(label)}</span></li>`).join('')}</ul>
      </div>
      ${piece('C', 'lab', c.pieces.c, lab.render(lab.initialState(data.lab), data.lab))}
      <p class="outro">${T(c.lab.outro)}</p>`)

  // ── 4 · Fingerprint ──
  const printSec = section(c.nav[3], 4, c.print.title, `      <p class="intro">${T(c.print.intro)}</p>
      ${piece('D', 'radar', c.pieces.d, radar.render(radar.initialState(data.radar), data.radar))}
      <div class="pair"><p>${T(c.print.support)}</p><p>${T(c.print.assessment)}</p></div>`)

  // ── 5 · Practice tiers ──
  const tiersSec = section(c.nav[4], 5, c.tiers.title, `      <p class="intro">${T(c.tiers.intro)}</p>
      <div class="tiers-frame" data-exhibit="tiers">${tiers.render(tiers.initialState(data.tiers), data.tiers)}</div>
      <div class="split split-even">
        <table class="grid-table xp">
          <caption>${T(c.tiers.sources.caption)}</caption>
          <tbody>${c.tiers.sources.rows.map(([what, xp]) => `<tr><th scope="row">${T(what)}</th><td class="num mono">${T(xp)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="prose"><p>${T(c.tiers.notRank)}</p><p>${T(c.tiers.titles)}</p></div>
      </div>`)

  // ── 6 · Player, coach, team ──
  const m = c.modes
  const cell = (text, col) => (text == null
    ? `<td class="is-none" data-label="${T(col)}"><span class="vh">${T(m.none)}</span><span aria-hidden="true">—</span></td>`
    : `<td data-label="${T(col)}">${T(text)}</td>`)
  const modesSec = section(c.nav[5], 6, m.title, `      <p class="intro">${T(m.intro)}</p>
      <table class="grid-table matrix">
        <thead><tr><td></td>${m.cols.map((col, i) => `<th scope="col">${T(col)}<small>${T(m.colNotes[i])}</small></th>`).join('')}</tr></thead>
        ${m.groups.map((g) => `<tbody>
          <tr class="matrix-group"><th colspan="4" scope="rowgroup">${T(g.name)}</th></tr>
          ${g.rows.map((r) => `<tr><th scope="row">${T(r[0])}</th>${[1, 2, 3].map((k) => cell(r[k], m.cols[k - 1])).join('')}</tr>`).join('')}
        </tbody>`).join('')}
      </table>
      <p class="outro">${T(m.webNote)} <a href="${esc(ctx.webApp)}">${T(c.download.webApp)}</a></p>`)

  // ── 7 · Themes ──
  const themesSec = section(c.nav[6], 7, c.themes.title, `      <p class="intro">${T(c.themes.intro)}</p>
      <figure class="piece" id="piece-e">
        <figcaption class="piece-cap"><span class="piece-ref mono">${T(c.pieces.ref)} E</span><span class="piece-what">${T(c.pieces.e)}</span></figcaption>
        <div class="piece-frame" data-themes>${themes.render(data.themes)}</div>
      </figure>
      <p class="outro">${T(c.themes.local)}</p>`)

  // ── Appendices ──
  const api = c.riot.table
  const riotSec = section(c.annexes[0], '', c.riot.title, `      <p class="intro">${T(c.riot.intro)}</p>
      ${ledger(c.riot.facts)}
      <table class="grid-table api">
        <caption>${T(api.caption)}</caption>
        <thead><tr>${api.head.map((h) => `<th scope="col">${T(h)}</th>`).join('')}</tr></thead>
        <tbody>${api.rows.map(([name, why]) => `<tr><th scope="row" class="mono">${T(name)}</th><td>${T(why)}</td></tr>`).join('')}</tbody>
      </table>`, ' sec-annex')

  const privacySec = section(c.annexes[1], '', c.privacy.title, `      <p class="intro">${T(c.privacy.intro)}</p>
      ${ledger(c.privacy.facts)}
      <p class="back"><a href="${esc(c.privacy.policyHref)}">${T(c.privacy.policy)}</a></p>`, ' sec-annex')

  const faqSec = section(c.annexes[2], '', c.faq.title, `      <div class="faq">${c.faq.items.map(([q, a]) => `<details><summary>${T(q)}</summary><p>${T(a)}</p></details>`).join('')}</div>`, ' sec-annex')

  // ── Close ──
  const final = `<section class="final" aria-labelledby="h-final">
    <h2 id="h-final">${lines(c.final.title)}</h2>
    <p class="lead">${T(c.final.lead)}</p>
    <div class="final-cta">
      ${downloadButton(c, ctx)}
      <dl class="final-facts">${facts.slice(1, 4).map(([k, v]) => `<div><dt>${T(k)}</dt><dd class="mono">${v}</dd></div>`).join('')}</dl>
    </div>
    <p class="sheet-note">${T(c.download.note)}</p>
  </section>`

  const main = [hero, method, microSec, labSec, printSec, tiersSec, modesSec, themesSec, riotSec, privacySec, faqSec, final].join('\n')

  const dataBlocks = [
    jsonBlock('data-micro', data.micro),
    jsonBlock('data-dashboard', data.dashboard),
    jsonBlock('data-lab', data.lab),
    jsonBlock('data-radar', data.radar),
    jsonBlock('data-tiers', data.tiers),
    jsonBlock('data-themes', { presets: Object.fromEntries(data.themes.presets.map((p) => [p.id, p.vars])) }),
    jsonBlock('data-release', { version: ctx.release.version, api: ctx.urls.api, sizeUnit: c.download.sizeUnit, locale: c.locale }),
  ]
  return { main, data: dataBlocks }
}
