/**
 * What site/capture-app.cjs films in the INSTALLED Ascend, with the player's
 * real data. Same ids and sizes as site/shots.cjs (the site's media), so a file
 * here replaces the harness one; `{gameId}` / `{recordingId}` are the latest
 * game with a recording on disk (analysed for the micro-review when possible).
 *
 *   needs  'gameId': skipped when the profile has no such game
 *   cloud  true: team screens, read from the cloud (skipped unless CAPTURE_CLOUD=1)
 *
 * Read-only browsing: hovers, scrolls, tabs and the clip mode's handles; no
 * answer, no save (and the app runs on a copy of the profile anyway).
 */

const REVIEW = '/review?gameId={gameId}'
const button = (text) => ({ sel: 'button', text })
/** The single player at 40 % of the game (the clip handles then sit in the middle), paused. */
const MID_VIDEO = { js: "(() => { const v = document.querySelector('video'); if (v && v.duration) { v.currentTime = v.duration * 0.4; v.pause() } return true })()" }
/** The side panel on its Micro-review tab. */
const MR_TAB = { click: { sel: '[role="tab"]', text: 'Micro-review' }, ms: 1 }

const dashboardTour = [
  { wait: 900 },
  { hover: 'main h2, main h3', ms: 1000 },
  { wait: 700 },
  { scroll: 520, ms: 2200 },
  { wait: 1200 },
  { scroll: -520, ms: 1900 },
  { wait: 600 },
]

/** The micro-review box beside the single player: the answers hovered, the moments switched (no answer given). */
const microReviewTour = [
  MR_TAB,
  { wait: 900 },
  { hover: { sel: '[data-testid="micro-review"] [role="group"] button', text: '' }, ms: 1000 },
  { wait: 700 },
  { hover: '[data-testid="not-a-mistake"]', ms: 800 },
  { wait: 700 },
  { click: { sel: '[data-testid="micro-review"] ol li:nth-child(2) button', text: '' }, ms: 900 },
  { wait: 2000 },
  { hover: { sel: '[data-testid="micro-review"] [role="group"] button', text: '' }, ms: 900 },
  { wait: 900 },
  { click: { sel: '[data-testid="micro-review"] ol li:nth-child(3) button', text: '' }, ms: 900 },
  { wait: 2200 },
]

const reviewTour = [
  MID_VIDEO,
  { wait: 900 },
  { hover: '[data-testid="player-filter-chips"]', ms: 900 },
  { wait: 800 },
  { hover: '[data-testid="clip-button"]', ms: 900 },
  { wait: 500 },
  { key: 'c' },
  { wait: 1600 },
  { hover: '[data-testid="clip-handle-end"]', ms: 900 },
  { wait: 1000 },
  { key: 'Escape' },
  { wait: 600 },
  { scroll: 520, ms: 2200 },
  { wait: 1200 },
  { scroll: -520, ms: 1800 },
  { wait: 600 },
]

/* ── Accueil ───────────────────────────────────────────────────────────── */

const home = [
  { id: 'home-dashboard', route: '/', viewport: [1600, 900], out: [1600, 900], steps: dashboardTour },
  { id: 'home-record', route: '/record', viewport: [1440, 900], out: [1440, 900] },
  { id: 'home-microreview', route: REVIEW, needs: 'gameId', viewport: [1440, 900], out: [1088, 680], steps: microReviewTour },
  { id: 'home-review', route: REVIEW, needs: 'gameId', viewport: [1440, 900], out: [1088, 680], steps: reviewTour },
  { id: 'home-stats', route: '/stats', viewport: [1440, 900], out: [1440, 900] },
  { id: 'home-lab', route: '/stats/mistakes', viewport: [1440, 900], out: [1440, 900] },
]

/* ── Entraînement solo ─────────────────────────────────────────────────── */

const solo = [
  { id: 'solo-session', route: '/session', viewport: [1600, 828], out: [1600, 828], steps: [{ wait: 900 }, { scroll: 380, ms: 1800 }, { wait: 1200 }, { scroll: -380, ms: 1500 }, { wait: 600 }] },
  { id: 'solo-record', route: '/record', viewport: [1416, 960], out: [1416, 960] },
  { id: 'solo-microreview', route: REVIEW, needs: 'gameId', viewport: [1600, 828], out: [1600, 828], steps: microReviewTour },
  // The single player in clip mode: the handles Début / Fin above the timeline (opened with C, nothing saved).
  { id: 'solo-review', route: REVIEW, needs: 'gameId', viewport: [1416, 960], out: [1416, 960], setup: [MR_TAB, MID_VIDEO, { wait: 800 }, { key: 'c' }, { wait: 1200 }] },
  { id: 'solo-stats', route: '/stats', viewport: [1416, 960], out: [1416, 960] },
  { id: 'solo-lab', route: '/stats/mistakes', viewport: [1416, 960], out: [1416, 960] },
  { id: 'solo-radar', route: '/', viewport: [1416, 960], out: [1416, 960], setup: [{ click: button('Voir le détail par fondamental'), ms: 1 }, { wait: 900 }] },
]

/* ── Mini demo windows (heroes of the solo page), 16:9 ──────────────────── */

const wide = { viewport: [1600, 900] }
const demo = [
  { id: 'demo-solo-objectif', route: '/session', ...wide, out: [1280, 720], steps: [{ wait: 800 }, { scroll: 300, ms: 1600 }, { wait: 1200 }, { scroll: -300, ms: 1300 }, { wait: 500 }] },
  { id: 'demo-solo-partie', route: '/record', ...wide, out: [1600, 900] },
  { id: 'demo-solo-micro', route: REVIEW, needs: 'gameId', ...wide, out: [1280, 720], steps: microReviewTour },
  { id: 'demo-solo-revue', route: REVIEW, needs: 'gameId', ...wide, out: [1280, 720], steps: reviewTour },
  { id: 'demo-solo-mesure', route: '/stats/mistakes', ...wide, out: [1600, 900] },
]

/* ── New screens (not placed on the site yet) ──────────────────────────── */

const extra = [
  { id: 'app-detected-mistakes', route: REVIEW, needs: 'gameId', viewport: [1416, 960], out: [1416, 960], setup: [{ click: { sel: 'button', text: 'Erreurs détectées' }, ms: 1 }, { wait: 1400 }] },
  { id: 'app-laning-phase', route: '/lane-phase/{gameId}', needs: 'gameId', viewport: [1416, 960], out: [1416, 960], settle: 4000 },
]

/* ── Team screens: read from the cloud (CAPTURE_CLOUD=1) ───────────────── */

const team = [
  { id: 'home-planning', cloud: true, route: '/planning', viewport: [1400, 880], out: [1050, 660] },
  { id: 'team-planning', cloud: true, route: '/team-space', viewport: [1600, 828], out: [1600, 828] },
  { id: 'team-stats', cloud: true, route: '/team', viewport: [1416, 960], out: [1416, 960] },
  { id: 'team-dashboard', cloud: true, route: '/coaching', viewport: [1600, 828], out: [1600, 828] },
]

module.exports = [...home, ...solo, ...demo, ...extra, ...(process.env.CAPTURE_CLOUD === '1' ? team : [])]
