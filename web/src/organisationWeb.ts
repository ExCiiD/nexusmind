import { sb } from './supabase'
import * as org from '@/lib/organisationCore'
import type { OrganisationApi } from '@/lib/organisation'

/**
 * § 18 web side (docs/contracts/organisation.md): "Relancer" and the published dossiers, the same core as the desktop.
 * The solo LFT export reads the desktop's local games and stays desktop only. Spread into web/src/api.ts like analystWebApi.
 */
export const organisationWebApi: OrganisationApi = {
  calendarRemindResponses: (eventId, userIds) => org.remindEventResponses(sb, eventId, userIds),
  calendarListReminders: (eventIds) => org.listEventReminders(sb, eventIds),
  opponentDossierListPublished: (groupId) => org.listPublishedDossiers(sb, groupId),
}
