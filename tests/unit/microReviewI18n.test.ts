/**
 * Every text key the micro-review can emit exists in both locale files: pattern labels, QCM diagnoses, summary heads
 * and extras. A missing key would show its raw name in the app (i18next prints the key).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MOMENT_PATTERNS, type CriticalMoment, type MomentFacts } from '../../src/lib/microReview/anomalyDetector'
import { QCM_CONTEXTS, RETIRED_OPTIONS, buildQcm, optionsFor } from '../../src/lib/microReview/smartQcm'

const locale = (lang: string) => JSON.parse(readFileSync(new URL(`../../src/i18n/locales/${lang}.json`, import.meta.url), 'utf8')).microReview
const LANGS = ['fr', 'en'] as const
/** A plain key, or an i18next plural pair. */
const has = (section: Record<string, unknown>, key: string) =>
  typeof section[key] === 'string' || (typeof section[`${key}_one`] === 'string' && typeof section[`${key}_other`] === 'string')

// Facts that open the branches of the summaries. A summary keeps 2 extras, so the generic death and the generic
// objective get one variant per extra; the two rich variants cover the either/or branches of the patterns.
const VARIANTS: MomentFacts[] = [
  {},
  { gankWindow: 1, deepWard: true, towerGreed: true, approachedBy: 1500, goldInPocket: 1600, alliesHigh: 3, alliesHome: 3, goldSharePct: 30, killStreak: 3, playerDistance: 3000,
    csLost: 12, xpLost: 400, platesLost: 2, roamSide: 'top', alliesDown: 2, nearestPit: 'dragon', botGoldLead: 300, killGapSec: 2, spikeLevel: 2, hpPct: 20, hpSnapshotAgeSec: 30,
    attackType: 'melee', laneHpPct: 40, opponentHpPct: 90, recallHpPct: 80, levelsBehind: 2, xpDiffJungle: -200, myLevel: 1, enemyLevel: 2, junglerInvolved: true, spawnInSec: 20,
    objective: 'dragon', sinceBaseSec: 60, midInBase: true, inhibGapSec: 8, firstBackSec: 268, campsStolenCs: 8, jungleCsLost: 8, campsTakenCs: 4, midOnWave: true, dragonDamagePct: 70,
    deathGapSec: 6, enemiesInvolved: 4, bootsSec: 300, turretLane: 'TOP', heraldAgoSec: 60, resetResource: 'mana', resetLowPct: 20, enemyBackSec: 40, csDiff6: -14, laneSnapshots: 7, kpPct: 30 },
  { gankWindow: 2, wardedRecently: false, roamSide: 'bot', attackType: 'ranged', laneHpPct: 50, resetResource: 'hp', resetLowPct: 20, levelsBehind: 1, alliesDown: 1, platesLost: 1,
    turretLane: 'BOT', firstBackSec: null, nearestPit: 'baron' },
  { alliedBaron: true }, { hpPct: 20, hpSnapshotAgeSec: 30 }, { levelDeficit: 1 }, { levelDeficit: 2 }, { goldInPocket: 1200 }, { secondsSinceOwnPlay: 10 },
  { alliesNearby: 0, enemiesInvolved: 3 }, { nearObjective: true, wardedLast60s: false }, { objectiveLost: 'baron', objectiveLostAfterSec: 30 },
  { objective: 'baron', playerDistance: 3000, wardsElsewhere: 1 }, { objective: 'dragon', wardsElsewhere: 2 }, { objective: 'grubs', wardsElsewhere: 0 },
  { opponentChampion: 'Ahri', csDiff10: -20, xpDiff10: -500 }, { csDiff10: -20 },
  // mid-roam-unpaid (26/11/2026): each branch of its bilan (gain / objective / nothing, follow-up / tower / freeze).
  { roamSide: 'top', roamBackSec: 500, roamKills: 1, roamAssists: 0, followKills: 1, platesLost: 1 },
  { roamSide: 'bot', roamBackSec: 500, roamObjective: 'dragon', followTowerLost: true },
  { roamBackSec: 500, freezeLikely: true },
  // roam cards of the other roles: tp, ADC / support extras, every support timer.
  { roamBackSec: 500, roamTp: true, csLost: 8, xpLost: 100 },
  { roamBackSec: 500, partnerDied: true, roamTimer: 'after-kills', roamGoldLost: 200 },
  { roamBackSec: 500, partnerForcedBack: true, partnerHpPct: 20, roamTimer: 'after-recall' },
  { roamBackSec: 500, roamTimer: 'adc-away' }, { roamBackSec: 500, roamTimer: 'enemy-duo-recall' }, { roamBackSec: 500, roamTimer: 'wave-crash-probable' },
  { roamBackSec: 500, roamTimer: 'paid-window' }, { roamBackSec: 500, roamTimer: 'bad' }, { roamBackSec: 500, roamTimer: 'none' },
  // jungle-gank-unpaid: gain / forced back / objective / nothing, and the two bad timers.
  { gankLane: 'BOT', roamBackSec: 500, campsLost: 3, gankGold: [-50, -420], gankXp: [30, -310], roamKills: 1, gankTimer: 'enemy-close' },
  { gankLane: 'TOP', roamBackSec: 500, gankForcedBack: true, gankTimer: 'camps-up' }, { gankLane: 'MID', roamBackSec: 500, roamObjective: 'dragon' }, { gankLane: 'MID', roamBackSec: 500 },
]
const moment = (facts: MomentFacts, trigger: CriticalMoment['trigger']): CriticalMoment => ({
  key: `${trigger}@200`, trigger, gameTimeSec: 200, severity: 0.3, position: null, zone: null, lane: null, territory: null, winProbBefore: 0.5, winProbAfter: 0.45, facts,
})

describe('micro-review texts — every key exists in French and English', () => {
  it.each(LANGS)('%s: a label for every detector pattern', (lang) => {
    for (const p of MOMENT_PATTERNS) expect(typeof locale(lang).pattern[p], p).toBe('string')
  })
  it.each(LANGS)('%s: a text for every QCM diagnosis, withdrawn ones included (old answers read back)', (lang) => {
    const facts = [{}, { hpPct: 20 }, { secondsSinceOwnPlay: 10 }, { playerWarded: true }, { midOnWave: true }, { nearObjective: true }]
    const reasons = new Set([...QCM_CONTEXTS.flatMap((c) => facts.flatMap((f) => optionsFor(c, f).map((o) => o.reason))), ...RETIRED_OPTIONS.map((o) => o.reason)])
    expect(reasons.size).toBeGreaterThan(80)
    expect(reasons).toContain('lowEnergy')
    for (const r of reasons) expect(has(locale(lang).reason, r), r).toBe(true)
  })
  it.each(LANGS)('%s: a text for every summary head and extra', (lang) => {
    const keys = new Set<string>()
    const triggers: CriticalMoment['trigger'][] = ['critical-death', 'absent-objective', 'early-deficit']
    for (const pattern of [undefined, ...MOMENT_PATTERNS]) for (const facts of VARIANTS) for (const trigger of triggers) {
      const s = buildQcm(moment({ ...facts, ...(pattern ? { pattern } : {}) }, trigger)).summary
      keys.add(s.head.key)
      for (const e of s.extras) keys.add(e.key)
    }
    // Every head and extra summaryOf can write: 74 plain keys and 8 either/or pairs.
    expect(keys.size).toBeGreaterThanOrEqual(90)
    for (const k of keys) expect(has(locale(lang).summary, k), k).toBe(true)
  })
  it('both locales carry the same micro-review keys', () => {
    const flat = (o: Record<string, unknown>, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]))
    expect(flat(locale('fr')).sort()).toEqual(flat(locale('en')).sort())
  })
})
