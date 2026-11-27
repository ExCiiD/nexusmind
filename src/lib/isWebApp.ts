/**
 * True in the web app, false on desktop. The marker is a call the web adapter (web/src/api.ts) really does NOT implement:
 * linkTeamToGroup (local teams linked to a group, desktop only, see tests/unit/webApiCoverage.test.ts). Do not use
 * computeTeamSynergyStats: the web implements it.
 */
export function isWebApp(): boolean {
  return typeof window.api?.linkTeamToGroup !== 'function'
}
