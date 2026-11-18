/**
 * The two product pages (Penpot, "Vitrine v2 — Entraînement solo" and
 * "Vitrine v2 — Environnement d'équipe"): a promise with the mini demo
 * window, a short framing section, every feature with a capture or a clip,
 * the rest of the toolbox, privacy, then the invitation (shell.mjs).
 */
import { esc, fill, tx } from '../lib/html.mjs'
import { frame } from '../lib/media.mjs'
import { tour } from '../lib/tour.mjs'

/** Media of each page: the demo window's chapters, then one per feature. `wide`: features shown full width. */
const PAGES = {
  solo: {
    tour: ['demo-solo-objectif', 'demo-solo-partie', 'demo-solo-micro', 'demo-solo-revue', 'demo-solo-mesure'],
    features: ['solo-session', 'solo-record', 'solo-microreview', 'solo-review', 'solo-stats', 'solo-lab', 'solo-radar'],
    wide: [0, 2],
  },
  team: {
    tour: ['demo-team-planning', 'demo-team-stats', 'demo-team-vod', 'demo-team-player', 'demo-team-draft', 'demo-team-staff'],
    features: ['team-dashboard', 'team-planning', 'team-vod', 'team-stats', 'team-player', 'team-draft'],
    wide: [0, 1],
  },
}

export function product(kind, c, ctx, data) {
  const L = c.lang
  const T = (s) => tx(fill(s, data.facts), L)
  const p = kind === 'solo' ? c.soloPage : c.teamPage
  const m = PAGES[kind]
  const media = ctx.media
  const tourId = `demo-${kind}`

  const hero = `<section class="hero hero-product" aria-labelledby="h-hero">
  <div class="wrap">
    <p class="kicker mono kicker-accent">${T(p.kicker)}</p>
    <h1 id="h-hero">${p.title.map((s) => `<span class="ln">${T(s)}</span>`).join(' ')}</h1>
    <div class="hero-row">
      <p class="lead">${T(p.lead)}</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#${esc(c.access.id)}">${T(c.navbar.access)}</a>
        <a class="link-arrow" href="#${tourId}">${T(p.demoLink)}<span aria-hidden="true"> →</span></a>
      </div>
    </div>
    ${tour(media, {
      id: tourId,
      title: p.demo.title,
      label: p.demo.title,
      lang: L,
      chapters: p.demo.chapters.map(([name, sub, alt], i) => ({ name, sub, alt, media: m.tour[i] })),
    })}
  </div>
</section>`

  // ── 01 · the method (solo) or the roles (team) ──
  const framing = kind === 'solo'
    ? `<section class="sec" id="methode" aria-labelledby="h-method">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker mono">${T(p.loop.kicker)}</p>
      <h2 id="h-method">${T(p.loop.title)}</h2>
      <p class="sec-lead">${T(p.loop.lead)}</p>
    </header>
    <ol class="loop">
      ${p.loop.steps.map(([title, text, time], i) => `<li>
        <span class="loop-n mono">${String(i + 1).padStart(2, '0')}</span>
        <h3>${T(title)}</h3>
        <p>${T(text)}</p>
        <p class="loop-time mono">${T(time)}</p>
      </li>`).join('\n      ')}
    </ol>
  </div>
</section>`
    : `<section class="sec" id="roles" aria-labelledby="h-roles">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker mono">${T(p.roles.kicker)}</p>
      <h2 id="h-roles">${T(p.roles.title)}</h2>
      <p class="sec-lead">${T(p.roles.lead)}</p>
    </header>
    <ul class="cols">
      ${p.roles.cols.map(([title, text]) => `<li><h3>${T(title)}</h3><p>${T(text)}</p></li>`).join('\n      ')}
    </ul>
  </div>
</section>`

  // ── 02 · features ──
  let flip = false
  const features = `<section class="sec" id="fonctionnalites" aria-labelledby="h-features">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker mono">${T(p.features.kicker)}</p>
      <h2 id="h-features">${T(p.features.title)}</h2>
      <p class="sec-lead">${T(p.features.lead)}</p>
    </header>
    <ol class="features">
      ${p.features.items.map((f, i) => {
        const head = `<p class="label"><span class="mono">${String(i + 1).padStart(2, '0')}</span>${T(f.label)}</p>
          <h3>${T(f.title)}</h3>
          <p>${T(f.text)}</p>`
        const points = `<ul class="points">${f.points.map((x) => `<li>${T(x)}</li>`).join('')}</ul>`
        if (m.wide.includes(i)) {
          return `<li class="feature feature-wide">
        <div class="feature-text">
          <div>${head}</div>
          ${points}
        </div>
        ${frame(media, m.features[i], f.alt, L)}
      </li>`
        }
        flip = !flip
        return `<li class="feature${flip ? '' : ' feature-flip'}">
        <div class="feature-text">
          ${head}
          ${points}
        </div>
        ${frame(media, m.features[i], f.alt, L)}
      </li>`
      }).join('\n      ')}
    </ol>
  </div>
</section>`

  // ── 03 · and also ──
  const table = (rows) => `<dl class="ledger">${rows.map(([term, text]) => `<div><dt>${T(term)}</dt><dd>${T(text)}</dd></div>`).join('')}</dl>`
  const more = `<section class="sec sec-tight" id="aussi" aria-labelledby="h-more">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker mono">${T(p.more.kicker)}</p>
      <h2 id="h-more" class="h2-sm">${T(p.more.title)}</h2>
    </header>
    ${table(p.more.rows)}
  </div>
</section>`

  // ── 04 · privacy (the solo page also says what is done with Riot's data) ──
  const riot = kind === 'solo' ? `<details class="riot">
      <summary>${T(c.riot.title)}</summary>
      <p>${T(c.riot.intro)}</p>
      ${table(c.riot.facts)}
      <table class="api">
        <caption>${T(c.riot.table.caption)}</caption>
        <thead><tr>${c.riot.table.head.map((h) => `<th scope="col">${T(h)}</th>`).join('')}</tr></thead>
        <tbody>${c.riot.table.rows.map(([name, why]) => `<tr><th scope="row" class="mono">${T(name)}</th><td>${T(why)}</td></tr>`).join('')}</tbody>
      </table>
    </details>
    <p class="more"><a href="${esc(c.footer.privacyHref)}">${T(p.privacy.policy)}</a></p>` : ''
  const privacy = `<section class="sec sec-tight" id="confidentialite" aria-labelledby="h-privacy">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker mono">${T(p.privacy.kicker)}</p>
      <h2 id="h-privacy" class="h2-sm">${T(p.privacy.title)}</h2>
      <p class="sec-lead">${T(p.privacy.lead)}</p>
    </header>
    ${table(p.privacy.rows)}
    ${riot}
  </div>
</section>`

  // ── 05 · getting started (team) ──
  const start = kind === 'team' ? `<section class="sec sec-tight" id="demarrer" aria-labelledby="h-start">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker mono">${T(p.start.kicker)}</p>
      <h2 id="h-start" class="h2-sm">${T(p.start.title)}</h2>
    </header>
    <ol class="start">
      ${p.start.steps.map(([title, text], i) => `<li><span class="start-n" aria-hidden="true">${i + 1}</span><h3>${T(title)}</h3><p>${T(text)}</p></li>`).join('\n      ')}
    </ol>
  </div>
</section>` : ''

  return { main: [hero, framing, features, more, privacy, start].filter(Boolean).join('\n') }
}
