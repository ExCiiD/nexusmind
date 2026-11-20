/**
 * Team Lobby cards (20/11/2026): the champion and skin a player shows on their card. Shared by the desktop main
 * process and the web adapter.
 *
 * The skins offered for a champion are the ones with a hosted cut-out: the manifest of the static Worker
 * `ascend-cutouts` (cloudflare/cutouts, 1,608 cut-outs reviewed by the user). Their names come from Data Dragon, at
 * the version the pack was built from (`manifest.ddragon`). A name that cannot be read is null, and the base skin
 * (number 0) has no name either: the screen shows the champion's name for it.
 *
 * The choice is stored in group_members.card_champion / card_skin_num (migration 20261120140000_member_card_champion),
 * written and read in collabCore (setMyCardChampion, listMemberLooks).
 */

export const CUTOUTS_BASE = 'https://ascend-cutouts.nexusmind-riot-proxy.workers.dev'

/** A Data Dragon champion id ("MonkeyKing", "Kaisa"), the prefix of the cut-out's file name. Same rule as the database. */
export const CARD_CHAMPION_ID = /^[A-Za-z0-9]{1,40}$/

export interface CardChampion {
  /** Data Dragon id, e.g. "MonkeyKing". */
  championId: string
  /** Data Dragon skin number, 0 for the base skin. */
  skinNum: number
}

export interface CardSkin {
  num: number
  /** Data Dragon's skin name in the requested language, null for the base skin or when it cannot be read. */
  name: string | null
  /** The hosted cut-out (WebP, transparent background). */
  url: string
  width: number
  height: number
}

export interface CutoutManifest {
  ddragon: string
  skins: Record<string, { champion: string; w: number; h: number }>
}

export function isCardChampion(v: unknown): v is CardChampion {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return typeof c.championId === 'string' && CARD_CHAMPION_ID.test(c.championId)
    && typeof c.skinNum === 'number' && Number.isInteger(c.skinNum) && c.skinNum >= 0 && c.skinNum <= 999
}

export function cutoutUrl(championId: string, skinNum: number): string {
  return `${CUTOUTS_BASE}/${championId}_${skinNum}.webp`
}

/** The manifest, or null when it is not one. Entries whose key is not `<id>_<num>` are left out. */
export function parseCutoutManifest(raw: unknown): CutoutManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as { ddragon?: unknown; skins?: unknown }
  if (typeof m.ddragon !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.ddragon) || !m.skins || typeof m.skins !== 'object') return null
  const skins: CutoutManifest['skins'] = {}
  for (const [key, v] of Object.entries(m.skins as Record<string, unknown>)) {
    const match = /^([A-Za-z0-9]{1,40})_(\d{1,3})$/.exec(key)
    const e = v as { champion?: unknown; w?: unknown; h?: unknown } | null
    if (!match || !e || typeof e.w !== 'number' || typeof e.h !== 'number') continue
    skins[key] = { champion: typeof e.champion === 'string' ? e.champion : match[1], w: e.w, h: e.h }
  }
  return { ddragon: m.ddragon, skins }
}

/** The skin numbers of a champion that have a hosted cut-out, base skin first. */
export function hostedSkins(manifest: CutoutManifest, championId: string): Array<{ num: number; width: number; height: number }> {
  if (!CARD_CHAMPION_ID.test(championId)) return []
  const prefix = `${championId}_`
  return Object.entries(manifest.skins)
    .filter(([key]) => key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length)))
    .map(([key, v]) => ({ num: Number(key.slice(prefix.length)), width: v.w, height: v.h }))
    .sort((a, b) => a.num - b.num)
}

/** Whether a choice points at a hosted cut-out (the screen checks this before saving). */
export function hasHostedCutout(manifest: CutoutManifest, choice: CardChampion): boolean {
  return Object.prototype.hasOwnProperty.call(manifest.skins, `${choice.championId}_${choice.skinNum}`)
}

type FetchFn = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

const MANIFEST_TTL_MS = 60 * 60 * 1000
let manifestCache: { at: number; value: Promise<CutoutManifest | null> } | null = null
const namesCache = new Map<string, Promise<Map<number, string>>>()

/** The hosted manifest, fetched at most once an hour (a failed fetch is retried on the next call). */
export function loadCutoutManifest(fetchFn: FetchFn, now = Date.now()): Promise<CutoutManifest | null> {
  if (manifestCache && now - manifestCache.at < MANIFEST_TTL_MS) return manifestCache.value
  const value = fetchFn(`${CUTOUTS_BASE}/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then(parseCutoutManifest)
    .catch(() => null)
  manifestCache = { at: now, value }
  value.then((m) => { if (!m && manifestCache?.value === value) manifestCache = null })
  return value
}

/** Data Dragon's skin names of a champion (number → name), empty when they cannot be read. */
function loadSkinNames(fetchFn: FetchFn, version: string, locale: string, championId: string): Promise<Map<number, string>> {
  const key = `${version}|${locale}|${championId}`
  const known = namesCache.get(key)
  if (known) return known
  const value = fetchFn(`https://ddragon.leagueoflegends.com/cdn/${version}/data/${locale}/champion/${championId}.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const names = new Map<number, string>()
      const skins = (json as { data?: Record<string, { skins?: Array<{ num?: unknown; name?: unknown }> }> } | null)?.data?.[championId]?.skins
      for (const s of skins ?? []) if (typeof s.num === 'number' && typeof s.name === 'string' && s.num !== 0) names.set(s.num, s.name)
      return names
    })
    .catch(() => new Map<number, string>())
  namesCache.set(key, value)
  value.then((names) => { if (!names.size) namesCache.delete(key) })
  return value
}

/** Data Dragon locales the app uses. */
export const CARD_SKIN_LOCALES = ['fr_FR', 'en_US'] as const
export type CardSkinLocale = (typeof CARD_SKIN_LOCALES)[number]

/**
 * The skins a player may pick for their card's champion: those with a hosted cut-out, base skin first. Empty when
 * the champion has none or the manifest cannot be read.
 */
export async function listCardSkins(fetchFn: FetchFn, championId: string, locale: CardSkinLocale = 'en_US'): Promise<CardSkin[]> {
  if (!CARD_CHAMPION_ID.test(championId)) return []
  const manifest = await loadCutoutManifest(fetchFn)
  if (!manifest) return []
  const skins = hostedSkins(manifest, championId)
  if (!skins.length) return []
  const names = await loadSkinNames(fetchFn, manifest.ddragon, locale, championId)
  return skins.map((s) => ({ num: s.num, name: names.get(s.num) ?? null, url: cutoutUrl(championId, s.num), width: s.width, height: s.height }))
}

/** For tests: forget the cached manifest and names. */
export function resetCardSkinsCache(): void {
  manifestCache = null
  namesCache.clear()
}
