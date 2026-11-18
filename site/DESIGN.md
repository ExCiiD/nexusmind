# Ascend showcase site — design and build notes

The site is a **scouting report on the product**: a contents rail, numbered
sections separated by hairlines, tables instead of cards, and five exhibits
("pièces") that are working previews of the app's screens. Everything below is
what keeps it that way.

## Brief (pinned by the product owner, do not drift)

1. Editorial "scouting report" style: condensed display type, hairline rules, one signal colour.
2. Nothing that reads as generated: no purple or blue gradient, no row of three identical cards, no glow, no emoji, no vague marketing sentence.
3. Riot Games compliance: no Riot logo, no official splash art, no official rank name, the legal notice on every page.
4. Interactive previews of the real screens, and a download button that points straight at the release.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0D0A06` | page |
| `--surface` | `#1C140C` | exhibit frames |
| `--rule` / `--rule-strong` | `#3A2C18` / `#6B5330` | hairlines, frame borders |
| `--text-hi` | `#F5E3BE` | headings, lead, values |
| `--text` | `#B5A68C` | body |
| `--text-low` | `#978769` | labels, notes (4.5:1 on ink and surface) |
| `--accent` | `#D4A24C` | the only signal: primary button, exhibit references, current item, what a mistake costs |

Inside `.app` (the previews) colours come from `--app-*` variables. Their
defaults are written by the build from the app's own `src/index.css`, so the
previews follow the product's default theme without a copy to maintain.

Wins and losses are told apart by fill, mistake families by the shape of
their marker (diamond, ring, triangle, square). Never by a second hue.

## Type

| Face | Job |
|---|---|
| Big Shoulders Display 800 to 900, uppercase | `h1`, `h2`, the brand, tier and matrix headers |
| Inter 400 / 500 / 600 | everything that is read |
| JetBrains Mono 500 / 600 | data: clocks, counts, versions, exhibit references |

All three are self-hosted in `public/assets/fonts` and released under the SIL
Open Font License. Inter's licence text sits next to it; the texts for the two
faces inherited from the app are still to be added. Labels are in sentence
case; no tracked-out capitals, no label sitting above a heading.

## Structure rules

- Site chrome is square (radius 0) and flat. The previews keep the app's small radii, which is how the two are told apart.
- A section is a hairline, a hanging number, a title, then prose at 38 to 40em.
- Facts go in a ledger (`dl.ledger`) or a table (`.grid-table`). No card grids.
- Tables fold into labelled blocks under 46rem; exhibits fold on their own width (container queries), not on the viewport.
- One authored motion: a diagnosis "prints in" (`.is-new`). Nothing animates on scroll. `prefers-reduced-motion` removes it.
- No gradient, shadow or blur anywhere: the build fails if the stylesheet contains one.

## Where things live

```
site/
  build.mjs            the whole build (npm run site:build)
  serve.mjs            local preview with production headers (npm run site:preview)
  og.cjs               link-preview images, via the repo's Electron (npm run site:og)
  site.config.mjs      SITE_URL, empty until a domain is attached
  src/
    engine.ts          the app modules the previews borrow (bundled, never copied)
    demo.mjs           the invented demonstration account: the only made-up numbers
    data.mjs           view-models computed by the app's code, per language
    copy/fr.mjs|en.mjs every sentence of the site; `{{slots}}` are filled with facts read from the app
    exhibits/*.mjs     render(state, data) + reduce(state, action, data), shared by build and browser
    pages/*.mjs        shell (head, rail, footer), home, legal pages, link-preview card
    legal/*.html       the four legal texts, published as written
    styles/*.css       base (tokens, type), layout (the report), app (the previews)
    client/main.js     browser entry: mounts the exhibits, themes, rail, release lookup
    release.mjs        the release the download button points at
  public/              what Cloudflare serves: build output + fonts, favicon, icons
```

## What the build refuses

Run `npm run site:build`; it stops with a list when any of these is true:

- a sentence exists in one language only, or a `{{slot}}` has no value;
- a text/background pair of the palette is under 4.5:1, or ink, surface or accent no longer match the brief;
- the stylesheet contains a gradient, a shadow or a blur;
- a page prints an emoji, an official rank name, a place name from the game's universe, a bracketed placeholder (marketing pages), an unfilled slot, or the French elision glitch `d'trade`;
- a link or an asset reference leads nowhere, an id is duplicated, a page has no single `h1`, or the Riot Games notice is missing;
- the release metadata disagrees with `release/latest.yml` (when that file is present).

## After an app release

1. Copy version, file name, size and sha512 from `release/latest.yml` into `src/release.mjs`.
2. `npm run site:build`, check with `npm run site:preview`, then `cd site && npx wrangler deploy`.

Until then the page still follows the newest release on its own: the browser
asks GitHub once and repoints the button when a newer installer exists.

## Still to do by the publisher

- Fill the bracketed placeholders of the four legal pages (publisher name, address, contact). The build lists them.
- Attach a domain, set `SITE_URL` in `site.config.mjs`, rebuild: canonical links, absolute preview images and the sitemap appear.
