/**
 * Preparing a team session ahead (user's decision of 20/11/2026, contract docs/contracts/session-prep.md): each
 * player's objectives for the session and drafts of the Draft Sim attached to it. Computed in sessionPrepCore.ts,
 * shared by the desktop and the web. The collective objectives stay in teamSessions.ts (teamSessionSetObjectives).
 */
import type { TeamSessionObjectives } from './teamSessions'

export interface PlayerSessionObjectives {
  playerId: string
  /** 0 to 2 fundamentals or Mon plan axes (the same ids as the collective objectives). */
  objectiveIds: string[]
  /** KPIs picked under those objectives, 10 at most. */
  kpiIds: string[]
  /** A short instruction, 140 characters at most. */
  note: string | null
  setBy: string | null
  setAt: string
}

/** A draft slot: the champions considered for it (usually one). Five slots at most per list. */
export type DraftSlots = string[][]

export interface SessionDraft {
  id: string
  /** The original draft (local Draft Sim or shared team draft): attaching it again replaces this copy. */
  sourceId: string | null
  name: string
  bluePicks: DraftSlots
  blueBans: DraftSlots
  redPicks: DraftSlots
  redBans: DraftSlots
  myTeamSide: 'blue' | 'red'
  notes: string | null
  position: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** Slots as given: a champion alone is a slot of one. */
export type DraftSlotsInput = Array<string | string[]>

export interface SessionDraftInput {
  sourceId: string | null
  name: string
  bluePicks: DraftSlotsInput
  blueBans: DraftSlotsInput
  redPicks: DraftSlotsInput
  redBans: DraftSlotsInput
  myTeamSide: 'blue' | 'red'
  notes: string | null
}

export interface SessionPrep {
  sessionId: string
  /** False before migration 20261120110520_team_session_prep. */
  available: boolean
  /** The reader may write: the session's manager or the group's staff, while the session is scheduled. */
  canPrepare: boolean
  objectives: TeamSessionObjectives | null
  /** The coach's message shown at the top of the players' view (280 characters), null when none. */
  message: { text: string; setBy: string | null; setAt: string } | null
  /** Every player's (each player sees theirs first and the others folded, DESIGN_STATE § 17). */
  playerObjectives: PlayerSessionObjectives[]
  /** In order (position, then date added). */
  drafts: SessionDraft[]
}

export interface PlayerObjectivesInput {
  objectiveIds: string[]
  kpiIds: string[]
  note: string | null
}

/** Errors: FORBIDDEN (not allowed, or the session started), NOT_FOUND, INVALID, NOT_AVAILABLE (before the migration). */
export interface SessionPrepApi {
  sessionPrepGet: (sessionId: string) => Promise<SessionPrep>
  /**
   * The "Préparation prête" badge (DESIGN_STATE § 17): of these Planning events, those whose session has at least one
   * objective set (collective or individual). One request for the whole week, not one per event.
   */
  sessionPrepReadyForEvents: (calendarEventIds: string[]) => Promise<string[]>
  /** The coach's message to the players; null or blank removes it. */
  sessionPrepSetMessage: (sessionId: string, text: string | null) => Promise<void>
  /** Replaces a player's objectives for the session; null removes them. */
  sessionPrepSetPlayerObjectives: (sessionId: string, playerId: string, value: PlayerObjectivesInput | null) => Promise<void>
  /** Attaches a copy of a draft; the same sourceId replaces the copy already attached. Returns its id. */
  sessionPrepAttachDraft: (sessionId: string, draft: SessionDraftInput) => Promise<string>
  /** Desktop only: attaches a draft of the local Draft Sim by its id. */
  sessionPrepAttachLocalDraft?: (sessionId: string, draftPrepId: string) => Promise<string>
  /** Attaches a shared team draft (team_drafts) by its id. */
  sessionPrepAttachSharedDraft: (sessionId: string, teamDraftId: string) => Promise<string>
  sessionPrepRemoveDraft: (draftId: string) => Promise<void>
  /** The session's drafts in the order wanted (all of them, each once). */
  sessionPrepReorderDrafts: (sessionId: string, draftIds: string[]) => Promise<void>
}
