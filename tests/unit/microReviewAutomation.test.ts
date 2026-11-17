import { describe, it, expect } from 'vitest'
import { verifyObjective, verifySessionObjectives, ruleFor } from '../../src/lib/microReview/objectiveVerification'
import { calibrationDue, measuredDistribution, calibrationGap, CALIBRATION_EVERY } from '../../src/lib/microReview/calibration'
import { codexFor, codexById, dominantPhase, normalizeRole, sessionPrefill, localize, isOfficialVideo, sanitizeVideos, segmentEmbedUrl, officialThumbnail, CODEX, type CodexEntry } from '../../src/lib/microReview/codex'
import { FUNDAMENTALS } from '../../src/lib/constants/fundamentals'
import type { ContestedObjective } from '../../src/lib/microReview/anomalyDetector'

const obj = (playerWarded: boolean, kind: ContestedObjective['kind'] = 'dragon', accountable = true): ContestedObjective => ({ gameTimeSec: 900, kind, takenBy: 'enemy', playerWarded, accountable })

describe('verifyObjective — vision', () => {
  it('passes with no no-ward tag and a ward before every contested objective', () => {
    const r = verifyObjective('vision_control', { tags: ['overstay'], contested: [obj(true), obj(true, 'baron')], reviewed: true })!
    expect(r).toMatchObject({ ruleId: 'ward-before-objectives', status: 'passed', objectivesWarded: 2, objectivesTotal: 2, failedTags: [] })
  })
  it('fails on a no-ward tag even when every objective was warded', () => {
    expect(verifyObjective('vision_control', { tags: ['no-ward-pre-obj'], contested: [obj(true)], reviewed: true })!.status).toBe('failed')
  })
  it('fails when one contested objective had no ward', () => {
    const r = verifyObjective('vision_setup', { tags: [], contested: [obj(true), obj(false)], reviewed: false })!
    expect(r.status).toBe('failed')
    expect(r.objectivesWarded).toBe(1)
  })
  it("only counts the objectives whose vision was the player's to provide", () => {
    // A top laner: two dragons taken by the team and one the player was dead for → none is held against them.
    const notMine = [obj(false, 'dragon', false), obj(false, 'dragon', false), obj(false, 'baron', false)]
    expect(verifyObjective('vision_control', { tags: [], contested: notMine, reviewed: true })).toMatchObject({ status: 'passed', objectivesWarded: 0, objectivesTotal: 0 })
    // Nothing to judge yet without a review.
    expect(verifyObjective('vision_control', { tags: [], contested: notMine, reviewed: false })!.status).toBe('unknown')
    // One accountable objective without a ward fails it, whatever the others.
    expect(verifyObjective('vision_control', { tags: [], contested: [...notMine, obj(false)], reviewed: true })).toMatchObject({ status: 'failed', objectivesWarded: 0, objectivesTotal: 1 })
    expect(verifyObjective('vision_control', { tags: [], contested: [...notMine, obj(true)], reviewed: false })).toMatchObject({ status: 'passed', objectivesWarded: 1, objectivesTotal: 1 })
  })
  it('counts every objective of an analysis stored before the accountability rule', () => {
    const legacy = [{ gameTimeSec: 900, kind: 'dragon', takenBy: 'ally', playerWarded: false }] as unknown as ContestedObjective[]
    expect(verifyObjective('vision_control', { tags: [], contested: legacy, reviewed: true })).toMatchObject({ status: 'failed', objectivesTotal: 1 })
  })
  it('is unknown without timeline nor review', () => {
    expect(verifyObjective('vision_control', { tags: [], contested: null, reviewed: false })!.status).toBe('unknown')
  })
})

describe('verifyObjective — other rules', () => {
  it('checks CS at 10 from the timeline even before a review', () => {
    expect(verifyObjective('csing_pathing', { tags: [], contested: [], csDiff10: -20, reviewed: false })!.status).toBe('failed')
    expect(verifyObjective('csing_pathing', { tags: [], contested: [], csDiff10: -5, reviewed: false })!.status).toBe('passed')
  })
  it('needs a review to call a tag-only rule passed', () => {
    expect(verifyObjective('map_awareness', { tags: [], contested: [], reviewed: false })!.status).toBe('unknown')
    expect(verifyObjective('map_awareness', { tags: [], contested: [], reviewed: true })!.status).toBe('passed')
    expect(verifyObjective('map_awareness', { tags: ['caught-out', 'caught-out'], contested: [], reviewed: true })).toMatchObject({ status: 'failed', failedTags: ['caught-out'] })
  })
  it('returns null for fundamentals without a measurable rule', () => {
    expect(verifyObjective('shotcalling_communication', { tags: [], contested: [], reviewed: true })).toBeNull()
  })
  it('low-energy protocol (resilience): no isolated death, forced trade or wasted summoner', () => {
    expect(verifyObjective('resilience', { tags: ['overstay'], contested: [], reviewed: true })).toMatchObject({ ruleId: 'low-energy', status: 'passed', failedTags: [] })
    expect(verifyObjective('resilience', { tags: ['caught-out', 'wasted-summoner'], contested: [], reviewed: true })).toMatchObject({ status: 'failed', failedTags: ['caught-out', 'wasted-summoner'] })
    expect(verifyObjective('resilience', { tags: [], contested: [], reviewed: false })!.status).toBe('unknown')
  })
  it('only targets real fundamentals', () => {
    const ids = new Set(FUNDAMENTALS.flatMap((c) => c.fundamentals.map((f) => f.id)))
    for (const id of ['vision_control', 'tempo', 'recall_timing', 'positioning', 'trades', 'mastery', 'csing_pathing', 'map_awareness']) {
      expect(ids.has(id)).toBe(true)
      expect(ruleFor(id)).not.toBeNull()
    }
  })
  it('aggregates a session with several objectives', () => {
    const s = verifySessionObjectives(['vision_control', 'tempo', 'shotcalling_communication'], { tags: ['overstay'], contested: [obj(true)], reviewed: true })
    expect(s.results.map((r) => r.status)).toEqual(['passed', 'failed'])
    expect(s.overall).toBe(false)
    expect(verifySessionObjectives(['shotcalling_communication'], { tags: [], contested: [], reviewed: true }).overall).toBeNull()
  })
})

describe('calibration flash', () => {
  it('is due every 15 games', () => {
    expect(CALIBRATION_EVERY).toBe(15)
    expect(calibrationDue(14)).toBe(false)
    expect(calibrationDue(15)).toBe(true)
  })
  it('measures the family distribution from tags', () => {
    const d = measuredDistribution([
      { slug: 'caught-out', category: 'macro' }, { slug: 'death-before-objective', category: 'macro' }, { slug: 'bad-positioning', category: 'micro' },
      { slug: 'no-ward-pre-obj', category: 'vision' }, { slug: 'my-custom', category: 'economy' },
    ])
    expect(d[0]).toEqual({ family: 'deaths', count: 3, share: 60 })
    expect(d.find((x) => x.family === 'tempo')!.count).toBe(1)
  })
  it('reports the gap between perception and data', () => {
    const d = measuredDistribution([...Array(6)].map(() => ({ slug: 'caught-out', category: 'macro' })).concat([{ slug: 'forgot-trinket', category: 'vision' }, { slug: 'forgot-trinket', category: 'vision' }]))
    const g = calibrationGap('vision', d)
    expect(g).toMatchObject({ measuredTop: 'deaths', perceivedShare: 25, topShare: 75, gapPts: 50, aligned: false, evidence: 8 })
    expect(calibrationGap('deaths', d).aligned).toBe(true)
  })
  it('does not judge on thin evidence', () => {
    const g = calibrationGap('tempo', measuredDistribution([{ slug: 'caught-out', category: 'macro' }]))
    expect(g.aligned).toBeNull()
    expect(calibrationGap('tempo', measuredDistribution([])).measuredTop).toBeNull()
  })
})

describe('AscendCodex', () => {
  it('has complete FR + EN entries on real fundamentals', () => {
    const ids = new Set(FUNDAMENTALS.flatMap((c) => c.fundamentals.map((f) => f.id)))
    expect(CODEX.length).toBeGreaterThanOrEqual(20)
    expect(new Set(CODEX.map((e) => e.id)).size).toBe(CODEX.length)
    for (const e of CODEX) {
      expect(ids.has(e.fundamentalId)).toBe(true)
      for (const f of [e.headline, e.tacticalRule, e.drillObjective]) {
        expect(f.fr.length).toBeGreaterThan(10)
        expect(f.en.length).toBeGreaterThan(10)
      }
    }
  })
  it('prefers role + phase, then any role, and never another role\'s rule', () => {
    expect(codexFor('no-ward-pre-obj', 'JUNGLE', 'mid')!.id).toBe('vision-obj-jungle-mid')
    expect(codexFor('no-ward-pre-obj', 'SUPPORT', 'mid')!.id).toBe('vision-obj-support-mid')
    expect(codexFor('no-ward-pre-obj', 'TOP', 'mid')!.id).toBe('vision-obj-any-mid')
    expect(codexFor('no-ward-pre-obj', 'TOP', 'late')!.id).toBe('vision-obj-any-late')
    expect(codexFor('unused-gold', 'TOP', 'late')!.id).toBe('gold-any-any')
    expect(codexFor('nonexistent', 'TOP', 'mid')).toBeNull()
  })
  it('lets a team rule override the built-in entry', () => {
    const team: CodexEntry = { ...CODEX[0], id: 'team-1', headline: { fr: 'Règle équipe', en: 'Team rule' } }
    expect(codexFor('no-ward-pre-obj', 'TOP', 'mid', [team])!.id).toBe('team-1')
  })
  it('finds the dominant phase', () => {
    expect(dominantPhase([100, 200, 1000])).toBe('early')
    expect(dominantPhase([1600, 1700, 100])).toBe('late')
    expect(dominantPhase([])).toBeNull()
  })
  it('normalises roles and builds the next-session prefill', () => {
    expect(normalizeRole('mid')).toBe('MIDDLE')
    expect(normalizeRole('ADC')).toBe('BOTTOM')
    expect(normalizeRole(null)).toBe('any')
    const e = codexFor('overstay', 'MIDDLE', 'mid')!
    expect(sessionPrefill(e, 'en')).toEqual({ objectiveIds: ['tempo'], customNote: e.drillObjective.en, codexId: e.id })
    expect(localize(e.headline, 'fr')).toBe(e.headline.fr)
  })
})

describe('AscendCodex — official videos only', () => {
  const ok = { title: { fr: 't', en: 't' }, coachNote: { fr: 'n', en: 'n' }, url: 'https://www.youtube.com/watch?v=GGajtr2XB2Y&t=486s', startSeconds: 486, endSeconds: 530, source: 'LoL Esports' }

  it('accepts only allow-listed LoL Esports watch URLs with a valid segment', () => {
    expect(isOfficialVideo(ok)).toBe(true)
    expect(isOfficialVideo({ ...ok, source: 'Caedrel' })).toBe(false)
    expect(isOfficialVideo({ ...ok, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toBe(false)
    expect(isOfficialVideo({ ...ok, url: 'https://youtube.com/clip/UgkxXZZ9xMkskD7mZVJMjAMHibeQuJ6AfPvy' })).toBe(false)
    expect(isOfficialVideo({ ...ok, url: 'http://www.youtube.com/watch?v=GGajtr2XB2Y' })).toBe(false)
    expect(isOfficialVideo({ ...ok, url: 'https://evil.example/watch?v=GGajtr2XB2Y' })).toBe(false)
    expect(isOfficialVideo({ ...ok, endSeconds: 400 })).toBe(false)
  })
  it('filters non-official videos out at load time', () => {
    expect(sanitizeVideos([ok, { ...ok, source: 'Streamer' }, null, 'x'])).toEqual([ok])
    expect(sanitizeVideos(undefined)).toEqual([])
  })
  it('plays only the tactical segment from the official thumbnail', () => {
    expect(segmentEmbedUrl(ok)).toBe('https://www.youtube.com/embed/GGajtr2XB2Y?start=486&end=530&rel=0&autoplay=1')
    expect(officialThumbnail(ok)).toBe('https://i.ytimg.com/vi/GGajtr2XB2Y/mqdefault.jpg')
    expect(segmentEmbedUrl({ ...ok, source: 'x' })).toBeNull()
  })
  it('ships no third-party video in the Codex', () => {
    const raw = JSON.stringify(CODEX)
    expect(raw).not.toMatch(/youtube\.com\/clip|caedrel/i)
    for (const e of CODEX) for (const v of e.videoExamples ?? []) expect(isOfficialVideo(v)).toBe(true)
  })
  it('contains the 6 pro-calibrated fiches (text-only when the source is confidential)', () => {
    const ids = ['codex_macro_obj_tempo_vs_tower_greed', 'codex_jgl_3camps_mid_cross_bot_invade', 'codex_jgl_pathing_integrity_reset_cycle',
      'codex_macro_early_obj_setup_asymmetry', 'codex_macro_131_jungle_hover_assignment', 'codex_macro_baron_balance_system']
    for (const id of ids) expect(codexById(id), id).not.toBeNull()
    expect(codexById('codex_macro_obj_tempo_vs_tower_greed')!.videoExamples).toEqual([])
    expect(codexById('codex_macro_baron_balance_system')!.videoExamples![0]).toMatchObject({ startSeconds: 1828, endSeconds: 2015, source: 'LoL Esports' })
    expect(codexById('codex_macro_obj_tempo_crossmap')).toBeNull()
  })
  it('prefers the fiche with an official example on a tie, and the role-specific one over a generic one', () => {
    expect(codexFor('overstay', 'JUNGLE', 'early')!.id).toBe('codex_jgl_pathing_integrity_reset_cycle')
    expect(codexFor('cs-deficit', 'JUNGLE', 'early')!.id).toBe('codex_jgl_3camps_mid_cross_bot_invade')
    expect(codexFor('bad-positioning', 'TOP', 'late')!.id).toBe('codex_macro_baron_balance_system')
    expect(codexFor('overstay', 'MIDDLE', 'mid')!.id).toBe('overstay-any-mid')
  })
})

describe('AscendCodex — V3 fiches (third-party analyses, text only)', () => {
  const ids = ['codex_macro_tempo_lines_sync', 'codex_mechanics_lane_quadrants_minion_wall', 'codex_deaths_teamfight_single_threat_tracking',
    'codex_tempo_single_action_window_wave_cheating', 'codex_mechanics_wave_slow_fast_rotation_timer', 'codex_vision_jungle_tracking_math_timers',
    'codex_mechanics_trading_4laws_cooldown_punish', 'codex_macro_choosing_good_fights_camera_check']
  it('are all present, bilingual and without any video', () => {
    for (const id of ids) {
      const e = codexById(id)!
      expect(e, id).not.toBeNull()
      expect(e.videoExamples).toEqual([])
      expect(e.headline.en.length).toBeGreaterThan(10)
    }
  })
})

describe('AscendCodex — V4 fiches & terminology', () => {
  const ids = ['codex_tempo_territorial_vs_order_vs_economic', 'codex_macro_pressure_asymmetry_next_midwave', 'codex_vision_baron_chokepoint_support_zoning',
    'codex_mechanics_mid_6archetypes_3v3_synergy', 'codex_tempo_roam_check_systematic_fog', 'codex_mental_low_energy_anti_tilt_protocol']
  it('adds the 6 fiches, bilingual, text only', () => {
    for (const id of ids) {
      const e = codexById(id)!
      expect(e, id).not.toBeNull()
      expect(e.videoExamples).toEqual([])
      for (const f of [e.headline, e.tacticalRule, e.drillObjective]) {
        expect(f.fr.length).toBeGreaterThan(20)
        expect(f.en.length).toBeGreaterThan(20)
      }
    }
    expect(new Set(CODEX.map((e) => e.id)).size).toBe(CODEX.length)
  })
  it('says "Fenêtre de tempo à action unique", never an arcade token', () => {
    expect(codexById('codex_tempo_arcade_tokens_wave_cheating')).toBeNull()
    const e = codexById('codex_tempo_single_action_window_wave_cheating')!
    expect(e.headline.fr).toContain('Fenêtre de tempo à action unique')
    expect(e.tacticalRule.fr).toContain('fenêtres à action unique')
    expect(JSON.stringify(CODEX)).not.toMatch(/arcade|token|jeton/i)
  })
  it('keeps LoL jargon in English in the French text', () => {
    const fr = CODEX.map((e) => [e.headline.fr, e.tacticalRule.fr, e.drillObjective.fr].join(' ')).join(' ')
    expect(fr).not.toMatch(/\bvagues?\b/i)
    expect(fr).not.toMatch(/temps de recharge|contre-gank/i)
  })
  it('the low-energy protocol is a session objective on the resilience fundamental', () => {
    expect(codexById('codex_mental_low_energy_anti_tilt_protocol')!.fundamentalId).toBe('resilience')
  })
})
