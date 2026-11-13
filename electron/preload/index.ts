import { contextBridge, ipcRenderer } from 'electron'

const api = {
  connectRiot: (gameName: string, tagLine: string, region: string, displayName?: string) =>
    ipcRenderer.invoke('auth:connect-riot', gameName, tagLine, region, displayName),
  disconnectRiot: () =>
    ipcRenderer.invoke('auth:disconnect'),
  reactivateAccount: (userId: string) =>
    ipcRenderer.invoke('auth:reactivate', userId),
  listSavedAccounts: () =>
    ipcRenderer.invoke('auth:list-saved-accounts'),

  createSession: (data: { objectiveId: string; objectiveIds?: string[]; selectedKpiIds?: string[]; subObjective?: string; customNote?: string; date?: string; isRetroactive?: boolean }) =>
    ipcRenderer.invoke('session:create', data),
  getActiveSession: () => ipcRenderer.invoke('session:get-active'),
  getLastSessionConfig: () => ipcRenderer.invoke('session:get-last-config'),
  getKpiHistory: () => ipcRenderer.invoke('session:get-kpi-history'),
  endSession: (id: string, manualSummary?: string, sessionConclusion?: string) => ipcRenderer.invoke('session:end', id, manualSummary, sessionConclusion),
  deleteSession: (id: string) => ipcRenderer.invoke('session:delete', id),
  bulkDeleteSessions: (ids: string[]) => ipcRenderer.invoke('session:bulk-delete', ids),
  cancelSession: (id: string) => ipcRenderer.invoke('session:cancel', id),
  updateSession: (id: string, data: { objectiveIds?: string[]; selectedKpiIds?: string[]; customNote?: string }) =>
    ipcRenderer.invoke('session:update', id, data),
  deleteGame: (gameId: string) => ipcRenderer.invoke('game:delete', gameId),
  setGameReviewStatus: (gameId: string, reviewStatus: 'pending' | 'to_be_reviewed') =>
    ipcRenderer.invoke('session:set-review-status', gameId, reviewStatus),

  saveReview: (data: {
    gameId: string
    timelineNotes: Array<{ time: string; note: string }>
    kpiScores: Record<string, number>
    freeText?: string
    objectiveRespected: boolean
  }) => ipcRenderer.invoke('review:save', data),
  getReviews: (sessionId: string) => ipcRenderer.invoke('review:get-by-session', sessionId),
  getGameContext: (gameId: string) => ipcRenderer.invoke('review:get-game-context', gameId),
  analyzeReviewBias: (gameId: string, objectiveIds: string[]) =>
    ipcRenderer.invoke('review:analyze-bias', { gameId, objectiveIds }),

  saveAssessment: (scores: Array<{ fundamentalId: string; subcategoryId?: string; score: number }>) =>
    ipcRenderer.invoke('assessment:save', scores),
  getLatestAssessment: () => ipcRenderer.invoke('assessment:get-latest'),
  getAssessmentHistory: () => ipcRenderer.invoke('assessment:get-history'),

  listSessions: () => ipcRenderer.invoke('sessions:list'),

  getProgressData: () => ipcRenderer.invoke('analytics:get-progress'),
  getSessionStats: () => ipcRenderer.invoke('analytics:get-session-stats'),
  getGameHistory: (limit?: number) => ipcRenderer.invoke('analytics:get-game-history', limit),
  getKpiTimeline: () => ipcRenderer.invoke('analytics:get-kpi-timeline'),

  onGameEnd: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('game:ended', handler)
    return () => {
      ipcRenderer.removeListener('game:ended', handler)
    }
  },

  // Fired after the background Match-V5 enrich finishes correcting the
  // provisional Game row (real win/loss, matchId, queueType…). The
  // renderer uses this to invalidate cached session/dashboard views so
  // the placeholder `win: false` doesn't linger on a victory.
  onGameUpdated: (callback: (info: { gameId: string; matchId: string; win: boolean; queueType: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: any) => callback(info)
    ipcRenderer.on('game:updated', handler)
    return () => {
      ipcRenderer.removeListener('game:updated', handler)
    }
  },

  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  fetchMatchHistory: (count?: number) => ipcRenderer.invoke('riot:fetch-match-history', count),
  importGamesToSession: (matchIds: string[]) => ipcRenderer.invoke('session:import-games', matchIds),

  getMatchHistoryWithStatus: (count?: number) => ipcRenderer.invoke('stats:match-history', count),
  getDetailedStats: (matchId: string) => ipcRenderer.invoke('stats:get-detailed', matchId),
  computeStatsAverages: () => ipcRenderer.invoke('stats:compute-averages'),
  getStatsSnapshots: () => ipcRenderer.invoke('stats:get-snapshots'),
  autoSnapshot: () => ipcRenderer.invoke('stats:auto-snapshot'),
  getAccountAverages: (puuid: string | null) => ipcRenderer.invoke('stats:get-account-averages', puuid),
  clearStatsSnapshots: () => ipcRenderer.invoke('stats:clear-snapshots'),

  // Destructive data maintenance (Settings → Danger Zone)
  clearStatsMistakes: () => ipcRenderer.invoke('data:clear-stats-mistakes'),
  clearRecentData: (days: number) => ipcRenderer.invoke('data:clear-recent', days),
  resetAllData: () => ipcRenderer.invoke('data:reset-all'),

  getBadges: () => ipcRenderer.invoke('badges:get'),

  listAccounts: () => ipcRenderer.invoke('account:list'),
  addAccount: (gameName: string, tagLine: string, region: string) =>
    ipcRenderer.invoke('account:add', gameName, tagLine, region),
  removeAccount: (accountId: string) => ipcRenderer.invoke('account:remove', accountId),

  simulateGame: () => ipcRenderer.invoke('dev:simulate-game'),
  isDev: () => ipcRenderer.invoke('dev:is-dev'),

  getAppVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
  getUser: () => ipcRenderer.invoke('user:get'),
  updateUser: (data: any) => ipcRenderer.invoke('user:update', data),

  // Bug reports & feature requests
  feedbackSend: (report: unknown) => ipcRenderer.invoke('feedback:send', report),
  feedbackList: () => ipcRenderer.invoke('feedback:list'),

  // Collaboration (groups, coach comments, assigned objectives)
  collabListGroups: () => ipcRenderer.invoke('collab:list-groups'),
  collabCreateGroup: (name: string, kind: 'team' | 'coaching') => ipcRenderer.invoke('collab:create-group', name, kind),
  collabCreateInvite: (groupId: string, role: 'coach' | 'analyst' | 'player', days: number) =>
    ipcRenderer.invoke('collab:create-invite', groupId, role, days),
  collabJoin: (code: string) => ipcRenderer.invoke('collab:join', code),
  collabLeave: (groupId: string) => ipcRenderer.invoke('collab:leave', groupId),
  collabDeleteGroup: (groupId: string, confirm: 'DELETE') => ipcRenderer.invoke('collab:delete-group', groupId, confirm),
  collabRemoveMember: (groupId: string, userId: string) => ipcRenderer.invoke('collab:remove-member', groupId, userId),
  collabSetSharing: (groupId: string, s: { shareReviews: boolean; shareStats: boolean; shareTeam: boolean }) =>
    ipcRenderer.invoke('collab:set-sharing', groupId, s),
  collabPlayerSessions: (playerId: string) => ipcRenderer.invoke('collab:player-sessions', playerId),
  collabListComments: (reviewId: string, playerId?: string) => ipcRenderer.invoke('collab:list-comments', reviewId, playerId),
  collabMyOpenComments: () => ipcRenderer.invoke('collab:my-open-comments'),
  collabAddComment: (c: unknown) => ipcRenderer.invoke('collab:add-comment', c),
  collabResolveComment: (id: string, resolved: boolean) => ipcRenderer.invoke('collab:resolve-comment', id, resolved),
  collabDeleteComment: (id: string) => ipcRenderer.invoke('collab:delete-comment', id),
  collabListAssignments: (playerId?: string, onlyOpen?: boolean) => ipcRenderer.invoke('collab:list-assignments', playerId, onlyOpen),
  collabAssignObjective: (a: unknown) => ipcRenderer.invoke('collab:assign-objective', a),
  collabSetAssignmentStatus: (id: string, status: 'open' | 'done' | 'dismissed') =>
    ipcRenderer.invoke('collab:set-assignment-status', id, status),

  // Ascend cloud account & backups (tokens never leave the main process)
  cloudStatus: () => ipcRenderer.invoke('cloud:status'),
  cloudSendCode: (email: string, inviteCode?: string) => ipcRenderer.invoke('cloud:send-code', email, inviteCode ?? null),
  cloudSignInPassword: (email: string, password: string) => ipcRenderer.invoke('cloud:sign-in-password', email, password),
  cloudSetPassword: (password: string) => ipcRenderer.invoke('cloud:set-password', password),
  cloudOpenWeb: () => ipcRenderer.invoke('cloud:open-web'),
  accessIsAdmin: () => ipcRenderer.invoke('access:is-admin'),
  accessListInvites: () => ipcRenderer.invoke('access:list-invites'),
  accessCreateInvite: (opts: unknown) => ipcRenderer.invoke('access:create-invite', opts),
  accessRevokeInvite: (code: string) => ipcRenderer.invoke('access:revoke-invite', code),
  cloudVerifyCode: (email: string, code: string) => ipcRenderer.invoke('cloud:verify-code', email, code),
  cloudSignOut: () => ipcRenderer.invoke('cloud:sign-out'),
  cloudBackupNow: () => ipcRenderer.invoke('cloud:backup-now'),
  cloudListBackups: () => ipcRenderer.invoke('cloud:list-backups'),
  cloudRestoreBackup: (id: string) => ipcRenderer.invoke('cloud:restore-backup', id),
  cloudDeleteBackup: (id: string) => ipcRenderer.invoke('cloud:delete-backup', id),
  cloudDeleteAccount: (confirm: 'DELETE') => ipcRenderer.invoke('cloud:delete-account', confirm),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  onSyncStatus: (cb: (status: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, s: unknown) => cb(s)
    ipcRenderer.on('sync:status', handler)
    return () => { ipcRenderer.removeListener('sync:status', handler) }
  },
  onSyncApplied: (cb: (info: { tables: string[]; count: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: { tables: string[]; count: number }) => cb(info)
    ipcRenderer.on('sync:applied', handler)
    return () => { ipcRenderer.removeListener('sync:applied', handler) }
  },
  onCloudAuthChanged: (cb: (user: { id: string; email: string | null } | null) => void) => {
    const handler = (_: Electron.IpcRendererEvent, user: { id: string; email: string | null } | null) => cb(user)
    ipcRenderer.on('cloud:auth-changed', handler)
    return () => { ipcRenderer.removeListener('cloud:auth-changed', handler) }
  },

  onUpdateAvailable: (cb: (version?: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, version?: string) => cb(version)
    ipcRenderer.on('updater:update-available', handler)
    return () => { ipcRenderer.removeListener('updater:update-available', handler) }
  },
  onUpdateProgress: (cb: (percent: number) => void) => {
    const handler = (_: Electron.IpcRendererEvent, percent: number) => cb(percent)
    ipcRenderer.on('updater:download-progress', handler)
    return () => { ipcRenderer.removeListener('updater:download-progress', handler) }
  },
  onUpdateDownloaded: (cb: () => void) => {
    ipcRenderer.on('updater:update-downloaded', cb)
    return () => { ipcRenderer.removeListener('updater:update-downloaded', cb) }
  },
  onUpdateError: (cb: (message: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, message: string) => cb(message)
    ipcRenderer.on('updater:error', handler)
    return () => { ipcRenderer.removeListener('updater:error', handler) }
  },
  installUpdate: () => ipcRenderer.invoke('updater:install-now'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check') as Promise<{ updateAvailable: boolean }>,

  exportBackup: () => ipcRenderer.invoke('backup:export') as Promise<
    | { canceled: true }
    | { canceled: false; filePath: string; counts: { sessions: number; games: number; reviews: number; assessments: number; snapshots: number; recordings: number; externalReviews: number } }
  >,
  importBackup: () => ipcRenderer.invoke('backup:import') as Promise<
    | { canceled: true }
    | { canceled: false; summary: { sessionsAdded: number; gamesAdded: number; reviewsAdded: number; assessmentsAdded: number; snapshotsAdded: number; recordingsAdded: number; externalReviewsAdded: number; conflicts: number; skipped: number } }
  >,

  // Recording — library (scan external folders)
  scanRecordings: () => ipcRenderer.invoke('recording:scan'),
  getRecording: (gameId: string) => ipcRenderer.invoke('recording:get', gameId),
  getRecordingById: (recordingId: string) => ipcRenderer.invoke('recording:get-by-id', recordingId),
  linkRecordingFile: (gameId: string) => ipcRenderer.invoke('recording:link-file', gameId),
  setYoutubeUrl: (gameId: string, youtubeUrl: string | null) => ipcRenderer.invoke('recording:set-youtube', gameId, youtubeUrl),
  deleteReview: (gameId: string) => ipcRenderer.invoke('review:delete', gameId),
  deleteRecording: (gameId: string) => ipcRenderer.invoke('recording:delete', gameId),
  unlinkRecording: (gameId: string) => ipcRenderer.invoke('recording:unlink', gameId),
  // Tries to recreate the missing Game row from Riot match history.
  // Pass a recordingId to limit to a single orphan; omit to backfill all.
  backfillOrphanRecordings: (recordingId?: string) => ipcRenderer.invoke('recording:backfill-orphans', recordingId),
  // Diagnostic variant of getGameEvents: returns events + reason/frameCount
  // so the UI can show "X events loaded" or a helpful error.
  refreshGameEvents: (gameId: string, forceRefetch = true) => ipcRenderer.invoke('stats:refresh-game-events', gameId, forceRefetch),
  deleteRecordingById: (recordingId: string) => ipcRenderer.invoke('recording:delete-by-id', recordingId),
  resetDismissedRecordings: () => ipcRenderer.invoke('recording:reset-dismissed'),
  getRecordingScanPaths: () => ipcRenderer.invoke('recording:get-scan-paths'),
  listGamesWithRecordings: () => ipcRenderer.invoke('recording:list-with-games'),
  // Recording — in-app capture
  pickRecordingFolder: () => ipcRenderer.invoke('recording:pick-folder'),
  getCaptureStatus: () => ipcRenderer.invoke('recording:get-capture-status'),
  startCapture: () => ipcRenderer.invoke('recording:start-capture'),
  stopCapture: (gameId?: string) => ipcRenderer.invoke('recording:stop-capture', gameId),
  getRecordingsDir: () => ipcRenderer.invoke('recording:get-recordings-dir'),

  // Audio devices (native-audio-node) — stable ids, no Chromium permission prompt
  listAudioDevices: () => ipcRenderer.invoke('audio:list-devices'),
  openSoundSettings: () => ipcRenderer.invoke('system:open-sound-settings'),
  onRecordingStarted: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('recording:started', handler)
    return () => ipcRenderer.removeListener('recording:started', handler)
  },
  onRecordingStopped: (cb: (data: { filePath: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { filePath: string }) => cb(data)
    ipcRenderer.on('recording:stopped', handler)
    return () => ipcRenderer.removeListener('recording:stopped', handler)
  },
  onRecordingLinked: (cb: (data: { gameId: string; filePath: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { gameId: string; filePath: string }) => cb(data)
    ipcRenderer.on('recording:linked', handler)
    return () => ipcRenderer.removeListener('recording:linked', handler)
  },
  onRecordingProcessing: (cb: (data: { gameId?: string; source: 'auto' | 'manual' }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { gameId?: string; source: 'auto' | 'manual' }) => cb(data)
    ipcRenderer.on('recording:processing', handler)
    return () => ipcRenderer.removeListener('recording:processing', handler)
  },
  onRecordingReady: (cb: (data: { recordingId: string | null; gameId?: string; filePath: string; durationSec: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { recordingId: string | null; gameId?: string; filePath: string; durationSec: number }) => cb(data)
    ipcRenderer.on('recording:ready', handler)
    return () => ipcRenderer.removeListener('recording:ready', handler)
  },
  onRecordingFailed: (cb: (data: { reason: string; filePath?: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { reason: string; filePath?: string }) => cb(data)
    ipcRenderer.on('recording:failed', handler)
    return () => ipcRenderer.removeListener('recording:failed', handler)
  },

  // Game events (kills, dragons, towers…) for video player timeline markers
  getGameEvents: (gameId: string) => ipcRenderer.invoke('stats:get-game-events', gameId),
  // R1: draft timestamped notes built from this game's own events + mistakes
  getPrefilledNotes: (gameId: string) => ipcRenderer.invoke('review:prefilled-notes', gameId),

  // Lane Phase Comparator — lazy-computed + cached on the Game row.
  // `getLanePhase` is the read-through path, `refreshLanePhase` forces a
  // full re-fetch from Riot.
  getLanePhase: (gameId: string) => ipcRenderer.invoke('stats:get-lane-phase', gameId),
  refreshLanePhase: (gameId: string) => ipcRenderer.invoke('stats:refresh-lane-phase', gameId),

  // Mistake Library — manual tagging + 4 heuristic auto-detections.
  listMistakeTags: (opts?: { includeArchived?: boolean }) => ipcRenderer.invoke('mistake:list-tags', opts),
  createMistakeTag: (args: { label: string; category: string; icon?: string; color?: string }) =>
    ipcRenderer.invoke('mistake:create-tag', args),
  archiveMistakeTag: (tagId: string) => ipcRenderer.invoke('mistake:archive-tag', tagId),
  listMistakesByGame: (gameId: string) => ipcRenderer.invoke('mistake:list-by-game', gameId),
  createMistake: (args: { gameId: string; tagId: string; gameTimeSec: number; videoTimeMs?: number; note?: string; severity?: number; recordingId?: string }) =>
    ipcRenderer.invoke('mistake:create', args),
  updateMistake: (args: { id: string; note?: string | null; severity?: number; tagId?: string }) =>
    ipcRenderer.invoke('mistake:update', args),
  deleteMistake: (id: string) => ipcRenderer.invoke('mistake:delete', id),
  autoDetectMistakes: (gameId: string) => ipcRenderer.invoke('mistake:auto-detect', gameId),
  getMistakeTopTags: (opts?: { days?: number; role?: string | null; champion?: string | null }) =>
    ipcRenderer.invoke('mistake-stats:top-tags', opts),
  getMistakeTrend: (opts: { tagSlugs?: string[]; days?: number; role?: string | null; champion?: string | null }) =>
    ipcRenderer.invoke('mistake-stats:trend', opts),
  getMistakeHeatmap: (opts: { days?: number; role?: string | null; champion?: string | null }) =>
    ipcRenderer.invoke('mistake-stats:heatmap', opts),

  // Bookmarks — per-recording free markers (works even on orphan recordings).
  listBookmarks: (recordingId: string) => ipcRenderer.invoke('bookmark:list-by-recording', recordingId),
  createBookmark: (args: { recordingId: string; videoTimeMs: number; label?: string; color?: string }) =>
    ipcRenderer.invoke('bookmark:create', args),
  updateBookmark: (args: { id: string; label?: string | null; color?: string | null; videoTimeMs?: number }) =>
    ipcRenderer.invoke('bookmark:update', args),
  deleteBookmark: (id: string) => ipcRenderer.invoke('bookmark:delete', id),

  // ── Team management ────────────────────────────────────────────────────────
  listTeams: (opts?: { isOpponent?: boolean }) => ipcRenderer.invoke('team:list', opts),
  getTeam: (id: string) => ipcRenderer.invoke('team:get', id),
  createTeam: (data: { name: string; tag?: string; logo?: string; notes?: string; isOpponent?: boolean }) =>
    ipcRenderer.invoke('team:create', data),
  updateTeam: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke('team:update', id, data),
  deleteTeam: (id: string) => ipcRenderer.invoke('team:delete', id),
  addTeamMember: (teamId: string, data: { displayName: string; ign?: string; tagLine?: string; region?: string; role: string; puuid?: string }) =>
    ipcRenderer.invoke('team:add-member', teamId, data),
  updateTeamMember: (memberId: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('team:update-member', memberId, data),
  removeTeamMember: (memberId: string) => ipcRenderer.invoke('team:remove-member', memberId),
  dedupeTeamMembers: (teamId: string) => ipcRenderer.invoke('team:dedupe-members', teamId),
  computeTeamSynergyStats: (teamId: string, opts?: { matchesPerMember?: number; minTogether?: number }) =>
    ipcRenderer.invoke('team:compute-synergy-stats', teamId, opts),
  importCustomGameCsv: (teamId: string, opts?: { csvContent?: string; filename?: string; forceType?: 'scrim' | 'tournament' }) =>
    ipcRenderer.invoke('team:import-custom-game-csv', teamId, opts),
  listCustomGames: (teamId: string, gameType?: 'scrim' | 'tournament') =>
    ipcRenderer.invoke('team:list-custom-games', teamId, gameType),
  deleteCustomGame: (id: string) =>
    ipcRenderer.invoke('team:delete-custom-game', id),
  computeCustomStats: (teamId: string, gameType: 'scrim' | 'tournament' | 'all') =>
    ipcRenderer.invoke('team:compute-custom-stats', teamId, gameType),
  computeCombinedStats: (teamId: string, opts?: { minTogether?: number }) =>
    ipcRenderer.invoke('team:compute-combined-stats', teamId, opts),
  computeOpponentDashboard: (teamId: string) =>
    ipcRenderer.invoke('team:compute-opponent-dashboard', teamId),
  listChampionPool: (memberId: string) => ipcRenderer.invoke('team:pool-list', memberId),
  upsertChampionPool: (memberId: string, championKey: string, role: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('team:pool-upsert', memberId, championKey, role, data),
  removeChampionPoolEntry: (entryId: string) => ipcRenderer.invoke('team:pool-remove', entryId),
  scoutMember: (memberId: string, count?: number, opts?: { roleOnly?: boolean }) =>
    ipcRenderer.invoke('team:scout-member', memberId, count, opts),
  autoFillPool: (memberId: string, opts?: { matchCount?: number; masteryCount?: number; overwriteTiers?: boolean; roleOnly?: boolean }) =>
    ipcRenderer.invoke('team:auto-fill-pool', memberId, opts),

  listDrafts: () => ipcRenderer.invoke('draft:list'),
  getDraft: (id: string) => ipcRenderer.invoke('draft:get', id),
  createDraft: (data: { name: string; vsTeamId?: string | null; bluePicks?: string[]; blueBans?: string[]; redPicks?: string[]; redBans?: string[]; myTeamSide?: 'blue' | 'red'; notes?: string }) =>
    ipcRenderer.invoke('draft:create', data),
  updateDraft: (id: string, data: Record<string, unknown>) => ipcRenderer.invoke('draft:update', id, data),
  deleteDraft: (id: string) => ipcRenderer.invoke('draft:delete', id),
  duplicateDraft: (id: string) => ipcRenderer.invoke('draft:duplicate', id),

  // External reviews
  fetchExternalPlayerHistory: (gameName: string, tagLine: string, region: string, count?: number) =>
    ipcRenderer.invoke('external-review:fetch-player-history', gameName, tagLine, region, count),
  createExternalReview: (data: {
    title: string
    objectiveId?: string
    objectiveIds?: string
    selectedKpiIds?: string
    filePath?: string
    playerName?: string
    matchData?: string
  }) => ipcRenderer.invoke('external-review:create', data),
  getExternalReview: (id: string) => ipcRenderer.invoke('external-review:get', id),
  saveExternalReview: (id: string, data: { timelineNotes?: string; freeText?: string; filePath?: string }) =>
    ipcRenderer.invoke('external-review:save', id, data),
  listExternalReviews: () => ipcRenderer.invoke('external-review:list'),
  pickExternalReviewFile: () => ipcRenderer.invoke('external-review:pick-file'),
  deleteExternalReview: (id: string) => ipcRenderer.invoke('external-review:delete', id),

  // Sharing
  sendToDiscord: (embeds: object[], webhookUrl: string) => ipcRenderer.invoke('share:send-to-discord', embeds, webhookUrl),
  copyReviewText: (text: string) => ipcRenderer.invoke('share:copy-text', text),
  listWebhooks: () => ipcRenderer.invoke('share:list-webhooks'),
  addWebhook: (name: string, url: string) => ipcRenderer.invoke('share:add-webhook', name, url),
  renameWebhook: (id: string, name: string) => ipcRenderer.invoke('share:rename-webhook', id, name),
  deleteWebhook: (id: string) => ipcRenderer.invoke('share:delete-webhook', id),

  // Coaching (deterministic, rule-based)
  getCoachingPatterns: () => ipcRenderer.invoke('coaching:get-patterns'),

  // Assistant (Phase A — rule-based, local)
  getAssistantReport: (moment: string, gameId?: string | null) => ipcRenderer.invoke('assistant:get-report', moment, gameId ?? null),
  sendAssistantFeedback: (insightKey: string, ruleId: string, moment: string, vote: 1 | -1 | 0) =>
    ipcRenderer.invoke('assistant:feedback', insightKey, ruleId, moment, vote),
  // Coaching engine — experiments (closed loop)
  coachExperiments: () => ipcRenderer.invoke('coach:experiments'),
  coachStartExperiment: (problemId: string, tagSlug: string | null, ruleId: string | null) =>
    ipcRenderer.invoke('coach:start-experiment', problemId, tagSlug, ruleId),
  coachAbandonExperiment: (experimentId: string) => ipcRenderer.invoke('coach:abandon-experiment', experimentId),
  coachObjectiveCheck: (gameId: string) => ipcRenderer.invoke('coach:objective-check', gameId),
  // R4/R5: which unreviewed game to review first, and the backlog size
  reviewPriorityGame: () => ipcRenderer.invoke('review:priority-game'),
  // P1: stats/bilan gap check (reassessment reminder)
  coachReassessmentCheck: () => ipcRenderer.invoke('coach:reassessment-check'),
  // Lot 5: pre-fill the next self-assessment from recent stats
  coachSuggestedScores: () => ipcRenderer.invoke('coach:suggested-scores'),
  // Lot 5: minimal game info for an insight's "Why?" evidence list
  coachGamesByIds: (gameIds: string[]) => ipcRenderer.invoke('coach:games-by-ids', gameIds),

  // Clips
  createClip: (opts: { recordingId: string; startMs: number; endMs: number; title?: string; linkedNoteText?: string }) =>
    ipcRenderer.invoke('clip:create', opts),
  exportClip: (opts: { recordingId: string; startMs: number; endMs: number; title?: string; linkedNoteText?: string }) =>
    ipcRenderer.invoke('clip:export', opts),
  listClips: (recordingId: string) => ipcRenderer.invoke('clip:list', recordingId),
  listAllClips: () => ipcRenderer.invoke('clip:list-all'),
  deleteClip: (clipId: string) => ipcRenderer.invoke('clip:delete', clipId),
  setClipYoutubeUrl: (clipId: string, url: string) => ipcRenderer.invoke('clip:set-youtube', clipId, url),
  setClipTempShare: (clipId: string, url: string, expiryHours: number) =>
    ipcRenderer.invoke('clip:set-temp-share', clipId, url, expiryHours),
  generateThumbnail: (recordingId: string) => ipcRenderer.invoke('recording:generate-thumbnail', recordingId),

  // Sharing (files + temp upload)
  sendFileToDiscord: (filePath: string, webhookUrl: string, caption?: string) =>
    ipcRenderer.invoke('share:send-file-to-discord', filePath, webhookUrl, caption),
  uploadToTemp: (filePath: string, expiryHours: number) =>
    ipcRenderer.invoke('share:upload-temp', filePath, expiryHours),

  // YouTube OAuth + upload
  youtubeAuthStart: () => ipcRenderer.invoke('youtube:auth-start'),
  youtubeGetStatus: () => ipcRenderer.invoke('youtube:get-status'),
  youtubeDisconnect: () => ipcRenderer.invoke('youtube:disconnect'),
  youtubeUpload: (opts: { filePath: string; title: string; description?: string; visibility?: string }) =>
    ipcRenderer.invoke('youtube:upload', opts),
  onYoutubeUploadProgress: (cb: (data: { jobId: string; percent: number }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: any) => cb(data)
    ipcRenderer.on('youtube:upload-progress', handler)
    return () => ipcRenderer.removeListener('youtube:upload-progress', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)

// Dedicated API for the hidden WGC capture renderer. Exposed to all renderers
// but only consumed by `src/wgc-capture.ts` in the capture window.
// Kept narrow: no filesystem access, no access to any business data.
const wgcAPI = {
  listScreenSources: () =>
    ipcRenderer.invoke('wgc:list-screen-sources') as Promise<
      Array<{ id: string; name: string; display_id?: string }>
    >,
  onStart: (
    cb: (payload: {
      recordFps: number
      targetHeight: number
      bitrateKbps: number
      sourceId: string
      mainWindowId: number
    }) => void,
  ) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      payload: {
        recordFps: number
        targetHeight: number
        bitrateKbps: number
        sourceId: string
        mainWindowId: number
      },
    ) => cb(payload)
    ipcRenderer.on('wgc:start', handler)
    return () => ipcRenderer.removeListener('wgc:start', handler)
  },
  onStop: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('wgc:stop', handler)
    return () => ipcRenderer.removeListener('wgc:stop', handler)
  },
  sendStarted: (info: {
    mimeType: string
    width: number
    height: number
    audioTracks: number
    audioDesktop: boolean
    audioMic: boolean
  }) => {
    ipcRenderer.send('wgc:started', info)
  },
  sendStopped: () => {
    ipcRenderer.send('wgc:stopped')
  },
  sendError: (message: string) => {
    ipcRenderer.send('wgc:error', message)
  },
  sendChunk: (chunk: ArrayBuffer, isLast: boolean) => {
    // ArrayBuffer is structured-cloned across the IPC boundary. For typical
    // 1-second chunks (~1-3 MB) this is negligible overhead.
    ipcRenderer.send('wgc:chunk', chunk, isLast)
  },
}

contextBridge.exposeInMainWorld('wgcAPI', wgcAPI)
