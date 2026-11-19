/**
 * AscendCodex — the Nov. 2026 research upgrade (docs/RECHERCHE_CONNAISSANCES.md): 34 new fiches that fill the
 * (tag, role, phase) gaps, and the season-2026 facts (patch 26.1+) that replaced outdated numbers in older fiches.
 */
import { describe, it, expect } from 'vitest'
import { CODEX, codexById, codexFor, type CodexEntry } from '../../src/lib/microReview/codex'
import { FUNDAMENTALS } from '../../src/lib/constants/fundamentals'
import { BUILT_IN_MISTAKE_TAGS } from '../../src/lib/mistakeTagCatalog'

/** id → the (tag, role, phase) it must answer by default. */
const NEW: Record<string, [string, string, 'early' | 'mid' | 'late' | null]> = {
  codex_baron_side_pairs_sweep_from_20: ['solo-baron-died', 'MIDDLE', 'mid'],
  codex_baron_late_lone_death_timer: ['solo-baron-died', 'TOP', 'late'],
  codex_draft_runes_lane_threat_comfort: ['bad-rune-choice', 'TOP', null],
  codex_ranged_kiting_cast_max_range: ['bad-kiting', 'MIDDLE', 'mid'],
  codex_dmg_lock_weave_execute: ['bad-dmg-maximisation', 'TOP', 'early'],
  codex_dive_midgame_two_shots_wave: ['dove-tower', 'TOP', 'mid'],
  codex_dive_late_inhibitor_reset_convert: ['dove-tower', 'MIDDLE', 'late'],
  codex_death_timer_count_the_respawn: ['death-before-objective', 'TOP', 'late'],
  codex_wavesync_side_waves_before_baron: ['bad-wave-sync', 'TOP', 'late'],
  codex_wavesync_crash_then_move_early: ['bad-wave-sync', 'TOP', 'early'],
  codex_lateback_spend_before_objective: ['late-back', 'BOTTOM', 'late'],
  codex_cs_late_side_waves_income: ['cs-deficit', 'TOP', 'late'],
  codex_xp_solo_side_waves_mid: ['xp-deficit', 'TOP', 'mid'],
  codex_skirmish_count_numbers_ults: ['bad-trade', 'TOP', 'mid'],
  codex_engage_space_followable_mid: ['bad-engage-angle', 'JUNGLE', 'mid'],
  codex_enemy_ward_clock_path_around: ['walked-into-ward', 'MIDDLE', 'early'],
  codex_teamfight_comps_one_threat_late: ['bad-threat-assessment', 'TOP', 'late'],
  codex_top_teleport_2026_summoner_vs_quest: ['wasted-summoner', 'TOP', 'mid'],
  codex_top_side_lane_rhythm_timer: ['overstay', 'TOP', 'mid'],
  codex_top_opening_crash_cheater_quest: ['bad-lane-opening', 'TOP', 'early'],
  codex_top_grubs_luxury_dragon_first: ['death-before-objective', 'TOP', 'early'],
  codex_mid_roam_budget_next_wave_numbers: ['overstay', 'MIDDLE', 'early'],
  codex_mid_priority_shove_before_objectives: ['bad-wave-sync', 'MIDDLE', 'mid'],
  codex_mid_reset_homeguard_match_recall: ['late-back', 'MIDDLE', 'early'],
  codex_adc_quest_then_mid_never_far_side: ['bad-positioning', 'BOTTOM', 'mid'],
  codex_adc_teamfight_threat_range_closest_target: ['bad-threat-assessment', 'BOTTOM', 'late'],
  codex_bot_duo_level2_ninth_minion: ['bad-lane-opening', 'BOTTOM', 'early'],
  codex_support_roam_free_windows_level5: ['overstay', 'SUPPORT', 'early'],
  codex_support_vision_cycle_trinket_pinks: ['forgot-trinket', 'SUPPORT', 'mid'],
  codex_support_late_ward_in_pairs_or_concede: ['no-ward-pre-obj', 'SUPPORT', 'late'],
  codex_support_peel_or_engage_job: ['bad-threat-assessment', 'SUPPORT', 'mid'],
  codex_jgl_opening_2026_clock_smite: ['bad-lane-opening', 'JUNGLE', 'early'],
  codex_jgl_contest_or_trade_plan_mid: ['death-before-objective', 'JUNGLE', 'mid'],
  codex_jgl_baron_soul_elder_no_trade: ['death-before-objective', 'JUNGLE', 'late'],
}
const ids = Object.keys(NEW)
const text = (e: CodexEntry, lang: 'fr' | 'en') => [e.headline[lang], e.tacticalRule[lang], e.drillObjective[lang]].join(' ')
const all = (lang: 'fr' | 'en') => CODEX.map((e) => text(e, lang)).join(' ')

describe('Codex research upgrade — the 34 new fiches', () => {
  it('are 34 distinct fiches, text only, bilingual, on real tags and fundamentals', () => {
    expect(ids).toHaveLength(34)
    const fundamentals = new Set(FUNDAMENTALS.flatMap((c) => c.fundamentals.map((f) => f.id)))
    const tags = new Set(BUILT_IN_MISTAKE_TAGS.map((t) => t.slug))
    for (const id of ids) {
      const e = codexById(id)
      expect(e, id).not.toBeNull()
      expect(CODEX.filter((x) => x.id === id), id).toHaveLength(1)
      expect(e!.videoExamples, id).toEqual([])
      expect(fundamentals.has(e!.fundamentalId), `${id} ${e!.fundamentalId}`).toBe(true)
      for (const t of [e!.mistakeSlug, ...(e!.mistakeSlugs ?? [])]) expect(tags.has(t), `${id} ${t}`).toBe(true)
      for (const f of [e!.headline, e!.tacticalRule, e!.drillObjective]) {
        expect(f.fr.length, id).toBeGreaterThan(40)
        expect(f.en.length, id).toBeGreaterThan(40)
      }
    }
  })

  it('each one is the default fiche of its (tag, role, phase) — none is unreachable', () => {
    for (const [id, [tag, role, phase]] of Object.entries(NEW)) expect(codexFor(tag, role, phase)?.id, id).toBe(id)
  })

  it('every tag now has a prescription: Baron solo deaths and runes for every role, kiting and damage beyond ADC and jungle', () => {
    for (const role of ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT']) {
      for (const tag of ['solo-baron-died', 'bad-rune-choice', 'bad-kiting', 'bad-dmg-maximisation']) {
        for (const phase of ['early', 'mid', 'late'] as const) expect(codexFor(tag, role, phase), `${tag} ${role} ${phase}`).not.toBeNull()
      }
    }
    for (const t of BUILT_IN_MISTAKE_TAGS) expect(codexFor(t.slug, 'TOP', 'mid'), t.slug).not.toBeNull()
    // The ADC keeps its own kiting fiche, the jungler its Smite fiche in the mid game.
    expect(codexFor('bad-kiting', 'BOTTOM', 'mid')!.id).toBe('kiting-adc-any')
    expect(codexFor('bad-dmg-maximisation', 'JUNGLE', 'mid')!.id).toBe('codex_jgl_burst_before_smite_animation_and_j4_chogath_combat_combos')
  })

  it('a mid- or late-game mistake no longer falls back to a laning-phase fiche', () => {
    for (const tag of ['dove-tower', 'bad-trade', 'xp-deficit', 'cs-deficit', 'late-back', 'bad-wave-sync']) {
      for (const phase of ['mid', 'late'] as const) {
        const e = codexFor(tag, 'MIDDLE', phase)!
        expect(e.phase === phase || e.phase === 'any' || (tag === 'xp-deficit' && phase === 'late') || (tag === 'bad-trade' && phase === 'late') || (tag === 'late-back' && phase === 'mid') || (tag === 'cs-deficit' && phase === 'mid') || (tag === 'dove-tower' && phase === 'mid'), `${tag} ${phase} → ${e.id}`).toBe(true)
      }
    }
    expect(codexFor('dove-tower', 'TOP', 'late')!.phase).toBe('late')
    expect(codexFor('bad-wave-sync', 'SUPPORT', 'early')!.phase).toBe('early')
  })
})

describe('Codex research upgrade — season 2026 facts', () => {
  it('teaches the 2026 numbers', () => {
    const fr = all('fr')
    const keep = [
      /la Baron apparaît à 20:00/, // Baron back at 20:00, Atakhan removed (26.1)
      /Carapateur de 2:55/, // Scuttle Crab 2:55 (26.1)
      /camps à 0:55/, // camps 35 s earlier (26.1)
      /1000 \(Unleashed\) dès que ton familier a mangé 15 friandises, 1400 \(Primal\) à 35/, // Smite (26.1)
      /Une plate rapporte 120 g/, // plates 120 g, permanent (26.1)
      /1 500 unités/, // minion XP range (25.S1.1)
      /9e sbire/, // duo bot lane level 2 (65 % XP each)
      /390 s depuis le patch 26\.19/, // quest Teleport
      /coûtent 40 g une fois ta quête terminée/, // support quest control wards
      /44 s au niveau 13 à 25:00, 54 s au niveau 16 à 30:00, 61 s au niveau 18 à 35:00/, // respawn formula
      /2 tirs de tour \+ 1 attaque pour les mêlée/, // a tower shot = 45 % of a melee minion
      /1 minute de roam sans pénalité/, // role-quest roaming budget (26.09)
      /avant le niveau 5/, // support out-of-lane penalty (26.16)
    ]
    for (const re of keep) expect(fr, String(re)).toMatch(re)
  })

  it('no longer teaches the outdated ones', () => {
    for (const lang of ['fr', 'en'] as const) {
      const t = all(lang)
      expect(t).not.toMatch(/(Carapateur|Scuttle Crab)( top)? (de |à |at )?3:30/)
      expect(t).not.toMatch(/160 g/)
      // XP range (1,500 since 25.S1.1) — 1,400 stays correct for the turret's aggro range.
      expect(t).not.toMatch(/1 400 unités des sbires|1,400 units of dying minions/)
      expect(t).not.toMatch(/Smite (amélioré )?\(900|Smite à 900|Smite to 900|\(900\/1/)
      expect(t).not.toMatch(/T-60 s, always push|À T-60 s d'un objectif, push toujours/)
      expect(t).not.toMatch(/plates have expired|plaques expirées/)
    }
    // Atakhan only appears to say it is gone.
    expect(all('fr').match(/Atakhan \S+ \S+/g)).toEqual(['Atakhan a disparu),'])
    expect(all('en').match(/Atakhan \S+ \S+/g)).toEqual(['Atakhan is gone),'])
  })

  it('keeps the text rules of the Codex: no rank or creator name, LoL jargon in English in French', () => {
    const raw = JSON.stringify(CODEX)
    expect(raw).not.toMatch(/\b(iron|bronze|silver|platinum|emerald|diamond|grandmaster|challenger)\b/i)
    expect(raw).not.toMatch(/skill ?capped|chippys|mysterias|kirei|eagz|strompest|biofrost|brokenblade|pobelter|faker|shok\b/i)
    expect(all('fr')).not.toMatch(/\bvagues?\b|temps de recharge|contre-gank/i)
  })
})
