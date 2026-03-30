export type NexusMindAPI = {
  connectRiot: (gameName: string, tagLine: string, region: string, displayName?: string) => Promise<any>
  disconnectRiot: () => Promise<void>

  createSession: (data: { objectiveId: string; objectiveIds?: string[]; selectedKpiIds?: string[]; subObjective?: string; customNote?: string; date?: string; isRetroactive?: boolean }) => Promise<any>
  getActiveSession: () => Promise<any>
  endSession: (id: string, manualSummary?: string) => Promise<any>
  deleteSession: (id: string) => Promise<any>
  deleteGame: (gameId: string) => Promise<any>
  setGameReviewStatus: (gameId: string, reviewStatus: 'pending' | 'to_be_reviewed') => Promise<any>

  saveReview: (data: {
    gameId: string
    timelineNotes: Array<{ time: string; note: string }>
    kpiScores: Record<string, number>
    freeText?: string
    objectiveRespected: boolean
  }) => Promise<any>
  getReviews: (sessionId: string) => Promise<any[]>
  analyzeReviewBias: (gameId: string, objectiveIds: string[]) => Promise<ReviewBiasSignal[]>

  saveAssessment: (scores: Array<{ fundamentalId: string; subcategoryId?: string; score: number }>) => Promise<any>
  getLatestAssessment: () => Promise<any>
  getAssessmentHistory: () => Promise<any[]>

  listSessions: () => Promise<any[]>

  getProgressData: () => Promise<any>
  getSessionStats: () => Promise<any>
  getGameHistory: (limit?: number) => Promise<any[]>

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

  getBadges: () => Promise<string[]>

  listAccounts: () => Promise<Array<{ id: string; gameName: string; tagLine: string; region: string; createdAt: string }>>
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

  // Coach / Supabase auth
  supabaseSignIn: (email: string, password: string) => Promise<{ uid: string; email?: string }>
  supabaseSignUp: (email: string, password: string) => Promise<{ uid: string; email?: string; needsConfirmation: boolean }>
  supabaseSignOut: () => Promise<{ success: boolean }>
  getSupabaseSession: () => Promise<{ uid: string; email?: string } | null>
  setRole: (role: string) => Promise<any>

  // Invite system
  generateInvite: () => Promise<{ code: string; link: string }>
  redeemInvite: (code: string) => Promise<{ coachName: string }>
  listCoaches: () => Promise<Array<{ relationId: string; displayName: string; puuid: string }>>
  listStudents: () => Promise<Array<{ relationId: string; supabaseId: string; displayName: string; puuid: string }>>

  // Student data for coach
  getStudentSessions: (studentSupabaseId: string) => Promise<any[]>
  getStudentAssessments: (studentSupabaseId: string) => Promise<any[]>

  // Coach comments
  addCoachComment: (data: { studentSupabaseId: string; targetType: 'session' | 'game' | 'review'; targetId: string; content: string }) => Promise<any>
  updateCoachComment: (commentId: string, content: string) => Promise<any>
  deleteCoachComment: (commentId: string) => Promise<{ success: boolean }>
  getCoachComments: (targetType: string, targetId: string) => Promise<any[]>

  // Sync
  syncToSupabase: () => Promise<{ success: boolean }>

  // Recording
  scanRecordings: () => Promise<{ scanned: number; matched: number; paths: Array<{ source: string; dir: string; exists: boolean }> }>
  getRecording: (gameId: string) => Promise<{ id: string; gameId: string; filePath: string | null; youtubeUrl: string | null; source: string } | null>
  linkRecordingFile: (gameId: string) => Promise<any>
  setYoutubeUrl: (gameId: string, youtubeUrl: string | null) => Promise<any>
  deleteRecording: (gameId: string) => Promise<{ success: boolean }>
  getRecordingScanPaths: () => Promise<Array<{ source: string; dir: string; exists: boolean }>>
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
