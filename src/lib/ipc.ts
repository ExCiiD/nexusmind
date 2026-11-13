import type { AccessInvite } from './accessCore'
import type { CollabApi } from './collab'
import type { FeedbackApi } from './feedback'
import type { AssistantMoment, AssistantReport } from '../components/Assistant/types'

export type GameEventType =
  | 'kill' | 'death' | 'assist'
  | 'dragon' | 'baron' | 'voidgrub' | 'herald' | 'atakhan'
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
}

export interface CloudStatus {
  /** False when the build has no Supabase URL/key (cloud features hidden). */
  configured: boolean
  user: CloudUser | null
  /** How Riot calls are sent: via the NexusMind proxy, a local dev key, or not at all. */
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

export interface MistakeTrendEntry {
  date: string // YYYY-MM-DD
  counts: Record<string, number>
}

export interface MistakeHeatmapEntry {
  date: string
  tagId: string
  tagSlug: string
  tagLabel: string
  count: number
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

export type TeamRole = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'
export type PoolTier = 'main' | 'comfort' | 'flex' | 'learning'

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

export type NexusMindAPI = CollabApi & FeedbackApi & {
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
  getReviews: (sessionId: string) => Promise<any[]>
  getGameContext: (gameId: string) => Promise<{ game: any; session: any } | null>
  analyzeReviewBias: (gameId: string, objectiveIds: string[]) => Promise<ReviewBiasSignal[]>

  saveAssessment: (scores: Array<{ fundamentalId: string; subcategoryId?: string; score: number }>) => Promise<any>
  getLatestAssessment: () => Promise<any>
  getAssessmentHistory: () => Promise<any[]>

  listSessions: () => Promise<any[]>

  getProgressData: () => Promise<any>
  getSessionStats: () => Promise<any>
  getGameHistory: (limit?: number) => Promise<any[]>
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
  computeStatsAverages: () => Promise<any>
  getStatsSnapshots: () => Promise<any[]>
  autoSnapshot: () => Promise<{ created: number }>
  getAccountAverages: (puuid: string | null) => Promise<{ averages: any; gameCount: number; firstGameAt: string; lastGameAt: string } | null>
  clearStatsSnapshots: () => Promise<{ deleted: number }>

  // Destructive data maintenance (Settings → Danger Zone)
  clearStatsMistakes: () => Promise<{ snapshots: number; detailedStats: number; lanePhase: number; mistakes: number }>
  clearRecentData: (days: number) => Promise<{ games: number; recordings: number; files: number; snapshots: number; sessions: number; mistakes: number }>
  resetAllData: () => Promise<{ sessions: number; games: number; recordings: number; files: number; snapshots: number; matchCache: number; externalReviews: number; assessments: number }>

  getBadges: () => Promise<string[]>

  listAccounts: () => Promise<Array<{ id: string; puuid: string; gameName: string; tagLine: string; region: string; createdAt: string }>>
  addAccount: (gameName: string, tagLine: string, region: string) => Promise<any>
  removeAccount: (accountId: string) => Promise<{ success: boolean }>

  simulateGame: () => Promise<any>
  isDev: () => Promise<boolean>

  onGameEnd: (callback: (data: any) => void) => () => void
  onGameUpdated: (callback: (info: { gameId: string; matchId: string; win: boolean; queueType: string }) => void) => () => void

  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>

  getAppVersion: () => Promise<string>
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

  // NexusMind cloud account & backups
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
  cloudSignOut: () => Promise<{ signedOut: boolean }>
  cloudBackupNow: () => Promise<CloudBackup>
  cloudListBackups: () => Promise<CloudBackup[]>
  cloudRestoreBackup: (id: string) => Promise<{ sessionsAdded: number; gamesAdded: number; reviewsAdded: number; assessmentsAdded: number; snapshotsAdded: number; recordingsAdded: number; externalReviewsAdded: number; conflicts: number; skipped: number }>
  cloudDeleteBackup: (id: string) => Promise<{ deleted: boolean }>
  cloudDeleteAccount: (confirm: 'DELETE') => Promise<{ deleted: boolean }>
  onCloudAuthChanged: (cb: (user: CloudUser | null) => void) => () => void

  // Multi-device sync
  syncStatus: () => Promise<SyncStatus>
  syncNow: () => Promise<SyncStatus>
  onSyncStatus: (cb: (status: SyncStatus) => void) => () => void
  onSyncApplied: (cb: (info: { tables: string[]; count: number }) => void) => () => void

  // Recording — library
  scanRecordings: () => Promise<{ scanned: number; matched: number; orphaned: number; dismissed: number; backfillLinked?: number; backfillNotFound?: number; paths: Array<{ source: string; dir: string; exists: boolean }> }>
  getRecording: (gameId: string) => Promise<{ id: string; gameId: string; filePath: string | null; youtubeUrl: string | null; source: string; createdAt?: string; startOffsetSec?: number | null } | null>
  getRecordingById: (recordingId: string) => Promise<{ id: string; gameId: string | null; filePath: string | null; youtubeUrl: string | null; source: string } | null>
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
  archiveMistakeTag: (tagId: string) => Promise<{ success: boolean }>
  listMistakesByGame: (gameId: string) => Promise<Mistake[]>
  createMistake: (args: { gameId: string; tagId: string; gameTimeSec: number; videoTimeMs?: number; note?: string; severity?: number; recordingId?: string }) => Promise<Mistake>
  updateMistake: (args: { id: string; note?: string | null; severity?: number; tagId?: string }) => Promise<Mistake>
  deleteMistake: (id: string) => Promise<{ success: boolean }>
  autoDetectMistakes: (gameId: string) => Promise<{ created: number; skipped: number; reason: string }>
  getMistakeTopTags: (opts?: { days?: number; role?: string | null; champion?: string | null }) => Promise<MistakeTopTagEntry[]>
  getMistakeTrend: (opts: { tagSlugs?: string[]; days?: number; role?: string | null; champion?: string | null }) => Promise<MistakeTrendEntry[]>
  getMistakeHeatmap: (opts: { days?: number; role?: string | null; champion?: string | null }) => Promise<MistakeHeatmapEntry[]>

  // Bookmarks
  listBookmarks: (recordingId: string) => Promise<Bookmark[]>
  createBookmark: (args: { recordingId: string; videoTimeMs: number; label?: string; color?: string }) => Promise<Bookmark>
  updateBookmark: (args: { id: string; label?: string | null; color?: string | null; videoTimeMs?: number }) => Promise<Bookmark>
  deleteBookmark: (id: string) => Promise<{ success: boolean }>
  deleteRecordingById: (recordingId: string) => Promise<{ success: boolean }>
  resetDismissedRecordings: () => Promise<{ success: boolean }>
  getRecordingScanPaths: () => Promise<Array<{ source: string; dir: string; exists: boolean }>>
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

  // Team management
  listTeams: (opts?: { isOpponent?: boolean }) => Promise<Team[]>
  getTeam: (id: string) => Promise<Team | null>
  createTeam: (data: { name: string; tag?: string; logo?: string; notes?: string; isOpponent?: boolean }) => Promise<Team>
  updateTeam: (id: string, data: Partial<{ name: string; tag: string | null; logo: string | null; notes: string | null; isOpponent: boolean; scoutNotes: string | null }>) => Promise<Team>
  deleteTeam: (id: string) => Promise<{ ok: true }>
  addTeamMember: (teamId: string, data: { displayName: string; ign?: string; tagLine?: string; region?: string; role: string; puuid?: string }) => Promise<TeamMember>
  updateTeamMember: (memberId: string, data: Partial<{ displayName: string; ign: string | null; tagLine: string | null; region: string | null; role: string; puuid: string | null }>) => Promise<TeamMember>
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
  computeOpponentDashboard: (teamId: string) => Promise<TeamSynergyStats>
  listChampionPool: (memberId: string) => Promise<ChampionPoolEntry[]>
  upsertChampionPool: (memberId: string, championKey: string, role: string, data: Partial<{ tier: string; notes: string | null; playRate: number | null; winRate: number | null }>) => Promise<ChampionPoolEntry>
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

  listDrafts: () => Promise<DraftPrep[]>
  getDraft: (id: string) => Promise<DraftPrep | null>
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
  listClips: (recordingId: string) => Promise<Array<{ id: string; title: string | null; startMs: number; endMs: number; filePath: string | null; youtubeUrl: string | null; tempShareUrl: string | null; createdAt: string }>>
  listAllClips: () => Promise<Array<{ clipId: string; recordingId: string; filePath: string | null; thumbnailPath: string | null; title: string | null; startMs: number; endMs: number; createdAt: string; fileSize: number; champion: string | null; opponentChampion: string | null; win: boolean; duration: number }>>
  deleteClip: (clipId: string) => Promise<{ success: boolean }>
  setClipYoutubeUrl: (clipId: string, url: string) => Promise<{ success: boolean }>
  setClipTempShare: (clipId: string, url: string, expiryHours: number) => Promise<{ success: boolean }>
  generateThumbnail: (recordingId: string) => Promise<{ success: boolean; path?: string }>

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
  youtubeAuthStart: () => Promise<{ url: string }>
  youtubeGetStatus: () => Promise<{ connected: boolean; channelName?: string; email?: string }>
  youtubeDisconnect: () => Promise<{ success: boolean }>
  youtubeUpload: (opts: { filePath: string; title: string; description?: string; visibility?: string }) => Promise<{ jobId: string }>
  onYoutubeUploadProgress: (cb: (data: { jobId: string; percent: number }) => void) => () => void

  getCoachingPatterns: () => Promise<CoachingPatterns | null>

  getAssistantReport: (moment: AssistantMoment, gameId?: string | null) => Promise<AssistantReport | null>
  sendAssistantFeedback: (insightKey: string, ruleId: string, moment: AssistantMoment, vote: 1 | -1 | 0) => Promise<{ ok: boolean }>
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
    api: NexusMindAPI
  }
}
