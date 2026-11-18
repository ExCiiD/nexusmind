/**
 * The four legal pages and the 404 page. The legal texts live in
 * site/src/legal/*.html and are published as written: only the page around
 * them comes from here. Their bracketed placeholders (publisher, address,
 * contact) can only be filled by the publisher; the build lists them.
 */
import { esc, tx } from '../lib/html.mjs'

export const LEGAL = [
  { source: 'conditions', lang: 'fr', path: '/conditions.html', kind: 'terms', alternates: { fr: '/conditions.html', en: '/en/terms.html' },
    title: "Conditions d'utilisation — Ascend", description: "Les règles d'utilisation de l'application Ascend, de l'app web et de leurs services en ligne." },
  { source: 'confidentialite', lang: 'fr', path: '/confidentialite.html', kind: 'privacy', alternates: { fr: '/confidentialite.html', en: '/en/privacy.html' },
    title: 'Politique de confidentialité — Ascend', description: 'Quelles données Ascend traite, où elles sont stockées, combien de temps, et comment exercer vos droits.' },
  { source: 'terms', lang: 'en', path: '/en/terms.html', kind: 'terms', alternates: { fr: '/conditions.html', en: '/en/terms.html' },
    title: 'Terms of Service — Ascend', description: 'The rules for using the Ascend application, web app and online services.' },
  { source: 'privacy', lang: 'en', path: '/en/privacy.html', kind: 'privacy', alternates: { fr: '/confidentialite.html', en: '/en/privacy.html' },
    title: 'Privacy Policy — Ascend', description: 'What data Ascend processes, where it is stored, for how long, and how to exercise your rights.' },
]

const other = (lang) => (lang === 'fr' ? 'en' : 'fr')

/** Rail of a legal page: home, the two legal texts, and the same text in the other language. */
export function legalPage(c, doc, body) {
  return {
    path: doc.path,
    title: doc.title,
    description: doc.description,
    alternates: doc.alternates,
    bodyClass: 'is-legal',
    rail: [{
      items: [
        { href: c.home, label: c.ui.legalBack },
        { href: c.footer.termsHref, label: c.footer.terms, current: doc.kind === 'terms' },
        { href: c.footer.privacyHref, label: c.footer.privacy, current: doc.kind === 'privacy' },
      ],
    }],
    langSwitch: { ...c.langSwitch, href: doc.alternates[other(doc.lang)] },
    footerLinks: homeLinks(c),
    main: `<article class="legal">\n${body}</article>`,
  }
}

/** Section links of the home page, as seen from another page. */
export const homeLinks = (c, base = c.home) => [...c.nav, ...c.annexes].map((x) => ({ href: `${base}#${x.id}`, label: x.label }))

/** One 404 page for the whole site (Cloudflare serves /404.html for every miss): both languages on it. */
export function notFoundPage(fr, en) {
  return {
    path: '/404.html',
    title: 'Page introuvable — Ascend',
    description: fr.ui.notFoundTitle,
    noindex: true,
    bodyClass: 'is-legal',
    rail: [{ items: [{ href: fr.home, label: fr.ui.legalBack }] }],
    langSwitch: fr.langSwitch,
    footerLinks: homeLinks(fr),
    main: `<article class="legal notfound">
      <h1>${tx(fr.ui.notFoundTitle, 'fr')}</h1>
      <p><a href="${esc(fr.home)}">${tx(fr.ui.notFoundBack, 'fr')}</a></p>
      <p lang="en">${tx(en.ui.notFoundTitle, 'en')} <a href="${esc(en.home)}">${tx(en.ui.notFoundBack, 'en')}</a></p>
    </article>`,
  }
}
