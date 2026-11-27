/**
 * View-models of the interactive exhibits, for one language. The inputs are
 * the invented demonstration account (demo.mjs); everything else is computed
 * by the app's own modules (`engine`, bundled from src/ by build.mjs) and
 * worded with the app's own locale strings (`app`), so the previews cannot
 * drift from the product.
 */
import { makeT, num, signed } from './lib/html.mjs'
import { appVars } from './lib/appVars.mjs'
import { DASHBOARD, FIRST_MOMENT, GAMES, LAB_DAYS, MISTAKES, MOMENTS, PLAYER, RADAR, XP_SOURCES } from './demo.mjs'

const RADAR_DIGITS = { kda: 2, csm: 1, deaths: 1, vspm: 1, pinks: 1, wardkill: 1, cc: 1 }

export function buildData({ engine, app, copy, lang, locale, tierDefs, iconUnlocks, themeBlocks, autoDetected }) {
  const t = makeT(app, lang)
  const c = makeT(copy, lang)
  const raw = (dict, key) => key.split('.').reduce((o, k) => o?.[k], dict)
  const pctOf = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0)
  const fundamentals = lang === 'fr' ? engine.FUNDAMENTALS_FR : engine.FUNDAMENTALS
  const fundLabel = (id) => {
    for (const cat of fundamentals) for (const f of cat.fundamentals) if (f.id === id) return f.label
    throw new Error(`unknown fundamental: ${id}`)
  }
  const tagMeta = engine.BUILT_IN_MISTAKE_TAGS
  const tagName = (slug) => engine.tagLabel(t, slug, tagMeta.find((x) => x.slug === slug)?.label)
  const families = engine.FAMILIES.map((f) => ({ id: f, label: t(`mistakeLab.family.${f}`) }))
  const letter = (win) => c(win ? 'ui.winLetter' : 'ui.lossLetter')

  // ── Product facts quoted in the copy ──
  const facts = {
    fundamentals: fundamentals.reduce((n, cat) => n + cat.fundamentals.length, 0),
    families: fundamentals.length,
    maxMoments: engine.DETECTOR_SPEC.maxMoments,
    patterns: engine.MOMENT_PATTERNS.length,
    spacing: engine.DETECTOR_SPEC.minSpacingSec,
    recent: RADAR.recentGames,
    snapshot: RADAR.snapshotGames,
    calibration: engine.CALIBRATION_EVERY,
    garbageHigh: Math.round(engine.GARBAGE_HIGH * 100),
    garbageLow: Math.round(engine.GARBAGE_LOW * 100),
    codex: engine.CODEX.length,
    tags: tagMeta.length,
    auto: autoDetected,
    labDays: LAB_DAYS,
    ...XP_SOURCES,
  }

  // ── A · micro-review ──
  const fiches = {}
  const ficheId = (entry) => {
    if (!entry) return null
    fiches[entry.id] ??= {
      headline: engine.localize(entry.headline, lang),
      rule: engine.localize(entry.tacticalRule, lang),
      drill: engine.localize(entry.drillObjective, lang),
      objective: fundLabel(entry.fundamentalId),
      video: !!entry.videoExamples?.length,
    }
    return entry.id
  }
  const moments = MOMENTS.map((m) => {
    const moment = {
      key: `${m.trigger}@${m.gameTimeSec}`, trigger: m.trigger, gameTimeSec: m.gameTimeSec, severity: m.severity, position: m.position,
      zone: engine.zoneOf(m.position, PLAYER.team), lane: engine.laneOf(m.position), territory: engine.territoryOf(m.position, PLAYER.team),
      winProbBefore: 0.5, winProbAfter: null, facts: m.facts,
    }
    const card = engine.buildQcm(moment)
    const sum = engine.summaryText(t, card.summary)
    const phase = engine.phaseOf(m.gameTimeSec)
    return {
      key: moment.key,
      clock: sum.clock,
      zone: sum.zone ?? '',
      line: sum.line,
      label: m.facts.pattern ? t(`microReview.pattern.${m.facts.pattern}`) : t(`microReview.trigger.${m.trigger}`),
      map: m.position,
      options: card.options.map((o) => ({
        id: o.id,
        outcome: o.outcome,
        main: t(`microReview.reason.${o.reason}`, { tag: o.tagSlug ? tagName(o.tagSlug) : '' }),
        sub: o.outcome === 'justified' ? t('microReview.justifiedBadge') : tagName(o.tagSlug),
        fiche: o.outcome === 'justified' ? null : ficheId((o.codexId ? engine.codexById(o.codexId) : null) ?? engine.codexFor(o.tagSlug, PLAYER.role, phase, [])),
      })),
      other: Object.fromEntries(tagMeta.map((tg) => [tg.slug, ficheId(engine.codexFor(tg.slug, PLAYER.role, phase, []))])),
    }
  })
  const micro = {
    lang, first: FIRST_MOMENT, xp: XP_SOURCES.microReview, moments, fiches, families,
    tags: tagMeta.map((tg) => ({ slug: tg.slug, label: tagName(tg.slug), family: engine.tagFamily(tg.slug, tg.category) })),
    pits: { baron: engine.BARON_PIT, dragon: engine.DRAGON_PIT, radius: engine.OBJECTIVE_RADIUS },
    s: {
      title: t('microReview.title'), subtitle: t('microReview.subtitle', { count: MOMENTS.length }), queue: t('microReview.queue'),
      question: t('microReview.question'), other: t('microReview.other'), otherTitle: t('microReview.otherTitle'),
      otherJustified: t('microReview.otherJustified'), assumed: t('microReview.reason.assumed'), cancel: t('microReview.cancel'),
      justifiedBadge: t('microReview.justifiedBadge'), justifiedDone: t('microReview.justifiedDone'), next: t('microReview.next'),
      done: t('microReview.done'), doneXp: raw(app, 'microReview.doneXp'), doneSummary: raw(app, 'microReview.doneSummary'),
      codexTitle: t('codex.title'), drill: t('codex.drill'), prepare: t('codex.prepare'),
      noVod: t('microReview.vod.noRecording'), mapLabel: t('microReview.vod.mapLabel'), familiesLabel: t('mistakeLab.families'),
      restart: c('ui.restart'), prepareDone: raw(copy, 'ui.prepareDone'), codexVideo: c('ui.codexVideo'), you: c('ui.you'),
    },
  }

  // ── C · Mistake Lab ──
  const games = GAMES.map((win, k) => ({ id: `g${k + 1}`, n: k + 1, win, champion: '', opponentChampion: null, duration: 1800, gameEndAt: new Date(Date.UTC(2026, 9, 19 + k * 2, 19)).toISOString() }))
  const occ = []
  for (const [slug, list] of Object.entries(MISTAKES)) {
    const tag = tagMeta.find((x) => x.slug === slug)
    if (!tag) throw new Error(`demo mistake is not a built-in tag: ${slug}`)
    for (const [n, sec] of list) {
      occ.push({ id: `${slug}-${n}-${sec}`, tag: { id: slug, slug, label: tagName(slug), category: tag.category }, severity: 2, gameTimeSec: sec, autoDetected: false, note: null, recordingId: null, game: games[n - 1] })
    }
  }
  const ranked = engine.rankMistakes(occ)
  const analysed = new Set(occ.map((o) => o.game.id)).size
  const allPhases = engine.phaseBreakdown(occ)
  const topPhase = Object.entries(allPhases).sort((a, b) => b[1] - a[1])[0]
  const maxCount = ranked[0].count
  const lab = {
    lang,
    families,
    kpis: [
      { label: t('mistakeLab.kpi.total'), value: String(occ.length), sub: t('mistakeLab.kpi.games', { count: analysed }) },
      { label: t('mistakeLab.kpi.perGame'), value: num(occ.length / analysed, locale, 1), sub: t('mistakeLab.kpi.perGameSub') },
      { label: t('mistakeLab.kpi.top'), value: ranked[0].label, sub: t('mistakeLab.kpi.topSub', { count: ranked[0].count, share: ranked[0].share }), text: true },
      { label: t('mistakeLab.kpi.phase'), value: t(`mistakeLab.phase.${topPhase[0]}`), sub: t('mistakeLab.kpi.phaseSub', { share: pctOf(topPhase[1], occ.length) }), text: true },
    ],
    rows: ranked.map((r) => {
      const mine = occ.filter((o) => o.tag.slug === r.slug)
      const phases = engine.phaseBreakdown(mine)
      const maxPhase = Math.max(...Object.values(phases), 1)
      const dom = engine.dominantPhase(mine.map((o) => o.gameTimeSec))
      const entry = engine.codexFor(r.slug, PLAYER.role, dom, [])
      const delta = r.winrateWith != null && r.winrateWithout != null ? r.winrateWith - r.winrateWithout : null
      return {
        slug: r.slug, label: r.label, family: r.family, count: r.count, share: r.share, bar: Math.round((r.count / maxCount) * 100),
        delta, deltaLabel: delta == null ? '—' : c('ui.points', { n: signed(delta, locale) }),
        inspector: {
          family: t(`mistakeLab.family.${r.family}`),
          summary: t('mistakeLab.inspector.summary', { count: r.count, games: r.games, share: r.share }),
          // Same wording rule as the app's Mistake Lab: too few games without the mistake → no comparison.
          cost: delta == null ? null
            : r.gamesWithout >= 3 ? t('mistakeLab.inspector.cost', { with: r.winrateWith, withGames: r.gamesWith, without: r.winrateWithout, withoutGames: r.gamesWithout })
            : t('mistakeLab.inspector.costFew', { with: r.winrateWith, withGames: r.gamesWith, withoutGames: r.gamesWithout }),
          phases: ['early', 'mid', 'late'].map((p) => ({ label: t(`mistakeLab.phase.${p}`), range: t(`mistakeLab.phaseRange.${p}`), count: phases[p], pct: Math.round((phases[p] / maxPhase) * 100) })),
          prescTitle: dom ? t('codex.whenTitle', { phase: t(`mistakeLab.phase.${dom}`) }) : '',
          fiche: entry ? { headline: engine.localize(entry.headline, lang), rule: engine.localize(entry.tacticalRule, lang), drill: engine.localize(entry.drillObjective, lang) } : null,
          moments: engine.latestMoments(occ, r.slug, 3).map((o) => ({ clock: engine.fmtClock(o.gameTimeSec), label: c('ui.game', { n: o.game.n }), win: o.game.win, letter: letter(o.game.win) })),
        },
      }
    }),
    s: {
      all: t('mistakeLab.family.all'), families: t('mistakeLab.families'), rankingTitle: t('mistakeLab.ranking.title'), none: t('mistakeLab.ranking.none'),
      costTitle: t('mistakeLab.ranking.costTitle'), when: t('mistakeLab.inspector.when'), momentsTitle: t('mistakeLab.inspector.moments'),
      actionHint: t('mistakeLab.inspector.actionHint'), codexTitle: t('codex.title'), drill: t('codex.drill'),
      legend: c('lab.legend'), noGap: c('ui.noGap'),
    },
  }

  // ── B · Dashboard ──
  const last10 = games.slice(-10)
  const formWin = pctOf(last10.filter((g) => g.win).length, last10.length)
  const dist = engine.measuredDistribution(occ.map((o) => ({ slug: o.tag.slug, category: o.tag.category })))
  const famLabel = (f) => t(`mistakeLab.family.${f}`)
  const need = engine.xpForLevel(DASHBOARD.level)
  const tierOf = (level) => tierDefs.reduce((cur, x) => (level >= x.minLevel ? x : cur), tierDefs[0])
  const objectives = DASHBOARD.sessionObjectives.map(fundLabel)
  const dashboard = {
    lang,
    name: PLAYER.name,
    role: t(`mistakeLab.roles.${PLAYER.role}`),
    form: last10.map((g) => ({ win: g.win, letter: letter(g.win), label: `${c('ui.game', { n: g.n })}, ${c(g.win ? 'ui.win' : 'ui.loss')}` })),
    formWinrate: `${formWin} % ${t('dashboard.header.winrateShort')}`,
    formDelta: `(${signed(formWin - DASHBOARD.overallWinrate, locale)} ${t('dashboard.header.vsOverall')})`,
    stats: [
      { label: t('dashboard.stats.games'), value: String(DASHBOARD.totalGames) },
      { label: t('dashboard.stats.winRate'), value: `${DASHBOARD.overallWinrate} %` },
      { label: t('dashboard.stats.avgKda'), value: num(DASHBOARD.avgKda, locale, 2) },
      { label: t('dashboard.stats.objSuccess'), value: `${DASHBOARD.objectivesKept} %` },
    ],
    session: {
      title: t('dashboard.activeSession.title'),
      objectives: objectives.join(', '),
      games: t('dashboard.activeSession.game', { count: DASHBOARD.sessionGames }),
    },
    calib: {
      title: t('calibration.title'),
      due: t('calibration.due', { count: DASHBOARD.gamesSinceCalibration }),
      question: t('calibration.question'),
      families,
      results: Object.fromEntries(engine.FAMILIES.map((f) => {
        const gap = engine.calibrationGap(f, dist)
        const text = gap.aligned == null ? t('calibration.resultThin')
          : gap.aligned ? t('calibration.resultAligned', { family: famLabel(gap.measuredTop), share: gap.topShare })
            : t('calibration.resultGap', { perceived: famLabel(f), perceivedShare: gap.perceivedShare, measured: famLabel(gap.measuredTop), share: gap.topShare })
        return [f, text]
      })),
      distTitle: t('calibration.dist', { count: games.length }),
      dist: dist.map((x) => ({ label: famLabel(x.family), share: x.share })),
    },
    s: {
      // The app still says "vos" on this one line; the page addresses the reader as "tu" throughout.
      welcome: t('dashboard.welcome'), formLine: c('ui.formLine', { count: last10.length }), form: t('dashboard.header.form'),
      mainRole: t('dashboard.header.mainRole'), formLabel: c('ui.formLabel'),
    },
  }

  // ── D · fundamentals radar ──
  const radarSet = (role) => {
    const axes = role === 'support' ? engine.SUPPORT_RADAR_AXES : engine.RADAR_AXES
    const points = engine.buildFundamentalsRadar(RADAR[role].recent, RADAR[role].snapshot, axes)
    return {
      score: t('dashboard.radar.score', { score: engine.overallRadarScore(points) }),
      points: points.map((p, i) => {
        const digits = RADAR_DIGITS[p.key] ?? 0
        const label = t(`dashboard.radar.axis.${p.key}`, { defaultValue: p.label })
        // The app prints "61%"; the page follows each language's own spacing rule (see typo()).
        const unit = p.unit === '%' ? ' %' : p.unit
        const fmt = (v) => `${num(v, locale, digits)}${unit}`
        const gap = p.recentRaw - p.snapshotRaw
        const inverted = axes[i].min > axes[i].max
        const recent = fmt(p.recentRaw)
        const snapshot = fmt(p.snapshotRaw)
        return {
          key: p.key, label, recent, snapshot, rs: p.recentScore, ss: p.snapshotScore,
          gap: `${signed(Number(gap.toFixed(digits)), locale, digits)}${unit}`,
          good: inverted ? gap < 0 : gap > 0,
          readout: c('print.readout', { axis: label, recent, snapshot, recentGames: RADAR.recentGames, snapshotGames: RADAR.snapshotGames }),
        }
      }),
    }
  }
  const radar = {
    lang,
    roles: [{ id: 'carry', label: c('print.roles.carry') }, { id: 'support', label: c('print.roles.support') }],
    sets: { carry: radarSet('carry'), support: radarSet('support') },
    s: {
      title: t('dashboard.radar.title'), recentLabel: t('dashboard.radar.recentLabel', { count: RADAR.recentGames }), snapshotLabel: t('dashboard.radar.snapshotLabel', { count: RADAR.snapshotGames }),
      roleLabel: c('print.roleLabel'), colAxis: c('print.table.axis'), colRecent: c('print.table.recent', { count: RADAR.recentGames }), colSnapshot: c('print.table.snapshot', { count: RADAR.snapshotGames }),
      colGap: c('print.table.gap'), readoutIdle: c('print.readoutIdle'), scale: c('print.scale'),
    },
  }

  // ── Practice tiers ──
  const xpToReach = (level) => { let sum = 0; for (let l = 1; l < level; l++) sum += engine.xpForLevel(l); return sum }
  // The totals printed under each tier must be the ones the app itself would turn into that level.
  for (const x of tierDefs) {
    if (engine.getLevelFromXp(xpToReach(x.minLevel)).level !== x.minLevel) throw new Error(`tier ${x.id}: the XP total does not give level ${x.minLevel} in the app`)
  }
  const top = tierDefs[tierDefs.length - 1].minLevel
  const tiers = {
    lang,
    current: tierOf(DASHBOARD.level).id,
    tiers: tierDefs.map((x) => {
      const xp = xpToReach(x.minLevel)
      const icons = iconUnlocks.filter(([, tier]) => tier === x.id).length
      return {
        id: x.id,
        label: t(`profile.tiers.${x.id}`),
        level: c('tiers.level', { n: x.minLevel }),
        levelShort: c('tiers.levelShort', { n: x.minLevel }),
        height: Math.round(10 + 90 * ((x.minLevel - 1) / (top - 1))),
        detail: x.minLevel === 1
          ? [c('tiers.detail.first'), c('tiers.detail.icons', { count: 0 })]
          : [c('tiers.detail.xp', { xp: num(xp, locale) }), c('tiers.detail.reviews', { n: num(Math.ceil(xp / XP_SOURCES.review), locale), m: num(Math.ceil(xp / XP_SOURCES.microReview), locale) }), c('tiers.detail.icons', { count: icons })],
      }
    }),
    s: { scaleLabel: c('tiers.scaleLabel'), you: c('tiers.you', { level: DASHBOARD.level }) },
  }

  // ── E · themes ──
  // Built-in themes keep their order from the app but lose their internal id
  // on the way out: the page names them by colour only.
  const themes = {
    lang,
    presets: themeBlocks.map((b, i) => ({ id: `p${i}`, name: c(`themes.names.${b.id}`), vars: appVars(b.tokens) })),
    custom: { palette: engine.DEFAULT_CUSTOM_PALETTE, vars: appVars(engine.deriveCustomTokens(engine.DEFAULT_CUSTOM_PALETTE)) },
    sample: {
      nav: [t('nav.dashboard'), t('nav.session'), t('nav.review'), t('nav.mistakeLab')],
      sessionTitle: t('dashboard.activeSession.title'),
      objective: objectives.join(', '),
      // The level as the app's sidebar shows it.
      pct: Math.round((DASHBOARD.xpIntoLevel / need) * 100),
      xp: `${DASHBOARD.xpIntoLevel}/${need} XP`,
      level: `${t('sidebar.level')} ${DASHBOARD.level}`,
      stats: dashboard.stats,
    },
    s: {
      presets: c('themes.presets'), custom: c('themes.custom'), preview: c('themes.preview'),
      fields: { base: c('themes.customFields.base'), accent: c('themes.customFields.accent'), secondary: c('themes.customFields.secondary') },
      sample: { objective: t('dashboard.activeSession.objective'), button: t('dashboard.activeSession.continueButton'), link: c('themes.sampleLink') },
    },
  }

  return { facts, micro, lab, dashboard, radar, tiers, themes }
}
