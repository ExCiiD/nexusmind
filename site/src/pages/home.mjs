/**
 * The home page (Penpot, "Vitrine v2 — Accueil"): the promise and the
 * dashboard, the five things the app does for a player between two games,
 * the four things it does for a team, the questions, then the invitation
 * (shell.mjs). The details live on the solo and team pages.
 */
import { esc, fill, tx } from '../lib/html.mjs'
import { frame } from '../lib/media.mjs'

const SOLO_MEDIA = ['home-record', 'home-microreview', 'home-review', 'home-stats', 'home-lab']
const TEAM_MEDIA = ['home-planning', 'home-team-dashboard', 'home-team-stats', 'home-vod']

export function home(c, ctx, data) {
  const L = c.lang
  /** Site copy, with the product facts measured at build time dropped into its `{{slots}}`. */
  const T = (s) => tx(fill(s, data.facts), L)
  const p = c.homePage
  const media = ctx.media
  const more = (href, label) => `<p class="more"><a href="${esc(href)}">${T(label)}<span aria-hidden="true"> →</span></a></p>`

  const hero = `<section class="hero" aria-labelledby="h-hero">
  <div class="wrap">
    <p class="kicker mono">${T(p.kicker)}</p>
    <h1 id="h-hero">${c.hero.title.map((s) => `<span class="ln">${T(s)}</span>`).join(' ')}</h1>
    <div class="hero-row">
      <p class="lead">${T(c.hero.lead)}</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#${esc(c.access.id)}">${T(c.navbar.access)}</a>
        <a class="link-arrow" href="${esc(c.pages.solo.path)}">${T(p.secondary)}<span aria-hidden="true"> →</span></a>
      </div>
    </div>
    ${frame(media, 'home-dashboard', p.heroAlt, L, { eager: true })}
  </div>
</section>`

  const solo = `<section class="sec" id="solo" aria-labelledby="h-solo">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker mono">${T(p.solo.kicker)}</p>
      <h2 id="h-solo">${T(p.solo.title)}</h2>
      <p class="sec-lead">${T(p.solo.lead)}</p>
    </header>
    <ol class="rows">
      ${p.solo.items.map(([label, title, text, alt], i) => `<li class="row${i % 2 ? ' row-flip' : ''}">
        <div class="row-text">
          <p class="label"><span class="mono">${String(i + 1).padStart(2, '0')}</span>${T(label)}</p>
          <h3>${T(title)}</h3>
          <p>${T(text)}</p>
        </div>
        ${frame(media, SOLO_MEDIA[i], alt, L)}
      </li>`).join('\n      ')}
    </ol>
    ${more(c.pages.solo.path, p.solo.more)}
  </div>
</section>`

  const teamCard = (i, wide) => {
    const [label, title, text, alt] = p.team.items[i]
    return `<li class="card${wide ? ' card-wide' : ''}">
        ${frame(media, TEAM_MEDIA[i], alt, L)}
        <p class="label">${T(label)}</p>
        <h3>${T(title)}</h3>
        <p>${T(text)}</p>
      </li>`
  }
  const team = `<section class="sec sec-surface" id="equipe" aria-labelledby="h-team">
  <div class="wrap">
    <header class="sec-head">
      <p class="kicker mono">${T(p.team.kicker)}</p>
      <h2 id="h-team">${T(p.team.title)}</h2>
      <p class="sec-lead">${T(p.team.lead)}</p>
    </header>
    <ul class="cards">
      ${teamCard(0, true)}
      ${teamCard(1, false)}
      ${teamCard(2, false)}
      ${teamCard(3, true)}
    </ul>
    <div class="also">
      <p>${T(p.team.also)}</p>
      ${more(c.pages.team.path, p.team.more)}
    </div>
  </div>
</section>`

  const faq = `<section class="sec" id="${esc(c.faq.id)}" aria-labelledby="h-faq">
  <div class="wrap faq-grid">
    <header class="sec-head">
      <p class="kicker mono">${T(c.faq.kicker)}</p>
      <h2 id="h-faq">${T(c.faq.title)}</h2>
      <p class="faq-aside">${T(c.faq.aside)} <a href="mailto:${esc(ctx.contact)}">${esc(ctx.contact)}</a></p>
    </header>
    <div class="faq">${c.faq.items.map(([q, a]) => `<details><summary>${T(q)}</summary><p>${T(a)}</p></details>`).join('')}</div>
  </div>
</section>`

  return { main: [hero, solo, team, faq].join('\n') }
}
