/**
 * The four legal pages and the 404 page. The legal texts live in
 * site/src/legal/*.html and are published as written: only the page around
 * them comes from here. The publisher's details (name, place, governing law,
 * contact address) are written in those texts; a detail still to come is
 * written as a bracketed placeholder, which the build lists and refuses once
 * the site has a public address.
 */
import { esc, tx } from '../lib/html.mjs'

/* `path` is the public address. Cloudflare serves conditions.html at /conditions
 * and redirects the .html form to it, so every link uses the short one; the
 * build writes each page to `path` + '.html'. */
export const LEGAL = [
  { source: 'conditions', lang: 'fr', path: '/conditions', kind: 'terms', alternates: { fr: '/conditions', en: '/en/terms' },
    title: "Conditions d'utilisation — Ascend", description: "Les règles d'utilisation de l'application Ascend, de l'app web et de leurs services en ligne." },
  { source: 'confidentialite', lang: 'fr', path: '/confidentialite', kind: 'privacy', alternates: { fr: '/confidentialite', en: '/en/privacy' },
    title: 'Politique de confidentialité — Ascend', description: 'Quelles données Ascend traite, où elles sont stockées, combien de temps, et comment exercer vos droits.' },
  { source: 'terms', lang: 'en', path: '/en/terms', kind: 'terms', alternates: { fr: '/conditions', en: '/en/terms' },
    title: 'Terms of Service — Ascend', description: 'The rules for using the Ascend application, web app and online services.' },
  { source: 'privacy', lang: 'en', path: '/en/privacy', kind: 'privacy', alternates: { fr: '/confidentialite', en: '/en/privacy' },
    title: 'Privacy Policy — Ascend', description: 'What data Ascend processes, where it is stored, for how long, and how to exercise your rights.' },
]

const other = (lang) => (lang === 'fr' ? 'en' : 'fr')

/** A legal page: the text, with the same text in the other language behind the language switch. */
export function legalPage(c, doc, body) {
  return {
    path: doc.path,
    title: doc.title,
    description: doc.description,
    alternates: doc.alternates,
    bodyClass: 'is-legal',
    langSwitch: { ...c.langSwitch, href: doc.alternates[other(doc.lang)] },
    main: `<article class="legal wrap">\n${body}</article>`,
  }
}

/** One 404 page for the whole site (Cloudflare serves /404.html for every miss): both languages on it. */
export function notFoundPage(fr, en) {
  return {
    path: '/404',
    title: 'Page introuvable — Ascend',
    description: fr.ui.notFoundTitle,
    noindex: true,
    bodyClass: 'is-legal',
    langSwitch: fr.langSwitch,
    main: `<article class="legal notfound wrap">
      <h1>${tx(fr.ui.notFoundTitle, 'fr')}</h1>
      <p><a href="${esc(fr.home)}">${tx(fr.ui.notFoundBack, 'fr')}</a></p>
      <p lang="en">${tx(en.ui.notFoundTitle, 'en')} <a href="${esc(en.home)}">${tx(en.ui.notFoundBack, 'en')}</a></p>
    </article>`,
  }
}
