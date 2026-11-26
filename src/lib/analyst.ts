/**
 * #40 analyst features (docs/DESIGN_STATE.md §§ 10-12, mockups validated by the user on 19/11/2026): the contract
 * shared by the desktop (IPC), the web adapter and the screens. Pure types and the API surface only. The pure
 * computations live in teamTimelineCore.ts, draftLogCore.ts and opponentDossierCore.ts, importable by both apps.
 *
 * Opponents are keyed by `opponentKey` (opponentKeyOf: the name, trimmed, lower case), not by team_scouting.id:
 * publishing a team rewrites the group's scouting rows, so their ids change on every publish.
 */
import type { TeamRole } from './team'
import type { TimelinePlayers } from './playerSessionStatsCore'

export type TeamGameSource = 'flex' | 'scrim' | 'tournament'
export type TeamSide = 'blue' | 'red'

/** The opponent's key in the draft log and the dossiers: name trimmed, inner spaces collapsed, lower case. */
export function opponentKeyOf(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

// ── § 10 Objectives and game rhythm ──────────────────────────────────────

export type ObjectiveKind = 'dragon' | 'elder' | 'grubs' | 'herald' | 'baron' | 'tower' | 'firstBlood'

export interface TeamTimelineEvent {
  kind: ObjectiveKind
  /** Game time of the event (s). */
  atSec: number
  /** Taken (or killed, for first blood) by our team. */
  ours: boolean
  /** Dragon: 'FIRE' | 'WATER' | 'EARTH' | 'AIR' | 'HEXTECH' | 'CHEMTECH'. Tower: 'OUTER' | 'INNER' | 'BASE' | 'NEXUS'. */
  subType?: string
  /** Tower lane. */
  lane?: 'TOP' | 'MID' | 'BOT'
  /** Grubs: how many Void Grubs this event killed (Riot logs each one). */
  count?: number
}

/** One team game reduced to what the Objectives tab needs (a timeline weighs 0.5-2 MB, this a few kB). */
export interface TeamGameTimeline {
  /** Bumped when the extraction changes: older cached summaries are extracted again. */
  version: number
  gameId: string
  matchId: string
  /** ISO time the game started. */
  playedAt: string
  durationSec: number
  source: TeamGameSource
  side: TeamSide
  win: boolean
  opponentName: string | null
  /** "16.22" (major.minor of info.gameVersion). */
  patch: string
  /** Void Grubs the game offered: 3 since patch 25.09 (game version 15.9), 6 before (two camps). */
  grubsAvailable: number
  events: TeamTimelineEvent[]
  /** Our total gold minus theirs at each minute (index = minute, from 0). */
  goldDiffByMinute: number[]
  /** Per-player minute series and champion kills (individual stats). Absent on summaries cached before it: no version bump. */
  players?: TimelinePlayers
}

/** A team game the tab can read, and whether its summary is already cached for everyone. */
export interface TeamObjectivesGameRef {
  gameId: string
  matchId: string
  playedAt: string
  source: TeamGameSource
  cached: boolean
}

export type TeamTimelineUnavailable = { unavailable: 'no-timeline' | 'no-side' | 'riot-error'; message?: string }

export interface TeamObjectivesFilters {
  /** ISO dates, inclusive. Absent = no bound. */
  from?: string
  to?: string
  /** Default ['scrim', 'tournament']. */
  sources: TeamGameSource[]
  side: 'both' | TeamSide
}

export interface ShareStat { share: number | null; games: number }

export interface TeamObjectivesSummary {
  games: number
  /** Most frequent patch of the games, null without games. */
  patch: string | null
  /** Under 5 games (§ 10: values shown dimmed). */
  lowSample: boolean
  tiles: {
    dragons: { share: number | null; firstDragonShare: number | null; soulsOurs: number; soulGames: number }
    grubs: { avgTaken: number | null; available: number; firstCampShare: number | null }
    herald: { share: number | null; avgAtSec: number | null }
    baron: { share: number | null; baronToWinShare: number | null }
    firstBlood: { share: number | null; avgAtSec: number | null }
    firstTower: { share: number | null; avgAtSec: number | null; mostLane: 'TOP' | 'MID' | 'BOT' | null }
  }
  /** Average gold difference (ours − theirs) per minute 0..30; null where no game lasted that long. */
  goldCurve: { all: Array<number | null>; blue: Array<number | null>; red: Array<number | null> }
  /** Most recent first. */
  timeline: TeamGameTimeline[]
  /** First occurrence of each objective: our average time vs theirs. */
  avgTimings: Array<{ kind: ObjectiveKind; oursSec: number | null; theirsSec: number | null }>
}

// ── § 11 Draft log ─────────────────────────────────────────────────────────

export interface DraftPick { champion: string; role: TeamRole | null }

export interface DraftLogEntry {
  id: string
  groupId: string
  /** Null for a draft added by hand. */
  matchId: string | null
  source: TeamGameSource | 'manual'
  playedAt: string
  patch: string | null
  opponentName: string | null
  opponentKey: string | null
  side: TeamSide
  /** Null when not known (a draft typed by hand without a result). */
  win: boolean | null
  durationSec: number | null
  /** Top → support when roles are known. */
  ourPicks: DraftPick[]
  theirPicks: DraftPick[]
  /** Null = no bans in that game (a custom without draft mode), or not typed. */
  ourBans: string[] | null
  theirBans: string[] | null
  /** The 10 picks in order (B1 R1 R2 B2 …) as champion names, typed by the analyst. Match-v5 does not give it. */
  pickOrder: string[] | null
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface DraftLogInput {
  playedAt: string
  source: TeamGameSource | 'manual'
  opponentName: string | null
  side: TeamSide
  win: boolean | null
  ourPicks: DraftPick[]
  theirPicks: DraftPick[]
  ourBans: string[] | null
  theirBans: string[] | null
  notes?: string | null
}

export type DraftLogPatch = Partial<Pick<DraftLogEntry, 'opponentName' | 'win' | 'ourBans' | 'theirBans' | 'pickOrder' | 'notes'>>

export interface DraftLogFilters {
  opponentKey?: string | null
  sources?: Array<TeamGameSource | 'manual'>
  side?: 'both' | TeamSide
  patch?: string | null
  /** Picked or banned, by us or them. */
  champion?: string | null
  result?: 'all' | 'win' | 'loss'
}

export interface DraftChampionRow { champion: string; games: number; wins: number; winRate: number | null; role: TeamRole | null }

export interface DraftLogSummary {
  count: number
  wins: number
  losses: number
  blue: ShareStat & { wins: number }
  red: ShareStat & { wins: number }
  /** Only from drafts with a typed pick order. Null when none has one. */
  ourFirstPick: (ShareStat & { wins: number }) | null
  /** The 3 champions most banned against us. */
  bannedAgainstUs: Array<{ champion: string; count: number }>
  ourPicks: DraftChampionRow[]
  /** What opponents pick against us: wins = their wins. */
  theirPicks: DraftChampionRow[]
}

// ── § 12 Opponent dossier ──────────────────────────────────────────────────

export type DossierStatus = 'draft' | 'published'

/** What the staff writes (the stored row). */
export interface OpponentDossier {
  id: string
  groupId: string
  opponentKey: string
  opponentName: string
  howTheyPlay: string | null
  /** Up to 5 champions. */
  suggestedBans: string[]
  /** Up to 600 characters. */
  gamePlan: string | null
  status: DossierStatus
  publishedAt: string | null
  /** The Riot data of the last "Refresh" (players' rank, form, duos), shared so players read it without Riot calls. */
  snapshot: DossierSnapshot | null
  snapshotAt: string | null
  updatedAt: string
  updatedBy: string | null
}

export interface OpponentDossierInput {
  opponentName: string
  howTheyPlay: string | null
  suggestedBans: string[]
  gamePlan: string | null
}

export type DossierThreat = 'dominant' | 'threat' | 'comfort' | null

export interface DossierPlayerCard {
  role: TeamRole
  displayName: string
  riotId: string | null
  /** 'not_found' when the Riot ID did not resolve on the last refresh (§ 12, "Joueur introuvable"). */
  status: 'ok' | 'not_found' | 'not_refreshed'
  rank: string | null
  topChampions: Array<{ champion: string; tier: string | null; games: number; winRate: number | null; threat: DossierThreat }>
  /** Last 10 ranked games, most recent first. */
  recentForm: Array<'W' | 'L'>
  /** A notable pool change: a champion played a lot lately and little before. */
  poolChange: { champion: string; games: number; days: number } | null
}

export interface DossierDuo { a: string; b: string; games: number; winRate: number | null }

/** Riot data gathered by "Refresh the data", stored on the dossier. */
export interface DossierSnapshot {
  version: number
  players: Array<Pick<DossierPlayerCard, 'role' | 'displayName' | 'riotId' | 'status' | 'rank' | 'recentForm' | 'poolChange'>>
  duos: DossierDuo[]
  /** Games read per player (20 with a personal key, 50 with the production key). */
  gamesPerPlayer: number
}

/** The whole page: the stored dossier, the scouted roster and pools, and what we played against them. */
export interface OpponentDossierView {
  opponentKey: string
  opponentName: string
  opponentTag: string | null
  /** The scouting notes (pre-fill "How they play" when the dossier has none). */
  scoutNotes: string | null
  /** Null until the staff saves one. Players only see published dossiers. */
  dossier: OpponentDossier | null
  players: DossierPlayerCard[]
  vsUs: { wins: number; losses: number; drafts: DraftLogEntry[]; objectives: TeamObjectivesSummary | null } | null
  duos: DossierDuo[]
  /** Analysis limited by the personal Riot key (§ 12, "Mode réduit"). */
  reducedMode: boolean
}

// ── API (window.api) ───────────────────────────────────────────────────────

export interface AnalystApi {
  /** § 10. Team games of the group matching the filters, newest first. */
  teamObjectivesGames: (groupId: string, filters: TeamObjectivesFilters) => Promise<TeamObjectivesGameRef[]>
  /** § 10. One game's summary: cached on the game for everyone, else read from Riot, extracted, then cached. */
  teamObjectivesGameTimeline: (gameId: string) => Promise<TeamGameTimeline | TeamTimelineUnavailable>

  /** § 11. */
  draftLogList: (groupId: string) => Promise<DraftLogEntry[]>
  /** § 11, staff. Adds the drafts of the group's team games not in the log yet (scrims, tournaments, flex). */
  draftLogSyncFromGames: (groupId: string) => Promise<{ added: number }>
  draftLogCreate: (groupId: string, input: DraftLogInput) => Promise<DraftLogEntry>
  draftLogUpdate: (id: string, patch: DraftLogPatch) => Promise<DraftLogEntry>
  draftLogDelete: (id: string) => Promise<void>

  /** § 12. */
  opponentDossierGet: (groupId: string, opponentKey: string) => Promise<OpponentDossierView>
  /** § 12, staff. Creates or updates the draft (a published dossier stays published). */
  opponentDossierSave: (groupId: string, opponentKey: string, input: OpponentDossierInput) => Promise<OpponentDossier>
  /** § 12, staff. Publishes to the group and notifies its members. */
  opponentDossierPublish: (groupId: string, opponentKey: string) => Promise<OpponentDossier>
  /** § 12, staff. Back to draft: players no longer see it. */
  opponentDossierUnpublish: (groupId: string, opponentKey: string) => Promise<OpponentDossier>
  /** § 12, staff. Reads Riot for the 5 players (rank, last ranked games, duos) and stores the snapshot. */
  opponentDossierRefresh: (groupId: string, opponentKey: string) => Promise<OpponentDossierView>
}
