# NexusMind — Product Requirements Document

**Version:** 1.0  
**Date:** 2026-03-28  
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

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | Electron 33 + electron-vite |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS (custom Hextech dark theme) + shadcn/ui |
| State management | Zustand |
| Database | SQLite (local file) via Prisma ORM |
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

```prisma
model User {
  id                 String   @id @default(cuid())
  summonerName       String
  puuid              String   @unique
  tagLine            String
  region             String
  xp                 Int      @default(0)
  streakDays         Int      @default(0)
  lastActiveDate     DateTime?
  assessmentFreqDays Int      @default(7)
  nextAssessmentAt   DateTime
  createdAt          DateTime @default(now())
  sessions           Session[]
  assessments        Assessment[]
}

model Assessment {
  id        String            @id @default(cuid())
  userId    String
  createdAt DateTime          @default(now())
  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  scores    AssessmentScore[]
}

model AssessmentScore {
  id             String     @id @default(cuid())
  assessmentId   String
  fundamentalId  String
  subcategoryId  String?
  score          Int
  assessment     Assessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)
}

model Session {
  id               String   @id @default(cuid())
  userId           String
  objectiveId      String
  subObjective     String?
  customNote       String?
  aiSuggestion     String?
  startedAt        DateTime @default(now())
  endedAt          DateTime?
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  games            Game[]
}

model Game {
  id           String   @id @default(cuid())
  sessionId    String
  matchId      String   @unique
  champion     String
  role         String
  kills        Int
  deaths       Int
  assists      Int
  cs           Int
  visionScore  Int
  duration     Int
  win          Boolean
  gameEndAt    DateTime
  session      Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  review       Review?
}

model Review {
  id                 String   @id @default(cuid())
  gameId             String   @unique
  timelineNotes      String
  kpiScores          String
  freeText           String?
  aiSummary          String?
  objectiveRespected Boolean
  createdAt          DateTime @default(now())
  game               Game     @relation(fields: [gameId], references: [id], onDelete: Cascade)
}

model Badge {
  id          String   @id @default(cuid())
  userId      String
  badgeId     String
  unlockedAt  DateTime @default(now())
  @@unique([userId, badgeId])
}
```

---

## 8. IPC API Surface

All communication between renderer and main process goes through `window.api` (contextBridge).

| Method | Direction | Description |
|---|---|---|
| `connectRiot(gameName, tagLine, region)` | R→M | Look up account via Riot API, create/update User |
| `disconnectRiot()` | R→M | Delete user record, return to onboarding |
| `getUser()` | R→M | Fetch current user from DB |
| `updateUser(data)` | R→M | Update user fields |
| `createSession(data)` | R→M | Create new session with objective |
| `getActiveSession()` | R→M | Fetch current open session |
| `endSession(id)` | R→M | Close session, set endedAt |
| `saveReview(data)` | R→M | Save post-game review to DB |
| `getReviews(sessionId)` | R→M | Fetch all reviews for a session |
| `saveAssessment(scores)` | R→M | Save self-assessment scores |
| `getLatestAssessment()` | R→M | Fetch most recent assessment |
| `getAssessmentHistory()` | R→M | Fetch all assessments |
| `getProgressData()` | R→M | Aggregate score trends per fundamental |
| `getSessionStats()` | R→M | Objective success rate, game counts |
| `getGameHistory(limit)` | R→M | Recent games with stats |
| `getObjectiveSuggestion(scores)` | R→M | GPT-4o objective recommendation |
| `synthesizeReview(data)` | R→M | GPT-4o post-game coaching note |
| `analyzePatterns(reviews)` | R→M | GPT-4o pattern recognition across session |
| `generateSessionSummary(sessionId)` | R→M | GPT-4o session narrative |
| `onGameEnd(callback)` | M→R | Subscribe to automatic game-end events |
| `minimizeWindow()` | R→M | Window control |
| `maximizeWindow()` | R→M | Window control |
| `closeWindow()` | R→M | Window control |

---

## 9. Environment Configuration

All configuration lives in `.env` at the project root:

```env
DATABASE_URL="file:../dev.db"
MAIN_VITE_RIOT_API_KEY="RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
MAIN_VITE_OPENAI_API_KEY="sk-..."
```

- `MAIN_VITE_*` variables are injected into the Electron main process at build time by electron-vite
- They are **never** exposed to the renderer process
- Riot development keys expire every 24 hours — regenerate at [developer.riotgames.com](https://developer.riotgames.com)

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
- Pages: Dashboard, Session, Review, Analytics

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

## 13. Out of Scope (v1.0)

- Mac/Linux builds (Windows only for MVP)
- Cloud sync or multi-device support
- Multiplayer / team features
- Support for other Riot games (TFT, Valorant)
- Paid subscription or in-app purchases
- Coach marketplace or social features
- Mobile companion app
