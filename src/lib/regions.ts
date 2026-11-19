/**
 * Riot platform ids offered in the app's region pickers, with their labels.
 * Plain data on purpose: the renderer imports it, and the IPC input schemas
 * live in the main process (electron/main/ipc/validate.ts), so no zod here.
 */
export const PLATFORM_REGIONS = [
  'BR1', 'EUN1', 'EUW1', 'JP1', 'KR', 'LA1', 'LA2', 'NA1',
  'OC1', 'PH2', 'RU', 'SG2', 'TH2', 'TR1', 'TW2', 'VN2',
] as const

export const regionDisplayNames: Record<string, string> = {
  BR1: 'Brazil',
  EUN1: 'EU Nordic & East',
  EUW1: 'EU West',
  JP1: 'Japan',
  KR: 'Korea',
  LA1: 'Latin America North',
  LA2: 'Latin America South',
  NA1: 'North America',
  OC1: 'Oceania',
  PH2: 'Philippines',
  RU: 'Russia',
  SG2: 'Singapore',
  TH2: 'Thailand',
  TR1: 'Turkey',
  TW2: 'Taiwan',
  VN2: 'Vietnam',
}

/** Short labels, as players write them (account chips). */
export const regionShortLabels: Record<string, string> = {
  EUW1: 'EUW', EUN1: 'EUNE', NA1: 'NA', KR: 'KR', BR1: 'BR',
  LA1: 'LAN', LA2: 'LAS', OC1: 'OCE', TR1: 'TR', RU: 'RU',
  JP1: 'JP', SG2: 'SG', VN2: 'VN', TW2: 'TW', TH2: 'TH', PH2: 'PH',
}
