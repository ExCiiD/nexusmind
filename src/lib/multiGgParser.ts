/**
 * Parse multi-search URLs from common LoL stats sites (op.gg, blitz.gg, etc.)
 * into a normalized list of `{ gameName, tagLine, region }`.
 *
 * Supports:
 *   - https://www.op.gg/multisearch/euw?summoners=PlayerA-EUW,PlayerB-NA1
 *   - https://op.gg/multisearch/euw?summoners=PlayerA%23EUW,Player%20B%23NA1
 *   - https://blitz.gg/lol/multisearch/euw1?summoners=PlayerA-EUW,PlayerB-NA1
 *   - Plain newline/comma-separated lists: "PlayerA#EUW\nPlayerB#NA1"
 *   - URLs without query string but with names in the path
 *
 * Region is inferred from URL when possible (e.g. `/multisearch/euw`),
 * otherwise falls back to per-name tagLine.
 */

export interface ParsedPlayer {
  gameName: string
  tagLine: string
  /** Riot routing region (EUW1, NA1, KR, …). Best-effort, may be ''. */
  region: string
}

export interface MultiGgParseResult {
  players: ParsedPlayer[]
  inferredRegion: string
  /** Raw issues for the user (e.g. "PlayerC: missing tag"). */
  warnings: string[]
}

// Map common short region codes (from URLs) AND common in-game tagLines
// → Riot routing region keys used elsewhere in the app.
// Note: KR1 is a common Korean tagLine but the routing region is just "KR".
const REGION_ALIASES: Record<string, string> = {
  euw: 'EUW1', euw1: 'EUW1',
  eune: 'EUN1', eun: 'EUN1', eun1: 'EUN1',
  na: 'NA1', na1: 'NA1',
  kr: 'KR', kr1: 'KR',
  br: 'BR1', br1: 'BR1',
  lan: 'LA1', la1: 'LA1',
  las: 'LA2', la2: 'LA2',
  oce: 'OC1', oc1: 'OC1',
  tr: 'TR1', tr1: 'TR1',
  ru: 'RU', ru1: 'RU',
  jp: 'JP1', jp1: 'JP1',
  ph: 'PH2', ph2: 'PH2',
  sg: 'SG2', sg2: 'SG2',
  tw: 'TW2', tw2: 'TW2',
  th: 'TH2', th2: 'TH2',
  vn: 'VN2', vn2: 'VN2',
  me: 'ME1', me1: 'ME1',
}

/**
 * Strict normalization: returns '' for unknown tags so callers can fall back
 * to a default region. Returning the raw token would incorrectly treat
 * arbitrary tagLines (e.g. "ABC", "PRO") as routing regions.
 */
function normalizeRegion(raw: string): string {
  if (!raw) return ''
  const k = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  return REGION_ALIASES[k] ?? ''
}

/**
 * Parse a single "Name#Tag" or "Name-Tag" token.
 * Returns null if it doesn't look like a valid Riot ID at all.
 */
function parseSingleToken(token: string, defaultRegion: string): ParsedPlayer | { error: string; raw: string } {
  const raw = token.trim()
  if (!raw) return { error: 'empty', raw }

  // Strip URL-encoded chars (some inputs come from copy-pasted browser URL bars).
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch { /* keep raw */ }

  // Format A: "Name#Tag" (Riot ID canonical form). The `#` may also appear as `%23`.
  const hashIdx = decoded.indexOf('#')
  if (hashIdx > 0) {
    const gameName = decoded.slice(0, hashIdx).trim()
    const tagLine = decoded.slice(hashIdx + 1).trim()
    if (!gameName || !tagLine) return { error: 'missing-name-or-tag', raw }
    return {
      gameName,
      tagLine: tagLine.toUpperCase(),
      region: normalizeRegion(tagLine) || defaultRegion,
    }
  }

  // Format B: "Name-Tag" used by op.gg URLs (since # is reserved in URLs).
  // We split on the LAST dash so names with dashes survive (e.g. "Some-Player-EUW").
  const lastDash = decoded.lastIndexOf('-')
  if (lastDash > 0 && lastDash < decoded.length - 1) {
    const gameName = decoded.slice(0, lastDash).trim()
    const tagLine = decoded.slice(lastDash + 1).trim()
    if (gameName && tagLine && /^[A-Za-z0-9]{2,5}$/.test(tagLine)) {
      return {
        gameName,
        tagLine: tagLine.toUpperCase(),
        region: normalizeRegion(tagLine) || defaultRegion,
      }
    }
  }

  // Format C: just a name (old summoner format). We can still create an entry
  // but it needs a manual tag — flag it.
  if (defaultRegion) {
    return { gameName: decoded, tagLine: '', region: defaultRegion }
  }
  return { error: 'no-tag-and-no-region', raw }
}

/**
 * Extract the region hint from a multisearch URL path/host.
 * e.g. "https://www.op.gg/multisearch/euw?…" → "EUW1"
 */
function extractRegionFromUrl(input: string): string {
  try {
    const url = new URL(input)
    // Common patterns: /multisearch/<region>, /<region>/multisearch
    const segments = url.pathname.split('/').filter(Boolean)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (seg === 'multisearch' && segments[i + 1]) {
        return normalizeRegion(segments[i + 1])
      }
      // blitz.gg: /lol/multisearch/<region>
      if (seg === 'lol' && segments[i + 1] === 'multisearch' && segments[i + 2]) {
        return normalizeRegion(segments[i + 2])
      }
    }
    // Some hosts use subdomain: euw.op.gg
    const sub = url.hostname.split('.')[0]
    if (sub && sub !== 'www' && sub.length <= 4) {
      const guess = normalizeRegion(sub)
      if (guess) return guess
    }
  } catch { /* not a URL */ }
  return ''
}

/**
 * Extract the comma- or newline-separated summoner list from the input.
 * If it's a URL, pulls from `?summoners=` query; otherwise treats whole input
 * as the list (newlines, commas, semicolons all OK).
 */
function extractSummonerList(input: string): string[] {
  let listSource = input.trim()
  try {
    const url = new URL(input)
    const fromQuery = url.searchParams.get('summoners')
      ?? url.searchParams.get('searchedNames')
      ?? url.searchParams.get('q')
    if (fromQuery) listSource = fromQuery
  } catch { /* not a URL — treat input as the list itself */ }

  return listSource
    .split(/[,\n;]/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseMultiGgUrl(input: string): MultiGgParseResult {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return { players: [], inferredRegion: '', warnings: ['Empty input'] }

  const inferredRegion = extractRegionFromUrl(trimmed)
  const tokens = extractSummonerList(trimmed)

  const players: ParsedPlayer[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  for (const tok of tokens) {
    const parsed = parseSingleToken(tok, inferredRegion)
    if ('error' in parsed) {
      warnings.push(`Skipped "${parsed.raw}": ${parsed.error}`)
      continue
    }
    // Dedup on canonical Riot ID — same player appearing twice in a paste is a no-op.
    const key = `${parsed.gameName.toLowerCase()}#${parsed.tagLine.toLowerCase()}`
    if (seen.has(key)) {
      warnings.push(`Duplicate skipped: ${parsed.gameName}#${parsed.tagLine}`)
      continue
    }
    seen.add(key)
    players.push(parsed)
  }

  return { players, inferredRegion, warnings }
}
