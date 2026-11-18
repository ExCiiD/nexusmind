/**
 * The parts of the app the showcase site borrows at build time, so that
 * every interactive preview is produced by the product's own code — the same
 * QCM generator, the same Codex, the same ranking and radar math as in the
 * desktop app. Bundled by site/build.mjs (esbuild); nothing here ships to
 * the browser as-is.
 */
export { buildQcm } from '../../src/lib/microReview/smartQcm'
export { CODEX, codexById, codexFor, localize, dominantPhase } from '../../src/lib/microReview/codex'
export { DETECTOR_SPEC, MOMENT_PATTERNS } from '../../src/lib/microReview/anomalyDetector'
export { GARBAGE_HIGH, GARBAGE_LOW } from '../../src/lib/microReview/winProbability'
export { CALIBRATION_EVERY, calibrationGap, measuredDistribution } from '../../src/lib/microReview/calibration'
export { summaryText, tagLabel } from '../../src/components/MicroReview/text'
export { FAMILIES, fmtClock, latestMoments, phaseBreakdown, phaseOf, rankMistakes, tagFamily } from '../../src/lib/mistakeInsights'
export { RADAR_AXES, SUPPORT_RADAR_AXES, buildFundamentalsRadar, overallRadarScore } from '../../src/lib/fundamentalsRadarCore'
export { BUILT_IN_MISTAKE_TAGS } from '../../src/lib/mistakeTagCatalog'
export { FUNDAMENTALS } from '../../src/lib/constants/fundamentals'
export { getLevelFromXp, xpForLevel } from '../../src/lib/utils'
export { DEFAULT_CUSTOM_PALETTE, deriveCustomTokens } from '../../src/lib/theme'
export { FUNDAMENTALS_FR } from '../../src/lib/constants/fundamentals.fr'
export { BARON_PIT, DRAGON_PIT, OBJECTIVE_RADIUS, laneOf, territoryOf, zoneOf } from '../../src/lib/microReview/geometry'
