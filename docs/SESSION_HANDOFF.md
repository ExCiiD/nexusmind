# Session handoff — 2026-11-17

Context for a fresh session picking up "Ascend" (NexusMind) after the previous
one (5 days, 7 auto-compactions) got unwieldy. Read this, then
`docs/INBOX.md` and `C:\Users\ariso\.claude\projects\D--DEV-NexusMind\memory\MEMORY.md`
(and its linked files) before doing anything else. Greet the user and ask
for Task 3's details before touching Task 1/2 code.

## Task 1 — finish the "compare radar against a followed player" feature (in progress, uncommitted)

Dashboard feature: the "Empreinte des fondamentaux" radar card compares the
user's recent form (15 games) against a snapshot (40 games).
`docs/ROADMAP.md`'s "Idées complémentaires" section (entry dated 17/11/2026)
asked to let the user swap the snapshot side for a *chosen other player's*
last 40 solo/duo games.

Already done (uncommitted — check `git status`):
- `prisma/schema.prisma`: new `FollowedPlayer` model (id, userId, gameName,
  tagLine, region, puuid, lastUsedAt, createdAt; unique on [userId, puuid]).
- `prisma/migrations/20261117000000_add_followed_player/migration.sql`:
  hand-written (NOT via `prisma migrate dev` — that wanted to run
  `prisma migrate reset` on this dev.db due to pre-existing, unrelated
  migration-history drift predating this work; the destructive reset was
  correctly avoided). Applied directly via the sqlite3 CLI at
  `/c/Users/ariso/AppData/Local/Microsoft/WinGet/Packages/Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe/platform-tools/sqlite3`,
  and tracked in `_prisma_migrations`. That pre-existing drift (indexes/
  columns the live dev.db is missing vs. what later migration files say it
  should have) is a separate, older issue — flag it to the user once, don't
  try to fix it here.
- `electron/main/ipc/stats.ipc.ts`: added `fetchDetailedStatsForMatches()`
  helper (shared match-fetch-and-extract loop, refactored out of
  `stats:get-fundamentals-radar`), extended that handler to accept an
  optional `followedPlayerId` arg (swaps the snapshot series only —
  `recent` always stays the user's own form), and added
  `stats:list-followed-players`, `stats:add-followed-player` (gameName,
  tagLine, region → resolves puuid via `getAccountByRiotId`, upserts by
  [userId, puuid] so a later name change doesn't break it),
  `stats:remove-followed-player`.

Still needed:
1. `src/lib/ipc.ts`: add the 4 methods to the `Api` interface
   (`getFundamentalsRadar` already exists — give it an optional
   `followedPlayerId?: string` param; add `listFollowedPlayers`,
   `addFollowedPlayer`, `removeFollowedPlayer`).
2. `electron/preload/index.ts`: wire the 4 methods via
   `ipcRenderer.invoke(...)`, same pattern as the existing
   `getFundamentalsRadar` line.
3. UI in `src/pages/Dashboard/DashboardPage.tsx`'s `FundamentalsRadarCard`:
   a selector ("Comparer à : Moi (snapshot) / <pseudo>") with a way to add
   a new followed player. Reuse the gameName/tagLine/region form pattern
   already in `src/pages/Onboarding/RiotConnectStep.tsx` (Input + Input +
   shadcn `Select` from `regionDisplayNames` in `src/lib/validation.ts`) —
   don't reinvent it. On success, call
   `window.api.getFundamentalsRadar(selectedFollowedPlayerId)`;
   `data.snapshotLabel` (already returned by the handler) should show
   instead of "Snapshot (N games)" when a followed player is selected.
4. i18n: add French+English keys under `dashboard.radar.*` in
   `src/i18n/locales/{en,fr}.json`; run `npm run check:i18n`.
5. `npm run typecheck && npm run lint && npm test` must pass.
6. Update `docs/ROADMAP.md` (mark that entry shipped) and
   `docs/PLAN_GESTION_EQUIPE.md` if relevant.
7. Version bump (`package.json`, currently `0.2.0-beta.106` → beta.107) and
   commit, matching this project's existing commit-message style (check
   recent `git log`).

## Task 2 — investigate and fix: infinite loading screen + can't log back in after logging out

User reported this verbally; no screenshot/repro steps survived in the
transcript. Ask for more detail if needed (desktop vs web, which account).
Likely a stale Supabase session/token not cleared on sign-out, or a race in
auth-state-restore. Start at `web/src/api.ts` and
`web/src/pages/AccountPage.tsx` (both reference signOut/logout, already
located but not yet read), and the Electron-side equivalent (likely
`electron/main/ipc/auth.ipc.ts` and however the desktop app persists/
restores a Supabase session across restarts). This project fixed a
similarly-described Supabase auth issue earlier in its history — check git
log / old session content for "correctif d'authentification" for prior
art, and determine whether this is a regression or a new case (e.g.
specific to logout→relogin, not cold start).

## Task 3 — ask the user for missing details on a UI upgrade request, don't guess

The user described wanting background/theme/icon/pop-up changes that an
exhaustive multi-day transcript search could not find anywhere — it most
likely never reached the previous session. Ask directly what they want
changed (background image/style? which icons? which dialogs, and how?).
Note: 4 color themes (hextech/piltover/noxus/void) already shipped in
Settings — don't confuse that with this separate ask.

## Process notes carried over

- Bash/PowerShell operates on this real project directory correctly, but
  anything affecting global/system state on the user's real machine
  (global npm installs, env vars, PATH, interactive CLI auth) must go
  through the Terminal-panel tools (`run_in_terminal` etc.), not
  Bash/PowerShell.
- Don't run `prisma migrate dev` in this repo (see Task 1 note on
  drift/reset) — hand-write migration SQL and apply via the sqlite3 CLI
  path above, or ask the user first.
- This repo has ~37 vendored skills under `.claude/skills/` (real
  third-party ones) plus a precedence table in `using-superpowers`'s
  SKILL.md: invoke at most one skill per overlap cluster (design/UI,
  delegation), not several stacked. Don't author new self-authored skills.
- Given the user's frustration this session, prefer brief check-ins at
  real decision points over silently guessing or repeating the same
  explanation multiple times.

Delete this file once its tasks are done — it's a one-time handoff note,
not a permanent doc (unlike `docs/INBOX.md`, which stays).
