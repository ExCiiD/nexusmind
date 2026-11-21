/**
 * A player's settings that follow them on every device (21/11/2026): UserPreference rows (synced, see syncSchema.ts).
 * The video player's timeline filters (src/lib/playerFilters.ts) and the review panel's place (src/lib/reviewPanelPref.ts).
 */
import { z } from 'zod'
import { getPrisma } from '../database'
import { validatedHandle } from './validate'
import { normalizePlayerFilters, PLAYER_FILTERS_KEY, type PlayerFilters } from '../../../src/lib/playerFilters'
import { normalizeReviewPanel, REVIEW_PANEL_KEY, type ReviewPanelPref } from '../../../src/lib/reviewPanelPref'
import { AUTO_YOUTUBE_KEY, normalizeAutoYoutube, type AutoYoutubePref } from '../../../src/lib/autoYoutubePref'

/** Front-End reads and writes them through getUser / updateUser too ({ playerFilters }). Unknown keys are ignored. */
export const playerFiltersSchema = z.object({
  notes: z.boolean(), microReview: z.boolean(), mistakes: z.boolean(), deaths: z.boolean(),
  dragon: z.boolean(), baron: z.boolean(), herald: z.boolean(), grubs: z.boolean(), turrets: z.boolean(), inhibs: z.boolean(), fights: z.boolean(),
  zoom: z.number().min(1).max(8),
}).partial().strip()

async function activeUserId(): Promise<string> {
  const user = await getPrisma().user.findFirst({ where: { isActive: true }, select: { id: true } })
  if (!user) throw new Error('No user found')
  return user.id
}

/** The stored filters, or the default (first launch). */
export async function getPlayerFilters(): Promise<PlayerFilters> {
  const userId = await activeUserId()
  const row = await getPrisma().userPreference.findUnique({ where: { userId_key: { userId, key: PLAYER_FILTERS_KEY } }, select: { value: true } })
  return normalizePlayerFilters(row?.value ?? null)
}

/** Saves a change (partial: the keys sent replace the stored ones). Returns the filters now stored. */
export async function setPlayerFilters(patch: Partial<PlayerFilters>): Promise<PlayerFilters> {
  const userId = await activeUserId()
  const next = normalizePlayerFilters({ ...(await getPlayerFilters()), ...patch })
  const value = JSON.stringify(next)
  await getPrisma().userPreference.upsert({
    where: { userId_key: { userId, key: PLAYER_FILTERS_KEY } },
    create: { userId, key: PLAYER_FILTERS_KEY, value },
    update: { value },
  })
  return next
}

/** updateUser's { reviewPanel } (21/11/2026): partial, unknown keys ignored. */
export const reviewPanelSchema = z.object({ hidden: z.boolean(), side: z.enum(['left', 'right']) }).partial().strip()

/** The review panel's place, or the default (never reset on read). */
export async function getReviewPanel(): Promise<ReviewPanelPref> {
  const userId = await activeUserId()
  const row = await getPrisma().userPreference.findUnique({ where: { userId_key: { userId, key: REVIEW_PANEL_KEY } }, select: { value: true } })
  return normalizeReviewPanel(row?.value ?? null)
}

/** Saves a change (the keys sent replace the stored ones). Returns the setting now stored. */
export async function setReviewPanel(patch: Partial<ReviewPanelPref>): Promise<ReviewPanelPref> {
  const userId = await activeUserId()
  const next = normalizeReviewPanel({ ...(await getReviewPanel()), ...patch })
  const value = JSON.stringify(next)
  await getPrisma().userPreference.upsert({
    where: { userId_key: { userId, key: REVIEW_PANEL_KEY } },
    create: { userId, key: REVIEW_PANEL_KEY, value },
    update: { value },
  })
  return next
}

/** « Upload YouTube automatique » (21/11/2026), or the default (off). */
export async function getAutoYoutube(): Promise<AutoYoutubePref> {
  const userId = await activeUserId()
  const row = await getPrisma().userPreference.findUnique({ where: { userId_key: { userId, key: AUTO_YOUTUBE_KEY } }, select: { value: true } })
  return normalizeAutoYoutube(row?.value ?? null)
}

/** Listeners told when the automatic upload setting is saved (the queue starts or stops on it). */
const autoYoutubeListeners = new Set<(pref: AutoYoutubePref) => void>()
export function onAutoYoutubeChange(cb: (pref: AutoYoutubePref) => void): () => void {
  autoYoutubeListeners.add(cb)
  return () => autoYoutubeListeners.delete(cb)
}

/** Saves a change (the keys sent replace the stored ones). Returns the setting now stored. */
export async function setAutoYoutube(patch: Partial<AutoYoutubePref>): Promise<AutoYoutubePref> {
  const userId = await activeUserId()
  const next = normalizeAutoYoutube({ ...(await getAutoYoutube()), ...patch })
  const value = JSON.stringify(next)
  await getPrisma().userPreference.upsert({
    where: { userId_key: { userId, key: AUTO_YOUTUBE_KEY } },
    create: { userId, key: AUTO_YOUTUBE_KEY, value },
    update: { value },
  })
  for (const cb of autoYoutubeListeners) try { cb(next) } catch { /* never breaks the save */ }
  return next
}

export function registerPreferencesHandlers(): void {
  validatedHandle('prefs:get-player-filters', z.tuple([]), () => getPlayerFilters())
  validatedHandle('prefs:set-player-filters', z.tuple([playerFiltersSchema]), (_e, patch) => setPlayerFilters(patch))
}
