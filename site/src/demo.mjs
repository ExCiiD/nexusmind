/**
 * Demonstration account of the showcase site. Every number below is invented
 * (and labelled as such on the page); everything derived from it — the QCM
 * options, the Codex fiches, the ranking, the win-rate gaps, the radar, the
 * calibration verdict — is computed by the app's own modules in build.mjs.
 *
 * One coherent story: a jungler whose early game is fine and whose farm and
 * objective setups are slipping, at the end of a session that turned sour.
 */

export const PLAYER = { name: 'Kaito', role: 'JUNGLE', team: 100 }

/** The lost game the micro-review is about (30:12). Positions are Riot map units. */
export const MOMENTS = [
  {
    trigger: 'early-deficit', gameTimeSec: 195, severity: 0.12, position: { x: 3600, y: 7200 },
    facts: { pattern: 'jungle-passive-clear', botGoldLead: 420, xpDiffJungle: -60 },
  },
  {
    trigger: 'absent-objective', gameTimeSec: 910, severity: 0.18, position: { x: 5700, y: 7800 },
    facts: { objective: 'dragon', pattern: 'tempo-hesitation', approachedBy: 2100, playerDistance: 3400, nearestPit: 'dragon', nearObjective: false },
  },
  {
    trigger: 'critical-death', gameTimeSec: 1528, severity: 0.34, position: { x: 5600, y: 10000 },
    facts: {
      assisters: 2, enemiesInvolved: 3, alliesNearby: 0, goldInPocket: 1650, wardedLast60s: false, secondsSinceOwnPlay: null,
      nearestPit: 'baron', pitDistance: 760, nearObjective: true, objectiveLost: 'baron', objectiveLostAfterSec: 30,
    },
  },
]
/** Index of the moment shown first on the page (the death next to Baron speaks to every role). */
export const FIRST_MOMENT = 2

/** 14 analysed games of the last 30 days, oldest first: true = win. */
export const GAMES = [true, false, false, true, false, true, false, false, true, true, false, true, false, false]

/** Tagged mistakes: slug → [game number (1-based), game time in seconds]. */
export const MISTAKES = {
  'no-ward-pre-obj': [[2, 840], [2, 1590], [3, 1130], [4, 905], [5, 610], [5, 1380], [7, 1000], [9, 1210], [11, 760], [11, 1700], [12, 1450], [14, 930], [14, 1498]],
  'forgot-trinket': [[1, 420], [5, 380], [5, 900], [8, 510], [10, 460], [11, 640]],
  'death-before-objective': [[3, 1180], [6, 1705], [8, 1290], [13, 1620], [14, 1528]],
  overstay: [[2, 1320], [7, 1105], [9, 880], [13, 1260]],
  'caught-out': [[5, 1510], [8, 990], [14, 1745]],
  'bad-positioning': [[3, 1640], [12, 1810]],
  'cs-deficit': [[2, 600], [11, 600]],
  'unused-gold': [[7, 1420]],
}
/** Period shown by the Mistake Lab preview (days). */
export const LAB_DAYS = 30

/** Averages in the shape computeAverages() returns: last 15 games, last 40 games. */
export const RADAR = {
  carry: {
    recent: {
      meta: { avgKills: 5.1, avgAssists: 7.9, avgDeaths: 4.6 },
      economy: { csPerMin: 6.1, goldPerMin: 398 },
      combat: { damagePerMin: 612, killParticipation: 61 },
      laning: { firstBloodRate: 24, cs15: 96, xp15: 6850, gold15: 5980 },
    },
    snapshot: {
      meta: { avgKills: 4.8, avgAssists: 7.2, avgDeaths: 4.9 },
      economy: { csPerMin: 6.6, goldPerMin: 404 },
      combat: { damagePerMin: 588, killParticipation: 57 },
      laning: { firstBloodRate: 18, cs15: 104, xp15: 6720, gold15: 5610 },
    },
  },
  support: {
    recent: {
      meta: { avgKills: 1.4, avgAssists: 13.2, avgDeaths: 5.4 },
      combat: { killParticipation: 64, healShieldPerMin: 410, damagePerMin: 330, damageMitigatedPerMin: 380, ccPerMin: 1.4 },
      vision: { visionScorePerMin: 2.3, visionScoreAdvantage: 9, controlWardsPurchased: 4.1, wardsDestroyed: 3.2 },
    },
    snapshot: {
      meta: { avgKills: 1.2, avgAssists: 12.1, avgDeaths: 4.7 },
      combat: { killParticipation: 61, healShieldPerMin: 380, damagePerMin: 310, damageMitigatedPerMin: 365, ccPerMin: 1.5 },
      vision: { visionScorePerMin: 2.0, visionScoreAdvantage: 4, controlWardsPurchased: 3.4, wardsDestroyed: 2.6 },
    },
  },
  recentGames: 15,
  snapshotGames: 40,
}

export const DASHBOARD = {
  totalGames: 84,
  overallWinrate: 55,
  avgKda: 3.47,
  objectivesKept: 72,
  streakDays: 4,
  /** Total XP: level 10 with 225 XP into it. */
  level: 10,
  xpIntoLevel: 225,
  /** The running session: the last four games of GAMES. */
  sessionGames: 4,
  sessionObjectives: ['wave_management', 'vision_control'],
  gamesSinceCalibration: 16,
}

/** XP granted by the app (electron/main/ipc: review 50, micro-review 30, assessment 100). */
export const XP_SOURCES = { review: 50, microReview: 30, assessment: 100 }
