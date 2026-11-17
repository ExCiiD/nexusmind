# Session handoff — 2026-11-17 (updated end of day)

Read this, then `docs/INBOX.md` and the memory index, before doing anything else.

## Done on 17/11 (beta.107, see ROADMAP « Phase U »)

Dashboard restyle, role-aware fundamentals radar (laner 9 KPIs / support 9 KPIs),
Stats « Analyse » tab, appearance (8 themes, backgrounds, color filter, live
preview), player profile (`/profile`: card, tiers, icons, 24 titles).
The « compare against a followed player » option stays a **roadmap item**
(user's call): its backend (`FollowedPlayer`, `stats:*-followed-player`) is in
place, no UI.

## Still open

1. **Redesign** — user picked A's visual style + B's « ateliers » content
   (no player-card pitch). Showcase site built in `site/` (see PLAN_VITRINE
   status); needs publisher/contact/domain placeholders filled, deploy, then
   the Riot Production key application. Applying direction A to the app +
   web is still to do. beta.107 is released (GitHub pre-release).
2. **Bug: infinite loading screen / can't log back in after logging out** —
   not investigated yet. Ask desktop vs web and repro steps. Start at
   `web/src/api.ts`, `web/src/pages/AccountPage.tsx`,
   `electron/main/ipc/auth.ipc.ts` and the desktop Supabase session restore;
   check git log for the earlier « correctif d'authentification ».
3. Local dev.db has older migration drift (missing indexes/columns) — never run
   `prisma migrate dev` here; hand-write SQL. Flag once, don't fix unasked.

## Tooling notes

- `.harness/` (git-excluded locally) is a Vite preview harness rendering real
  pages with a mocked `window.api` — `ui-harness` in the parent
  `D:\DEV\NexusMind\.claude\launch.json`. Use it to screenshot renderer work.
- ESLint now ignores `.claude/**` (vendored skill scripts broke `npm run lint`).

Delete this file once item 2 is resolved and the direction is chosen.
