import type { AccessInvite } from './accessCore'
import type { CalendarApi } from './calendar'
import type { CollabApi } from './collab'
import type { VodReviewApi } from './vodReview'
import type { WellbeingApi } from './wellbeing'
import type { TeamOpsApi } from './teamOps'
import type { AnnouncementsApi } from './announcements'
import type { TeamSessionApi } from './teamSessions'
import type { TeamSessionReviewApi } from './teamSessionReviews'
import type { ReportApi } from './report'
import type { AnalystApi } from './analyst'
import type { TrialsApi } from './trials'
import type { ScrimsReadApi } from './scrims'
import type { FeedbackApi } from './feedback'
import type { NotificationsApi } from './notifications'
import type { TeamShareApi } from './team'
import type { DiscussionApi } from './discussion'
import type {
  AssistantMoment,
  AssistantReport,
  CoachExperiment,
  CoachExperimentState,
  CoachObjectiveCheck,
} from '../components/Assistant/types'
import type { WeeklyAwards } from './weeklyAwardsCore'

/** Weekly MVP / Grinder awards of a team roster (team:weekly-awards); rules in weeklyAwardsCore.ts. */
export type { AwardKind, AwardHolder, AwardRaceEntry, WeeklyAwards } from './weeklyAwardsCore'

export type GameEventType =
  | 'kill' | 'death' | 'assist'
  | 'dragon' | 'baron' | 'voidgrub' | 'herald'
  | 'turret' | 'inhibitor' | 'plate'

export interface GameEvent {
  type: GameEventType
  subType?: string
  gameTimeMs: number
  label: string
  teamId?: 100 | 200
  isPlayer: boolean
}

// ── Bookmarks ──────────────────────────────────────────────────────────────
export interface CloudUser {
  id: string
  email: string | null
  /** The user set a password (sign-in without an e-mail code). */
  hasPassword?: boolean
}

export interface CloudStatus {
  /** False when the build has no Supabase URL/key (cloud features hidden). */
  configured: boolean
  user: CloudUser | null
  /** How Riot calls are sent: via the Ascend proxy, a local dev key, or not at all. */
  riotMode: 'proxy' | 'direct' | 'none'
  lastBackupAt: string | null
}

export interface SyncStatus {
  phase: 'idle' | 'syncing' | 'error' | 'blocked'
  /** Local changes not yet uploaded. */
  pending: number
  lastSyncAt: string | null
  /** SIGNED_OUT | NETWORK | DIFFERENT_PLAYER | MULTIPLE_LOCAL_PROFILES | NO_LOCAL_PROFILE */
  error: string | null
}

export interface CloudBackup {
  id: string
  created_at: string
  size_bytes: number
  app_version: string | null
  device: string | null
  counts: Record<string, number>
}

export interface Bookmark {
  id: string
  recordingId: string
  videoTimeMs: number
  label?: string | null
  color?: string | null
  createdAt: string
}

// ── Lane Phase Comparator ──────────────────────────────────────────────────
export type LanePhaseGrade = 'S' | 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F'

export interface LanePhaseFrameStat {
  player: number
  opponent: number
  diff: number
}

export interface LanePhaseFrame {
  minute: number
  cs: LanePhaseFrameStat
  gold: LanePhaseFrameStat
  xp: LanePhaseFrameStat
  level: LanePhaseFrameStat
  damageTaken: LanePhaseFrameStat
  damageDealt: LanePhaseFrameStat
}

export interface LanePhaseReport {
  schemaVersion: 2
  player: { participantId: number; puuid?: string; championName: string; teamPosition: string }
  opponent: { participantId: number; championName: string; teamPosition: string }
  framesByMinute: LanePhaseFrame[]
  plates: Array<{ minute: number; takenByPlayer: boolean }>
  soloEvents: Array<{ minute: number; type: 'kill' | 'death' }>
  grade: LanePhaseGrade
  scoreComponents: {
    csAt14: number
    goldAt14: number
    xpAt14: number
    soloKD: { k: number; d: number }
    plates: { taken: number; lost: number }
    dmgAt14: { player: number; opponent: number; diff: number }
    kp: { player: number; opponent: number }
    objDmg: { player: number; opponent: number }
    numericScore: number
  }
}

// ── Mistake Library ────────────────────────────────────────────────────────
export interface MistakeTag {
  id: string
  slug: string
  label: string
  category: 'macro' | 'micro' | 'vision' | 'economy' | 'draft' | string
  icon?: string | null
  color?: string | null
  isBuiltIn: boolean
  archivedAt?: string | null
  createdAt: string
}

export interface Mistake {
  id: string
  gameId: string
  recordingId?: string | null
  tagId: string
  tag: MistakeTag
  gameTimeSec: number
  videoTimeMs?: number | null
  note?: string | null
  severity: number
  autoDetected: boolean
  createdAt: string
}

export interface MistakeTopTagEntry {
  tag: MistakeTag
  count: number
  lastAt: string
}

export interface LanePhaseDiag {
  reason:
    | 'ok'
    | 'no-game'
    | 'no-match-id'
    | 'no-user'
    | 'timeline-fetch-failed'
    | 'match-fetch-failed'
    | 'empty-timeline'
    | 'no-player'
    | 'no-opponent'
    | 'no-frames'
    | 'bad-data'
  message?: string
  matchId?: string
  frameCount?: number
  playerResolvedVia?: 'puuid' | 'champion' | 'none'
  cached?: boolean
}

export interface ChampionPoolEntry {
  id: string
  memberId: string
  championKey: string
  role: string
  tier: string
  notes?: string | null
  playRate?: number | null
  winRate?: number | null
  /** Lifetime champion-mastery points pulled from Riot during auto-fill /
   *  scout. Drives the Draft Sim threat highlights (300k+ = orange,
   *  dominant pick = red). `null` for legacy entries created before this
   *  column existed and for manual entries that never went through Riot. */
  masteryPoints?: number | null
  /** Average (kills+assists)/max(1,deaths) across scouted games for this
   *  champion+role. Feeds the "high winrate or KDA" threat signal — see
   *  src/lib/threatCore.ts. Null for legacy/manual/mastery-only entries. */
  kda?: number | null
  /** First and last analysed game on this champion in this role (auto-fill /
   *  scout); they give the "new" tier and the drop of a main left aside. */
  firstPlayedAt?: string | Date | null
  lastPlayedAt?: string | Date | null
  /** Tier the rule computed last; `tier` differing from it was set by hand. */
  autoTier?: string | null
  updatedAt: string
}

export interface TeamMember {
  id: string
  teamId: string
  displayName: string
  ign?: string | null
  tagLine?: string | null
  region?: string | null
  role: string
  puuid?: string | null
  /** #38: "Name#TAG" before a rename was applied; show it, then clear it (updateTeamMember, previousRiotId: null). */
  previousRiotId?: string | null
  champPool?: ChampionPoolEntry[]
}

export interface Team {
  id: string
  userId: string
  name: string
  tag?: string | null
  logo?: string | null
  notes?: string | null
  isOpponent: boolean
  scoutNotes?: string | null
  /** The cloud group this team is the roster of (Coaching & Management), if any. */
  groupId?: string | null
  createdAt: string
  updatedAt: string
  members?: TeamMember[]
}

export interface CustomGame {
  id: string
  teamId: string
  gameType: 'scrim' | 'tournament'
  gameDate: string | null
  durationSec: number
  win: boolean | null
  participantsJson: string
  sourceFile: string | null
  notes: string | null
  importedAt: string
}

export interface SynergyPlayerStats {
  memberId: string
  displayName: string
  role: string
  gamesPlayed: number
  wins: number
  winRate: number
  averages: {
    kda: number
    kills: number
    deaths: number
    assists: number
    cs: number
    csPerMin: number
    damage: number
    damagePerMin: number
    damageTaken: number
    ccTime: number
    visionScore: number
    wardsPlaced: number
    wardsKilled: number
    controlWards: number
    gold: number
    goldPerMin: number
    xpPerMin: number
    damagePerGold: number
  }
  shares: {
    damagePct: number
    goldPct: number
    visionPct: number
    damageTakenPct: number
    ccPct: number
    kpPct: number
  }
  byChampion: Array<{ championKey: string; games: number; wins: number; winRate: number }>
}

export interface TeamSynergyStats {
  matchCount: number
  candidateCount: number
  membersResolved: number
  membersWithGames: number
  players: SynergyPlayerStats[]
  fetchedAt: number
  /** Combined stats only (team:compute-combined-stats): the games averaged, per source. */
  sources?: { flex: number; scrim: number; tournament: number }
}

export interface DraftPrep {
  id: string
  userId: string
  name: string
  vsTeamId?: string | null
  vsTeam?: Team | null
  bluePicks: string  // JSON-encoded string[]
  blueBans: string
  redPicks: string
  redBans: string
  myTeamSide: 'blue' | 'red'
  notes?: string | null
  createdAt: string
  updatedAt: string
}

export interface SavedAccount {
  id: string
  displayName: string
  summonerName: string
  tagLine: string
  region: string
  profileIconId: number
  isActive: boolean
  mainRole: string | null
  createdAt: string
  updatedAt: string
  _count: { sessions: number }
}

export type AscendAPI = CollabApi & FeedbackApi & NotificationsApi & TeamShareApi & CalendarApi & VodReviewApi & WellbeingApi & TeamOpsApi & AnnouncementsApi & ReportApi & TrialsApi & ScrimsReadApi & DiscussionApi & TeamSessionApi & TeamSessionReviewApi & AnalystApi & {
  connectRiot: (gameName: string, tagLine: string, region: string, displayName?: string) => Promise<any>
  disconnectRiot: () => Promise<void>
  reactivateAccount: (userId: string) => Promise<any>
  listSavedAccounts: () => Promise<SavedAccount[]>

  createSession: (data: { objectiveId: string; objectiveIds?: string[]; selectedKpiIds?: string[]; subObjective?: string; customNote?: string; date?: string; isRetroactive?: boolean }) => Promise<any>
  getActiveSession: () => Promise<any>
  getLastSessionConfig: () => Promise<{ objectiveIds: string[]; selectedKpiIds: string[]; customNote: string; date: string } | null>
  getKpiHistory: () => Promise<Array<{ objectiveIds: string[]; selectedKpiIds: string[] }>>
  endSession: (id: string, manualSummary?: string, sessionConclusion?: string) => Promise<any>
  deleteSession: (id: string) => Promise<any>
  bulkDeleteSessions: (ids: string[]) => Promise<{ success: boolean; deleted: number }>
  cancelSession: (id: string) => Promise<{ success: boolean }>
  updateSession: (id: string, data: { objectiveIds?: string[]; selectedKpiIds?: string[]; customNote?: string }) => Promise<any>
  deleteGame: (gameId: string) => Promise<any>
  setGameReviewStatus: (gameId: string, reviewStatus: 'pending' | 'to_be_reviewed') => Promise<any>

  saveReview: (data: {
    gameId: string
    timelineNotes: Array<{ time: string; note: string }>
    kpiScores: Record<string, number>
    kpiNotes?: Record<string, string>
    freeText?: string
    objectiveRespected: boolean
  }) => Promise<any>
  getGameContext: (gameId: string) => Promise<{ game: any; session: any } | null>
  analyzeReviewBias: (gameId: string, objectiveIds: string[]) => Promise<ReviewBiasSignal[]>

  saveAssessment: (scores: Array<{ fundamentalId: string; subcategoryId?: string; score: number }>) => Promise<any>
  getLatestAssessment: () => Promise<any>

  listSessions: () => Promise<any[]>

  getProgressData: () => Promise<any>
  getSessionStats: () => Promise<any>
  getGameHistory: (limit?: number) => Promise<any[]>
  /** Sidebar badges: games marked "to review", mistakes tagged in the last 30 days. */
  getNavBadges: () => Promise<{ toReview: number; mistakes30d: number }>
  getKpiTimeline: () => Promise<Array<{ date: string; objectiveId: string; avgScore: number; gamesReviewed: number }>>

  fetchMatchHistory: (count?: number) => Promise<Array<{
    matchId: string
    champion: string
    role: string
    kills: number
    deaths: number
    assists: number
    cs: number
    visionScore: number
    duration: number
    win: boolean
    gameEndAt: string
    alreadyImported: boolean
  }>>
  importGamesToSession: (matchIds: string[]) => Promise<any[]>

  getMatchHistoryWithStatus: (count?: number) => Promise<Array<{
    gameId: string | null
    matchId: string
    champion: string
    opponentChampion: string | null
    role: string
    kills: number
    deaths: number
    assists: number
    cs: number
    visionScore: number
    duration: number
    win: boolean
    gameEndAt: string
    imported: boolean
    reviewed: boolean
    reviewStatus: 'pending' | 'to_be_reviewed' | 'reviewed'
    accountName: string
  }>>
  getDetailedStats: (matchId: string) => Promise<DetailedGameStats>
  getStatsSnapshots: () => Promise<any[]>
  autoSnapshot: () => Promise<{ created: number }>
  getAccountAverages: (puuid: string | null) => Promise<{ averages: any; gameCount: number; firstGameAt: string; lastGameAt: string } | null>
  /** "Empreinte des fondamentaux" radar (Dashboard) — recent (last 15
   *  games) vs snapshot (last 40 games), both via computeAverages(). */
  getFundamentalsRadar: () => Promise<{ recent: any; recentGameCount: number; snapshot: any; snapshotGameCount: number } | null>
  clearStatsSnapshots: () => Promise<{ deleted: number }>

  // Destructive data maintenance (Settings → Danger Zone)
  clearStatsMistakes: () => Promise<{ snapshots: number; detailedStats: number; lanePhase: number; mistakes: number }>
  clearRecentData: (days: number) => Promise<{ games: number; recordings: number; files: number; snapshots: number; sessions: number; mistakes: number }>
  resetAllData: () => Promise<{ sessions: number; games: number; recordings: number; files: number; snapshots: number; matchCache: number; externalReviews: number; assessments: number }>

  getBadges: () => Promise<string[]>
  /** Activity counters for player titles (Profile page). */
  getProfileStats: () => Promise<import('./profile').ProfileStats | null>

  listAccounts: () => Promise<Array<{ id: string; puuid: string; gameName: string; tagLine: string; region: string; createdAt: string }>>
  addAccount: (gameName: string, tagLine: string, region: string) => Promise<any>
  removeAccount: (accountId: string) => Promise<{ success: boolean }>

  simulateGame: () => Promise<any>
  isDev: () => Promise<boolean>

  onGameEnd: (callback: (data: any) => void) => () => void
  onGameUpdated: (callback: (info: { gameId: string; matchId: string; win: boolean; queueType: string }) => void) => () => void


  getAppVersion: () => Promise<string>
  /** "Launch Ascend when Windows starts" (installed app on Windows only: `supported` false elsewhere).
   *  While on, Ascend starts in the notification area and closing the window hides it there. Desktop only. */
  getLaunchAtLogin?: () => Promise<{ supported: boolean; enabled: boolean }>
  setLaunchAtLogin?: (enabled: boolean) => Promise<{ supported: boolean; enabled: boolean }>
  getUser: () => Promise<any>
  updateUser: (data: any) => Promise<any>

  onUpdateAvailable: (cb: (version?: string) => void) => () => void
  onUpdateProgress: (cb: (percent: number) => void) => () => void
  onUpdateDownloaded: (cb: () => void) => () => void
  onUpdateError: (cb: (message: string) => void) => () => void
  installUpdate: () => Promise<void>
  checkForUpdates: () => Promise<{
    status: 'available' | 'up-to-date' | 'unknown' | 'error' | 'dev-mode'
    updateAvailable: boolean
    currentVersion?: string
    latestVersion?: string
    error?: string
  }>

  // Backup & restore (multi-PC manual sync)
  exportBackup: () => Promise<
    | { canceled: true }
    | { canceled: false; filePath: string; counts: { sessions: number; games: number; reviews: number; assessments: number; snapshots: number; recordings: number; externalReviews: number } }
  >
  importBackup: () => Promise<
    | { canceled: true }
    | { canceled: false; summary: { sessionsAdded: number; gamesAdded: number; reviewsAdded: number; assessmentsAdded: number; snapshotsAdded: number; recordingsAdded: number; externalReviewsAdded: number; conflicts: number; skipped: number } }
  >

  // Ascend cloud account & backups
  cloudStatus: () => Promise<CloudStatus>
  /** `inviteCode` is required the first time an e-mail signs in (invite-only access). */
  cloudSendCode: (email: string, inviteCode?: string) => Promise<{ sent: boolean }>
  /** Opens the web app in the browser, already signed in. Desktop only. */
  cloudOpenWeb?: () => Promise<{ signedIn: boolean }>
  /** Web only: invite code from an invite link (read once). */
  pendingInviteCode?: () => string | null
  accessIsAdmin: () => Promise<boolean>
  accessListInvites: () => Promise<AccessInvite[]>
  accessCreateInvite: (opts: { email?: string | null; days?: number; maxUses?: number; note?: string | null }) => Promise<string>
  accessRevokeInvite: (code: string) => Promise<{ revoked: boolean }>
  cloudVerifyCode: (email: string, code: string) => Promise<CloudUser | null>
  /** Sign in with e-mail + password (only once the user has set one). */
  cloudSignInPassword: (email: string, password: string) => Promise<CloudUser | null>
  /** Sets / changes the password of the signed-in user. */
  cloudSetPassword: (password: string) => Promise<CloudUser | null>
  cloudSignOut: () => Promise<{ signedOut: boolean }>
  /** Every device and the web (scope global). Rejects when the server could not be reached: nothing was revoked. */
  cloudSignOutEverywhere?: () => Promise<{ signedOut: boolean }>
  cloudBackupNow: () => Promise<CloudBackup>
  cloudListBackups: () => Promise<CloudBackup[]>
  cloudRestoreBackup: (id: string) => Promise<{ sessionsAdded: number; gamesAdded: number; reviewsAdded: number; assessmentsAdded: number; snapshotsAdded: number; recordingsAdded: number; externalReviewsAdded: number; conflicts: number; skipped: number }>
  cloudDeleteBackup: (id: string) => Promise<{ deleted: boolean }>
  cloudDeleteAccount: (confirm: 'DELETE') => Promise<{ deleted: boolean }>
  onCloudAuthChanged: (cb: (user: CloudUser | null) => void) => () => void

  // Multi-device sync
  syncStatus: () => Promise<SyncStatus>
  syncNow: () => Promise<SyncStatus>
  /** Cleanup for the sync-leak fixed in beta.104 (desktop-only — see
   *  electron/main/sync/syncAudit.ts). Maps table name -> row count. */
  syncAuditForeignRows: () => Promise<Record<string, number>>
  syncDeleteForeignRows: () => Promise<Record<string, number>>
  onSyncStatus: (cb: (status: SyncStatus) => void) => () => void
  onSyncApplied: (cb: (info: { tables: string[]; count: number }) => void) => () => void

  // Recording — library
  scanRecordings: () => Promise<{ scanned: number; matched: number; orphaned: number; dismissed: number; backfillLinked?: number; backfillNotFound?: number; paths: Array<{ source: string; dir: string; exists: boolean }> }>
  getRecording: (gameId: string) => Promise<{ id: string; gameId: string; filePath: string | null; youtubeUrl: string | null; source: string; createdAt?: string; startOffsetSec?: number | null } | null>
  /** The ids, among `gameIds`, of the games that have a recording (one query). Desktop only: absent on the web. */
  recordingGameIdsWithRecording?: (gameIds: string[]) => Promise<string[]>
  linkRecordingFile: (gameId: string) => Promise<any>
  setYoutubeUrl: (gameId: string, youtubeUrl: string | null) => Promise<any>
  deleteReview: (gameId: string) => Promise<{ success: boolean }>
  deleteRecording: (gameId: string) => Promise<{ success: boolean }>
  unlinkRecording: (gameId: string) => Promise<{ success: boolean }>
  /** Re-runs the orphan-recording Riot lookup. Pass a recording id to
   *  target a single orphan; omit to retry every orphan. */
  backfillOrphanRecordings: (recordingId?: string) => Promise<{ considered: number; linked: number; notFound: number; skipped: number }>
  /** Force-refetch the match + timeline for a game and return diagnostics. */
  refreshGameEvents: (gameId: string, forceRefetch?: boolean) => Promise<{
    events: Array<{ type: string; gameTimeMs: number; label: string; subType?: string; teamId?: number; isPlayer: boolean }>
    diag: {
      reason: 'ok' | 'no-game' | 'no-match-id' | 'no-user' | 'timeline-fetch-failed' | 'match-fetch-failed' | 'player-not-resolved' | 'empty-timeline'
      message?: string
      matchId?: string
      frameCount?: number
      playerResolvedVia?: 'puuid' | 'champion' | 'none'
    }
  }>
  /** Read-through cache for the Lane Phase Comparator report. Cheap on
   *  subsequent calls (persisted on Game.lanePhaseReport). */
  getLanePhase: (gameId: string) => Promise<{ report: LanePhaseReport | null; diag: LanePhaseDiag }>
  /** Bypass every cache and recompute the lane phase report from Riot. */
  refreshLanePhase: (gameId: string) => Promise<{ report: LanePhaseReport | null; diag: LanePhaseDiag }>

  // Mistake Library
  listMistakeTags: (opts?: { includeArchived?: boolean }) => Promise<MistakeTag[]>
  createMistakeTag: (args: { label: string; category: string; icon?: string; color?: string }) => Promise<MistakeTag>
  listMistakesByGame: (gameId: string) => Promise<Mistake[]>
  createMistake: (args: { gameId: string; tagId: string; gameTimeSec: number; videoTimeMs?: number; note?: string; severity?: number; recordingId?: string }) => Promise<Mistake>
  deleteMistake: (id: string) => Promise<{ success: boolean }>
  autoDetectMistakes: (gameId: string) => Promise<{ created: number; skipped: number; reason: string }>
  /** Mistake Lab: tagged occurrences with game result, game time and recording. */
  getMistakeOccurrences: (opts?: { days?: number; role?: string | null; champion?: string | null }) => Promise<import('./mistakeInsights').MistakeOccurrence[]>

  // Micro-review (docs/PLAN_MICRO_REVIEW.md)
  microReviewGet: (gameId: string) => Promise<import('./microReview/types').MicroReviewPayload | null>
  microReviewAnswer: (input: import('./microReview/types').MicroReviewAnswerInput) => Promise<import('./microReview/types').MicroReviewAnswerResult>
  microReviewVerifyObjectives: (gameId: string) => Promise<import('./microReview/types').ObjectiveVerificationPayload | null>
  calibrationStatus: () => Promise<import('./microReview/types').CalibrationStatus | null>
  calibrationSubmit: (family: import('./mistakeInsights').MistakeFamily) => Promise<import('./microReview/types').CalibrationResult>
  microReviewCloudPlayerAnswers: import('./microReview/types').MicroReviewCloudApi['microReviewCloudPlayerAnswers']
  microReviewCloudMyVerdicts: import('./microReview/types').MicroReviewCloudApi['microReviewCloudMyVerdicts']
  microReviewCloudSetVerdict: import('./microReview/types').MicroReviewCloudApi['microReviewCloudSetVerdict']
  teamCodexList: import('./microReview/types').MicroReviewCloudApi['teamCodexList']
  teamCodexAdd: import('./microReview/types').MicroReviewCloudApi['teamCodexAdd']
  teamCodexDelete: import('./microReview/types').MicroReviewCloudApi['teamCodexDelete']
  getMistakeTopTags: (opts?: { days?: number; role?: string | null; champion?: string | null }) => Promise<MistakeTopTagEntry[]>

  // Bookmarks
  listBookmarks: (recordingId: string) => Promise<Bookmark[]>
  createBookmark: (args: { recordingId: string; videoTimeMs: number; label?: string; color?: string }) => Promise<Bookmark>
  deleteBookmark: (id: string) => Promise<{ success: boolean }>
  deleteRecordingById: (recordingId: string) => Promise<{ success: boolean }>
  resetDismissedRecordings: () => Promise<{ success: boolean }>
  listGamesWithRecordings: () => Promise<Array<{
    recordingId: string
    gameId: string
    filePath: string | null
    youtubeUrl: string | null
    source: string
    champion: string
    opponentChampion: string | null
    win: boolean
    kills: number
    deaths: number
    assists: number
    duration: number
    gameEndAt: string
    hasReview: boolean
    reviewId: string | null
    sessionObjectiveId: string
  }>>
  // Recording — in-app capture
  pickRecordingFolder: () => Promise<string | null>
  getCaptureStatus: () => Promise<{ isRecording: boolean; filePath: string | null; ffmpegAvailable: boolean }>
  startCapture: () => Promise<{ started: boolean; filePath: string | null }>
  stopCapture: (gameId?: string) => Promise<{ stopped: boolean; filePath?: string }>
  getRecordingsDir: () => Promise<string>

  // Audio devices — enumerated via native-audio-node (main process)
  listAudioDevices: () => Promise<AudioDevicesSummary>
  openSoundSettings: () => Promise<{ opened: boolean; reason?: 'unsupported-platform' | 'failed'; error?: string }>
  onRecordingStarted: (cb: () => void) => () => void
  onRecordingStopped: (cb: (data: { filePath: string }) => void) => () => void
  onRecordingLinked: (cb: (data: { gameId: string; filePath: string }) => void) => () => void
  onRecordingProcessing: (cb: (data: { gameId?: string; source: 'auto' | 'manual' }) => void) => () => void
  onRecordingReady: (cb: (data: { recordingId: string | null; gameId?: string; filePath: string; durationSec: number }) => void) => () => void
  onRecordingFailed: (cb: (data: { reason: string; filePath?: string }) => void) => () => void
  getGameEvents: (gameId: string) => Promise<GameEvent[]>
  /** R1: draft timestamped notes built from this game's own events + severity-3 mistakes. */
  getPrefilledNotes: (gameId: string) => Promise<Array<{ time: string; note: string; auto: true }>>

  // Team management
  /** Web only (E14): scopes the group-less listTeams/addTeamMember/... IPC
   *  surface below to one group, since the web Team page is group-scoped
   *  and desktop has nothing equivalent to call this with. No-op on
   *  desktop — never called there. */
  teamSetActiveGroup?: (groupId: string | null) => void
  listTeams: (opts?: { isOpponent?: boolean; groupId?: string; includeUnassigned?: boolean }) => Promise<Team[]>
  createTeam: (data: { name: string; tag?: string; logo?: string; notes?: string; isOpponent?: boolean; groupId?: string }) => Promise<Team>
  /** Makes the team the roster of a cloud group (null unlinks); the group's previous team is released. */
  linkTeamToGroup: (teamId: string, groupId: string | null) => Promise<Team>
  deleteTeam: (id: string) => Promise<{ ok: true }>
  addTeamMember: (teamId: string, data: { displayName: string; ign?: string; tagLine?: string; region?: string; role: string; puuid?: string }) => Promise<TeamMember>
  updateTeamMember: (memberId: string, data: Partial<{ displayName: string; ign: string | null; tagLine: string | null; region: string | null; role: string; puuid: string | null; previousRiotId: string | null }>) => Promise<TeamMember>
  removeTeamMember: (memberId: string) => Promise<{ ok: true }>
  dedupeTeamMembers: (teamId: string) => Promise<{ removed: number }>
  computeTeamSynergyStats: (
    teamId: string,
    opts?: { matchesPerMember?: number; minTogether?: number },
  ) => Promise<TeamSynergyStats>
  importCustomGameCsv: (
    teamId: string,
    opts?: { csvContent?: string; filename?: string; forceType?: 'scrim' | 'tournament' },
  ) => Promise<
    | { canceled: true }
    | { canceled: false; warning: 'filename-missing-type'; filename: string }
    | { canceled: false; gameId: string; gameType: 'scrim' | 'tournament'; participants: number; filename: string; win: boolean | null }
  >
  listCustomGames: (teamId: string, gameType?: 'scrim' | 'tournament') => Promise<CustomGame[]>
  deleteCustomGame: (id: string) => Promise<{ ok: true }>
  computeCustomStats: (teamId: string, gameType: 'scrim' | 'tournament' | 'all') => Promise<TeamSynergyStats>
  computeCombinedStats: (teamId: string, opts?: { minTogether?: number }) => Promise<TeamSynergyStats>
  listChampionPool: (memberId: string) => Promise<ChampionPoolEntry[]>
  upsertChampionPool: (memberId: string, championKey: string, role: string, data: Partial<{ tier: string; notes: string | null; playRate: number | null; winRate: number | null; masteryPoints: number | null; kda: number | null }>) => Promise<ChampionPoolEntry>
  removeChampionPoolEntry: (entryId: string) => Promise<{ ok: true }>
  scoutMember: (
    memberId: string,
    count?: number,
    opts?: { roleOnly?: boolean },
  ) => Promise<{ upserted: number; totalMatches?: number; sameRoleCount?: number }>
  autoFillPool: (
    memberId: string,
    opts?: { matchCount?: number; masteryCount?: number; overwriteTiers?: boolean; roleOnly?: boolean },
  ) => Promise<{ upserted: number; matchesUsed: number; masteriesUsed: number }>
  /**
   * #46 point 2: a Lobby card's first champions within seconds, from the player's champion masteries only (1 Riot
   * call, interactive priority), when their local pool is still empty. 0 when the pool was not empty. Call it
   * first, then autoFillPool as before for the full pool. Optional: absent on older builds.
   */
  teamCardChampions?: (memberId: string) => Promise<{ upserted: number }>
  /** Solo/Duo and Flex rank of each roster member (Riot league-v4, cached 5 min; force skips the cache). Desktop only. */
  teamMemberRanks?: (teamId: string, opts?: { force?: boolean }) => Promise<import('./rankCore').MemberRankResult[]>
  /** MVP and Grinder holders of a local team, their streaks and totals, and this week's race. Reads Riot first
   *  (bounded wait) when the team's data is over 30 minutes old, else answers from the local database.
   *  Desktop only: the web app has no implementation. */
  teamWeeklyAwards?: (teamId: string) => Promise<WeeklyAwards>
  /** Renders a looking-for-team announcement at its format's size and copies it; `save` also asks where to save
   *  the PNG (filePath null when cancelled). Desktop only: the web app has no export. */
  lftExportPng?: (req: { markup: string; css: string; width: number; height: number; fileName: string; action: 'save' | 'copy' }) =>
    Promise<{ copied: true; filePath: string | null }>
  /** The champion of a loading art cut out of its scene (local BiRefNet model, downloaded once), as a PNG data
   *  URL; null when there is none to show. Desktop only: the web app keeps the full art. */
  championCutout?: (championKey: string, skin?: number) => Promise<{ dataUrl: string | null }>

  listDrafts: () => Promise<DraftPrep[]>
  createDraft: (data: { name: string; vsTeamId?: string | null; bluePicks?: string[][] | string[]; blueBans?: string[][] | string[]; redPicks?: string[][] | string[]; redBans?: string[][] | string[]; myTeamSide?: 'blue' | 'red'; notes?: string }) => Promise<DraftPrep>
  updateDraft: (id: string, data: Partial<{ name: string; vsTeamId: string | null; bluePicks: string[][] | string[]; blueBans: string[][] | string[]; redPicks: string[][] | string[]; redBans: string[][] | string[]; myTeamSide: 'blue' | 'red'; notes: string | null }>) => Promise<DraftPrep>
  deleteDraft: (id: string) => Promise<{ ok: true }>
  duplicateDraft: (id: string) => Promise<DraftPrep>

  // External reviews
  fetchExternalPlayerHistory: (gameName: string, tagLine: string, region: string, count?: number) => Promise<any[]>
  createExternalReview: (data: {
    title: string
    objectiveId?: string
    objectiveIds?: string
    selectedKpiIds?: string
    filePath?: string
    playerName?: string
    matchData?: string
  }) => Promise<any>
  getExternalReview: (id: string) => Promise<any>
  saveExternalReview: (id: string, data: { timelineNotes?: string; freeText?: string; filePath?: string; kpiScores?: string }) => Promise<any>
  listExternalReviews: () => Promise<any[]>
  pickExternalReviewFile: () => Promise<string | null>
  deleteExternalReview: (id: string) => Promise<{ success: boolean }>

  // Clips
  createClip: (opts: { recordingId: string; startMs: number; endMs: number; title?: string; linkedNoteText?: string }) => Promise<{ id: string }>
  exportClip: (opts: { recordingId: string; startMs: number; endMs: number; title?: string; linkedNoteText?: string }) =>
    Promise<{ id: string; filePath: string; thumbnailPath: string | null; title: string | null; startMs: number; endMs: number; fileSize: number; revealedInFolder: boolean }>
  /** J (FE-3): the Clip fields the screens read, plus the file size in bytes. A clip's youtubeUrl / tempShareUrl
   *  are not part of it (removed with E15-B, no screen shows them). */
  listClips: (recordingId: string) => Promise<Array<{
    id: string; recordingId: string; filePath: string; thumbnailPath: string | null; title: string | null
    startMs: number; endMs: number; linkedNoteText: string | null; createdAt: string; fileSize: number
  }>>
  listAllClips: () => Promise<Array<{ clipId: string; recordingId: string; filePath: string | null; thumbnailPath: string | null; title: string | null; startMs: number; endMs: number; createdAt: string; fileSize: number; champion: string | null; opponentChampion: string | null; win: boolean; duration: number }>>
  deleteClip: (clipId: string) => Promise<{ success: boolean }>

  // Sharing (files + temp upload)
  sendToDiscord: (embeds: object[], webhookUrl: string) => Promise<{ success: boolean }>
  sendFileToDiscord: (filePath: string, webhookUrl: string, caption?: string) => Promise<{ success: boolean }>
  uploadToTemp: (filePath: string, expiryHours: number) => Promise<{ url: string; expiresAt: string }>
  copyReviewText: (text: string) => Promise<void>
  listWebhooks: () => Promise<DiscordWebhook[]>
  addWebhook: (name: string, url: string) => Promise<DiscordWebhook>
  renameWebhook: (id: string, name: string) => Promise<{ success: boolean }>
  deleteWebhook: (id: string) => Promise<{ success: boolean }>

  // YouTube OAuth + upload
  /** Resolves once the browser consent is done (J, FE-3: the main process returns the connection, not a URL). */
  youtubeAuthStart: () => Promise<{ connected: boolean; channelName: string }>
  /** `available`: false in the installed app or without OAuth credentials (option A, 19/11/2026): hide upload. */
  youtubeGetStatus: () => Promise<{ connected: boolean; channelName: string | null; available?: boolean }>
  youtubeDisconnect: () => Promise<{ success: boolean }>
  /** Resolves when the upload is done (progress comes through onYoutubeUploadProgress). */
  youtubeUpload: (opts: { filePath: string; title: string; description?: string; visibility?: string }) => Promise<{ videoId: string; url: string }>
  onYoutubeUploadProgress: (cb: (data: { jobId: string; percent: number }) => void) => () => void

  /** Local Whisper transcription (Phase 5, Planning rework). Desktop-only —
   *  the model (ONNX Runtime) runs in the Electron main process. */
  transcriptionRun: (filePath: string, language: string) => Promise<{ text: string }>

  getCoachingPatterns: () => Promise<CoachingPatterns | null>

  getAssistantReport: (moment: AssistantMoment, gameId?: string | null) => Promise<AssistantReport | null>
  sendAssistantFeedback: (insightKey: string, ruleId: string, moment: AssistantMoment, vote: 1 | -1 | 0) => Promise<{ ok: boolean }>
  coachExperiments: () => Promise<CoachExperimentState | null>
  coachStartExperiment: (problemId: string, tagSlug: string | null, ruleId: string | null) => Promise<CoachExperiment>
  /** Starts the measurable experiment for one mistake tag (Mistake Lab). */
  coachStartTagExperiment: (tagSlug: string) => Promise<CoachExperiment>
  coachAbandonExperiment: (experimentId: string) => Promise<{ ok: boolean }>
  coachObjectiveCheck: (gameId: string) => Promise<CoachObjectiveCheck | null>
  /** R4/R5: which unreviewed game to review first, and the backlog size. */
  reviewPriorityGame: () => Promise<{ gameId: string; reason: 'close_loss' | 'severe_mistakes' | 'deviation' | 'recency'; backlogCount: number } | null>
  /** P1: fundamentals whose measured performance has clearly shifted since the last self-rating. */
  coachReassessmentCheck: () => Promise<{ gaps: Array<{ fundamentalId: string; metric: string; selfScore: number; z: number }> } | null>
  /** Lot 5: pre-fills the next self-assessment from recent stats (empty on first-ever assessment). */
  coachSuggestedScores: () => Promise<Array<{ fundamentalId: string; metric: string; score: number; previousScore: number; z: number }>>
  /** Lot 5: minimal game info ("Why?" evidence list), in the order requested. */
  coachGamesByIds: (gameIds: string[]) => Promise<Array<{ id: string; champion: string; win: boolean; endedAt: number; reviewed: boolean }>>
}

export interface DetailedGameStats {
  laning: {
    gold15: number | null
    xp15: number | null
    xpPerMin15: number | null
    cs15: number | null
    damage15: number | null
    damagePerMin15: number | null
    goldDiff15: number | null
    xpDiff15: number | null
    csDiff15: number | null
    damageDiff15: number | null
    turretPlates15: number | null
    firstBloodParticipation: boolean
  }
  economy: {
    xp: number | null
    xpPerMin: number | null
    goldPerMin: number
    csPerMin: string
    teamGoldPercent: number
    laneCS: number
    jungleCS: number
    maxCsAdvantage: number | null
  }
  combat: {
    killParticipation: number
    damagePerMin: number
    teamDamagePercent: number
    damagePerGold: number
    soloKills: number | null
    damageTaken: number
    damageMitigated: number
    damageTakenPercent: number
    /** Heals + shields on teammates per minute. */
    healShieldPerMin?: number
    /** Damage absorbed (Riot damageSelfMitigated) per minute. */
    damageMitigatedPerMin?: number
    /** Crowd-control score (Riot timeCCingOthers) per minute. */
    ccPerMin?: number
  }
  objectives: {
    damageToEpicMonsters: number
    teamEpicMonsterDmgPercent: number
    damageToBuildings: number
    teamBuildingDamagePercent: number
    objectivesStolen: number
    firstTowerParticipation: boolean
    turretPlates: number
    inhibitorTakedowns: number
  }
  vision: {
    visionScorePerMin: number
    controlWardsPurchased: number
    wardsPlaced: number
    wardsDestroyed: number
    stealthWardsPlaced: number | null
    visionScoreAdvantage: number | null
  }
  behavioral: {
    skillshotsDodged: number | null
    killsNearEnemyTurret: number | null
    outnumberedKills: number | null
    takedownsInEnemyJungle: number | null
  }
  meta: {
    champion: string
    role: string
    win: boolean
    kills: number
    deaths: number
    assists: number
    cs: number
    visionScore: number
    duration: number
    gameEndAt: number
    matchId: string
    opponentChampion: string | null
    accountName?: string
  }
  opponent: {
    champion: string
    kills: number
    deaths: number
    assists: number
    cs: number
    laneCS: number
    jungleCS: number
    visionScore: number
    totalDamage: number
    damagePerMin: number
    goldEarned: number
    goldPerMin: number
    csPerMin: number
    visionScorePerMin: number
    wardsPlaced: number
    wardsDestroyed: number
    controlWardsPurchased: number
    stealthWardsPlaced: number | null
    damageTaken: number
    damageMitigated: number
    damagePerGold: number
    killParticipation: number
    epicMonsterDamage: number
    damageToBuildings: number
    objectivesStolen: number
    inhibitorTakedowns: number
    turretPlates: number
    firstTowerParticipation: boolean
    firstBloodParticipation: boolean
    soloKills: number | null
    skillshotsDodged: number | null
    killsNearEnemyTurret: number | null
    outnumberedKills: number | null
    takedownsInEnemyJungle: number | null
    gold15: number | null
    xp15: number | null
    xpPerMin15: number | null
    cs15: number | null
    damage15: number | null
    damagePerMin15: number | null
    turretPlates15: number | null
  } | null
}

export interface DiscordWebhook {
  id: string
  name: string
  url: string
  createdAt: string
}

export interface AudioDeviceInfo {
  id: string
  name: string
  manufacturer: string | null
  isDefault: boolean
  sampleRate: number
  channelCount: number
}

export interface AudioDevicesSummary {
  inputs: AudioDeviceInfo[]
  outputs: AudioDeviceInfo[]
  defaultInputId: string | null
  defaultOutputId: string | null
  defaultInputName: string | null
  defaultOutputName: string | null
}

export interface CoachingWeakKpi {
  kpiId: string
  avgScore: number
  sessionCount: number
  objectiveId: string
}

export interface CoachingPatterns {
  weakKpis: CoachingWeakKpi[]
  reviewCompletionRate: number
  mostRepeatedObjective: { objectiveId: string; count: number } | null
  recentObjectiveIds: string[]
  totalSessionsAnalyzed: number
  highDeathsWarning: boolean
  avgDeathsRecent: number | null
}

export interface ReviewBiasSignal {
  objectiveId: string
  ruleId: string
  severity: 'warning'
  evidence: Record<string, number>
}


declare global {
  interface Window {
    api: AscendAPI
  }
}
