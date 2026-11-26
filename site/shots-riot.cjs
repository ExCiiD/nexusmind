/**
 * Stills for the Riot production-key application (docs/prod/riot-application/,
 * docs/prod/DEMANDE_CLE_PROD.md R14). Same format as site/shots.cjs; harness mock
 * data only, and capture.cjs swaps the developer's own name for a demo one.
 *
 *   SHOTS_FILE=./shots-riot.cjs CAPTURE_OUT=docs/prod/riot-application npx electron site/capture.cjs
 */
const NO_CALIBRATION = 'm.calibrationStatus = { ...m.calibrationStatus, due: false }'
const wide = { viewport: [1600, 900], out: [1600, 900] }

module.exports = [
  { id: 'riot-1-dashboard', route: '/', ...wide, mock: NO_CALIBRATION },
  { id: 'riot-2-micro-review', route: '/microreview', ...wide },
  { id: 'riot-3-team-objectives', route: '/team?tab=objectives', ...wide, setup: [{ wait: 2500 }] },
  { id: 'riot-4-opponent-dossier', route: '/coaching?tab=scouting&dossier=team-aegis', ...wide, setup: [{ wait: 2500 }] },
  { id: 'riot-5-planning', route: '/planning', ...wide, setup: [{ wait: 1200 }] },
  { id: 'riot-6-team-space', route: '/team-space', ...wide, setup: [{ wait: 1500 }] },
]
