# NexusMind — Product Requirements Document

**Version:** 1.2  
**Date:** 2026-04-11  
**Status:** In Development

---

## 1. Vision & Objectives

NexusMind is a League of Legends self-coaching desktop application designed to help players improve through structured reviews, persistent objectives, detailed game statistics, and deterministic coaching rules in a local-first environment.

**Core problem:** Players want to improve but lack a repeatable workflow to set focus areas, review games, measure progress, and identify recurring mistakes without relying on scattered tools.

**Product direction:** NexusMind shifts from an AI-centered product to a business-rules-first product. The primary engine is built on sessions, reviews, KPI scoring, detailed stats, replays, and persistent filters. AI becomes an optional assistance layer, never a dependency for the main flow.

**Solution:** An always-on desktop companion that detects game ends, opens the right review context, links recordings, tracks fundamentals over time, and generates coaching insights from structured local data and deterministic heuristics.

---

## 2. Target Users

| Persona | Description |
|---|---|
| Ranked grinder | Player who wants a repeatable improvement loop across multiple solo queue games |
| Self-review player | Already reviews VODs or stats manually and wants one structured desktop workflow |
| Performance tracker | Wants detailed stats, progression snapshots, and role/account filtering in one place |
| Multi-account player | Uses multiple Riot accounts and wants one unified chronology with account-aware filters |
| External feedback seeker | Wants to export sessions or reviews to Discord or share replays for outside comments |

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | Electron 33 + electron-vite |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS (custom Hextech dark theme) + shadcn/ui |
| State management | Zustand |
| Local database | SQLite (local file) via Prisma ORM |
| Riot data | Riot Games REST API v5 (Match-v5, Summoner-v4, League-v4, Account-v1) |
| Game detection | Riot Live Client Data API (`localhost:2999`) |
| Charts | Recharts |
| Local sharing | Discord webhooks + clipboard export |
| Media capture | ffmpeg-based local recording |
| Unit tests | Vitest |
| E2E tests | Playwright |
| Packaging | electron-builder (Windows NSIS installer) + electron-updater |

**Optional assistance layer:** AI-backed helpers may remain available for selected insight features, but the product must remain fully usable without any model provider configured.

---

## 4. Security Architecture

- **Context isolation:** `contextIsolation: true`, `nodeIntegration: false` on all BrowserWindows
- **Typed IPC surface:** All renderer↔main communication via `contextBridge` with a strictly typed API object
- **Secrets management:** Any external credentials are loaded only in the Electron main process and are never exposed to the renderer
- **Input validation:** All IPC inputs and external URLs must be sanitized and validated before persistence or network calls
- **CSP headers:** Content Security Policy set via `session.defaultSession.webRequest` to block inline scripts and external resources
- **Local-first data ownership:** Reviews, sessions, accounts, recordings, and stats remain stored locally by default
- **No remote code execution:** Browser windows remain restricted to the typed preload surface and approved local protocols

---

## 5. Current Product Scope

### 5.1 Onboarding
- Connect Riot account (game name + tag + region)
- Link additional Riot accounts after onboarding
- Initial self-assessment grid for fundamentals
- Periodic reassessment reminder
- Account picker and active account persistence

### 5.2 Session System
- Create a session with 1 to 3 objectives
- Optional custom note
- KPI selection derived from the chosen objectives
- Objective/KPI memory per objective based on previous completed sessions
- "Same as last day" prefill from the most recent completed session
- Live sessions and retroactive sessions
- Session lock: one active session at a time
- Session history with outcome tracking
- Persistent queue filter (`soloq`, `flex`, `both`)

### 5.3 Game End Detection
- Polls `localhost:2999/liveclientdata/allgamedata` every 5 seconds
- Detects game state transition from active → ended
- Fetches match data from Match-v5 (KDA, CS, Vision Score, win/loss)
- Automatically creates or resolves the session game entry when possible
- Automatically opens the Review page only when a valid game row exists
- Supports multi-account resolution for recent matches

### 5.4 Post-Game Review Engine
- **Match stats display:** Champion, KDA, CS/min, Vision Score, win/loss
- **Timeline notes:** Timestamped freeform notes (format `M:SS`) for key moments
- **Dynamic KPI form:** Per-fundamental scored items (0–10) relevant to the selected session objectives
- **Freeform note:** Open reflection field
- **Objective binary:** Did you respect the session objective? Yes / No
- **Bias signal checks:** Deterministic warnings when high KPI scores conflict with detected gameplay evidence
- **Draft recovery:** Local autosave and restore while a review is in progress
- **Historic review mode:** Open a past game review directly from history or replays
- **Off-role handling:** Remove a live-session game from the session when it should not count toward the current focus
- Saves to local SQLite database

### 5.5 Analytics Dashboard
- Progress chart based on assessment bilans and live KPI timeline
- Independent filters for multiple analytics charts
- Persisted chart filters and selected time period
- Objective/category isolate-first filtering behavior
- Game history summary, objective success rate, streaks, XP, and badges
- Assessment-first access gate before analytics become available

### 5.6 Gamification
- XP system: earned per review submitted
- Streak counter: consecutive days with at least one review
- Badge unlocks (e.g., "First Review", "7-Day Streak", "Wave Master")
- Rank and progression events are surfaced through deterministic milestone logic

### 5.7 History & Stats
- Chronological multi-account game history
- Role filter with `main role only` option
- Account filter in history and detailed stats
- Detailed per-match stats pages
- Aggregated averages for recent matches
- Snapshots of detailed stats progression over time
- Main-role-aware stat filtering

### 5.8 Game Recording & Replays

**External and local replay support**
- Scan known video folders and match recordings to games by timestamp
- Manually link a local file to a game
- Store an optional YouTube URL per game
- Use a dedicated Replays page to browse all games with a recording

**Built-in capture**
- ffmpeg-based local recording
- Auto-record tied to game detection
- Manual start/stop recording when auto-record is disabled
- Recording quality, FPS, encoder, and folder settings
- Automatic link attempt from built-in recording to the resolved game

### 5.9 External Reviews
- Create reviews for games outside the user’s own history
- Two entry modes:
  - custom review with optional local video
  - external player history lookup
- Optional objective/KPI selection for external reviews
- Dedicated external review list and detail pages

### 5.10 Sharing
- Share sessions and reviews to Discord via webhooks
- Support multiple saved webhooks
- Fallback text export to clipboard when webhook delivery is unavailable
- Embed payload sanitization to respect Discord limits

### 5.11 Deterministic Insight Engine

NexusMind now prioritizes deterministic rule-based insights over model-generated coaching.

| Capability | Rule-based source of truth |
|---|---|
| Objective suggestion | Latest assessment weakness + recent session history + objective frequency |
| Review insight | Objective respected flag + KPI averages + lowest KPIs + timeline notes + free text |
| Pattern detection | Repeated low KPIs + repeated objectives + repeated review signals over recent sessions |
| Session summary | Game count + winrate + review completion + KPI averages + objective adherence |
| Off-role warning | Current game role compared to configured `mainRole` |
| Bias warning | KPI self-rating compared to deterministic gameplay signals |

---

### 5.9 Game Recording

#### Phase 1 — Import from external tools + YouTube embed (implemented)

**Import logic**
- On startup or manual scan trigger, the app scans known output folders:
  - Outplayed: `%LOCALAPPDATA%\Outplayed\Videos\League of Legends\`
  - InsightCapture: `%APPDATA%\InsightCapture\recordings\`
  - OBS: `%USERPROFILE%\Videos\` (default)
- Video files (`.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.flv`) are matched to games by timestamp: recording file birth time vs `gameEndAt`, within a ±10-minute window.
- Matched recordings are automatically linked in the local `Recording` table.
- Users can also manually link a file via file picker dialog or attach a YouTube URL.

**Recording panel (Review page)**
- If a game has a local `filePath`: an HTML5 `<video>` player is shown above the review form (collapsible).
- If a game has a `youtubeUrl`: a YouTube iframe embed is shown instead.
- If no recording exists: the review form shows as-is (no change in behavior).
- "Add Recording" section lets users link a file or paste a YouTube URL at any time.

**History page**
- Games that have a recording show a small camera icon in the game row.

**Replay library**
- The replay library is a dedicated page listing all games that already have a local or external recording attached.
- Each replay entry exposes the linked game context so the player can jump directly into the correct review flow.

**Built-in recording**
- Built-in recording is part of the current product scope.
- Recording can start automatically from game detection or manually from Settings.
- Capture settings are user-configurable and stored locally.

---

## 6. Fundamentals Matrix

All fundamentals are stored in `src/lib/constants/fundamentals.ts` as a typed constant.

### 6.1 Wave Management
| Subcategory | Key KPIs |
|---|---|
| Last-hitting | CS/min, CS@10, CS@15, gold efficiency |
| Freeze | Duration maintained, proximity to tower, opponent denied |
| Slow push | Wave size before roam, tower plates taken |
| Fast push | Push speed, rotation timing |
| Crash & reset | Tower damage, recall timing |
| Counter-jungler crash | Coordination with jungler, dragon/baron setup |

### 6.2 Vision Control
| Subcategory | Key KPIs |
|---|---|
| Ward placement | Vision score, wards placed/game, coverage of key zones |
| Control ward usage | CW purchased, CW placed in objectives |
| Sweeping | Enemy wards cleared, sweeper timing |
| Map awareness | Reaction time to pings, tracking unseen enemies |
| Objective vision | Ward placed before drake/baron, prior timer setup |

### 6.3 Trading & Combat
| Subcategory | Key KPIs |
|---|---|
| Trade patterns | Kill participation, trade efficiency (damage dealt/taken) |
| All-in timing | Kill conversion rate, correct all-in windows |
| Poke vs sustain | Harass consistency, sustain resource management |
| Ability sequencing | Combo execution, cooldown management |
| Kill/death efficiency | KDA, death count, death context (solo vs team) |

### 6.4 Map Movements & Rotations
| Subcategory | Key KPIs |
|---|---|
| Roaming | Kills/assists post-roam, wave state before roam |
| TP usage | TP cooldown efficiency, TP arrival timing |
| Proxy farming | CS gained, map pressure created |
| Pressure without kills | Objective take rate after kill, side lane pressure |
| Cross-map impact | Assists in other lanes, herald/dragon participation |

### 6.5 Objective Control
| Subcategory | Key KPIs |
|---|---|
| Dragon | Drake participation rate, drake soul secured |
| Baron | Baron attempt rate, baron secured/stolen |
| Rift Herald | Herald secured, plates taken post-herald |
| Timer tracking | Objective timer accuracy, rotation lead time |
| Smite accuracy | Smite success rate (jungler) |

### 6.6 Team Coordination
| Subcategory | Key KPIs |
|---|---|
| Engage/disengage | Initiation success rate, peel effectiveness |
| Peel | Damage prevented, ADC/carry survival rate |
| Follow-up | Reaction time to engage, kill conversion |
| Communication | Ping usage, call timing |
| Win condition focus | Time spent on win condition vs aimless play |

### 6.7 Mental & Decision Making
| Subcategory | Key KPIs |
|---|---|
| Tilt resistance | Performance drop after death, consistency across game length |
| Focus under pressure | Decision quality in high-stress situations |
| Win condition clarity | Correct macro decision-making (split vs group) |
| Game tempo | Lead conversion rate, avoiding overextension |
| Surrender vote discipline | Refusing FF in winnable games |

### 6.8 Champion Mastery
| Subcategory | Key KPIs |
|---|---|
| Mechanics | Ability hit rate, skill shot accuracy |
| Matchup knowledge | Trading correctly vs specific champions |
| Power spike awareness | Timing fights around item/level spikes |
| Adaptation | Build adjustments based on enemy comp |
| Positioning | Deaths to ganks, positioning in team fights |

### 6.9 Resource Management
| Subcategory | Key KPIs |
|---|---|
| Gold efficiency | Item completion time, gold unspent at death |
| Mana/energy management | Resource % at key fight moments |
| Cooldown tracking | Fighting with key abilities available |
| HP management | HP% when committing to fights |
| Recall timing | Recalls on full wave, minimal lost gold |

### 6.10 Laning Phase Fundamentals
| Subcategory | Key KPIs |
|---|---|
| Level 1 setup | Invade/level participation, bush control |
| Level 2 advantage | First level 2 achievement, kill opportunity exploitation |
| Early jungle tracking | Correct tracking of jungler path |
| 3/4 man dive avoidance | Deaths to ganks, safe positioning under tower |
| First blood pressure | Aggression window usage at level 1–3 |

---

## 7. Data Model

NexusMind is local-first. The production data model centers on the following local entities:

| Entity | Purpose |
|---|---|
| `User` | Active player identity, preferences, queue filter, main role, recording preferences, external recording path |
| `Account` | Additional linked Riot accounts used for multi-account history and stat aggregation |
| `Assessment` / `AssessmentScore` | Baseline and recurring self-evaluations used as progression anchors |
| `Session` | Coaching unit with objective set, KPI selection, note, date, status, and session conclusion |
| `Game` | Imported or auto-detected Riot match attached to a session |
| `Review` | Structured post-game evaluation: timeline notes, KPI scores, free text, objective respected |
| `Recording` | Local file path or YouTube URL linked to a game |
| `GameDetailedStats` / snapshots | Aggregated and per-game detailed stat storage for progression views |
| `ExternalReview` | Review object for custom or third-party player analysis |
| `DiscordWebhook` | Saved named webhooks for sharing flows |
| `Badge` | Gamification unlocks derived from deterministic product events |

### Business Rules on Stored Data
- Sessions are the primary coaching container.
- Games, reviews, and recordings are always subordinate to a resolved session or explicit external review context.
- KPI scores use a `0–10` scale consistently across assessments, reviews, and analytics.
- Recordings are stored locally; the database stores metadata and references, not the media itself.
- The local database is the source of truth for all coaching workflows.

---

## 8. IPC API Surface

All communication between renderer and main process goes through `window.api` (contextBridge). Full type definitions in `src/lib/ipc.ts`.

### Core

| Method | Description |
|---|---|
| `connectRiot(gameName, tagLine, region)` | Look up account via Riot API, create/update User |
| `disconnectRiot()` | Delete user record, return to onboarding |
| `getUser()` | Fetch current user from DB |
| `updateUser(data)` | Update user fields |
| `createSession(data)` | Create new session with 1–3 objectives and selected KPIs |
| `getActiveSession()` | Fetch current open session |
| `getLastSessionConfig()` | Fetch the latest completed session config for prefill |
| `getKpiHistory()` | Fetch completed session objective/KPI history for KPI memory |
| `endSession(id)` | Close session and persist the session conclusion |
| `deleteSession(id)` | Delete session and all child records |
| `deleteGame(gameId)` | Remove a game from the current session when it should not count |
| `setGameReviewStatus(gameId, status)` | Move a game between review queue states |
| `saveReview(data)` | Save post-game review to the local database |
| `getReviews(sessionId)` | Fetch all reviews for a session |
| `getGameContext(gameId)` | Fetch a historic game and its session context |
| `analyzeReviewBias(gameId, objectiveIds)` | Bias signal detection from match timeline |
| `saveAssessment(scores)` | Save self-assessment scores |
| `getLatestAssessment()` | Fetch most recent assessment |
| `getAssessmentHistory()` | Fetch all assessments |
| `getProgressData()` | Aggregate score trends per fundamental |
| `getSessionStats()` | Objective success rate, game counts |
| `getGameHistory(limit)` | Recent games with stats |
| `getKpiTimeline()` | Aggregate completed-session KPI scores into analytics timeline points |
| `getObjectiveSuggestion(scores)` | Optional assistant capability; deterministic replacement preferred |
| `synthesizeReview(data)` | Optional assistant capability; deterministic replacement preferred |
| `analyzePatterns(reviews)` | Optional assistant capability; deterministic replacement preferred |
| `generateSessionSummary(sessionId)` | Optional assistant capability; deterministic replacement preferred |
| `listAccounts()` | List linked secondary Riot accounts |
| `addAccount(gameName, tagLine, region)` | Link a secondary Riot account |
| `removeAccount(accountId)` | Remove a secondary account |
| `getMatchHistoryWithStatus(count)` | Multi-account history with import/review status |
| `getDetailedStats(matchId)` | Per-match detailed stat breakdown |
| `getStatsSnapshots()` | Detailed stat progression snapshots |
| `getAccountAverages(puuid)` | Recent detailed stat averages filtered by account |
| `onGameEnd(callback)` | Subscribe to automatic game-end events |
| `minimizeWindow()` / `maximizeWindow()` / `closeWindow()` | Window controls |

### Recording

| Method | Description |
|---|---|
| `scanRecordings()` | Scan Outplayed/InsightCapture/OBS folders and auto-match to games |
| `getRecording(gameId)` | Fetch recording row for a game |
| `linkRecordingFile(gameId)` | Open file picker and link a video file to a game |
| `setYoutubeUrl(gameId, url)` | Attach a YouTube URL to a game |
| `deleteRecording(gameId)` | Remove recording link from a game |
| `getRecordingScanPaths()` | Return known scan paths and whether they exist |
| `listGamesWithRecordings()` | Return the replay library with linked game metadata |
| `pickRecordingFolder()` | Choose a local recordings folder |
| `getCaptureStatus()` | Return current in-app capture state |
| `startCapture()` / `stopCapture()` | Control local ffmpeg recording |

### External Review & Sharing

| Method | Description |
|---|---|
| `fetchExternalPlayerHistory(...)` | Fetch match history for an external player |
| `createExternalReview(data)` | Create a custom or external-player review |
| `getExternalReview(id)` / `saveExternalReview(id, data)` | Read and update external reviews |
| `listExternalReviews()` / `deleteExternalReview(id)` | Manage the external review library |
| `sendToDiscord(embeds, webhookUrl)` | Send structured share payloads to Discord |
| `copyReviewText(text)` | Copy a text fallback to the clipboard |
| `listWebhooks()` / `addWebhook()` / `renameWebhook()` / `deleteWebhook()` | Manage saved Discord webhooks |

---

## 9. Environment Configuration

All configuration lives in `.env` at the project root:

```env
DATABASE_URL="file:../dev.db"
MAIN_VITE_RIOT_API_KEY="RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
MAIN_VITE_OPENAI_API_KEY="sk-..."   # optional
GH_TOKEN="github_pat_..."           # optional, release/publish only
```

- `MAIN_VITE_*` variables are injected into the Electron main process at build time by electron-vite
- They are **never** exposed to the renderer process
- Riot development keys expire every 24 hours — regenerate at [developer.riotgames.com](https://developer.riotgames.com)
- AI credentials are optional and must never gate the core coaching workflow

---

## 10. UI/UX Design

### Theme: Hextech Dark
Custom Tailwind color palette inspired by League of Legends' Hextech UI:

| Token | Hex | Usage |
|---|---|---|
| `hextech-black` | `#010A13` | Page backgrounds |
| `hextech-dark` | `#0A1628` | Sidebar, cards |
| `hextech-elevated` | `#1E2D40` | Hover states, inputs |
| `hextech-border` | `#785A28` | Primary borders |
| `hextech-border-dim` | `#1E2D40` | Subtle borders |
| `hextech-gold` | `#C8AA6E` | Primary accent |
| `hextech-gold-bright` | `#F0E6D2` | Headings, highlights |
| `hextech-cyan` | `#0BC4E3` | Secondary accent, XP bar |
| `hextech-teal` | `#0397AB` | Gradient partner to cyan |
| `hextech-green` | `#0ACE83` | Success, active states |
| `hextech-red` | `#FF4655` | Errors, danger |
| `hextech-text` | `#A09B8C` | Body text |
| `hextech-text-dim` | `#5B5A56` | Placeholders, metadata |
| `hextech-text-bright` | `#F0E6D2` | Primary content |

### Navigation
- Persistent left sidebar (width: 256px) with nav links and user profile footer
- Titlebar: hidden native, replaced with custom drag region + window controls
- Pages: Dashboard, Session, Replays, Review, History, Stats, Analytics, Settings
- Review supports both standard reviews and external review flows

### Key UX Principles
- **Speed of review entry:** The review form must be completable in under 2 minutes
- **Post-game focus:** Window auto-focuses when a game ends
- **Business-rules first:** Core insight surfaces must have a deterministic fallback and should prefer deterministic logic by default
- **Progressive disclosure:** Optional AI assistance degrades gracefully if no provider key is configured

---

## 11. Testing Strategy

### Unit Tests (Vitest)
Located in `tests/unit/`. Coverage targets:

| Module | What's tested |
|---|---|
| `fundamentals.ts` | Structure completeness, all IDs unique, all categories present |
| `gameDetector.ts` | State machine transitions (idle→active→ended), error resilience |
| `riotClient.ts` | Rate limiter logic, region routing mapping, URL construction |
| `openaiClient.ts` | Prompt construction, error handling |
| `validation.ts` | Zod schemas — valid and invalid inputs |
| `utils.ts` | KDA formatter, XP/level calculator, CS/min computation |

**Target:** 48+ unit tests, all passing.

### E2E Tests (Playwright)
Located in `tests/e2e/`. Stub structure for:
- Onboarding flow (connect account → assessment → dashboard)
- Session creation and game end detection trigger
- Review form submission
- Analytics page data rendering
- Disconnect and re-onboard flow

---

## 12. Build & Distribution

### Development
```bash
npm run dev          # electron-vite dev server + hot reload
npm run test         # vitest unit tests
npm run test:e2e     # playwright E2E tests
```

### Production
```bash
npm run build        # electron-vite production build
npm run dist         # electron-builder → NSIS installer
```

### Output
- Windows NSIS installer: `dist/NexusMind-Setup-{version}.exe`
- Auto-update via `electron-updater` (update feed URL configurable in `electron-builder.yml`)

---

## 13. Out of Scope (v1.x)

- Mac/Linux builds (Windows only)
- Support for other Riot games (TFT, Valorant)
- Paid subscription or in-app purchases
- Cloud coach/student collaboration layer
- Mobile companion app
- Real-time live coaching during an active match
- Full champion guide knowledge base and matchup engine
- Large-scale VOD ingestion and automatic champion matchup dossier generation

---

## 14. Business Rules First Strategy

### 14.1 Product Rule
The product must remain fully operational without AI. Sessions, reviews, analytics, history, detailed stats, recordings, external reviews, and Discord sharing must all work using structured local data and deterministic rules.

### 14.2 Deterministic Source of Truth
- `Assessment` data defines baseline strengths and weaknesses.
- `Session` data defines active coaching focus.
- `Review` data defines per-game evaluation.
- `KPI` scores define measurable execution quality on a `0–10` scale.
- `GameDetailedStats` and snapshots define factual performance metrics.
- `Recording` links define evidence and replay access.
- `Account` and `mainRole` filters define aggregation scope.

### 14.3 Current Business Rules

#### Accounts and scope
- A user may have one primary Riot account and multiple linked accounts.
- Aggregated history must remain chronologically ordered across all linked accounts.
- Statistics views must offer `main account`, `all accounts`, and specific secondary account filtering.

#### Main role
- `mainRole` is a global coaching filter.
- It impacts history filters, detailed stats aggregation, and live-session off-role warnings.

#### Sessions
- A session requires at least one objective and supports up to three.
- The available KPIs are derived from the selected objectives.
- The last known KPI selection for an objective should be reused when that objective is selected again.
- If an objective has never been used before, all of its KPIs may be selected by default.
- The latest completed session may be reused as a prefill template.

#### Reviews
- A review must be tied to a valid game context or an explicit external review context.
- Review state consists of timeline notes, KPI scores, free text, and objective adherence.
- Review drafts are recoverable locally until the review is saved.

#### Analytics
- Analytics require at least one assessment as baseline.
- Chart filters must persist across navigation.
- Objective and category filters must support isolate-first behavior.
- KPI session data may extend progression charts, but bilans remain the default reference for comparison views.

#### Recordings
- Recordings are local artifacts linked to games by metadata and timing.
- Auto-recorded files should link to their resolved game whenever possible.
- The replay library is a filtered view of games that already have a recording.

#### Sharing
- Discord sharing must be generated from structured local data.
- If webhook delivery fails, a text fallback must remain available.

### 14.4 AI Degradation Policy
If an AI-backed capability exists, a deterministic fallback must also exist.

| Capability | Deterministic fallback |
|---|---|
| Objective suggestion | Weakest assessment fundamentals + recent focus history |
| Review summary | Objective result + KPI averages + lowest KPIs + timeline note count + free text |
| Pattern detection | Repeated low KPIs and repeated review signals across recent sessions |
| Session summary | Game count + winrate + review completion + KPI average + objective adherence |

### 14.5 Future Major Update
The `Champion Guides + Matchup Engine` initiative remains a future major update. It will be implemented as a structured knowledge system based on `champion + role + patch`, then connected to a deterministic matchup comparison engine. It is intentionally excluded from the current scope while the local-first coaching workflow is consolidated.

---

## 15. Product Roadmap

### 15.1 Current

The current product scope focuses on the complete local coaching loop:

- Riot account onboarding and multi-account support
- Initial assessment and reassessment flows
- Session creation with objective and KPI selection
- Objective memory and "same as last day" session prefill
- Live game-end detection and review opening
- Structured post-game reviews with timeline notes, KPI scores, and free text
- Local draft recovery while a review is in progress
- Recording linking, replay browsing, and built-in local capture
- History, analytics, detailed stats, and progression snapshots
- External reviews for non-owned games or external players
- Discord sharing via webhooks plus clipboard fallback

### 15.2 Next

The next product iteration should deepen the deterministic coaching engine without increasing operating cost significantly:

- Rule-based objective recommendation using assessment weakness + recent session repetition
- Rule-based review summary generated from KPI scores, objective adherence, timeline notes, and free text
- Rule-based recurring pattern detection across recent reviews and sessions
- Session quality and completion scoring
- Review completion states and review queue improvements
- Persistent filters across all list and analytics views
- Coaching cards generated from deterministic heuristics rather than model output

### 15.3 Future Major Update

Future major updates include knowledge-heavy systems that require new ingestion and maintenance pipelines:

- Champion guide knowledge base structured by `champion + role + patch`
- Matchup engine comparing two structured champion profiles
- Matchup-specific recommendations backed by current-patch data
- Large-scale guide, stats, and VOD ingestion workflows

### 15.4 Out of Scope for Now

- Real-time live coaching during an active match
- Full cloud collaboration layer
- Social discovery or marketplace mechanics
- Support for games outside League of Legends

---

## 16. Functional Requirements

### 16.1 Onboarding and Accounts

- The application must allow a player to create a local user profile from a Riot account lookup.
- The application must allow linking additional Riot accounts after onboarding.
- The application must persist the active user identity and linked accounts locally.
- The application must support switching aggregation scope between main account, all accounts, and specific linked accounts where relevant.

### 16.2 Assessments

- The application must allow a player to complete an initial assessment before accessing analytics.
- The application must persist assessment scores historically.
- The application must use assessment data as the baseline reference for progression charts and rule-based recommendations.

### 16.3 Sessions

- The application must allow creating a session with 1 to 3 objectives.
- The application must derive the available KPI list from the selected objectives.
- The application must persist selected KPIs as part of the session configuration.
- The application must allow both live and retroactive session creation.
- The application must prevent multiple active sessions at the same time.
- The application must support pre-filling a new session from the most recent completed session.
- The application must restore the most recent KPI selection per objective whenever an already-used objective is selected again.

### 16.4 Live Detection and Game Intake

- The application must detect the end of a League of Legends match from the Live Client API.
- The application must resolve the most recent match across linked accounts when possible.
- The application must create or attach the correct game row to the active session after detection.
- The application must open the review flow only if a valid game context exists.
- The application must allow removing an automatically added off-role game from the active session.

### 16.5 Review Flow

- The application must support reviewing the current session game and historic games.
- The application must persist timeline notes, KPI scores, objective adherence, and free text.
- The application must autosave review drafts locally until the review is saved.
- The application must restore a local draft if no saved review exists yet.
- The application must display deterministic bias warnings when score patterns conflict with gameplay evidence.

### 16.6 Recordings and Replays

- The application must allow linking a local video file to a game.
- The application must allow attaching a YouTube URL to a game.
- The application must scan configured folders and attempt to auto-match recordings to games by timestamp.
- The application must support built-in local recording via ffmpeg.
- The application must expose a replay library for all games that already have a linked recording.

### 16.7 External Reviews

- The application must allow creating a custom external review with an optional video.
- The application must allow creating a review from an external player’s match history.
- The application must persist external reviews separately from standard session reviews.
- The application must expose a list view for saved external reviews.

### 16.8 History, Analytics, and Detailed Stats

- The application must expose a chronological multi-account game history.
- The application must support role-based filtering, including `main role only`.
- The application must expose analytics filters that persist across navigation.
- The application must support progression views based on both assessments and session KPI data.
- The application must expose detailed stats per match and aggregated detailed stats over recent games.
- The application must support account-scoped detailed stat aggregation.

### 16.9 Sharing

- The application must allow sharing sessions and reviews to Discord via webhook.
- The application must store multiple named webhook configurations locally.
- The application must provide a clipboard text fallback when webhook delivery fails.
- The application must sanitize outgoing embed payloads to respect Discord limits.

---

## 17. Non-Functional Requirements

### 17.1 Reliability

- The main coaching loop must continue to work without any AI provider configured.
- Failures in optional integrations must not block session creation, review saving, analytics, or history browsing.
- Local persistence failures must surface actionable error states to the user.

### 17.2 Performance

- Opening the Review page after a resolved live game should feel immediate and should not require manual refresh.
- History, analytics, and stats pages should remain responsive under multi-account usage and growing local history.
- Built-in recording should prioritize low performance impact on the user machine.

### 17.3 Data Integrity

- All user-generated coaching data must remain stored locally by default.
- Derived analytics must remain consistent with the persisted KPI scale and current filters.
- Multi-account and role-aware aggregations must remain deterministic and reproducible.

### 17.4 Security

- Secrets must never be exposed to the renderer process.
- Local file access must remain restricted to validated user actions or approved local workflows.
- Shared payloads must not contain hidden secrets or unsafe user-provided markup.

### 17.5 Product Cost Control

- Core insight generation should prefer deterministic heuristics over paid model inference.
- AI-backed features, when present, must be optional and degradable.
- New features that require recurring external inference costs must justify their product value explicitly.

---

## 18. Success Metrics

### 18.1 Activation

- Percentage of new users who complete onboarding and first assessment
- Percentage of onboarded users who create a first session
- Percentage of users who complete at least one full review

### 18.2 Core Usage

- Reviews completed per active user per week
- Sessions completed per active user per week
- Share of sessions that end with at least one completed review
- Share of reviewed games with a linked recording

### 18.3 Product Quality

- Live session game-end detection success rate
- Auto-link rate for built-in recordings
- Review draft recovery success rate
- Discord share success rate
- Crash-free session rate

### 18.4 Coaching Depth

- Average number of KPI scores filled per review
- Percentage of sessions using repeated objectives intentionally
- Percentage of users returning to analytics after at least two completed sessions
- Percentage of users using account, role, or objective filters

### 18.5 Cost Efficiency

- Percentage of coaching insights generated without AI
- External inference calls per active user per week
- Average external inference cost per retained active user
