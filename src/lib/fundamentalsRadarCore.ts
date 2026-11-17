/**
 * "Empreinte des fondamentaux" radar (Dashboard). Pure — no I/O. Takes the
 * raw averages `computeAverages()` (electron/main/ipc/stats.ipc.ts) already
 * produces for two windows (recent: last 15 games, snapshot: last 40
 * games — the default comparison) and maps them onto 9 fixed axes with a
 * calibrated 0-100 scale for the radar's SVG polygon.
 *
 * Calibration bounds are a first pass, not derived from any rank dataset —
 * revisit once this has been used against real data. They exist purely so
 * the two polygons occupy a readable spread of the chart; the raw values
 * shown on hover/in the detail modal are the actual numbers.
 */

export interface RadarAxisDef {
  key: string
  label: string
  unit: string
  min: number
  max: number
  /** Path into the `computeAverages()` result. */
  pick: (s: any) => number | null
}

/** Order matches the reference design: KDA, CS/m, Gold/m, DMG/m, KP, FB,
 *  CS@15, XP@15, Gold@15 — clockwise from the top. */
export const RADAR_AXES: RadarAxisDef[] = [
  {
    key: 'kda', label: 'KDA', unit: '', min: 0, max: 6,
    pick: (s) => (s?.meta?.avgDeaths > 0 ? (s.meta.avgKills + s.meta.avgAssists) / s.meta.avgDeaths : s?.meta ? s.meta.avgKills + s.meta.avgAssists : null),
  },
  { key: 'csm', label: 'CS/m', unit: '', min: 3, max: 9, pick: (s) => s?.economy?.csPerMin ?? null },
  { key: 'goldm', label: 'Gold/m', unit: '', min: 250, max: 550, pick: (s) => s?.economy?.goldPerMin ?? null },
  { key: 'dmgm', label: 'DMG/m', unit: '', min: 300, max: 900, pick: (s) => s?.combat?.damagePerMin ?? null },
  { key: 'kp', label: 'KP', unit: '%', min: 0, max: 100, pick: (s) => s?.combat?.killParticipation ?? null },
  { key: 'fb', label: 'FB', unit: '%', min: 0, max: 100, pick: (s) => s?.laning?.firstBloodRate ?? null },
  { key: 'cs15', label: 'CS@15', unit: '', min: 50, max: 140, pick: (s) => s?.laning?.cs15 ?? null },
  { key: 'xp15', label: 'XP@15', unit: '', min: 4500, max: 8500, pick: (s) => s?.laning?.xp15 ?? null },
  { key: 'gold15', label: 'Gold@15', unit: '', min: 3500, max: 6500, pick: (s) => s?.laning?.gold15 ?? null },
]

/**
 * Support (`UTILITY`) axes: the laner KPIs (CS, gold, damage) say nothing
 * about a support's impact. These measure what a support controls —
 * fight presence (KP, KDA), staying alive, vision (own score, the gap vs.
 * the opposing support, control wards, wards cleared) and utility, split
 * so both styles score fairly: heals + shields for enchanters, crowd
 * control for engage supports. Same first-pass calibration caveat as above.
 */
export const SUPPORT_RADAR_AXES: RadarAxisDef[] = [
  {
    key: 'kda', label: 'KDA', unit: '', min: 0, max: 6,
    pick: (s) => (s?.meta?.avgDeaths > 0 ? (s.meta.avgKills + s.meta.avgAssists) / s.meta.avgDeaths : s?.meta ? s.meta.avgKills + s.meta.avgAssists : null),
  },
  { key: 'kp', label: 'KP', unit: '%', min: 35, max: 80, pick: (s) => s?.combat?.killParticipation ?? null },
  // Inverted: fewer deaths → further out on the chart (min > max).
  { key: 'deaths', label: 'Deaths', unit: '', min: 9, max: 2, pick: (s) => s?.meta?.avgDeaths ?? null },
  { key: 'vspm', label: 'Vision/m', unit: '', min: 0.8, max: 3.2, pick: (s) => s?.vision?.visionScorePerMin ?? null },
  { key: 'vsdiff', label: 'Vision diff', unit: '', min: -15, max: 30, pick: (s) => s?.vision?.visionScoreAdvantage ?? null },
  { key: 'pinks', label: 'Pinks', unit: '', min: 0, max: 8, pick: (s) => s?.vision?.controlWardsPurchased ?? null },
  { key: 'wardkill', label: 'Wards killed', unit: '', min: 0, max: 6, pick: (s) => s?.vision?.wardsDestroyed ?? null },
  { key: 'healshield', label: 'Heal+Shield/m', unit: '', min: 0, max: 500, pick: (s) => s?.combat?.healShieldPerMin ?? null },
  { key: 'cc', label: 'CC/m', unit: '', min: 0, max: 3, pick: (s) => s?.combat?.ccPerMin ?? null },
]

/** Axis set for the user's main role (Riot `teamPosition` values). */
export function radarAxesForRole(role: string | null | undefined): RadarAxisDef[] {
  return role === 'UTILITY' || role === 'SUPPORT' ? SUPPORT_RADAR_AXES : RADAR_AXES
}

export interface RadarAxisPoint {
  key: string
  label: string
  unit: string
  /** Null when the source average has no data for this axis. */
  recentRaw: number | null
  snapshotRaw: number | null
  /** 0-100, clamped — null stays null (no line drawn through that axis). */
  recentScore: number | null
  snapshotScore: number | null
}

function normalize(value: number | null, min: number, max: number): number | null {
  if (value == null || Number.isNaN(value)) return null
  const pct = ((value - min) / (max - min)) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

export function buildFundamentalsRadar(recent: any | null, snapshot: any | null, axes: RadarAxisDef[] = RADAR_AXES): RadarAxisPoint[] {
  return axes.map((axis) => {
    const recentRaw = recent ? axis.pick(recent) : null
    const snapshotRaw = snapshot ? axis.pick(snapshot) : null
    return {
      key: axis.key,
      label: axis.label,
      unit: axis.unit,
      recentRaw,
      snapshotRaw,
      recentScore: normalize(recentRaw, axis.min, axis.max),
      snapshotScore: normalize(snapshotRaw, axis.min, axis.max),
    }
  })
}

/** Global score shown next to the chart title — mean of the axes that
 *  have a recent value (ignores missing ones rather than treating them as 0). */
export function overallRadarScore(points: RadarAxisPoint[]): number | null {
  const scores = points.map((p) => p.recentScore).filter((s): s is number => s != null)
  if (scores.length === 0) return null
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

/** SVG polygon `points` attribute for one series ('recentScore' or
 *  'snapshotScore'), laid out clockwise from the top, center/radius in SVG
 *  user units — same convention as the reference radar. */
export function radarPolygonPoints(points: RadarAxisPoint[], series: 'recentScore' | 'snapshotScore', center: number, radius: number): string {
  return points.map((p, idx) => {
    const angle = (Math.PI * 2 * idx) / points.length - Math.PI / 2
    const val = (p[series] ?? 0) / 100
    const x = center + radius * val * Math.cos(angle)
    const y = center + radius * val * Math.sin(angle)
    return `${x},${y}`
  }).join(' ')
}
