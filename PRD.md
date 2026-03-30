# NexusMind — Product Requirements Document

**Version:** 1.1  
**Date:** 2026-03-30  
**Status:** In Development

---

## 1. Vision & Objectives

NexusMind is a League of Legends self-coaching desktop application designed to help players improve in a structured, data-driven way. It centralizes Riot API statistics, self-assessment, objective tracking, and AI-powered analysis in a single offline-first environment.

**Core problem:** Players want to improve but lack a structured way to identify weaknesses, set objectives, and track progress across games.

**Solution:** An always-on desktop companion that automatically detects game ends, prompts a structured post-game review, tracks fundamentals over time, and provides AI coaching synthesis.

---

## 2. Target Users

| Persona | Description |
|---|---|
| Ranked grinder | Iron–Diamond player who plays 3–10 games/week and wants structured improvement |
| Self-aware player | Already watches VODs or reads guides; wants to quantify and track weak areas |
| Stat tracker | Wants KDA, CS, Vision Score, and win rate data without switching between websites |
| Student | Wants structured feedback from a coach; shares data and recordings via invite link |
| Coach | Coaches one or more students remotely; reviews their sessions and leaves comments |

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | Electron 33 + electron-vite |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS (custom Hextech dark theme) + shadcn/ui |
| State management | Zustand |
| Local database | SQLite (local file) via Prisma ORM |
| Cloud backend | Supabase (PostgreSQL + Auth + RLS) — coach/student sharing layer |
| AI | OpenAI GPT-4o (official SDK) |
| Riot data | Riot Games REST API v5 (Match-v5, Summoner-v4, League-v4, Account-v1) |
| Game detection | Riot Live Client Data API (`localhost:2999`) |
| Charts | Recharts |
| Unit tests | Vitest |
| E2E tests | Playwright |
| Packaging | electron-builder (Windows NSIS installer) + electron-updater |

---

## 4. Security Architecture

- **Context isolation:** `contextIsolation: true`, `nodeIntegration: false` on all BrowserWindows
- **Typed IPC surface:** All renderer↔main communication via `contextBridge` with a strictly typed API object
- **API keys:** Loaded from `.env` at build time via electron-vite's `MAIN_VITE_*` env prefix — never exposed to the renderer process
- **Input validation:** Zod schemas on all IPC inputs (summoner name, tag, region, review fields)
- **CSP headers:** Content Security Policy set via `session.defaultSession.webRequest` to block inline scripts and external resources
- **No remote code execution:** `sandbox: false` only where required by Prisma native module; all other windows fully sandboxed

---

## 5. MVP Features

### 5.1 Onboarding
- Connect Riot account (game name + tag + region → Account-v1 → Summoner-v4 lookup)
- Initial self-assessment grid (rate all fundamental subcategories 1–5)
- Periodic reassessment reminder (configurable, default 7 days)

### 5.2 Session System
- Create a session with a single primary objective from the fundamentals matrix
- Optional sub-objective and custom note
- AI-powered objective suggestion based on weakest assessment scores (GPT-4o)
- Session lock: one active session at a time
- Session history with outcome tracking

### 5.3 Game End Detection
- Polls `localhost:2999/liveclientdata/allgamedata` every 5 seconds
- Detects game state transition from active → ended
- Fetches match data from Match-v5 (KDA, CS, Vision Score, win/loss)
- Automatically focuses the Review page

### 5.4 Post-Game Review Engine
- **Match stats display:** Champion, KDA, CS/min, Vision Score, win/loss
- **Timeline notes:** Timestamped freeform notes (format `M:SS`) for key moments
- **Dynamic KPI form:** Per-fundamental scored items (1–5) relevant to the session objective
- **Freeform note:** Open reflection field
- **AI synthesis:** GPT-4o summarizes timeline notes + KPIs into a 2–3 sentence coaching note
- **Objective binary:** Did you respect the session objective? Yes / No
- Saves to local SQLite database

### 5.5 Analytics Dashboard
- Score trend per fundamental (line chart, Recharts)
- Win rate over time (donut chart)
- CS/min trend
- Session objective success rate
- Game history table

### 5.6 Gamification
- XP system: earned per review submitted
- Streak counter: consecutive days with at least one review
- Badge unlocks (e.g., "First Review", "7-Day Streak", "Wave Master")
- Rank milestone detection with AI congratulation message

### 5.7 AI Features (GPT-4o)
| Feature | Trigger | Output |
|---|---|---|
| Objective suggestion | Assessment scores submitted | Ranked list of focus areas with rationale |
| Review synthesis | Review saved | 2–3 sentence coaching summary |
| Pattern recognition | Session ended | Recurring mistakes + recommendation to continue or change objective |
| Session summary | Session closed | Full session narrative with improvement trajectory |
| Rank milestone | Rank change detected | Motivational message connecting rank to skill improvement |

### 5.8 Coach / Student System

A cloud-backed role system that lets coaches review their students' data remotely without requiring any dedicated server beyond Supabase (free tier).

#### Roles
- Users select one of three roles in Settings: **Student**, **Coach**, or **Both**.
- Role is stored locally (SQLite `User.role`) and synced to Supabase `profiles`.

#### Account & Auth
- Users create a NexusMind account (email + password) via Supabase Auth directly from Settings.
- No separate registration flow — sign-up and sign-in are embedded in the Settings page.
- The Supabase UID and email are persisted locally so the user stays signed in across restarts.

#### Invite & Connection Flow
1. **Student** generates a one-time invite code in Settings → Coach & Student.
2. Student shares the code out-of-band (Discord, message, etc.).
3. **Coach** pastes the code in their Settings → Coach & Student.
4. A `coach_students` record is created in Supabase (status: `active`).
5. Both parties are now linked; the coach can see the student in the Students page.

#### Data Sync (student → Supabase)
- After every `session:end` and `review:save`, the app pushes the last 50 completed sessions (+ games + reviews) and the last 20 assessments to Supabase in the background (non-blocking).
- Local SQLite remains the single source of truth; Supabase is the read-only sharing layer.

#### Coach Students Page (`/students`)
- Lists all linked active students.
- Selecting a student fetches their synced sessions and shows a read-only overview.
- Navigation links to sub-views: Sessions, Analytics, History, Assessment (all read-only).
- Settings and Students nav items are hidden in student-view mode.

#### Coach Comments
- On every Session card (Students page) and Review page, coaches can add collapsible Coach Notes.
- Comments are stored in Supabase `coach_comments` with `target_type` (`session` / `game` / `review`) + `target_id`.
- Coaches can add, edit, and delete their own comments.
- Students see coach comments in read-only mode on their own Review page when signed in.

#### Security
- Row Level Security (RLS) on all Supabase tables ensures:
  - A coach only reads data for students linked to them.
  - Students only read/write their own data.
  - Invite codes are readable by anyone for redemption, but writable only by the coach who created them.

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

**Coach view of recordings**
- Coaches see `youtubeUrl` embeds for student games (synced via Supabase `synced_games.youtube_url`).
- Coaches do **not** see local `filePath` recordings (those are only on the student's machine).
- Recommended workflow: student uploads the recording to YouTube (unlisted), pastes the link in the app, and the coach sees the embed automatically.

#### Phase 2 — Built-in recording (future)
- Electron `desktopCapturer` to capture the League window.
- `MediaRecorder` API for WebM encoding.
- Auto-start/stop tied to the GameDetector lifecycle.
- Local file management and automatic cleanup.

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

## 7. Database Schema

### 7.1 Local SQLite (Prisma)

```prisma
model User {
  id                 String       @id @default(cuid())
  displayName        String       @default("")
  summonerName       String
  puuid              String       @unique
  tagLine            String       @default("")
  region             String
  assessmentFreqDays Int          @default(14)
  nextAssessmentAt   DateTime
  xp                 Int          @default(0)
  streakDays         Int          @default(0)
  lastActiveDate     DateTime?
  queueFilter        String       @default("both")
  role               String       @default("student")  // "student" | "coach" | "both"
  supabaseUid        String?      // Supabase Auth UID once signed in
  supabaseEmail      String?
  createdAt          DateTime     @default(now())
  updatedAt          DateTime     @updatedAt
  sessions           Session[]
  assessments        Assessment[]
  badges             Badge[]
  accounts           Account[]
}

model Account {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  puuid       String   @unique
  gameName    String
  tagLine     String
  region      String
  createdAt   DateTime @default(now())
}

model Assessment {
  id        String            @id @default(cuid())
  userId    String
  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime          @default(now())
  scores    AssessmentScore[]
}

model AssessmentScore {
  id            String     @id @default(cuid())
  assessmentId  String
  assessment    Assessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)
  fundamentalId String
  subcategoryId String?
  score         Int
}

model Session {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date            DateTime @default(now())
  objectiveId     String
  objectiveIds    String   @default("[]")
  selectedKpiIds  String   @default("[]")
  subObjective    String?
  customNote      String?
  status          String   @default("active")
  aiSummary       String?
  games           Game[]
}

model Game {
  id               String             @id @default(cuid())
  sessionId        String
  session          Session            @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  matchId          String             @unique
  champion         String
  opponentChampion String?
  reviewStatus     String             @default("pending")
  role             String
  kills            Int
  deaths           Int
  assists          Int
  cs               Int
  visionScore      Int
  duration         Int
  win              Boolean
  rank             String?
  lp               Int?
  gameEndAt        DateTime
  review           Review?
  detailedStats    GameDetailedStats?
  recording        Recording?
}

model Review {
  id                 String   @id @default(cuid())
  gameId             String   @unique
  game               Game     @relation(fields: [gameId], references: [id], onDelete: Cascade)
  timelineNotes      String
  kpiScores          String
  freeText           String?
  aiSummary          String?
  objectiveRespected Boolean
  createdAt          DateTime @default(now())
}

model Recording {
  id          String   @id @default(cuid())
  gameId      String   @unique
  game        Game     @relation(fields: [gameId], references: [id], onDelete: Cascade)
  filePath    String?      // local path (Outplayed, InsightCapture, OBS, manual)
  youtubeUrl  String?      // YouTube link for coach sharing
  source      String   @default("manual")  // "outplayed" | "insightcapture" | "obs" | "manual" | "youtube"
  duration    Int?
  createdAt   DateTime @default(now())
}

model Badge {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  badgeId    String
  unlockedAt DateTime @default(now())
  @@unique([userId, badgeId])
}
```

### 7.2 Cloud — Supabase (PostgreSQL)

Tables managed in Supabase (not Prisma). Full schema in `supabase/schema.sql`.

| Table | Purpose |
|---|---|
| `profiles` | One row per Supabase Auth user; stores `local_puuid`, `display_name`, `role` |
| `coach_students` | Coach ↔ student relationships; `invite_code` for connection, `status` pending/active |
| `synced_sessions` | Mirror of student's completed sessions |
| `synced_games` | Mirror of student's games (includes `youtube_url`) |
| `synced_reviews` | Mirror of student's reviews |
| `synced_assessments` | Mirror of student's assessments |
| `synced_assessment_scores` | Mirror of assessment score rows |
| `coach_comments` | Coach notes on sessions, games, or reviews; student-readable via RLS |

All tables have Row Level Security policies: students write their own data, coaches read only their linked students' data.

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
| `createSession(data)` | Create new session with objective |
| `getActiveSession()` | Fetch current open session |
| `endSession(id)` | Close session; triggers background Supabase sync |
| `deleteSession(id)` | Delete session and all child records |
| `saveReview(data)` | Save post-game review; triggers background Supabase sync |
| `getReviews(sessionId)` | Fetch all reviews for a session |
| `analyzeReviewBias(gameId, objectiveIds)` | Bias signal detection from match timeline |
| `saveAssessment(scores)` | Save self-assessment scores |
| `getLatestAssessment()` | Fetch most recent assessment |
| `getAssessmentHistory()` | Fetch all assessments |
| `getProgressData()` | Aggregate score trends per fundamental |
| `getSessionStats()` | Objective success rate, game counts |
| `getGameHistory(limit)` | Recent games with stats |
| `getObjectiveSuggestion(scores)` | GPT-4o objective recommendation |
| `synthesizeReview(data)` | GPT-4o post-game coaching note |
| `analyzePatterns(reviews)` | GPT-4o pattern recognition across session |
| `generateSessionSummary(sessionId)` | GPT-4o session narrative |
| `listAccounts()` | List linked secondary Riot accounts |
| `addAccount(gameName, tagLine, region)` | Link a secondary Riot account |
| `removeAccount(accountId)` | Remove a secondary account |
| `onGameEnd(callback)` | Subscribe to automatic game-end events |
| `minimizeWindow()` / `maximizeWindow()` / `closeWindow()` | Window controls |

### Coach & Student

| Method | Description |
|---|---|
| `supabaseSignIn(email, password)` | Sign in to Supabase Auth |
| `supabaseSignUp(email, password)` | Create Supabase account + profile |
| `supabaseSignOut()` | Sign out and clear local supabaseUid |
| `getSupabaseSession()` | Check current Supabase session |
| `setRole(role)` | Update user role (student / coach / both) |
| `generateInvite()` | Generate a student invite code |
| `redeemInvite(code)` | Coach redeems a student invite code |
| `listCoaches()` | List coaches linked to the current student |
| `listStudents()` | List students linked to the current coach |
| `getStudentSessions(studentSupabaseId)` | Fetch a student's synced sessions + games + reviews |
| `getStudentAssessments(studentSupabaseId)` | Fetch a student's synced assessments |
| `addCoachComment(data)` | Post a coach comment on a session/game/review |
| `updateCoachComment(id, content)` | Edit an existing coach comment |
| `deleteCoachComment(id)` | Delete a coach comment |
| `getCoachComments(targetType, targetId)` | Fetch all coach comments for a target |
| `syncToSupabase()` | Manually trigger student data push to Supabase |

### Recording

| Method | Description |
|---|---|
| `scanRecordings()` | Scan Outplayed/InsightCapture/OBS folders and auto-match to games |
| `getRecording(gameId)` | Fetch recording row for a game |
| `linkRecordingFile(gameId)` | Open file picker and link a video file to a game |
| `setYoutubeUrl(gameId, url)` | Attach a YouTube URL to a game |
| `deleteRecording(gameId)` | Remove recording link from a game |
| `getRecordingScanPaths()` | Return known scan paths and whether they exist |

---

## 9. Environment Configuration

All configuration lives in `.env` at the project root:

```env
DATABASE_URL="file:../dev.db"
MAIN_VITE_RIOT_API_KEY="RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
MAIN_VITE_OPENAI_API_KEY="sk-..."
MAIN_VITE_SUPABASE_URL="https://yourproject.supabase.co"
MAIN_VITE_SUPABASE_ANON_KEY="eyJ..."
```

- `MAIN_VITE_*` variables are injected into the Electron main process at build time by electron-vite
- They are **never** exposed to the renderer process
- Riot development keys expire every 24 hours — regenerate at [developer.riotgames.com](https://developer.riotgames.com)
- Supabase URL and anon key are found in your Supabase project → Settings → API. The **anon (public)** key is the correct one to use — it is safe in desktop apps because RLS policies enforce access control

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
- Pages: Dashboard, Session, Review, History, Stats, Analytics, Students (coach/both only), Settings
- The **Students** nav item is shown only when the user's role is `coach` or `both`
- A `CoachContext` React context tracks the "viewing as student" state; when active, Settings and Students are hidden from the sidebar

### Key UX Principles
- **Speed of review entry:** The review form must be completable in under 2 minutes
- **Post-game focus:** Window auto-focuses when a game ends
- **Progressive disclosure:** AI features degrade gracefully if OpenAI key is not set

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
- Coach marketplace or social discovery features
- Mobile companion app
- Built-in screen recorder (Phase 2 future item — see §5.9)
- Real-time live coaching (Supabase Realtime subscriptions not enabled yet)
- Multi-coach per student or coach teams
