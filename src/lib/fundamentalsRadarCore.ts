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

/** One term of an axis that adds several stats up (see `fightImpactParts`). */
export interface RadarAxisPart {
  key: string
  /** Per-minute average of this stat. */
  value: number
  /** Share of `value` that counts in the axis. */
  weight: number
}

export interface RadarAxisDef {
  key: string
  label: string
  unit: string
  min: number
  max: number
  /** Path into the `computeAverages()` result. */
  pick: (s: any) => number | null
  /** Terms of the axis when it is a sum, for the detail view. */
  parts?: (s: any) => RadarAxisPart[] | null
}

/** Order matches the reference design: KDA, CS/m, Gold/m, DMG/m, KP, FB,
 *  CS@15, XP@15, Gold@15 — clockwise from the top. */
export const RADAR_AXES: RadarAxisDef[] = [
  {
    key: 'kda', label: 'KDA', unit: '', min: 0, max: 6,
    pick: (s) => (s?.meta?.avgDeaths > 0 ? (s.meta.avgKills + s.meta.avgAssists) / s.meta.avgDeaths : s?.meta ? s.meta.avgKills + s.meta.avgAssists : null),
  },
  { key: 'csm', label: 'CS/m', unit: '', min: 3, max: 9, pick: (s) => s?.economy?.csPerMin ?? null },
  { key: 'goldm', label: 'Gold/m', unit: ' g', min: 250, max: 550, pick: (s) => s?.economy?.goldPerMin ?? null },
  { key: 'dmgm', label: 'DMG/m', unit: '', min: 300, max: 900, pick: (s) => s?.combat?.damagePerMin ?? null },
  { key: 'kp', label: 'KP', unit: '%', min: 0, max: 100, pick: (s) => s?.combat?.killParticipation ?? null },
  { key: 'fb', label: 'FB', unit: '%', min: 0, max: 100, pick: (s) => s?.laning?.firstBloodRate ?? null },
  { key: 'cs15', label: 'CS@15', unit: '', min: 50, max: 140, pick: (s) => s?.laning?.cs15 ?? null },
  // @15 ranges from real ranked timelines (17/11/2026 check): lobby average
  // ≈ 5,650 gold / 10.5 levels at 15:00, strong laners 7,000+ gold and
  // 8,500+ XP. Riot's totalGold includes the 500 starting gold.
  { key: 'xp15', label: 'XP@15', unit: ' XP', min: 4500, max: 9500, pick: (s) => s?.laning?.xp15 ?? null },
  { key: 'gold15', label: 'Gold@15', unit: ' g', min: 3500, max: 7500, pick: (s) => s?.laning?.gold15 ?? null },
]

/**
 * Share of the damage a support absorbs (Riot `damageSelfMitigated`: what its
 * resistances and shields soaked up) that counts in its fight impact.
 */
export const FIGHT_IMPACT_ABSORBED_WEIGHT = 0.4

/**
 * "Fight impact" of a support, per minute: heals + shields on teammates,
 * damage to champions and 40% of the damage absorbed.
 *
 * It replaces a heal+shield axis that only an enchanter could fill. Measured
 * on the 6,029 support performances of 3,015 cached ranked games (Nov. 2026):
 * half of them had under 100 heal+shield per minute, and the champion picked
 * explained 71% of that number. The sum below puts the three styles level
 * (enchanters 895, poke mages 848, engage supports 851 on average) and stays
 * almost as tied to winning as the old axis: it is 0.33 standard deviation
 * higher in wins than in losses of the same champion, against 0.36.
 *
 * Why absorbed and not received: raw damage taken is much higher in losses
 * (0.58 standard deviation), so counting it would reward getting punished.
 * The 0.4 weight is the one that levels the styles (0.33 leaves engage
 * supports 11% short, 0.5 puts them ahead).
 *
 * Returns null when a term is unknown rather than counting it as zero.
 */
export function fightImpactParts(s: any): RadarAxisPart[] | null {
  const combat = s?.combat
  const healShield = combat?.healShieldPerMin ?? null
  const damage = combat?.damagePerMin ?? null
  // Averages computed before the per-minute field existed only carry the total.
  const minutes = s?.meta?.avgDuration > 0 ? s.meta.avgDuration / 60 : null
  const absorbed = combat?.damageMitigatedPerMin ?? (combat?.damageMitigated != null && minutes ? combat.damageMitigated / minutes : null)
  if (healShield == null || damage == null || absorbed == null) return null
  return [
    { key: 'healShield', value: healShield, weight: 1 },
    { key: 'damage', value: damage, weight: 1 },
    { key: 'absorbed', value: absorbed, weight: FIGHT_IMPACT_ABSORBED_WEIGHT },
  ]
}

export function fightImpactPerMin(s: any): number | null {
  const parts = fightImpactParts(s)
  return parts ? Math.round(parts.reduce((sum, p) => sum + p.value * p.weight, 0)) : null
}

/**
 * Support (`UTILITY`) axes: the laner KPIs (CS, gold, damage) say nothing
 * about a support's impact. These measure what a support controls —
 * fight presence (KP, KDA), staying alive, vision (own score, the gap vs.
 * the opposing support, control wards, wards cleared), fight impact
 * whatever the style (see `fightImpactParts`) and crowd control.
 * Same first-pass calibration caveat as above, except for fight impact,
 * whose 400-1300 scale comes from the measured distribution (10% of support
 * games are under 545, half under 837, 10% above 1,228).
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
  { key: 'impact', label: 'Fight impact/m', unit: '', min: 400, max: 1300, pick: fightImpactPerMin, parts: fightImpactParts },
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
  /** Only on an axis that adds several stats up: its terms (null when unknown). */
  recentParts?: RadarAxisPart[] | null
  snapshotParts?: RadarAxisPart[] | null
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
      ...(axis.parts ? { recentParts: recent ? axis.parts(recent) : null, snapshotParts: snapshot ? axis.parts(snapshot) : null } : {}),
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
