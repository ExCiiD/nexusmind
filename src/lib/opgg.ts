/**
 * Builds an op.gg profile URL from a Riot ID — used by the Discord bot
 * (E11) to show opponent links for a scrim without anyone having to type
 * them in by hand: the scouted opponent's roster (team_rosters, shared
 * since E14) already has ign/tagLine/region, this just formats it.
 */

const REGION_TO_OPGG_SLUG: Record<string, string> = {
  BR1: 'br', EUN1: 'eune', EUW1: 'euw', JP1: 'jp', KR: 'kr', LA1: 'lan', LA2: 'las',
  NA1: 'na', OC1: 'oce', PH2: 'ph', RU: 'ru', SG2: 'sg', TH2: 'th', TR1: 'tr', TW2: 'tw', VN2: 'vn',
}

/** Null when the region is unknown or the Riot ID is incomplete — callers
 *  should just omit the link rather than send a broken one. */
export function buildOpggUrl(ign: string | null | undefined, tagLine: string | null | undefined, region: string | null | undefined): string | null {
  if (!ign || !tagLine || !region) return null
  const slug = REGION_TO_OPGG_SLUG[region.toUpperCase()]
  if (!slug) return null
  return `https://op.gg/lol/summoners/${slug}/${encodeURIComponent(ign)}-${encodeURIComponent(tagLine)}`
}
