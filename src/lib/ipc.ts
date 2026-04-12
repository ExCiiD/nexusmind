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

export type NexusMindAPI = {
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

  getObjectiveSuggestion: (scores: Record<string, number>) => Promise<string>
  synthesizeReview: (data: { timelineNotes: any[]; kpiScores: Record<string, number>; objective: string }) => Promise<string>
  analyzePatterns: (reviews: any[]) => Promise<string>
  generateSessionSummary: (sessionId: string) => Promise<string>

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

  getBadges: () => Promise<string[]>

  listAccounts: () => Promise<Array<{ id: string; puuid: string; gameName: string; tagLine: string; region: string; createdAt: string }>>
  addAccount: (gameName: string, tagLine: string, region: string) => Promise<any>
  removeAccount: (accountId: string) => Promise<{ success: boolean }>

  simulateGame: () => Promise<any>
  isDev: () => Promise<boolean>

  onGameEnd: (callback: (data: any) => void) => () => void

  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>

  getUser: () => Promise<any>
  updateUser: (data: any) => Promise<any>

  onUpdateAvailable: (cb: () => void) => void
  onUpdateDownloaded: (cb: () => void) => void
  installUpdate: () => Promise<void>

  // Recording — library
  scanRecordings: () => Promise<{ scanned: number; matched: number; paths: Array<{ source: string; dir: string; exists: boolean }> }>
  getRecording: (gameId: string) => Promise<{ id: string; gameId: string; filePath: string | null; youtubeUrl: string | null; source: string } | null>
  linkRecordingFile: (gameId: string) => Promise<any>
  setYoutubeUrl: (gameId: string, youtubeUrl: string | null) => Promise<any>
  deleteRecording: (gameId: string) => Promise<{ success: boolean }>
  deleteRecordingById: (recordingId: string) => Promise<{ success: boolean }>
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
  onRecordingStarted: (cb: () => void) => () => void
  onRecordingStopped: (cb: (data: { filePath: string }) => void) => () => void
  onRecordingLinked: (cb: (data: { gameId: string; filePath: string }) => void) => () => void

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
  listClips: (recordingId: string) => Promise<Array<{ id: string; title: string | null; startMs: number; endMs: number; filePath: string | null; youtubeUrl: string | null; tempShareUrl: string | null; createdAt: string }>>
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
