import { sb } from './supabase'
import * as prep from '@/lib/sessionPrepCore'
import type { SessionPrepApi } from '@/lib/sessionPrep'

/**
 * Preparing a team session ahead, web side (docs/contracts/session-prep.md): the same core as the desktop
 * (electron/main/cloud/teamSessions.ts). The local Draft Sim exists on the desktop only, so the web attaches shared team
 * drafts (and drafts it builds itself). Spread into the web's window.api (web/src/api.ts) like analystWebApi.
 */
export const sessionPrepWebApi: SessionPrepApi = {
  sessionPrepGet: (sessionId) => prep.getSessionPrep(sb, sessionId),
  sessionPrepReadyForEvents: (calendarEventIds) => prep.prepReadyForEvents(sb, calendarEventIds),
  sessionPrepSetMessage: (sessionId, text) => prep.setPrepMessage(sb, sessionId, text),
  sessionPrepSetPlayerObjectives: (sessionId, playerId, value) => prep.setPlayerObjectives(sb, sessionId, playerId, value),
  sessionPrepAttachDraft: (sessionId, draft) => prep.attachDraft(sb, sessionId, draft),
  sessionPrepAttachSharedDraft: (sessionId, teamDraftId) => prep.attachSharedDraft(sb, sessionId, teamDraftId),
  sessionPrepRemoveDraft: (draftId) => prep.removeDraft(sb, draftId),
  sessionPrepReorderDrafts: (sessionId, draftIds) => prep.reorderDrafts(sb, sessionId, draftIds),
}
