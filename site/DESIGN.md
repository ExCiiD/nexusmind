# Ascend showcase site — design and build notes

The site is the **"Vitrine v2"** designed in Penpot by the product owner
(pages "Vitrine v2 — Accueil", "— Entraînement solo", "— Environnement
d'équipe", 18 November 2026): a top bar, three pages (home, solo training, team
environment) in French and English, the app shown through captures and short
clips of its real screens, and a mini demonstration window at the top of each
product page. Everything below is what keeps it that way.

## Brief (pinned by the product owner, do not drift)

1. The Penpot "Vitrine v2" pages are the reference: condensed display type, hairline rules, one signal colour. The navigation has four items only: the brand, "Entraînement solo", "Environnement d'équipe", "Demander l'accès".
2. Nothing that reads as generated: no purple or blue gradient, no glow, no emoji, no vague marketing sentence.
3. Riot Games compliance: no Riot logo, no official splash art, no official rank name, the legal notice on every page.
   Champion names in text are allowed (confirmed by the publisher on 18 November 2026). Champion icons and other Riot art stay out, including in the captures (see Media).
4. The app's real screens, captured with a demonstration account; "Demander l'accès" leads to the invitation at the bottom of every page, with the download for those who already have a code.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0D0A06` | page |
| `--surface` | `#1C140C` | the team section, the invitation, capture frames |
| `--rule` / `--rule-strong` | `#3A2C18` / `#6B5330` | hairlines, frame borders |
| `--text-hi` | `#F5E3BE` | headings, lead, values |
| `--text` | `#B5A68C` | body |
| `--text-low` | `#978769` | labels, notes (4.5:1 on ink and surface) |
| `--accent` | `#D4A24C` | the only signal: primary button, section numbers, current page, list markers |

Since 18 November 2026 the app's default theme is this palette too (the
app's `src/index.css`): its borders are the two rules, its dim text is
`--text-low`, and gold is its only accent. The build checks that the app's
default theme and the site palette have not drifted apart.

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

## Logo

The mark is "A d'éclats" (chosen on 18 November 2026): a solid A whose top
bursts into gold fragments. It sits before "ASCEND" in the top bar, the footer,
the demonstration window's title bar and the link-preview card (`src/lib/mark.mjs`, the simplified version: the site only
shows it small). Trunk in `--text-hi`, fragments in `--accent`; never recoloured,
never moved apart, no glow. The favicon is the app icon (`public/favicon.svg`).
The masters, the app icon and the logotype are in the app's `src/assets/brand/`;
the React component is `src/components/Brand/AscendMark.tsx`.

## Structure rules

- Site chrome is square (radius 0) and flat. The captures keep the app's own 8 px boxes, which is how the two are told apart.
- A section is a hairline, a mono kicker ("01 — …"), a title, a lead at 40em.
- Features alternate text and capture; the first ones of a product page take the full width, their points beside the text.
- Facts go in a ledger (`dl.ledger`). Questions are `<details>`.
- Clips play only while on screen, never with `prefers-reduced-motion`, and each one has a pause control. The demonstration window plays its chapters in turn; a chapter chosen by hand stays.
- No gradient, shadow or blur anywhere: the build fails if the stylesheet contains one.

## Media

Every capture and clip comes from `site/capture.cjs`, which renders the app's
UI harness (`.harness/`, the `ui-harness` preview on port 5199, with its mock
data) off screen in the repo's Electron, plays the steps written in
`site/shots.cjs`, and writes `public/media/<id>.webp` (stills, and the poster
of each clip) and `<id>.mp4` (H.264, muted, made to loop). On the way it:

- shows a demonstration player ("Nova") and the released version instead of the harness's own names;
- swaps every Data Dragon picture (champion icons, spells, items) and every video thumbnail for a neutral tile in the app's colours, a champion keeping its initials;
- gives the recordings of the Record Hub thumbnails drawn from the app's schematic map;
- draws its own cursor, and hides scrollbars.

To redo them: start the `ui-harness` preview, then `npx electron site/capture.cjs`
(all of them) or `npx electron site/capture.cjs home-dashboard solo-lab` (some),
then `npm run site:build`. A still is twice the size the page shows it at, a
clip about one and a half times; the build reads the sizes from `shots.cjs`
and fails when a file is missing. Redo them after any visible change to a
captured screen.

## Where things live

```
site/
  build.mjs            the whole build (npm run site:build)
  serve.mjs            local preview with production headers and page addresses (npm run site:preview)
  og.cjs               link-preview images, via the repo's Electron (npm run site:og)
  capture.cjs          captures and clips of the app, via the repo's Electron (see Media)
  shots.cjs            what capture.cjs films: route, size, steps, per media file
  site.config.mjs      SITE_URL (empty means preview, not indexed) and the contact address
  src/
    engine.ts          the app modules the site borrows (bundled, never copied)
    data.mjs           facts read from the app's code, per language (counts quoted in the copy)
    copy/fr.mjs|en.mjs every sentence of the site; `{{slots}}` are filled with those facts
    pages/*.mjs        shell (head, top bar, invitation, footer), home, product (solo and team), legal, link-preview card
    lib/media.mjs      a capture or a clip; lib/tour.mjs the demonstration window
    exhibits/*.mjs     the interactive previews of the first site, no longer on a page (data.mjs still feeds the link-preview radar)
    legal/*.html       the four legal texts, published as written
    styles/*.css       base (tokens, type), layout (the pages), app (the old previews)
    client/main.js     browser entry: menu, clips, demonstration windows, release lookup
    release.mjs        the release the download button points at
  public/              what Cloudflare serves: build output, media, fonts, favicon, icons
```

## What the build refuses

Run `npm run site:build`; it stops with a list when any of these is true:

- a sentence exists in one language only, or a `{{slot}}` has no value;
- a text/background pair of the palette is under 4.5:1, or ink, surface or accent no longer match the brief;
- the stylesheet contains a gradient, a shadow or a blur;
- a page prints an emoji, an official rank name, a place name from the game's universe, a bracketed placeholder (marketing pages), an unfilled slot, or the French elision glitch `d'trade`;
- a link or an asset reference (a capture, a clip, its poster) leads nowhere, an id is duplicated, a page has no single `h1`, or the Riot Games notice is missing;
- an internal link names a `.html` file (Cloudflare would answer it with a redirect);
- a preview page is not marked `noindex`, or a public page is;
- a legal page still prints a bracketed placeholder while the site has a public address;
- the release metadata disagrees with `release/latest.yml` (when that file is present).

## After an app release

1. Copy version, file name, size and sha512 from `release/latest.yml` into `src/release.mjs`.
2. `npm run site:build`, check with `npm run site:preview`, then `cd site && npx wrangler deploy`.

Until then the page still follows the newest release on its own: the browser
asks GitHub once and repoints the button when a newer installer exists.

## Online

Preview: <https://ascend-site.nexusmind-riot-proxy.workers.dev> (Cloudflare worker `ascend-site`, online since 18 November 2026; it was called `nexusmind-site` for its first hours, and that address no longer answers).

The second part of the address, `nexusmind-riot-proxy`, is the workers.dev name of the whole Cloudflare account. The Riot proxy, the web app and the Discord bot live under it, and released versions of the app have those addresses built in, so it is not renamed. An address without it takes a custom domain.

- **Preview or public.** While `SITE_URL` is empty the site is a preview: every page carries a robots `noindex` meta tag and every response an `X-Robots-Tag: noindex` header, so it can be shared by link without being indexed with unfinished legal pages. `robots.txt` still allows the crawl on purpose: a crawler that may not fetch a page never reads its `noindex`.
- **Page addresses.** Cloudflare serves `conditions.html` at `/conditions` and answers `/conditions.html` with a redirect, so links, alternates and the sitemap use the short addresses. `serve.mjs` follows the same rules; `npx wrangler dev` inside `site/` runs Cloudflare's own emulator when in doubt.
- **Deploying.** `npm run site:build`, commit, then `cd site && npx wrangler deploy`. `site/public` is what goes online, so deploy from a clean checkout. `npx wrangler rollback` returns to the previous version.

## Still to do by the publisher

- Open the site to search engines: attach a domain (or keep the workers.dev address), set `SITE_URL` in `site.config.mjs`, rebuild and deploy. The `noindex` marks go away; canonical links, absolute preview images and the sitemap appear. On a custom domain, turn on "Always Use HTTPS" in Cloudflare.
- The publisher's details are in the four legal texts (`src/legal/*.html`) since 18 November 2026: publisher ExCiiD, Réunion (France), French law, a contact address. They are also in the app's own texts (`src/legal/*.md` at the repo root). A change of contact address is made in both places.
- The legal texts are a version 0.2 that no lawyer has reviewed.
