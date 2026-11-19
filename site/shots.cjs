/**
 * What site/capture.cjs photographs and films. One entry per media file.
 *
 *   id        file name in site/public/media
 *   route     harness route (see .harness/main.tsx)
 *   viewport  [w, h] the app is rendered at
 *   crop      [x, y, w, h] part of the viewport kept, or
 *   region    { cards: [heading text…], pad?, size?, anchor? } the cards to keep
 *   out       [w, h] size of the file
 *   scale     page zoom for stills cut out of a page (window = viewport × scale,
 *             at most the screen, 2560 × 1392 on this machine)
 *   mock      JS run before the route mounts, `m` being the harness mock table
 *   setup     steps played before a still is taken
 *   steps     steps of a clip (its presence makes the entry a clip)
 *
 * Steps: { wait }, { route }, { hover }, { click }, { type }, { key },
 * { scroll, in?, ms? }, { reveal, block? }, { js }, { hideCursor }. A target
 * is a selector, a { sel, text } pair or [x, y].
 *
 * Sizes: a still is twice the size the page shows it at (sharp on dense
 * screens), a clip about one and a half times.
 */

/** Clicks a tab (or any button) by its label, at once. */
const tab = (text) => ({ click: { sel: '[role=tab], button', text }, ms: 1 })
const button = (text) => ({ sel: 'button', text })

/** The dashboard's calibration prompt is a moment of its own, not the dashboard. */
const NO_CALIBRATION = 'm.calibrationStatus = { ...m.calibrationStatus, due: false }'

/** Recorded games for the Record Hub (the harness has none): thumbnails come from capture.cjs. */
const RECORDINGS = `(() => {
  const rows = [
    ['LeeSin', 'Diana', true, 9, 2, 11, 1712, 'soloq', true],
    ['JarvanIV', 'Kindred', false, 4, 8, 7, 1923, 'soloq', true],
    ['Sejuani', 'Nidalee', true, 6, 5, 11, 2196, 'flex', true],
    ['Viego', 'Elise', true, 11, 3, 6, 1588, 'soloq', false],
    ['Vi', 'Diana', false, 3, 6, 9, 2041, 'soloq', true],
    ['Graves', 'Kindred', true, 8, 1, 7, 1655, 'flex', false],
    ['LeeSin', 'Nidalee', true, 7, 4, 13, 1847, 'soloq', true],
    ['MonkeyKing', 'Elise', false, 2, 7, 5, 1499, 'soloq', false],
  ]
  const day = 86400000
  m.listGamesWithRecordings = rows.map(([champion, opponentChampion, win, kills, deaths, assists, duration, queueType, hasReview], i) => ({
    recordingId: 'rec' + i, gameId: 'g' + i, filePath: 'C:/Videos/Ascend/game-' + i + '.mp4', youtubeUrl: i === 2 ? 'https://youtu.be/demo' : null,
    source: 'capture', thumbnailPath: 'C:/Videos/Ascend/thumbs/game-' + i + '.jpg', clipCount: [2, 0, 1, 0, 3, 0, 1, 0][i],
    champion, opponentChampion, win, kills, deaths, assists, duration, gameEndAt: new Date(Date.now() - (i < 5 ? 0.05 + i * 0.04 : 1 + (i - 5) * 0.05) * day).toISOString(),
    hasReview, reviewId: hasReview ? 'rv' + i : null, sessionObjectiveId: 'wave_management', queueType, isSessionEligible: true, accountName: 'Nova',
  }))
  m.listAllClips = [0, 2, 4, 4, 6].map((g, i) => ({ clipId: 'clip' + i, recordingId: 'rec' + g, filePath: 'C:/Videos/Ascend/clips/clip-' + i + '.mp4', thumbnailPath: 'C:/Videos/Ascend/clips/clip-' + i + '.jpg',
    title: ['Invade lvl 1', 'Steal drake', 'Teamfight Baron', 'Flash + R', 'Gank bot'][i], startMs: 0, endMs: 24000, createdAt: new Date(Date.now() - i * 40000000).toISOString(), fileSize: 18000000,
    champion: ['LeeSin', 'Sejuani', 'Vi', 'Vi', 'LeeSin'][i], opponentChampion: null, win: true, duration: 24 }))
  m.scanRecordings = { added: 0 }
})()`

/* ── Shared clips ─────────────────────────────────────────────────────── */

const dashboardTour = [
  { wait: 700 },
  { hover: button('Continuer la session'), ms: 1100 },
  { wait: 700 },
  { hover: button('Voir le détail par fondamental'), ms: 1000 },
  { wait: 600 },
  { scroll: 560, ms: 2200 },
  { wait: 900 },
  { hover: { sel: 'h3', text: 'Assistant' }, ms: 900 },
  { wait: 900 },
  { scroll: -560, ms: 1900 },
  { wait: 300 },
  { hover: button('Continuer la session'), ms: 900 },
  { wait: 300 },
]

const microReviewTour = [
  { wait: 800 },
  { hover: button('Occasion manquée'), ms: 900 },
  { wait: 500 },
  { click: button("J'ai mal lu l'état des lanes"), ms: 700 },
  { wait: 2300 },
  { click: button('Moment suivant'), ms: 900 },
  { wait: 1400 },
  { click: button('Aucune ward pour préparer'), ms: 1000 },
  { wait: 2200 },
  { click: button('Moment suivant'), ms: 900 },
  { wait: 1400 },
  { click: button('Respect de la menace clé'), ms: 1000 },
  { wait: 2400 },
]

const planningTour = [
  { wait: 700 },
  { hover: { sel: 'button.absolute', text: 'Scrim vs Aegis' }, ms: 1000 },
  { wait: 600 },
  { click: { sel: 'button.absolute', text: 'Scrim vs Aegis' }, ms: 400 },
  { wait: 2600 },
  { key: 'Escape' },
  { wait: 700 },
  { hover: { sel: 'button.absolute', text: 'Match officiel' }, ms: 1200 },
  { wait: 1200 },
]

const VOD_SETUP = [tab('Review VOD'), { wait: 1400 }]
const vodTour = [
  { wait: 500 },
  { hover: { sel: 'p, div', text: 'Rotation top trop lente' }, ms: 1000 },
  { wait: 700 },
  { click: 'input[placeholder="sec"]', ms: 900 },
  { type: '1660' },
  { click: 'textarea', ms: 700 },
  { type: 'Baron trop tôt : deux joueurs sans vision côté top.', cps: 26 },
  { wait: 600 },
  { hover: { js: "document.querySelector('main textarea').closest('div').parentElement.querySelectorAll('button')[1]" }, ms: 700 },
  { wait: 1400 },
]

/* ── Accueil ───────────────────────────────────────────────────────────── */

const home = [
  { id: 'home-dashboard', route: '/', viewport: [1600, 900], out: [1600, 900], mock: NO_CALIBRATION, steps: dashboardTour },
  { id: 'home-record', route: '/record', viewport: [1440, 900], out: [1440, 900], mock: RECORDINGS, settle: 2600 },
  { id: 'home-microreview', route: '/microreview', viewport: [1440, 900], out: [1088, 680], steps: microReviewTour },
  { id: 'home-review', route: '/review', viewport: [1440, 900], out: [1088, 680], steps: [{ wait: 900 }, { scroll: 640, ms: 2600 }, { wait: 1400 }, { scroll: -640, ms: 2200 }, { wait: 700 }] },
  { id: 'home-stats', route: '/stats', viewport: [1440, 900], out: [1440, 900] },
  { id: 'home-lab', route: '/stats/mistakes', viewport: [1440, 900], out: [1440, 900] },
  { id: 'home-planning', route: '/planning', viewport: [1400, 880], out: [1050, 660], steps: planningTour },
  { id: 'home-team-dashboard', route: '/coaching', viewport: [1440, 790], out: [920, 880], scale: 1.75, setup: [{ reveal: { sel: 'h3', text: 'Retours du coach' }, block: 'start' }], region: { cards: ['Retours du coach', 'Tableau de bord staff'], pad: 0, anchor: 'start' } },
  { id: 'home-team-stats', route: '/team', viewport: [1440, 790], out: [920, 880], scale: 1.75, setup: [tab('Stats Flex'), { wait: 1500 }, { reveal: { sel: 'h2, h3, p, span', text: 'Kaito' }, block: 'start' }], region: { cards: ['Kaito'], pad: 14, size: [596, 570], anchor: 'start' } },
  { id: 'home-vod', route: '/coaching', viewport: [1400, 880], out: [1050, 660], setup: VOD_SETUP, steps: vodTour },
]

/* ── Entraînement solo ─────────────────────────────────────────────────── */

const solo = [
  {
    id: 'solo-session', route: '/session', viewport: [1600, 828], out: [1600, 828], mock: NO_CALIBRATION,
    steps: [
      { wait: 800 },
      { hover: { sel: 'span, div', text: 'Gestion des waves' }, ms: 900 },
      { wait: 700 },
      { scroll: 380, ms: 1800 },
      { wait: 900 },
      { click: 'a[href="#/plan"]', ms: 1100 },
      { wait: 1800 },
      { hover: button('Pourquoi ?'), ms: 1000 },
      { click: button('Pourquoi ?'), ms: 300 },
      { wait: 2200 },
      { click: 'a[href="#/session"]', ms: 1200 },
      { wait: 900 },
    ],
  },
  { id: 'solo-record', route: '/record', viewport: [1416, 960], out: [1416, 960], mock: RECORDINGS, settle: 2600 },
  { id: 'solo-microreview', route: '/microreview', viewport: [1600, 828], out: [1600, 828], steps: microReviewTour },
  { id: 'solo-review', route: '/review', viewport: [1416, 960], out: [1416, 960] },
  { id: 'solo-stats', route: '/stats', viewport: [1416, 960], out: [1416, 960] },
  { id: 'solo-lab', route: '/stats/mistakes', viewport: [1416, 960], out: [1416, 960] },
  { id: 'solo-radar', route: '/', viewport: [1416, 960], out: [1416, 960], mock: NO_CALIBRATION, setup: [{ click: button('Voir le détail par fondamental'), ms: 1 }, { wait: 900 }] },
]

/* ── Environnement d'équipe ────────────────────────────────────────────── */

const team = [
  { id: 'team-dashboard', route: '/coaching', viewport: [1600, 828], out: [1600, 828], setup: [{ reveal: { sel: 'h3', text: 'Retours du coach' }, block: 'start' }] },
  { id: 'team-planning', route: '/planning', viewport: [1600, 828], out: [1600, 828], steps: planningTour },
  { id: 'team-vod', route: '/coaching', viewport: [1416, 960], out: [1416, 960], setup: [tab('Review VOD'), { wait: 1200 }] },
  { id: 'team-stats', route: '/team', viewport: [1416, 960], out: [1416, 960] },
  {
    id: 'team-player', route: '/coaching', viewport: [1416, 960], out: [1062, 720],
    setup: [tab('Joueurs'), { wait: 1500 }],
    steps: [{ wait: 500 }, { hover: { sel: 'h2, h3', text: 'Nyra' }, ms: 900 }, { scroll: 420, ms: 2000 }, { wait: 1200 }, tab('Rapport hebdo'), { wait: 2600 }],
  },
  {
    id: 'team-draft', route: '/coaching', viewport: [1416, 960], out: [1062, 720],
    setup: [tab('Draft Sim'), { wait: 1500 }],
    steps: [{ wait: 500 }, { hover: 'main img[alt]', ms: 1000 }, { wait: 800 }, tab('Scouting'), { wait: 1600 }, { hover: { sel: 'h3, h2', text: 'Aegis' }, ms: 900 }, { wait: 1400 }],
  },
]

/* ── Mini demo windows (heroes of the solo and team pages), 16:9 ──────────── */

const wide = { viewport: [1600, 900] }
const demo = [
  { id: 'demo-solo-objectif', route: '/session', ...wide, out: [1280, 720], mock: NO_CALIBRATION, steps: [{ wait: 700 }, { hover: { sel: 'span, div', text: 'Gestion des waves' }, ms: 900 }, { wait: 600 }, { hover: { sel: 'span, div', text: 'Contrôle de la vision' }, ms: 700 }, { wait: 700 }, { scroll: 300, ms: 1600 }, { wait: 1200 }, { scroll: -300, ms: 1300 }, { wait: 500 }] },
  { id: 'demo-solo-partie', route: '/record', ...wide, out: [1600, 900], mock: RECORDINGS, settle: 2600 },
  { id: 'demo-solo-micro', route: '/microreview', ...wide, out: [1280, 720], steps: microReviewTour },
  { id: 'demo-solo-revue', route: '/review', ...wide, out: [1280, 720], steps: [{ wait: 800 }, { scroll: 600, ms: 2400 }, { wait: 1300 }, { scroll: -600, ms: 2000 }, { wait: 600 }] },
  { id: 'demo-solo-mesure', route: '/stats/mistakes', ...wide, out: [1600, 900] },
  { id: 'demo-team-planning', route: '/planning', ...wide, out: [1280, 720], steps: planningTour },
  { id: 'demo-team-stats', route: '/team', ...wide, out: [1600, 900] },
  { id: 'demo-team-vod', route: '/coaching', ...wide, out: [1280, 720], setup: VOD_SETUP, steps: vodTour },
  { id: 'demo-team-player', route: '/coaching', ...wide, out: [1280, 720], setup: [tab('Joueurs'), { wait: 1500 }], steps: [{ wait: 500 }, { hover: { sel: 'h2, h3', text: 'Nyra' }, ms: 900 }, { scroll: 420, ms: 2000 }, { wait: 1300 }, { scroll: -420, ms: 1500 }, { wait: 600 }] },
  { id: 'demo-team-draft', route: '/coaching', ...wide, out: [1280, 720], setup: [tab('Draft Sim'), { wait: 1600 }], steps: [{ wait: 500 }, { hover: 'main img[alt]', ms: 1000 }, { wait: 900 }, tab('Scouting'), { wait: 1800 }, { hover: { sel: 'h3, h2', text: 'Aegis' }, ms: 900 }, { wait: 1200 }] },
  { id: 'demo-team-staff', route: '/coaching', ...wide, out: [1600, 900], setup: [{ reveal: { sel: 'h3', text: 'Retours du coach' }, block: 'start' }] },
]

module.exports = [...home, ...solo, ...team, ...demo]
