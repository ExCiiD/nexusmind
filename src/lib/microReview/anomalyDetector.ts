/**
 * AnomalyDetector — picks at most 3 critical moments of a game for the
 * 45-second micro-review (docs/PLAN_MICRO_REVIEW.md).
 *
 * Pure and deterministic: Match-V5 + Match-Timeline-V5 in, structured facts
 * out (no strings — the QCM generator and the UI turn facts into text).
 * Runs once per game after it ended; never during a game (Riot policy).
 * Summoner's Rift, classic mode only: the geometry and the timers mean
 * nothing anywhere else.
 *
 * Three triggers (the only values stored with an answer):
 *   critical-death     the player dies, then within 90 s the team loses win
 *                      probability or a neutral objective / building — or
 *                      the death matches one of the patterns below;
 *   absent-objective   the enemy takes an epic monster while the player is
 *                      alive, without a ward of theirs near the pit in the
 *                      previous 90 s and without a cross-map trade;
 *   early-deficit      at 10:00, csDiff < −15 or xpDiff < −400 against the
 *                      direct opponent, with fewer than 2 takedowns.
 * Every candidate is dropped when P(win) just before it is < 0.18 or > 0.85,
 * except, above 0.85, the jungle patterns of GARBAGE_CEILING_EXEMPT (V6).
 *
 * Patterns (facts.pattern) refine a trigger without a new trigger name:
 *   on critical-death    tower-dive-one-for-one, level-up-spike,
 *                        support-level2-allin, mid-ahead-of-wave-death,
 *                        mid-reset-trap-death, back-timer-missed,
 *                        gank-during-team-reset, gank-timer,
 *                        range-melee-volatility, jungle-dragon-tank-death,
 *                        inhib-forced-dive, jungle-herald-unused-death,
 *                        jungle-invade-death, pit-chokepoint,
 *                        adc-solo-sidelane-reopen, jungle-compensation-death,
 *                        fed-carry-first, tempo-front-isolated
 *   on absent-objective  low-hp-recall-before-objective, jungle-outsmited,
 *                        tempo-hesitation, support-absent-scuttle,
 *                        jungle-baron-recall, tempo-late-recall, pit-chokepoint
 *   on early-deficit     mid-passive-wave-loss, support-no-early-ward,
 *                        support-botlane-leech, support-weakside-unwarded,
 *                        jungle-overchase, jungle-counter-tempo,
 *                        jungle-passive-clear, jungle-window-unpunished,
 *                        jungle-late-first-recall, jungle-early-boots,
 *                        jungle-camps-up-gank, jungle-weakside-stolen,
 *                        jungle-fled-invade, jungle-side-t1-destroyed,
 *                        bad-rotation, mid-roam-plates, cheater-recall
 * A death gets at most one pattern: they are tried in the order above, the
 * most specific first, so one death never yields two concurrent readings
 * (a death read as a Dragon tank or a compensation is not an overchase too).
 * Likewise one lost fight, one enemy objective or one lane deficit yields one
 * moment: the forced back before an objective and the lost smite claim that
 * objective, the jungler's Baron recall claims that fight, the mid lane
 * given away at 6:00 replaces the 10:00 deficit.
 * Every threshold lives in DETECTOR_SPEC and is asserted, on both sides of
 * its boundary, by tests/unit/anomalyDetectorMath*.test.ts and
 * tests/unit/microReviewV5|V6|V7.test.ts.
 *
 * Resolution limits, by construction of Riot's timeline:
 *   - participant positions, gold, XP, CS and HP are 60 s snapshots.
 *     Positions in between are interpolated along what the events prove: a
 *     champion walks from its last snapshot to where it dies, stays there
 *     until it respawns, then leaves its fountain toward the next snapshot.
 *     A detour inside one minute that no event marks cannot be seen;
 *   - jungle camps are a per-minute counter: a camp taken in the same minute
 *     as a chase (before it, or after a respawn) cancels the overchase; which
 *     camp it was, when it died and the Scuttle Crabs are not in the data. A
 *     camp stolen is the enemy jungler's counter rising while two snapshots
 *     in a row show them in the same quadrant of our jungle;
 *   - there is no spell-cast event (dash, Smite, ultimate) and no minion
 *     wave: an order of spells or the state of a wave is never read;
 *   - WARD_PLACED has no coordinates (the player's position is used);
 *   - there is no recall, rune, passive, item-charge or minion-wave event; a
 *     recall is read from the champion standing in its base, or from an
 *     ITEM_PURCHASED while alive (the shop only sells in base — checked on
 *     cached games), which dates the arrival, not the start of the channel;
 *     Teleport casts are a whole-game count; bounties are estimated from the
 *     kill streak;
 *   - damage exists only on a death (victimDamageReceived, which names the
 *     Dragon among its sources);
 *   - there is no item catalogue: "3 completed items" is read as 10 000 g
 *     spent (total gold earned minus gold in pocket). Item ids are logged:
 *     boots (1001) bought, the Eye of the Herald (3513) leaving its holder's
 *     inventory when used or expired — its pick-up is not logged.
 * When the data cannot prove a pattern, the detector stays silent.
 */

import {
  ALLY_RADIUS, FOUNTAIN, OBJECTIVE_RADIUS, OUTER_TURRETS, WARD_RADIUS, PIT_FIGHT_RADIUS, PIT_INSIDE_RADIUS,
  dist, inBaseBox, laneOf, nearestPit, pitCenter, tempoLineD, territoryOf, zoneOf,
  type LaneBucket, type Pit, type Point, type TeamId, type Territory, type Zone,
} from './geometry'
import {
  GARBAGE_HIGH, OBJECTIVE_WEIGHT, frameClock, isGarbageTime, objectiveKindOf, winProbabilityTrack,
  type ObjectiveKind,
} from './winProbability'
import { attackTypeOf, isControlMage } from './championClasses'
import { deathTimerSec, respawnTimeFactor, seasonOf } from './gameClock'

export type MomentTrigger = 'critical-death' | 'absent-objective' | 'early-deficit'

/** Every pattern the detector can set (tests iterate this list, so a new pattern is never left untested). */
export const MOMENT_PATTERNS = [
  'tempo-hesitation', 'jungle-overchase', 'jungle-counter-tempo', 'jungle-passive-clear',
  'tempo-late-recall', 'tempo-front-isolated', 'gank-timer', 'fed-carry-first',
  'jungle-window-unpunished', 'bad-rotation', 'pit-chokepoint', 'mid-roam-plates',
  // V5 — laning phase.
  'tower-dive-one-for-one', 'level-up-spike', 'back-timer-missed', 'range-melee-volatility', 'cheater-recall',
  // V6 — roles.
  'support-no-early-ward', 'support-level2-allin', 'gank-during-team-reset', 'low-hp-recall-before-objective',
  'adc-solo-sidelane-reopen', 'jungle-baron-recall', 'inhib-forced-dive',
  // V7–V10 — jungle, mid, engage support.
  'jungle-late-first-recall', 'jungle-camps-up-gank', 'jungle-weakside-stolen', 'jungle-invade-death', 'jungle-dragon-tank-death',
  'jungle-compensation-death', 'jungle-early-boots', 'jungle-side-t1-destroyed', 'jungle-herald-unused-death', 'jungle-fled-invade',
  'jungle-outsmited', 'mid-ahead-of-wave-death', 'mid-reset-trap-death', 'mid-passive-wave-loss',
  'support-botlane-leech', 'support-absent-scuttle', 'support-weakside-unwarded',
] as const
export type MomentPattern = typeof MOMENT_PATTERNS[number]

/**
 * Kept above the garbage-time ceiling (P(win) > 0.85): throwing a won game is the very mistake they describe, and a
 * team holding Baron or that has just taken an inhibitor is almost always above it (cached games: 24 of 26 inhibitor
 * dives, 82 % of Barons). The floor (P(win) < 0.18) still applies to them.
 */
export const GARBAGE_CEILING_EXEMPT: readonly MomentPattern[] = ['jungle-baron-recall', 'inhib-forced-dive']

/**
 * Every numeric rule of the detector (seconds, map units, gold, ratios), on the season-2026 clock (game version 16.x:
 * minions 0:30, camps 0:55, Scuttle 2:55); see gameClock.ts for the numbers checked on cached games. Games of an older
 * season are not analysed.
 */
export const DETECTOR_SPEC = {
  maxMoments: 3,
  minSpacingSec: 25,
  death: { windowSec: 90, wpDrop: 0.05, allyRadius: ALLY_RADIUS, sameFightSec: 10, wardLookbackSec: 60, ownPlaySec: 35, hpSnapshotMinAgeSec: 10 },
  absent: { wardRadius: WARD_RADIUS, wardLookbackSec: 90, crossMapSec: 60, deadBeforeSec: 110, accountableFromSec: 300 },
  early: { atSec: 600, csDiff: -15, xpDiff: -400, takedowns: 2 },
  hesitation: { notInPitSec: 30, moveFromSec: 25, approachMin: 1200, crossMapBeforeSec: 40, crossMapAfterSec: 15, towerGreedSec: 75 },
  /**
   * Jungle, from the end of the first clear to 8:00. Passive clear: in our half at every homeSamplesSec, no takedown
   * until quietUntilSec, read at passiveAtSec. Counter-tempo: a river play on the riverPlaySec samples (every 15 s),
   * from the startAtSec quadrant back to it at backAtSec, read at counterTempoAtSec.
   */
  jungle: {
    fromSec: 115, toSec: 480, overchaseSec: 20, sampleSec: 5, counterTempoXp: 150, riverPlaySec: [160, 220], backAtSec: 265, passiveBotLead: 250,
    homeSamplesSec: [85, 145, 175, 205], quietUntilSec: 205, passiveAtSec: 160, startAtSec: 85, counterTempoAtSec: 235,
  },
  tempoLine: { fromSec: 900, alliesHigh: 0.55, userBase: 0.15, userFront: 0.65, alliesHome: 0.30, minAllies: 3, goldBefore: 1500, goldLookbackSec: 30, fightWindowSec: 30, aliveBeforeSec: 60 },
  /** Gank on a predictable timer: the 3-camp transition (1:50–2:25), the end of the first clear (2:40–3:50). */
  gank: { window1: [110, 145], window2: [160, 230], deepWardLifetimeSec: 150 },
  tempoWindow: { fromSec: 115, untilSec: 720, distance: 8000, windowSec: 45, respawnGraceSec: 20 },
  carry: { bounty: 450, kda: 4, goldShare: 0.25, enemies: 3, fightRadius: 2500, lostWithinSec: 60, firstDeathSec: 10 },
  rotation: { untilSec: 840, awaySec: 30, cs: 8, xp: 350, deathGuardSec: 45 },
  // #45 D5: pit fights count from 15:00, when the Herald spawns.
  pit: { fromSec: 900, fightRadius: PIT_FIGHT_RADIUS, insideRadius: PIT_INSIDE_RADIUS, beforeSec: 15, fightGapSec: 20 },
  /**
   * Mid roam paid in plates. Plates no longer fall at 14:00 in 2026 (on cached 16.x games they are taken up to 47:47,
   * three quarters of them after 14:00): a roam can cost plates for as long as the mid T1 stands, so the window runs to
   * 20:00, when Baron spawns and the map regroups (mid T1 p75 20:30).
   */
  midRoam: { untilSec: 1200, plates: 1, cs: 10, minOffAxis: 2600 },
  // V5 — laning phase.
  /**
   * Kills the lane opponent within 850 units of a standing enemy T1, dies within 4 s, enemy jungler not involved. The
   * T1 keeps its plating until it falls in 2026, so the dive stays a T1 dive to 20:00.
   */
  dive: { untilSec: 1200, turretRadius: 850, afterKillSec: 4 },
  /** Killed by the lane opponent within 10 s of their level 2 or 3, while still below that level. */
  levelSpike: { untilSec: 235, windowSec: 10, levels: [2, 3] },
  /** Under 35 % HP with 800+ gold in lane, then dead in the river / jungle within 40 s, before 10:00. */
  backTimer: { untilSec: 600, hpPct: 35, gold: 800, withinSec: 40 },
  /** 1v1 death to the lane opponent before 8:00: ranged under 60 % HP at level ≤ 3, or melee under 50 % at level ≤ 4 against a ranged above 85 %. */
  rangeMelee: { untilSec: 480, rangedHp: 60, rangedMaxLevel: 3, meleeHp: 50, meleeMaxLevel: 4, opponentHp: 85 },
  /**
   * A back between 2:00 and 2:40 (a purchase in visitSec, after the starting items) from above 75 % HP at 2:00, no
   * Teleport cast, 1+ level behind at 4:00. No snapshot falls inside that window, so the back is read from the purchases.
   */
  cheaterRecall: {
    visitSec: [120, 160] as readonly [number, number],
    anchorSec: 120, hpBeforeSec: 120, hpPct: 75, levelAtSec: 240, levelDeficit: 1, teleportSpellId: 12,
  },
  // V6 — roles.
  /** Support: no ward of their own by 1:10 (champion objects aside); or killed 1:30–2:05 below the level of an enemy in the fight. */
  supportEarly: { wardBySec: 70, deathFromSec: 90, deathToSec: 125 },
  /** Laner ganked before 14:00 in the enemy half of their lane while 2+ allies, the jungler or a bot laner among them, stood in base in the 15 s before. */
  teamReset: { untilSec: 840, lookbackSec: 15, alliesHome: 2 },
  /**
   * Back under 40 % HP 0–35 s before a dragon / Voidgrubs spawn, an opponent under 60 % on the same snapshot (the trade
   * was mutual), then a fight lost at that pit before the player is back (30 s after shopping). The channel (8 s) is
   * counted back from the first purchase of the visit (purchases less than 30 s apart are one visit).
   */
  tradeRecall: { untilSec: 840, hpPct: 40, opponentHpPct: 60, beforeSpawnSec: 35, channelSec: 8, returnSec: 30, visitGapSec: 30 },
  /** ADC after 14:00: killed alone in a side lane across the river at most 45 s after reaching it, the walk from base counted as 45 s. */
  adcReopen: { fromSec: 840, walkSec: 45, withinSec: 45 },
  /** Jungler ahead (KDA > 3, or 10 000 g spent ≈ 3 items) in base or in their own jungle during the team's Baron buff while 3+ allies stand in the enemy half and 2+ die there. */
  baronRecall: { kda: 3, goldSpent: 10_000, alliesForward: 3, alliesDown: 2, fightWindowSec: 30, awayBeforeSec: 30, awayAfterSec: 15 },
  /** Jungler killed in the enemy base within 15 s after an enemy inhibitor falls. */
  inhibDive: { withinSec: 15 },
  /** Spawn timers of the patches analysed (15.20–16.22, checked on cached games): dragon at 5:00 then 5:00 after each kill, one Voidgrub camp at 8:00. */
  spawns: { firstDragonSec: 300, dragonRespawnSec: 300, grubsSec: 480 },
  // V7–V10 — jungle, mid, engage support.
  /** Jungler still on the map at 3:30 (1st camp back up, so the T-25 s recall was missed): no back after 1:00, no takedown, no death. */
  jungleFirstBack: { bySec: 210, startSec: 60 },
  /**
   * A gank that cost the camps (the brief's "deficit of 8 jungle CS"), from 2:00 to 12:00: the jungler in a lane with an
   * enemy within 2500 on a snapshot, no takedown and no death in the minute that follows, and 8+ jungle CS lost on the
   * enemy jungler over that minute. Whether the camps were "up", or stolen, is not in the data.
   */
  gankCost: { fromSec: 120, untilSec: 720, cs: 8, enemyRadius: 2500 },
  /**
   * Our camps stolen, proven: from 2:00, the enemy jungler gains 8+ jungle CS between two snapshots while standing in the
   * same quadrant of our jungle at both. Read as the weak side left behind before 16:00 (the player shopped — starting
   * items aside — from the minute before to the end of that minute, then is on the other side), and for the support before
   * 18:00 (our jungler top side, no ward of theirs in our bot-side jungle in the 120 s before).
   */
  campsStolen: { cs: 8, fromSec: 120, weakSideUntilSec: 960, supportUntilSec: 1080, wardLookbackSec: 120 },
  /**
   * Jungler dead in the enemy jungle before 16:00, alone or with one ally (not a team fight), after taking a camp (4+ jungle
   * CS between the snapshot a minute before the death and the one after it), no takedown in the 30 s before, not an overchase.
   */
  invadeDeath: { untilSec: 960, noTakedownSec: 30, campCs: 4, maxAllies: 1, midRadius: 2500 },
  /** Jungler dead within 3000 of the Dragon pit between 5:00 and 12:00, the Dragon having dealt 60 %+ of their max HP (under 40 % left), enemies in the fight. */
  dragonTank: { fromSec: 300, untilSec: 720, damageShare: 0.6 },
  /**
   * Compensation death: an ally fell within 3000 units in the 15 s before, 2+ more enemies on the jungler's death than
   * allies alive around them, and the enemy takes an epic monster at that pit within 60 s. Without the objective the
   * brief's "or a skirmish" matches 1.25 deaths per jungle game on cached games (0.17 with it): no longer a pattern.
   */
  compensation: { windowSec: 15, allyRadius: 3000, outnumberedBy: 2, objectiveWithinSec: 60 },
  /** Boots (item 1001) bought by the jungler before 8:00 without a kill. */
  earlyBoots: { untilSec: 480, itemId: 1001 },
  /**
   * The jungler last-hits an enemy side-lane T1 before 20:00 while a tower had already fallen (leave it at 1 HP for the
   * laner). The plates stay on until the tower falls, so the last hit also takes the plates left: no start time, the
   * first fallen tower is the anchor.
   */
  sideTower: { fromSec: 0, untilSec: 1200 },
  /**
   * Jungler dead in a fight 15:00–22:00 while holding the Eye of the Herald (item 3513). Riot logs no pick-up, but the eye
   * leaving an inventory (used, or expired about 300 s after the kill) is an ITEM_DESTROYED naming its holder: the jungler
   * held it at that death when that event is theirs and comes after it. Deaths in the 20 s after the Herald fell (the
   * time the eye lies on the ground) are the Herald fight itself, not a fight entered with the eye.
   * #45 D2 (19/11/2026): the Herald spawns at 15:00 and leaves at 19:45 in 2026 (League of Legends Wiki). On the cached
   * 16.x games (128 games, 108 eyes) the eye left its holder by 21:21 in 90 % of cases, by 21:52 in 95 % (latest 23:09),
   * so the window runs to 22:00. The ITEM_DESTROYED check keeps a wider window exact.
   */
  heraldEye: { fromSec: 900, untilSec: 1320, itemId: 3513, pickupSec: 20 },
  /**
   * Fled an invade: before 15:00, a snapshot shows the jungler under 15 % HP in their own jungle, the enemy jungler within
   * 2000 above 70 % and an ally of ours within 2000; the jungler is alive 15 s later and the enemy jungler takes 4+
   * jungle CS that minute.
   */
  fledInvade: { untilSec: 900, hpPct: 15, enemyHpPct: 70, radius: 2000, aliveSec: 15, campCs: 4 },
  /** Enemy Dragon / Elder / Herald / Baron taken while the jungler, alive, stood within 900 of the pit. */
  outsmite: { pitRadius: 900 },
  /** Mid laner dead in the mid lane before 12:00 at most 45 s after leaving base (a purchase after 1:00, or a respawn). */
  aheadOfWave: { untilSec: 720, afterBaseSec: 45, startSec: 60 },
  /**
   * Reset trap: the enemy mid backs first; the player, under 30 % HP or mana on the snapshot before (a mana pool over 200,
   * so not energy, rage or flow), does not back and dies within 90 s; before 12:00.
   */
  resetTrap: { untilSec: 720, lowPct: 30, stayedSec: 45, withinSec: 90, manaPoolMin: 200 },
  /** Mid laner 12+ CS behind at 6:00 with no basic spell at 2 points at level 3 and fewer than 2 takedowns (kills pay for CS, as at 10:00). */
  midWaveLoss: { atSec: 360, csDiff: -12, takedowns: 2 },
  /** Support level 6+ at 9:00, within 2000 of the ADC in the bot lane on 6 of the 7 snapshots 9:00–15:00 (over 75 %), under 45 % kill participation at 15:00. */
  supportLeech: { fromSec: 540, untilSec: 900, level: 6, radius: 2000, snapshots: 6, kp: 0.45 },
  /** Our jungler dead in the bot river between 2:50 and 3:15 (Scuttle at 2:55), the support more than 2000 away and without a takedown around it. */
  supportScuttle: { fromSec: 170, untilSec: 195, radius: 2000 },
} as const


export interface MomentFacts {
  // critical-death
  assisters?: number
  /** Killer (if a champion) + assisters. */
  enemiesInvolved?: number
  /** Allies within 2500 units, alive or fallen in the same fight (the 10 s before). */
  alliesNearby?: number
  goldInPocket?: number
  wardedLast60s?: boolean
  /** Seconds since the player's last kill / takedown / tower or plate, null when none in the last 35 s. */
  secondsSinceOwnPlay?: number | null
  nearestPit?: Pit
  pitDistance?: number
  nearObjective?: boolean
  objectiveLost?: ObjectiveKind | null
  objectiveLostAfterSec?: number | null
  /** The player's team had Baron (ally Baron kill in the 3 min before). */
  alliedBaron?: boolean
  /** Levels behind the killer at the last snapshot (only when ≥ 1). */
  levelDeficit?: number
  /** HP (percent) at the last snapshot before the death, when that snapshot is 10–60 s old. */
  hpPct?: number
  hpSnapshotAgeSec?: number
  // absent-objective
  objective?: ObjectiveKind
  playerDistance?: number | null
  wardsElsewhere?: number
  /** The player did place a ward near the pit in the 90 s before (the miss is then not a vision one). */
  playerWarded?: boolean
  // early-deficit
  csDiff10?: number
  xpDiff10?: number
  takedownsBefore10?: number
  opponentChampion?: string | null
  // patterns (see header)
  pattern?: MomentPattern
  /** tempo-hesitation: units walked toward the pit in the last 25 s. */
  approachedBy?: number
  /** tempo-hesitation: the player took a side-lane tower / plate in the 75 s before instead of setting up. */
  towerGreed?: boolean
  /** jungle patterns: XP vs the enemy jungler after the play. */
  xpDiffJungle?: number
  /** jungle-passive-clear: bot duo gold lead at 3:00. */
  botGoldLead?: number
  /** tempo lines: forward allies who died in the fight / allies still home (gank-during-team-reset: allies in base in the 15 s before). */
  alliesHigh?: number
  alliesHome?: number
  /** gank-timer: which window (1 = the 3-camp transition, 2 = the end of the first clear); wards are best effort (no coordinates in the timeline). */
  gankWindow?: 1 | 2
  deepWard?: boolean
  wardedRecently?: boolean
  /** fed-carry-first: share of team gold (percent), kill streak and estimated bounty. */
  goldSharePct?: number
  killStreak?: number
  bountyGold?: number
  /** bad-rotation / mid-roam-plates: CS and XP lost against the lane opponent during the roam. */
  csLost?: number
  xpLost?: number
  /** mid-roam-plates: mid plates lost, side of the roam, enemy holding the Voidgrubs. */
  platesLost?: number
  roamSide?: 'top' | 'bot'
  enemyGrubs?: boolean
  /** pit-chokepoint, low-hp-recall-before-objective, jungle-baron-recall: allies who died in the fight the player missed or lost. */
  alliesDown?: number
  /** tower-dive-one-for-one: seconds between the player's kill and their death, lane of the enemy T1. */
  killGapSec?: number
  turretLane?: 'TOP' | 'MID' | 'BOT'
  /** level-up-spike: the level the lane opponent had just reached (2 or 3). */
  spikeLevel?: number
  /** range-melee-volatility: the player's attack type and the HP of the snapshot that decided the lane. */
  attackType?: 'melee' | 'ranged'
  laneHpPct?: number
  opponentHpPct?: number
  /** cheater-recall: HP at 2:00 and levels behind the lane opponent at 4:00 (low-hp-recall-before-objective: HP on the snapshot before the back). */
  recallHpPct?: number
  levelsBehind?: number
  /** support-level2-allin: the support's level and the highest level among the enemies in the fight (LEVEL_UP events); the enemy jungler took part. */
  myLevel?: number
  enemyLevel?: number
  junglerInvolved?: boolean
  /** low-hp-recall-before-objective: seconds between the start of the back and the spawn. */
  spawnInSec?: number
  /** adc-solo-sidelane-reopen: seconds since the player left base; the mid laner was in base meanwhile. */
  sinceBaseSec?: number
  midInBase?: boolean
  /** inhib-forced-dive: seconds between the inhibitor and the death. */
  inhibGapSec?: number
  // V7–V10.
  /** jungle-late-first-recall: the first back after 1:00 (s), null when there was none. */
  firstBackSec?: number | null
  /** jungle-camps-up-gank: jungle CS lost on the enemy jungler over the minute of the gank (their gain minus the player's). */
  jungleCsLost?: number
  /** jungle-weakside-stolen, support-weakside-unwarded: jungle CS the enemy jungler took in our jungle that minute. */
  campsStolenCs?: number
  /** jungle-invade-death: jungle CS the player took around the death; their mid laner was on the mid lane, away from it. */
  campsTakenCs?: number
  midOnWave?: boolean
  /** jungle-dragon-tank-death: damage the Dragon dealt, in percent of max HP. */
  dragonDamagePct?: number
  /** jungle-compensation-death: seconds between the ally's death and the player's. */
  deathGapSec?: number
  /** jungle-early-boots: when the boots were bought (s). */
  bootsSec?: number
  /** jungle-herald-unused-death: seconds since the player took the Herald. */
  heraldAgoSec?: number
  /** mid-reset-trap-death: the low resource on the snapshot of the enemy back, and the seconds from that back to the death. */
  resetResource?: 'hp' | 'mana'
  resetLowPct?: number
  enemyBackSec?: number
  /** mid-passive-wave-loss: CS behind the lane opponent at 6:00. */
  csDiff6?: number
  /** support-botlane-leech: snapshots 9:00–15:00 next to the ADC in the bot lane (of 7), kill participation at 15:00 (percent). */
  laneSnapshots?: number
  kpPct?: number
}

export interface CriticalMoment {
  /** Stable id within the game: `${trigger}@${gameTimeSec}`. */
  key: string
  trigger: MomentTrigger
  gameTimeSec: number
  /** Ranking score (bigger = costlier). */
  severity: number
  position: Point | null
  zone: Zone | null
  lane: LaneBucket | null
  territory: Territory | null
  /** P(win) just before the action / at the end of its window (3 decimals; never shown as a rating). */
  winProbBefore: number | null
  winProbAfter: number | null
  facts: MomentFacts
}

export interface ContestedObjective {
  gameTimeSec: number
  kind: ObjectiveKind
  takenBy: 'ally' | 'enemy'
  /** The player placed at least one ward within WARD_RADIUS of the pit in the 90 s before. */
  playerWarded: boolean
  /**
   * The vision of this objective was the player's to provide — same rule as
   * the auto-detected `no-ward-pre-obj` tag: supports and junglers on every
   * objective, laners on the ones their team lost; never when the player was
   * dead in the 110 s before, before 5:00, nor for the Voidgrubs.
   */
  accountable: boolean
}

export interface GameAnalysis {
  participantId: number
  teamId: TeamId
  champion: string
  /** Riot teamPosition (TOP / JUNGLE / MIDDLE / BOTTOM / UTILITY / ''). */
  position: string
  /** P(win) at every frame snapshot (3 decimals). */
  winProb: number[]
  /** ≤ 3 moments, chronological. */
  moments: CriticalMoment[]
  /** Every epic monster of the game (dragon, Baron, Herald, grubs), for objective checks. */
  contested: ContestedObjective[]
  /** Candidates discarded as garbage time (kept out of the Mistake Lab ratios). */
  garbageDiscarded: number
  /** Lane numbers at 10:00 vs the direct opponent (laners only), for objective checks. */
  laneAt10: { csDiff: number; xpDiff: number } | null
}

export interface DetectorSelector {
  puuids?: string[]
  championName?: string
}

export const MAX_MOMENTS = DETECTOR_SPEC.maxMoments
export const SUMMONERS_RIFT_MAP_ID = 11
const EPIC: ObjectiveKind[] = ['dragon', 'elder', 'baron', 'herald', 'grubs']
/** Objectives the jungler secures with Smite and can lose to the enemy one (V7). */
const OUTSMITE_KINDS: ObjectiveKind[] = ['dragon', 'elder', 'herald', 'baron']
const HESITATION_KINDS: ObjectiveKind[] = ['dragon', 'elder', 'baron', 'grubs']
const PATTERN_BONUS = 0.12
/** Baron buff duration (the 3 min powerplay). */
const BARON_BUFF_MS = 180_000
/** Outer mid turrets, to tell whose plate fell. */
const MID_OUTER_TURRET: Record<TeamId, Point> = { 100: { x: 5846, y: 6396 }, 200: { x: 9164, y: 8609 } }
/** Float noise allowed on a threshold computed from unrounded probabilities. */
const EPS = 1e-9

export { deathTimerSec, respawnTimeFactor }

/** Kill gold of a champion on an n-kill streak (classic table: 2 kills → 450 g … 7+ → 1000 g). Estimate: the live bounty also depends on farm leads. */
const BOUNTY_BY_STREAK = [300, 300, 450, 600, 700, 800, 900, 1000]
export function bountyGold(killStreak: number): number {
  return BOUNTY_BY_STREAK[Math.max(0, Math.min(BOUNTY_BY_STREAK.length - 1, Math.floor(killStreak)))]
}

/** Summoner's Rift in classic mode (fields absent from a payload are not held against it). */
export function isSupportedGame(match: any): boolean {
  const info = match?.info ?? {}
  if (info.mapId != null && info.mapId !== SUMMONERS_RIFT_MAP_ID) return false
  if (info.gameMode != null && info.gameMode !== 'CLASSIC') return false
  return true
}

function resolveParticipant(match: any, sel: DetectorSelector): any | null {
  const parts: any[] = match?.info?.participants ?? []
  if (sel.puuids?.length) {
    const hit = parts.find((p) => p.puuid && sel.puuids!.includes(p.puuid))
    if (hit) return hit
  }
  if (sel.championName) {
    const c = sel.championName.toLowerCase()
    const same = parts.filter((p) => String(p.championName ?? '').toLowerCase() === c)
    if (same.length === 1) return same[0]
  }
  return null
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d
const within = (p: Point | null | undefined, q: Point, r: number): boolean => p != null && dist(p, q) <= r

/** One death of a champion: where and when it fell, when it is back. */
interface Life { ts: number; pos: Point; respawn: number }

export function analyzeGame(match: any, timeline: any, selector: DetectorSelector): GameAnalysis | null {
  const frames: any[] = timeline?.info?.frames ?? []
  const me = resolveParticipant(match, selector)
  if (!me || frames.length < 2 || !isSupportedGame(match) || seasonOf(match) !== 'current') return null
  const S = DETECTOR_SPEC
  const pid: number = me.participantId
  const team = (me.teamId === 200 ? 200 : 100) as TeamId
  const parts: any[] = match.info.participants
  const teamById = new Map<number, number>(parts.map((p) => [p.participantId, p.teamId]))
  const teamOf = (id: number) => teamById.get(id)
  const positionOf = (p: any): string => p?.teamPosition || p?.individualPosition || ''
  const role = positionOf(me)
  const allies = parts.filter((p) => p.teamId === team && p.participantId !== pid).map((p) => p.participantId as number)
  const enemies = parts.filter((p) => p.teamId !== team).map((p) => p.participantId as number)
  const enemyJungler = parts.find((p) => p.teamId !== team && positionOf(p) === 'JUNGLE')?.participantId as number | undefined
  const laneOpponent = ['TOP', 'MIDDLE', 'BOTTOM'].includes(role) ? parts.find((p) => p.teamId !== team && positionOf(p) === role) : undefined
  const isLaner = ['TOP', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(role)
  /** Roles whose job is the vision of every objective (same split as the auto-detector). */
  const visionRole = role === 'UTILITY' || role === 'JUNGLE'

  const clock = frameClock(frames)
  const track = winProbabilityTrack(frames, teamOf, team)
  /** Would-be moments dropped because P(win) just before them was garbage time. */
  let garbageDiscarded = 0

  // Flatten events once (chronological).
  const events: any[] = []
  for (const f of frames) for (const ev of (f.events ?? []) as any[]) if (typeof ev.timestamp === 'number') events.push(ev)
  events.sort((a, b) => a.timestamp - b.timestamp)
  const kills = events.filter((e) => e.type === 'CHAMPION_KILL')
  const involves = (e: any, id: number): boolean => e.killerId === id || (e.assistingParticipantIds ?? []).includes(id)

  const pframe = (i: number, id: number) => frames[Math.max(0, Math.min(frames.length - 1, i))]?.participantFrames?.[String(id)]
  /** The participant's last snapshot at or before `ms`. */
  const snapshotAt = (id: number, ms: number) => pframe(clock.indexAt(ms), id)
  const goldOf = (i: number, id: number) => Number(pframe(i, id)?.totalGold) || 0
  const csOf = (i: number, id: number) => (Number(pframe(i, id)?.minionsKilled) || 0) + (Number(pframe(i, id)?.jungleMinionsKilled) || 0)
  const xpOf = (i: number, id: number) => Number(pframe(i, id)?.xp) || 0
  const levelOf = (i: number, id: number) => Number(pframe(i, id)?.level) || 0
  /** HP percent of a snapshot, null when the timeline carries no champion stats. */
  const hpPctOf = (i: number, id: number): number | null => {
    const s = pframe(i, id)?.championStats
    return s && Number(s.healthMax) > 0 ? Math.round((Number(s.health) / Number(s.healthMax)) * 100) : null
  }

  // ── Lives: where every champion fell, and when it came back ───────────
  const lives = new Map<number, Life[]>()
  for (const e of kills) {
    const id = e.victimId
    const pos = e.position as Point | undefined
    if (typeof id !== 'number' || !pos) continue
    const level = Number(snapshotAt(id, e.timestamp)?.level) || 1
    const list = lives.get(id) ?? []
    list.push({ ts: e.timestamp, pos, respawn: e.timestamp + deathTimerSec(level, e.timestamp / 60000) * 1000 })
    lives.set(id, list)
  }
  /** Dead at `ms` (between a death and its respawn). */
  const deadAt = (id: number, ms: number): boolean => !!lives.get(id)?.some((d) => d.ts <= ms && ms < d.respawn)
  /** Dead at some point of [from, to], or back for less than `graceMs` at `from`. */
  const downIn = (id: number, from: number, to: number, graceMs = 0): boolean => !!lives.get(id)?.some((d) => d.ts <= to && d.respawn + graceMs > from)

  /**
   * Position at `ms`. Snapshots are 60 s apart; in between, the champion
   * walks straight from one known point to the next — the known points being
   * the snapshots, the place it dies and its fountain when it respawns. Dead,
   * it is where it fell.
   */
  const posAt = (id: number, ms: number): Point | null => {
    const own = lives.get(id)
    const dead = own?.find((d) => d.ts <= ms && ms < d.respawn)
    if (dead) return dead.pos
    const i = clock.indexAt(ms)
    let t0 = clock.ts(i)
    let p0: Point | null = pframe(i, id)?.position ?? null
    let t1 = clock.ts(i + 1)
    let p1: Point | null = i < clock.last ? pframe(i + 1, id)?.position ?? null : null
    if (own) {
      // Respawned since the last snapshot (which may have been taken while dead): it restarts from the fountain.
      for (const d of own) if (d.respawn <= ms && d.respawn > t0) { t0 = d.respawn; p0 = FOUNTAIN[teamOf(id) === 200 ? 200 : 100] }
      // Dies before the next snapshot: it is walking to where it falls.
      const next = own.find((d) => d.ts > ms && d.ts <= t1)
      if (next) { t1 = next.ts; p1 = next.pos }
    }
    if (!p0) return p1
    if (!p1 || t1 <= t0) return p0
    const t = Math.max(0, Math.min(1, (ms - t0) / (t1 - t0)))
    return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }
  }
  const tempoD = (p: Point | null): number | null => (p ? tempoLineD(p, team) : null)

  const myWards = events.filter((e) => e.type === 'WARD_PLACED' && e.creatorId === pid && e.wardType !== 'UNDEFINED')
    .map((e) => ({ ts: e.timestamp as number, pos: posAt(pid, e.timestamp) }))
  const myDeaths = kills.filter((e) => e.victimId === pid)
  const allyDeaths = kills.filter((e) => allies.includes(e.victimId))
  const enemyDeaths = kills.filter((e) => enemies.includes(e.victimId))
  const takedownIn = (from: number, to: number): boolean => kills.some((e) => e.timestamp >= from && e.timestamp <= to && involves(e, pid))
  const ownPlays = events.filter((e) =>
    ((e.type === 'CHAMPION_KILL' || e.type === 'BUILDING_KILL') && involves(e, pid)) ||
    (e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === pid)).map((e) => e.timestamp as number)

  // V6 helpers. The shop only sells in base: a purchase dates a base visit between two snapshots.
  const shops = new Map<number, number[]>()
  for (const e of events) {
    if (e.type !== 'ITEM_PURCHASED' || typeof e.participantId !== 'number') continue
    shops.set(e.participantId, [...(shops.get(e.participantId) ?? []), e.timestamp])
  }
  const shopsOf = (id: number): number[] => shops.get(id) ?? []
  /** Stood in its base at some point of [from, to] (a purchase, or a snapshot on the fountain platform) and is alive at `to`. */
  const homeIn = (id: number, from: number, to: number): boolean => {
    if (deadAt(id, to)) return false
    if (shopsOf(id).some((t) => t >= from && t <= to)) return true
    const side: TeamId = teamOf(id) === 200 ? 200 : 100
    for (let i = 0; i <= clock.last; i++) if (clock.ts(i) >= from && clock.ts(i) <= to && inBaseBox(pframe(i, id)?.position, side)) return true
    return false
  }
  const levelUps = events.filter((e) => e.type === 'LEVEL_UP')
  /** Level at `ms` from the LEVEL_UP events (exact time), not from the per-minute snapshot. */
  const levelAtMs = (id: number, ms: number): number => 1 + levelUps.filter((e) => e.participantId === id && e.timestamp <= ms).length
  const roleOfId = (id: number): string => positionOf(parts.find((p) => p.participantId === id))
  /** The lane of the player's role (supports play bot); null for a jungler. */
  const myLaneBucket: LaneBucket | null = role === 'TOP' ? 'TOP' : role === 'MIDDLE' ? 'MID' : role === 'BOTTOM' || role === 'UTILITY' ? 'BOT' : null
  /** The support's level-2 fight was already reported as a death: the missing early ward is then the same story. */
  let supportLevel2Death = false
  /** Jungler deaths the death loop read with a V7 pattern that outranks the V4 overchase reading of the same death. */
  const readDeaths = new Set<number>()

  // V7–V10 helpers.
  const jungleCsOf = (i: number, id: number) => Number(pframe(i, id)?.jungleMinionsKilled) || 0
  const allyByRole = (r: string): number | undefined => parts.find((p) => p.teamId === team && p.participantId !== pid && positionOf(p) === r)?.participantId
  /** Purchases that start a base visit (none in the 30 s before), after the starting items. */
  const visitsOf = (id: number): number[] => shopsOf(id).filter((t, n, all) => t > 60_000 && (n === 0 || t - all[n - 1] >= S.tradeRecall.visitGapSec * 1000))
  /** When the player last left base before `ms`: their last purchase after `afterMs`, or their last respawn; null when neither. */
  const baseExitBefore = (ms: number, afterMs = -Infinity): number | null => {
    const shop = [...shopsOf(pid)].reverse().find((t) => t <= ms && t > afterMs) ?? -Infinity
    const respawn = Math.max(-Infinity, ...(lives.get(pid) ?? []).filter((l) => l.respawn <= ms).map((l) => l.respawn))
    const left = Math.max(shop, respawn)
    return Number.isFinite(left) ? left : null
  }
  /** Mana percent of a snapshot; null for pools of 200 or less (energy, rage, flow…) and champions without a resource. */
  const manaPctOf = (i: number, id: number): number | null => {
    const s = pframe(i, id)?.championStats
    return s && Number(s.powerMax) > S.resetTrap.manaPoolMin ? Math.round((Number(s.power) / Number(s.powerMax)) * 100) : null
  }
  const sideOf = (p: Point): 'top' | 'bot' => (p.y > p.x ? 'top' : 'bot')
  /** Minutes [k, k+1] in which the enemy jungler takes 8+ jungle CS standing in the same quadrant of our jungle at both snapshots. */
  const steals: Array<{ k: number; cs: number; side: 'top' | 'bot' }> = []
  if (enemyJungler != null) {
    const inOurs = (p: Point | null | undefined): p is Point => p != null && territoryOf(p, team) === 'own' && laneOf(p) === 'JUNGLE'
    for (let k = S.campsStolen.fromSec / 60; k + 1 <= clock.last; k++) {
      const a = pframe(k, enemyJungler)?.position as Point | undefined
      const b = pframe(k + 1, enemyJungler)?.position as Point | undefined
      if (!inOurs(a) || !inOurs(b) || sideOf(a) !== sideOf(b)) continue
      const cs = jungleCsOf(k + 1, enemyJungler) - jungleCsOf(k, enemyJungler)
      if (cs >= S.campsStolen.cs) steals.push({ k, cs, side: sideOf(b) })
    }
  }
  /**
   * The V4 overchase test of a death (jungle, from the end of the first clear to 8:00): the 20 s before it across the river or in the enemy jungle, no
   * takedown, no camp between the snapshot before the chase and the one after the death. Section 4 reports it; the V7
   * invade death leaves such deaths to it.
   */
  const isOverchaseDeath = (d: any): boolean => {
    const J = S.jungle
    const ts: number = d.timestamp
    if (role !== 'JUNGLE' || ts < J.fromSec * 1000 || ts > J.toSec * 1000) return false
    const start = ts - J.overchaseSec * 1000
    const awayFromHome = (p: Point | null | undefined) => p != null && territoryOf(p, team) !== 'own'
    const path = Array.from({ length: J.overchaseSec / J.sampleSec }, (_, n) => posAt(pid, start + n * J.sampleSec * 1000))
    if (!awayFromHome(d.position ?? posAt(pid, ts)) || !path.every(awayFromHome) || takedownIn(start, ts)) return false
    // Camps are a per-minute counter: any camp between the snapshot before the chase and the one after the death cancels it.
    return !(jungleCsOf(clock.indexAt(ts) + 1, pid) > jungleCsOf(clock.indexAt(start), pid))
  }

  // Objectives (ours = taken by our team / an enemy building destroyed).
  const objectives = events.map((e) => {
    const kind = objectiveKindOf(e)
    if (!kind) return null
    const ours = e.type === 'ELITE_MONSTER_KILL' ? (e.killerTeamId ?? teamOf(e.killerId)) === team : e.teamId !== team
    return { ts: e.timestamp as number, kind, ours, pos: (e.position as Point | undefined) ?? null }
  }).filter((o): o is NonNullable<typeof o> => o != null)

  const candidates: CriticalMoment[] = []
  /**
   * Registers a candidate unless P(win) just before the action is garbage
   * time (then it is only counted). `gateMs`: the action itself, when the
   * moment is anchored a few seconds earlier for the VOD.
   */
  const add = (trigger: MomentTrigger, ms: number, pos: Point | null, severity: number, facts: MomentFacts, winProbAfter: number | null = null, gateMs = ms): boolean => {
    const before = track.before(gateMs)
    const exempt = before != null && before > GARBAGE_HIGH && facts.pattern != null && GARBAGE_CEILING_EXEMPT.includes(facts.pattern)
    if (isGarbageTime(before) && !exempt) {
      garbageDiscarded++
      return false
    }
    candidates.push({
      key: `${trigger}@${Math.round(ms / 1000)}`,
      trigger,
      gameTimeSec: Math.round(ms / 1000),
      severity: round(severity),
      position: pos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : null,
      zone: pos ? zoneOf(pos, team) : null,
      lane: pos ? laneOf(pos) : null,
      territory: pos ? territoryOf(pos, team) : null,
      winProbBefore: before != null ? round(before) : null,
      winProbAfter: winProbAfter != null ? round(winProbAfter) : null,
      facts,
    })
    return true
  }

  /** KDA and kill streak of the player just before `ts`. */
  const statsBefore = (ts: number) => {
    let k = 0, dth = 0, a = 0, streak = 0
    for (const e of kills) {
      if (e.timestamp >= ts) break
      if (e.killerId === pid) { k++; streak++ }
      else if ((e.assistingParticipantIds ?? []).includes(pid)) a++
      if (e.victimId === pid) { dth++; streak = 0 }
    }
    return { kda: (k + a) / Math.max(1, dth), streak }
  }

  // ── Pit fights (V4): clusters of kills around a pit, from the mid game ──
  interface PitFight { pit: Pit; start: number; end: number; allyDeaths: number; enemyDeaths: number }
  const pitFights: PitFight[] = []
  for (const pit of ['baron', 'dragon'] as const) {
    const center = pitCenter(pit)
    let cluster: any[] = []
    const flush = () => {
      if (cluster.length >= 2) {
        pitFights.push({
          pit, start: cluster[0].timestamp, end: cluster[cluster.length - 1].timestamp,
          allyDeaths: cluster.filter((e) => teamOf(e.victimId) === team).length,
          enemyDeaths: cluster.filter((e) => teamOf(e.victimId) !== team).length,
        })
      }
      cluster = []
    }
    for (const e of kills) {
      if (e.timestamp < S.pit.fromSec * 1000 || !e.position || dist(e.position, center) >= S.pit.fightRadius) continue
      if (cluster.length && e.timestamp - cluster[cluster.length - 1].timestamp > S.pit.fightGapSec * 1000) flush()
      cluster.push(e)
    }
    flush()
  }
  /** The pit fight a death belongs to: during it, and within the fight radius of that pit. */
  const pitFightOf = (d: any): PitFight | undefined => {
    const p = d.position as Point | undefined
    return p ? pitFights.find((f) => d.timestamp >= f.start && d.timestamp <= f.end && dist(p, pitCenter(f.pit)) < S.pit.fightRadius) : undefined
  }
  /** Support, or a control mage in the mid lane: their job at an objective is zoning. */
  const isZoner = role === 'UTILITY' || (role === 'MIDDLE' && isControlMage(me.championName))
  /** Inside the pit (d < 900 of its centre) for the whole 15 s before the fight broke out. */
  const insidePitBefore = (f: PitFight): boolean => [1, 2 / 3, 1 / 3, 0].every((k) => {
    const p = posAt(pid, f.start - k * S.pit.beforeSec * 1000)
    return p != null && dist(p, pitCenter(f.pit)) < S.pit.insideRadius
  })

  // ── 1. Critical deaths ────────────────────────────────────────────────
  for (const d of myDeaths) {
    const ts: number = d.timestamp
    // P(win) just before the death (objectives up to it) against P(win) 90 s
    // later (objectives up to then, gold and XP of the last snapshot inside
    // the window): nothing that happened before the death or after the
    // window can make it critical.
    const before = track.before(ts)
    const after = track.at(ts + S.death.windowSec * 1000)
    const drop = before != null && after != null ? before - after : 0
    const lost = objectives
      .filter((o) => !o.ours && o.ts > ts && o.ts <= ts + S.death.windowSec * 1000)
      .sort((a, b) => OBJECTIVE_WEIGHT[b.kind] - OBJECTIVE_WEIGHT[a.kind] || a.ts - b.ts)[0] ?? null

    const pos: Point | null = d.position ?? posAt(pid, ts)
    const fi = clock.indexAt(ts)
    const assisters: number[] = d.assistingParticipantIds ?? []
    const killerIsChamp = typeof d.killerId === 'number' && d.killerId > 0 && teamOf(d.killerId) !== team
    const involved: number[] = [...(killerIsChamp ? [d.killerId as number] : []), ...assisters]
    // In the fight: alive, or fallen in the 10 s before (a corpse from an earlier fight is nobody).
    const inFight = (id: number) => !deadAt(id, ts) || !!lives.get(id)?.some((l) => l.ts <= ts && ts - l.ts <= S.death.sameFightSec * 1000)
    const alliesNearby = pos ? allies.filter((a) => inFight(a) && within(posAt(a, ts), pos, S.death.allyRadius)).length : 0
    const sec = ts / 1000

    // Patterns: each makes the death worth reviewing even without a win-probability swing.
    let pattern: MomentPattern | undefined
    const extra: Partial<MomentFacts> = {}

    const opp: number | null = laneOpponent?.participantId ?? null
    const junglerInFight = enemyJungler != null && (involved.includes(enemyJungler) ||
      ((d.victimDamageReceived ?? []) as any[]).some((x) => x?.participantId === enemyJungler))

    // V5 — 1-for-1 tower dive: the player kills the lane opponent next to a standing enemy T1 and dies within 4 s, without the enemy jungler.
    if (opp != null && sec < S.dive.untilSec && !junglerInFight) {
      const myKill = [...kills].reverse().find((e) => e.killerId === pid && e.victimId === opp && e.timestamp <= ts && ts - e.timestamp <= S.dive.afterKillSec * 1000)
      const enemyTeam: TeamId = team === 100 ? 200 : 100
      const lane = myKill?.position ? (['TOP', 'MID', 'BOT'] as const).find((l) => dist(myKill.position, OUTER_TURRETS[enemyTeam][l]) <= S.dive.turretRadius) : undefined
      const standing = lane && !events.some((e) => e.type === 'BUILDING_KILL' && e.towerType === 'OUTER_TURRET' && e.teamId === enemyTeam &&
        e.laneType === `${lane}_LANE` && e.timestamp < myKill.timestamp)
      if (lane && standing) {
        pattern = 'tower-dive-one-for-one'
        Object.assign(extra, { killGapSec: Math.round((ts - myKill.timestamp) / 1000), turretLane: lane })
      }
    }

    // V5 — level-up spike: killed by the lane opponent right after their level 2 or 3, still a level below.
    if (!pattern && opp != null && sec <= S.levelSpike.untilSec && d.killerId === opp && !junglerInFight) {
      const up = [...events].reverse().find((e) => e.type === 'LEVEL_UP' && e.participantId === opp && (S.levelSpike.levels as readonly number[]).includes(e.level) &&
        e.timestamp <= ts && ts - e.timestamp <= S.levelSpike.windowSec * 1000)
      if (up && levelAtMs(pid, ts) < up.level) {
        pattern = 'level-up-spike'
        Object.assign(extra, { spikeLevel: up.level })
      }
    }

    // V6 — support, level-2 fight lost: killed 1:30–2:05 while below the level of an enemy in the fight (gank or all-in).
    const SE = S.supportEarly
    if (!pattern && role === 'UTILITY' && sec >= SE.deathFromSec && sec <= SE.deathToSec && involved.length > 0) {
      const mine = levelAtMs(pid, ts)
      const theirs = Math.max(...involved.map((id) => levelAtMs(id, ts)))
      if (theirs > mine) {
        pattern = 'support-level2-allin'
        supportLevel2Death = true
        Object.assign(extra, { myLevel: mine, enemyLevel: theirs, ...(junglerInFight ? { junglerInvolved: true } : {}) })
      }
    }

    // V9 — mid laner caught right out of base: dead in the mid lane at most 45 s after leaving it, before 12:00 (ahead of the new wave).
    const AW = S.aheadOfWave
    if (!pattern && role === 'MIDDLE' && sec < AW.untilSec && pos && laneOf(pos) === 'MID' && zoneOf(pos, team) !== 'own-base' && killerIsChamp) {
      const left = baseExitBefore(ts, AW.startSec * 1000)
      if (left != null && ts - left <= AW.afterBaseSec * 1000) {
        pattern = 'mid-ahead-of-wave-death'
        Object.assign(extra, { sinceBaseSec: Math.round((ts - left) / 1000) })
      }
    }

    // V9 — reset trap: the enemy mid backed first; the player, low on HP or mana, stayed in lane and died within 90 s.
    const RT = S.resetTrap
    if (!pattern && role === 'MIDDLE' && opp != null && sec < RT.untilSec) {
      const back = visitsOf(opp).filter((r) => r <= ts && ts - r <= RT.withinSec * 1000 && !downIn(opp, r - 60_000, r)).pop()
      if (back != null && !shopsOf(pid).some((t) => t >= back - RT.stayedSec * 1000 && t <= ts)) {
        const k = clock.indexAt(back)
        const hp = hpPctOf(k, pid)
        const mana = manaPctOf(k, pid)
        const low = hp != null && hp < RT.lowPct ? { resetResource: 'hp' as const, resetLowPct: hp }
          : mana != null && mana < RT.lowPct ? { resetResource: 'mana' as const, resetLowPct: mana } : null
        if (low) {
          pattern = 'mid-reset-trap-death'
          Object.assign(extra, { ...low, enemyBackSec: Math.round((ts - back) / 1000) })
        }
      }
    }

    // V5 — back timer missed: low HP with gold in lane, then dead in the river or jungle instead of recalling.
    if (!pattern && isLaner && sec < S.backTimer.untilSec && pos) {
      const age = (ts - clock.ts(fi)) / 1000
      const hp = hpPctOf(fi, pid)
      const at = pframe(fi, pid)?.position as Point | undefined
      if (hp != null && hp < S.backTimer.hpPct && age >= S.death.hpSnapshotMinAgeSec && age <= S.backTimer.withinSec &&
          (Number(pframe(fi, pid)?.currentGold) || 0) >= S.backTimer.gold && at && laneOf(at) !== 'JUNGLE' && laneOf(pos) === 'JUNGLE') {
        pattern = 'back-timer-missed'
      }
    }

    // V6 — ganked in the enemy half of the lane while the team was resetting: 2+ allies in base in the 15 s before,
    // the jungler or a bot laner among them. A gank = an enemy other than the lane opponents took part.
    const TR = S.teamReset
    if (!pattern && myLaneBucket && sec < TR.untilSec && pos && territoryOf(pos, team) === 'enemy' && laneOf(pos) === myLaneBucket) {
      const laneRoles = myLaneBucket === 'BOT' ? ['BOTTOM', 'UTILITY'] : [role]
      const ganked = junglerInFight || involved.some((id) => !laneRoles.includes(roleOfId(id)))
      const home = ganked ? allies.filter((a) => homeIn(a, ts - TR.lookbackSec * 1000, ts)) : []
      if (home.length >= TR.alliesHome && home.some((a) => ['JUNGLE', 'BOTTOM', 'UTILITY'].includes(roleOfId(a)))) {
        pattern = 'gank-during-team-reset'
        Object.assign(extra, { alliesHome: home.length })
      }
    }

    // Gank on a predictable jungle timer (laners): 1:50–2:25, or 2:40–3:50 without a deep ward.
    if (!pattern && isLaner && enemyJungler != null && involved.includes(enemyJungler)) {
      const w1 = sec >= S.gank.window1[0] && sec <= S.gank.window1[1]
      const w2 = sec >= S.gank.window2[0] && sec <= S.gank.window2[1]
      if (w1 || w2) {
        const recent = myWards.filter((w) => w.ts <= ts && ts - w.ts <= S.gank.deepWardLifetimeSec * 1000)
        const deepWard = recent.some((w) => w.pos != null && zoneOf(w.pos, team) === 'enemy-jungle')
        if (w1 || !deepWard) {
          pattern = 'gank-timer'
          Object.assign(extra, { gankWindow: w1 ? 1 : 2, deepWard, wardedRecently: recent.length > 0 })
        }
      }
    }

    // V5 — range vs melee: a 1v1 death to the lane opponent before 8:00, after the lane's HP war was lost.
    if (!pattern && opp != null && sec < S.rangeMelee.untilSec && d.killerId === opp && assisters.length === 0) {
      const mine = attackTypeOf(me.championName)
      const theirs = attackTypeOf(laneOpponent.championName)
      if (mine && theirs && mine !== theirs) {
        const R = S.rangeMelee
        for (let i = 1; i <= fi && clock.ts(i) < ts; i++) {
          const hp = hpPctOf(i, pid)
          const oppHp = hpPctOf(i, opp)
          const lvl = levelOf(i, pid)
          const lost = mine === 'ranged'
            ? hp != null && hp < R.rangedHp && lvl <= R.rangedMaxLevel
            : hp != null && oppHp != null && hp < R.meleeHp && oppHp > R.opponentHp && lvl <= R.meleeMaxLevel
          if (lost) {
            pattern = 'range-melee-volatility'
            Object.assign(extra, { attackType: mine, laneHpPct: hp, ...(oppHp != null ? { opponentHpPct: oppHp } : {}) })
            break
          }
        }
      }
    }

    // V7 — jungler dead on a Dragon tanked between 5:00 and 12:00: the Dragon took 60 %+ of their max HP, enemies in the fight.
    const DT = S.dragonTank
    if (!pattern && role === 'JUNGLE' && sec >= DT.fromSec && sec <= DT.untilSec && pos && dist(pos, pitCenter('dragon')) < S.pit.fightRadius && involved.length > 0) {
      const max = Number(pframe(fi, pid)?.championStats?.healthMax) || 0
      const dragon = ((d.victimDamageReceived ?? []) as any[]).filter((x) => x?.type === 'MONSTER' && /dragon/i.test(String(x?.name ?? '')))
        .reduce((s, x) => s + (Number(x.physicalDamage) || 0) + (Number(x.magicDamage) || 0) + (Number(x.trueDamage) || 0), 0)
      if (max > 0 && dragon / max >= DT.damageShare) {
        pattern = 'jungle-dragon-tank-death'
        Object.assign(extra, { dragonDamagePct: Math.round((dragon / max) * 100) })
      }
    }

    // V6 — jungler dead in the enemy base within 15 s after an enemy inhibitor fell: a dive forced instead of leaving.
    if (!pattern && role === 'JUNGLE' && pos && zoneOf(pos, team) === 'enemy-base') {
      const inhib = [...events].reverse().find((e) => e.type === 'BUILDING_KILL' && e.buildingType === 'INHIBITOR_BUILDING' && e.teamId !== team &&
        e.timestamp < ts && ts - e.timestamp <= S.inhibDive.withinSec * 1000)
      if (inhib) {
        pattern = 'inhib-forced-dive'
        Object.assign(extra, { inhibGapSec: Math.round((ts - inhib.timestamp) / 1000) })
      }
    }

    // V7 — jungler dead in a fight 15:00–22:00 with the Eye of the Herald in their pocket: the team took the Herald before, and
    // the eye left the jungler's own inventory (ITEM_DESTROYED: used or expired) only after this death.
    const HE = S.heraldEye
    if (!pattern && role === 'JUNGLE' && sec >= HE.fromSec && sec <= HE.untilSec && involved.length > 0) {
      const herald = [...objectives].reverse().find((o) => o.ours && o.kind === 'herald' && o.ts < ts)
      const gone = herald ? events.find((e) => e.type === 'ITEM_DESTROYED' && e.itemId === HE.itemId && e.timestamp > herald.ts) : undefined
      if (herald && gone && gone.participantId === pid && gone.timestamp > ts && ts - herald.ts >= HE.pickupSec * 1000) {
        pattern = 'jungle-herald-unused-death'
        Object.assign(extra, { heraldAgoSec: Math.round((ts - herald.ts) / 1000) })
      }
    }

    // V7/V8 — jungler dead invading before 16:00: in the enemy jungle, alone or with one ally, after taking a camp, no takedown
    // in the 30 s before, not an overchase.
    const IV = S.invadeDeath
    if (!pattern && role === 'JUNGLE' && sec < IV.untilSec && pos && territoryOf(pos, team) === 'enemy' && laneOf(pos) === 'JUNGLE' && involved.length > 0 &&
        alliesNearby <= IV.maxAllies && !takedownIn(ts - IV.noTakedownSec * 1000, ts) && !isOverchaseDeath(d)) {
      const taken = jungleCsOf(clock.indexAt(ts) + 1, pid) - jungleCsOf(clock.indexAt(ts - 60_000), pid)
      if (taken >= IV.campCs) {
        const mid = allyByRole('MIDDLE')
        const mp = mid != null && !deadAt(mid, ts) ? posAt(mid, ts) : null
        pattern = 'jungle-invade-death'
        Object.assign(extra, { campsTakenCs: taken, ...(mp && laneOf(mp) === 'MID' && dist(mp, pos) > IV.midRadius ? { midOnWave: true } : {}) })
      }
    }

    // Support / control mage standing in the pit instead of holding a choke point (the death is part of the pit fight).
    if (!pattern && isZoner) {
      const fight = pitFightOf(d)
      if (fight && insidePitBefore(fight)) {
        pattern = 'pit-chokepoint'
        Object.assign(extra, { alliesDown: fight.allyDeaths })
      }
    }

    // V6 — ADC re-opening a side lane alone: dead with no ally around, in a side lane across the river, at most
    // 45 s of walk + 45 s after leaving base (the last purchase, or the respawn when nothing was bought).
    const AR = S.adcReopen
    if (!pattern && role === 'BOTTOM' && sec > AR.fromSec && pos && alliesNearby === 0 && territoryOf(pos, team) === 'enemy' && (laneOf(pos) === 'TOP' || laneOf(pos) === 'BOT')) {
      const left = baseExitBefore(ts)
      if (left != null && ts - left <= (AR.walkSec + AR.withinSec) * 1000) {
        pattern = 'adc-solo-sidelane-reopen'
        const mid = allyByRole('MIDDLE')
        Object.assign(extra, { sinceBaseSec: Math.round((ts - left) / 1000), ...(mid != null && homeIn(mid, left, ts) ? { midInBase: true } : {}) })
      }
    }

    // V7 — compensation death: an ally had just fallen next to an objective (the team was in "minus"); the jungler fought on
    // outnumbered, died, and the enemy took the objective.
    const CP = S.compensation
    if (!pattern && role === 'JUNGLE' && pos) {
      const first = allyDeaths.find((e) => e.timestamp < ts && ts - e.timestamp <= CP.windowSec * 1000 && e.position && dist(e.position, pos) <= CP.allyRadius)
      const taken = objectives.find((o) => !o.ours && EPIC.includes(o.kind) && o.ts >= ts && o.ts <= ts + CP.objectiveWithinSec * 1000 &&
        dist(pos, o.pos ?? pitCenter(o.kind === 'dragon' || o.kind === 'elder' ? 'dragon' : 'baron')) <= OBJECTIVE_RADIUS)
      const alive = allies.filter((a) => !deadAt(a, ts) && within(posAt(a, ts), pos, S.death.allyRadius)).length
      if (first && taken && involved.length >= alive + CP.outnumberedBy) {
        pattern = 'jungle-compensation-death'
        Object.assign(extra, { deathGapSec: Math.round((ts - first.timestamp) / 1000), objective: taken.kind })
      }
    }

    // A death read as a Dragon tank or a compensation is not also an overchase (section 4): one death, one reading.
    if (pattern === 'jungle-dragon-tank-death' || pattern === 'jungle-compensation-death') readDeaths.add(ts)

    // The fed carry is the first to die in a teamfight that is then lost.
    if (!pattern) {
      const myGold = goldOf(fi, pid)
      const teamGold = allies.reduce((s, a) => s + goldOf(fi, a), myGold)
      const share = teamGold > 0 ? myGold / teamGold : 0
      const topGold = allies.every((a) => goldOf(fi, a) <= myGold)
      const { kda, streak } = statsBefore(ts)
      const bounty = bountyGold(streak)
      if (topGold && (bounty >= S.carry.bounty || (kda > S.carry.kda && share > S.carry.goldShare))) {
        const firstDeath = !kills.some((e) => e.timestamp >= ts - S.carry.firstDeathSec * 1000 && e.timestamp < ts)
        // Enemies present: those credited on the kill plus those alive within the fight radius.
        const enemiesPresent = new Set([...involved, ...(pos ? enemies.filter((e) => !deadAt(e, ts) && within(posAt(e, ts), pos, S.carry.fightRadius)) : [])]).size
        const until = ts + S.carry.lostWithinSec * 1000
        const alliesLost = 1 + allyDeaths.filter((e) => e.timestamp > ts && e.timestamp <= until).length
        const enemiesLost = enemyDeaths.filter((e) => e.timestamp > ts && e.timestamp <= until).length
        const objectiveLost = objectives.some((o) => !o.ours && o.ts > ts && o.ts <= until)
        if (firstDeath && enemiesPresent >= S.carry.enemies && (alliesLost > enemiesLost || objectiveLost)) {
          pattern = 'fed-carry-first'
          Object.assign(extra, { goldSharePct: Math.round(share * 100), killStreak: streak, bountyGold: bounty })
        }
      }
    }

    // Alone high on the tempo line (D > 0.65) while 3+ allies, alive, are still home (D < 0.30).
    if (!pattern && ts > S.tempoLine.fromSec * 1000 && pos) {
      const home = allies.filter((a) => {
        if (deadAt(a, ts)) return false
        const v = tempoD(posAt(a, ts))
        return v != null && v < S.tempoLine.alliesHome
      }).length
      if (tempoLineD(pos, team) > S.tempoLine.userFront && alliesNearby === 0 && home >= S.tempoLine.minAllies) {
        pattern = 'tempo-front-isolated'
        Object.assign(extra, { alliesHome: home })
      }
    }

    if (drop < S.death.wpDrop - EPS && !lost && !pattern) continue

    const pit = pos ? nearestPit(pos) : null
    const lastPlay = [...ownPlays].reverse().find((t) => t <= ts && ts - t < S.death.ownPlaySec * 1000)
    const myLevel = Number(pframe(fi, pid)?.level) || 0
    const killerLevel = killerIsChamp ? Number(pframe(fi, d.killerId)?.level) || 0 : 0
    const levelDeficit = myLevel > 0 && killerLevel > myLevel ? killerLevel - myLevel : 0
    const snapshotAgeSec = Math.round((ts - clock.ts(fi)) / 1000)
    const stats = pframe(fi, pid)?.championStats
    const hpPct = stats && Number(stats.healthMax) > 0 && snapshotAgeSec >= S.death.hpSnapshotMinAgeSec
      ? Math.round((Number(stats.health) / Number(stats.healthMax)) * 100) : null
    const alliedBaron = objectives.some((o) => o.ours && o.kind === 'baron' && o.ts <= ts && ts - o.ts <= BARON_BUFF_MS)
    const facts: MomentFacts = {
      assisters: assisters.length,
      enemiesInvolved: involved.length,
      alliesNearby,
      goldInPocket: Math.round(Number(pframe(fi, pid)?.currentGold) || 0),
      wardedLast60s: myWards.some((w) => w.ts <= ts && ts - w.ts <= S.death.wardLookbackSec * 1000),
      secondsSinceOwnPlay: lastPlay != null ? Math.round((ts - lastPlay) / 1000) : null,
      nearestPit: pit?.pit,
      pitDistance: pit ? Math.round(pit.distance) : undefined,
      nearObjective: pit ? pit.distance <= OBJECTIVE_RADIUS : false,
      objectiveLost: lost?.kind ?? null,
      objectiveLostAfterSec: lost ? Math.round((lost.ts - ts) / 1000) : null,
      ...(alliedBaron ? { alliedBaron: true } : {}),
      ...(levelDeficit > 0 ? { levelDeficit } : {}),
      ...(hpPct != null ? { hpPct, hpSnapshotAgeSec: snapshotAgeSec } : {}),
      ...(pattern ? { pattern, ...extra } : {}),
    }
    const severity = Math.max(0, drop) + (lost ? 0.08 * OBJECTIVE_WEIGHT[lost.kind] : 0) + (facts.nearObjective ? 0.05 : 0) + (pattern ? PATTERN_BONUS : 0)
    add('critical-death', ts, pos, severity, facts, after)
  }

  // ── 1b. Forced back before an objective (V6): low after a mutual trade, the player backs just before a dragon or
  // Voidgrubs spawn and the team loses the fight at that pit without them. The objective is then this story (section 2).
  const recallClaims: Array<{ pit: Pit; from: number; to: number }> = []
  {
    const R = S.tradeRecall
    const P = S.spawns
    const spawns: Array<{ ts: number; kind: 'dragon' | 'grubs' }> = [
      { ts: P.firstDragonSec * 1000, kind: 'dragon' }, { ts: P.grubsSec * 1000, kind: 'grubs' },
      ...objectives.filter((o) => o.kind === 'dragon').map((o) => ({ ts: o.ts + P.dragonRespawnSec * 1000, kind: 'dragon' as const })),
    ]
    // Whose HP makes the trade mutual: the lane opponent(s) — both enemy bot laners for the bot lane — or the enemy jungler.
    const rivalRoles = myLaneBucket === 'BOT' ? ['BOTTOM', 'UTILITY'] : role ? [role] : []
    const rivals = enemies.filter((id) => rivalRoles.includes(roleOfId(id)))
    const buys = shopsOf(pid)
    for (let k = 0; k < buys.length; k++) {
      const shop = buys[k]
      // The first purchase of a visit, alive for the minute before it (a respawn is not a back).
      if ((k > 0 && shop - buys[k - 1] < R.visitGapSec * 1000) || downIn(pid, shop - 60_000, shop)) continue
      const recall = shop - R.channelSec * 1000
      if (recall >= R.untilSec * 1000) break
      const spawn = spawns.find((s) => s.ts >= recall && s.ts - recall <= R.beforeSpawnSec * 1000)
      if (!spawn) continue
      const fi = clock.indexAt(recall)
      const at = pframe(fi, pid)?.position as Point | undefined
      const hp = hpPctOf(fi, pid)
      if (!at || zoneOf(at, team) === 'own-base' || hp == null || hp >= R.hpPct) continue
      const theirs = rivals.map((id) => hpPctOf(fi, id)).filter((v): v is number => v != null && v < R.opponentHpPct)
      if (theirs.length === 0) continue
      const pit: Pit = spawn.kind === 'dragon' ? 'dragon' : 'baron'
      const back = shop + R.returnSec * 1000
      const near = kills.filter((e) => e.timestamp >= recall && e.timestamp <= back && e.position && dist(e.position, pitCenter(pit)) < S.pit.fightRadius)
      const down = near.filter((e) => teamOf(e.victimId) === team)
      if (down.length === 0 || down.length <= near.length - down.length) continue
      const first: number = down[0].timestamp
      const before = track.before(first)
      const after = track.at(back + 60_000)
      recallClaims.push({ pit, from: recall, to: back + 60_000 })
      add('absent-objective', recall, at, 0.1 + down.length * 0.04 + (before != null && after != null ? Math.max(0, before - after) : 0), {
        pattern: 'low-hp-recall-before-objective', objective: spawn.kind, recallHpPct: hp, opponentHpPct: Math.min(...theirs),
        spawnInSec: Math.round((spawn.ts - recall) / 1000), alliesDown: down.length, nearestPit: pit,
      }, after, first)
    }
  }

  // ── 2. Enemy epic objectives: hesitation / absent ─────────────────────
  const contested: ContestedObjective[] = []
  /** Enemy epic kills this section turned into a moment (the jungle tempo window must not report them twice). */
  const claimed = new Set<number>()
  const lastEpic = new Map<string, number>()
  for (const o of objectives) {
    if (!EPIC.includes(o.kind)) continue
    // Voidgrubs come as one event per grub: one contest per pack and per side.
    const slot = `${o.kind}:${o.ours ? 'ally' : 'enemy'}`
    const previous = lastEpic.get(slot)
    if (previous != null && o.ts - previous < 60_000) continue
    lastEpic.set(slot, o.ts)
    const pitName: Pit = o.kind === 'dragon' || o.kind === 'elder' ? 'dragon' : 'baron'
    const pitPos: Point = o.pos ?? pitCenter(pitName)
    const lookback = S.absent.wardLookbackSec * 1000
    const wardsNear = myWards.filter((w) => w.ts <= o.ts && o.ts - w.ts <= lookback && w.pos != null && dist(w.pos, pitPos) <= S.absent.wardRadius).length
    const diedBefore = (sec: number) => deadAt(pid, o.ts) || myDeaths.some((d) => d.timestamp <= o.ts && o.ts - d.timestamp <= sec * 1000)
    contested.push({
      gameTimeSec: Math.round(o.ts / 1000), kind: o.kind, takenBy: o.ours ? 'ally' : 'enemy', playerWarded: wardsNear > 0,
      accountable: (visionRole || !o.ours) && !diedBefore(S.absent.deadBeforeSec) && o.ts >= S.absent.accountableFromSec * 1000 && o.kind !== 'grubs',
    })
    if (o.ours) continue

    // A forced back before this objective (section 1b) already tells the story of this fight.
    if (recallClaims.some((c) => c.pit === pitName && o.ts >= c.from && o.ts <= c.to)) {
      claimed.add(o.ts)
      continue
    }

    // Alive? A death shortly before is trigger 1's business.
    if (diedBefore(S.death.windowSec)) continue

    const before = track.before(o.ts)
    const after = track.at(o.ts + 60_000)
    const drop = before != null && after != null ? Math.max(0, before - after) : 0
    const pAtKill = posAt(pid, o.ts)

    // V7 — the jungler, alive in the pit, loses the objective to the enemy smite (it is not an absence).
    if (role === 'JUNGLE' && OUTSMITE_KINDS.includes(o.kind) && pAtKill && dist(pAtKill, pitPos) < S.outsmite.pitRadius) {
      claimed.add(o.ts)
      add('absent-objective', o.ts - 10_000, pAtKill, 0.06 * OBJECTIVE_WEIGHT[o.kind] + drop + 0.05, {
        pattern: 'jungle-outsmited', objective: o.kind, playerDistance: Math.round(dist(pAtKill, pitPos)), nearestPit: pitName, nearObjective: true,
      }, after, o.ts)
      continue
    }

    // Tempo hesitation: out of tempo at T−30 s, yet neither set up nor cross-mapped (the player lived the whole window).
    const H = S.hesitation
    if (HESITATION_KINDS.includes(o.kind) && !downIn(pid, o.ts - H.crossMapBeforeSec * 1000, o.ts)) {
      const p30 = posAt(pid, o.ts - H.notInPitSec * 1000)
      const p25 = posAt(pid, o.ts - H.moveFromSec * 1000)
      const from = o.ts - H.crossMapBeforeSec * 1000
      const to = o.ts + H.crossMapAfterSec * 1000
      // The player's own side-lane tower / plate right before the objective is greed, not a team cross-map…
      const towerGreed = events.some((e) => e.timestamp >= o.ts - H.towerGreedSec * 1000 && e.timestamp <= o.ts &&
        ((e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === pid) || (e.type === 'BUILDING_KILL' && e.teamId !== team && involves(e, pid))))
      // …a cross-map is the team taking something else (an epic monster, or a building without the player).
      const teamCrossMap = objectives.some((x) => x.ours && EPIC.includes(x.kind) && x.ts >= from && x.ts <= to) ||
        events.some((e) => e.type === 'BUILDING_KILL' && e.teamId !== team && !involves(e, pid) && e.timestamp >= from && e.timestamp <= to)
      if (p30 && p25 && pAtKill && dist(p30, pitPos) > OBJECTIVE_RADIUS && !teamCrossMap) {
        const approachedBy = dist(p25, pitPos) - dist(pAtKill, pitPos)
        // "Stays in neutral ground": in the river and off the lanes from T−25 s to T, without ever reaching the pit.
        const neutral = (p: Point | null) => p != null && territoryOf(p, team) === 'river' && laneOf(p) === 'JUNGLE'
        const idleInRiver = [p25, posAt(pid, o.ts - H.moveFromSec * 500), pAtKill].every(neutral) && dist(pAtKill, pitPos) > OBJECTIVE_RADIUS
        if (towerGreed || approachedBy >= H.approachMin || idleInRiver) {
          claimed.add(o.ts)
          add('absent-objective', o.ts - H.moveFromSec * 1000, p25, 0.06 * OBJECTIVE_WEIGHT[o.kind] + drop + 0.05, {
            objective: o.kind, pattern: 'tempo-hesitation', approachedBy: Math.round(Math.max(0, approachedBy)),
            ...(towerGreed ? { towerGreed: true } : {}),
            ...(wardsNear > 0 ? { playerWarded: true } : {}),
            playerDistance: Math.round(dist(pAtKill, pitPos)), nearestPit: pitName, nearObjective: false,
          }, after, o.ts)
          continue
        }
      }
    }

    // Absent: no ward of the player near the pit, and no cross-map trade by the team.
    if (wardsNear > 0) continue
    if (objectives.some((x) => x.ours && Math.abs(x.ts - o.ts) <= S.absent.crossMapSec * 1000)) continue
    claimed.add(o.ts)
    // Anchor the VOD on the player, 20 s before the objective falls.
    add('absent-objective', o.ts - 20_000, pAtKill, 0.06 * OBJECTIVE_WEIGHT[o.kind] + drop + 0.02, {
      objective: o.kind,
      playerDistance: pAtKill ? Math.round(dist(pAtKill, pitPos)) : null,
      wardsElsewhere: myWards.filter((w) => w.ts <= o.ts && o.ts - w.ts <= lookback).length,
      nearestPit: pitName,
      nearObjective: pAtKill ? dist(pAtKill, pitPos) <= OBJECTIVE_RADIUS : false,
    }, after, o.ts)
  }

  // ── 3a. Mid lane given away (V9): 12+ CS behind at 6:00 without 2 points in one basic spell at level 3. That is the
  // lane's CS story: the 10:00 deficit (section 3) is then not reported a second time.
  let midWaveLoss = false
  if (role === 'MIDDLE' && laneOpponent && frames.length > S.midWaveLoss.atSec / 60) {
    const k = S.midWaveLoss.atSec / 60
    const diff = csOf(k, pid) - csOf(k, laneOpponent.participantId)
    const ups = events.filter((e) => e.type === 'SKILL_LEVEL_UP' && e.participantId === pid && (e.levelUpType ?? 'NORMAL') === 'NORMAL').slice(0, 3)
    const doubled = ups.some((e, n) => ups.findIndex((x) => x.skillSlot === e.skillSlot) !== n)
    const takedowns = kills.filter((e) => e.timestamp <= k * 60_000 && involves(e, pid)).length
    if (diff <= S.midWaveLoss.csDiff && ups.length === 3 && !doubled && takedowns < S.midWaveLoss.takedowns) {
      // Same scale as the 10:00 deficit (1 CS = 0.01).
      midWaveLoss = add('early-deficit', k * 60_000, pframe(k, pid)?.position ?? null, Math.min(0.2, -diff / 100), {
        pattern: 'mid-passive-wave-loss', csDiff6: diff, opponentChampion: laneOpponent.championName ?? null,
      })
    }
  }

  // ── 3. Early deficit at 10:00 (laners with a direct opponent) ─────────
  let laneAt10: GameAnalysis['laneAt10'] = null
  const atFrame = S.early.atSec / 60
  if (laneOpponent && frames.length > atFrame) {
    const mine = pframe(atFrame, pid)
    const theirs = pframe(atFrame, laneOpponent.participantId)
    if (mine && theirs) {
      const csDiff = csOf(atFrame, pid) - csOf(atFrame, laneOpponent.participantId)
      const xpDiff = Math.round(xpOf(atFrame, pid) - xpOf(atFrame, laneOpponent.participantId))
      laneAt10 = { csDiff, xpDiff }
      const takedowns = kills.filter((e) => e.timestamp <= S.early.atSec * 1000 && involves(e, pid)).length
      if (!midWaveLoss && (csDiff < S.early.csDiff || xpDiff < S.early.xpDiff) && takedowns < S.early.takedowns) {
        const severity = Math.min(0.3, Math.abs(Math.min(0, csDiff)) / 100 + Math.abs(Math.min(0, xpDiff)) / 4000)
        add('early-deficit', S.early.atSec * 1000, mine.position ?? null, severity, {
          csDiff10: csDiff, xpDiff10: xpDiff, takedownsBefore10: takedowns, opponentChampion: laneOpponent.championName ?? null,
        })
      }
    }
  }

  // ── 3b. Cheater recall that backfired (V5, laners with a direct opponent) ──
  // A back between 2:00 and 2:40 (a purchase then) from high HP, without Teleport, then a level behind at 4:00: the opponent
  // kept the bigger wave. Riot only counts Teleport casts for the whole game, so any cast keeps the
  // detector silent.
  if (laneOpponent && frames.length > S.cheaterRecall.levelAtSec / 60) {
    const C = S.cheaterRecall
    const opp: number = laneOpponent.participantId
    const visited = visitsOf(pid).some((t) => t >= C.visitSec[0] * 1000 && t <= C.visitSec[1] * 1000)
    const atBase: Point | undefined = visited ? FOUNTAIN[team] : undefined
    const hpBefore = hpPctOf(C.hpBeforeSec / 60, pid)
    const tpSlot = [1, 2].find((k) => me[`summoner${k}Id`] === C.teleportSpellId)
    const tpCast = tpSlot != null && !(Number(me[`summoner${tpSlot}Casts`]) === 0)
    const behind = levelOf(C.levelAtSec / 60, opp) - levelOf(C.levelAtSec / 60, pid)
    if (atBase && hpBefore != null && hpBefore > C.hpPct && !tpCast &&
        behind >= C.levelDeficit && !downIn(pid, C.hpBeforeSec * 1000, C.levelAtSec * 1000)) {
      add('early-deficit', C.anchorSec * 1000, atBase, 0.12 + Math.min(0.08, behind * 0.04), {
        pattern: 'cheater-recall', recallHpPct: hpBefore, levelsBehind: behind, opponentChampion: laneOpponent.championName ?? null,
      })
    }
  }

  // ── 3c. Support without a ward of their own by 1:10 (V6) — unless the level-2 fight already made the point ──
  if (role === 'UTILITY' && !supportLevel2Death && frames.length > 2) {
    const by = S.supportEarly.wardBySec * 1000
    if (!myWards.some((w) => w.ts <= by) && !downIn(pid, 0, by)) add('early-deficit', by, posAt(pid, by), 0.06, { pattern: 'support-no-early-ward' })
  }

  // ── 3d. Engage support (V10): glued to the ADC after level 6, missing at the first Scuttle Crab, weak side unwarded ──
  if (role === 'UTILITY') {
    const adc = allyByRole('BOTTOM')
    const jg = allyByRole('JUNGLE')
    const L = S.supportLeech
    if (adc != null && clock.last >= L.untilSec / 60 && levelOf(L.fromSec / 60, pid) >= L.level) {
      let near = 0
      for (let k = L.fromSec / 60; k <= L.untilSec / 60; k++) {
        const a = pframe(k, pid)?.position as Point | undefined
        const b = pframe(k, adc)?.position as Point | undefined
        if (a && b && dist(a, b) <= L.radius && laneOf(a) === 'BOT') near++
      }
      const teamKills = kills.filter((e) => e.timestamp <= L.untilSec * 1000 && teamOf(e.killerId) === team).length
      const kp = teamKills > 0 ? kills.filter((e) => e.timestamp <= L.untilSec * 1000 && involves(e, pid)).length / teamKills : 0
      if (near >= L.snapshots && kp < L.kp) {
        add('early-deficit', L.fromSec * 1000, pframe(L.fromSec / 60, pid)?.position ?? null, 0.08, { pattern: 'support-botlane-leech', laneSnapshots: near, kpPct: Math.round(kp * 100) })
      }
    }

    // Our jungler dead in the bot river 2:50–3:15 while the support stood more than 2000 away, without a takedown around it.
    const SC = S.supportScuttle
    const fall = jg != null ? kills.find((e) => e.victimId === jg && e.timestamp >= SC.fromSec * 1000 && e.timestamp <= SC.untilSec * 1000 && e.position && zoneOf(e.position, team) === 'bot-river') : undefined
    const here = fall && !deadAt(pid, fall.timestamp) ? posAt(pid, fall.timestamp) : null
    if (fall && here && dist(here, fall.position) > SC.radius && !takedownIn(fall.timestamp - 10_000, fall.timestamp + 10_000)) {
      const at = fall.timestamp - 10_000
      const before = track.before(fall.timestamp)
      const after = track.at(fall.timestamp + 60_000)
      add('absent-objective', at, posAt(pid, at), 0.1 + (before != null && after != null ? Math.max(0, before - after) : 0), {
        pattern: 'support-absent-scuttle', playerDistance: Math.round(dist(here, fall.position)),
      }, after, fall.timestamp)
    }

    // Our bot-side camps stolen while our jungler played top side, with no ward of the support in our bot-side jungle in the 120 s before.
    const CS = S.campsStolen
    for (const s of steals) {
      if (s.side !== 'bot' || s.k * 60 >= CS.supportUntilSec || jg == null) continue
      if (![pframe(s.k, jg)?.position, pframe(s.k + 1, jg)?.position].some((p) => p != null && sideOf(p) === 'top')) continue
      const from = s.k * 60_000 - CS.wardLookbackSec * 1000
      const warded = myWards.some((w) => w.ts >= from && w.ts <= (s.k + 1) * 60_000 && w.pos != null &&
        territoryOf(w.pos, team) === 'own' && laneOf(w.pos) === 'JUNGLE' && sideOf(w.pos) === 'bot')
      if (!warded && add('early-deficit', s.k * 60_000, pframe(s.k, pid)?.position ?? null, 0.1, { pattern: 'support-weakside-unwarded', campsStolenCs: s.cs })) break
    }
  }

  // ── 4. Jungle (1:55–8:00): overchase, passive clear, counter-tempo ────
  if (role === 'JUNGLE') {
    const J = S.jungle
    const xpDiffAt = (i: number): number | null => {
      if (enemyJungler == null || i >= frames.length) return null
      const a = pframe(i, pid)
      const b = pframe(i, enemyJungler)
      return a && b ? (Number(a.xp) || 0) - (Number(b.xp) || 0) : null
    }
    const camps = (i: number) => Number(pframe(i, pid)?.jungleMinionsKilled) || 0
    const away = (p: Point | null | undefined): p is Point => p != null && territoryOf(p, team) !== 'own'
    const jungle = (ms: number, pos: Point | null, pattern: MomentPattern, severity: number, facts: MomentFacts) =>
      add('early-deficit', ms, pos, severity, { pattern, ...facts })

    // A — overchase ending in a death: the 20 s before it across the river or in the enemy jungle, with no takedown and no camp…
    let chased = false
    for (const d of myDeaths) {
      if (readDeaths.has(d.timestamp) || !isOverchaseDeath(d)) continue
      const ts: number = d.timestamp
      const start = ts - J.overchaseSec * 1000
      chased = true
      jungle(start, posAt(pid, start), 'jungle-overchase', 0.22, { xpDiffJungle: xpDiffAt(clock.indexAt(ts) + 1) ?? undefined })
    }
    // …or in the XP lead over the enemy jungler lost on the next frame (alive all along: a death is case A's business).
    if (!chased) {
      for (let k = Math.ceil(J.fromSec / 60); (k + 1) * 60 <= J.toSec && k + 1 < frames.length; k++) {
        const here = xpDiffAt(k)
        const next = xpDiffAt(k + 1)
        if (here == null || next == null || here <= 0 || next >= 0) continue
        const p = posAt(pid, k * 60_000)
        if (!away(p) || downIn(pid, k * 60_000, (k + 1) * 60_000)) continue
        if (takedownIn(k * 60_000, (k + 1) * 60_000) || camps(k + 1) > camps(k)) continue
        jungle(k * 60_000, p, 'jungle-overchase', 0.18, { xpDiffJungle: next })
        chased = true
        break
      }
    }

    // Passive full clear while bot (and mid) had priority: the 3-camp invade was there.
    const laneLead = (pos: string, i: number) => parts.filter((p) => positionOf(p) === pos)
      .reduce((s, p) => s + (p.teamId === team ? 1 : -1) * goldOf(i, p.participantId), 0)
    const botLead = laneLead('BOTTOM', 3) + laneLead('UTILITY', 3)
    const midLead = laneLead('MIDDLE', 3)
    const stayedHome = J.homeSamplesSec.every((s) => { const p = posAt(pid, s * 1000); return p != null && territoryOf(p, team) === 'own' })
    const xp6 = xpDiffAt(6)
    if (!chased && botLead >= J.passiveBotLead && midLead >= 0 && stayedHome && !takedownIn(0, J.quietUntilSec * 1000) && xp6 != null && xp6 <= 0) {
      jungle(J.passiveAtSec * 1000, posAt(pid, J.passiveAtSec * 1000), 'jungle-passive-clear', 0.12, { botGoldLead: Math.round(botLead), xpDiffJungle: xp6 })
    }

    // B — counter-tempo: a river play around 2:40–3:40, then back to the starting quadrant, behind in XP at 6:00.
    const start = posAt(pid, J.startAtSec * 1000)
    const riverSamples = Array.from({ length: (J.riverPlaySec[1] - J.riverPlaySec[0]) / 15 + 1 }, (_, n) => J.riverPlaySec[0] + n * 15)
    const riverPlay = riverSamples.map((s) => posAt(pid, s * 1000)).some((p) => p != null && territoryOf(p, team) === 'river')
    const back = posAt(pid, J.backAtSec * 1000)
    if (start && riverPlay && back && territoryOf(start, team) === 'own' && territoryOf(back, team) === 'own' &&
        (start.y > start.x) === (back.y > back.x) && xp6 != null && xp6 < -J.counterTempoXp) {
      jungle(J.counterTempoAtSec * 1000, back, 'jungle-counter-tempo', 0.15 + Math.min(0.1, -xp6 / 4000), { xpDiffJungle: xp6 })
    }

    // Tempo window not punished (1:55–12:00): the enemy jungler shows far away, nothing is taken in the next 45 s.
    if (enemyJungler != null) {
      const W = S.tempoWindow
      for (const e of events) {
        if (e.timestamp < W.fromSec * 1000) continue
        if (e.timestamp >= W.untilSec * 1000) break
        const shows = (e.type === 'CHAMPION_KILL' || e.type === 'ELITE_MONSTER_KILL') && involves(e, enemyJungler)
        if (!shows || !e.position) continue
        // An enemy epic that trigger 2 already reports is one moment, not two.
        if (e.type === 'ELITE_MONSTER_KILL' && claimed.has(e.timestamp)) continue
        const end = e.timestamp + W.windowSec * 1000
        // Dead, or barely out of the fountain: there was no window to use.
        if (downIn(pid, e.timestamp, end, W.respawnGraceSec * 1000)) continue
        const mine = posAt(pid, e.timestamp)
        if (!mine || dist(mine, e.position) <= W.distance) continue
        const cashed = events.some((x) => x.timestamp > e.timestamp && x.timestamp <= end && (
          ((x.type === 'CHAMPION_KILL' || x.type === 'BUILDING_KILL' || x.type === 'ELITE_MONSTER_KILL') && involves(x, pid)) ||
          (x.type === 'ELITE_MONSTER_KILL' && (x.killerTeamId ?? teamOf(x.killerId)) === team && within(posAt(pid, x.timestamp), x.position ?? mine, 3000)) ||
          (x.type === 'TURRET_PLATE_DESTROYED' && x.killerId === pid)))
        const stayedOwnSide = [0, 1 / 3, 2 / 3, 1].every((k) => { const p = posAt(pid, e.timestamp + k * W.windowSec * 1000); return p != null && territoryOf(p, team) === 'own' })
        if (cashed || !stayedOwnSide) continue
        if (jungle(e.timestamp, mine, 'jungle-window-unpunished', 0.14, { playerDistance: Math.round(dist(mine, e.position)) })) break
      }
    }

    // V7 — still on the map at 3:30 (1st camp back up): no back after 1:00, no takedown, no death. A timeline without any
    // purchase of the player (real games always log the starting items) cannot tell a back: silent then.
    const FB = S.jungleFirstBack
    const firstBack = shopsOf(pid).find((t) => t > FB.startSec * 1000) ?? null
    if (shopsOf(pid).length > 0 && (firstBack == null || firstBack > FB.bySec * 1000) && clock.last * 60 > FB.bySec &&
        !takedownIn(0, FB.bySec * 1000) && !myDeaths.some((d) => d.timestamp <= FB.bySec * 1000)) {
      jungle(FB.bySec * 1000, posAt(pid, FB.bySec * 1000), 'jungle-late-first-recall', 0.07, { firstBackSec: firstBack != null ? Math.round(firstBack / 1000) : null })
    }

    // V8.2 — boots bought before 8:00 without a kill (the shop proves the fountain).
    const EB = S.earlyBoots
    const boots = events.find((e) => e.type === 'ITEM_PURCHASED' && e.participantId === pid && e.itemId === EB.itemId && e.timestamp < EB.untilSec * 1000)
    if (boots && !kills.some((e) => e.killerId === pid && e.timestamp <= boots.timestamp)) {
      jungle(boots.timestamp, FOUNTAIN[team], 'jungle-early-boots', 0.06, { bootsSec: Math.round(boots.timestamp / 1000) })
    }

    // V7 — a gank that cost the camps (2:00–12:00): in a lane next to an enemy on a snapshot, no takedown and no death in the
    // minute that follows, and 8+ jungle CS lost on the enemy jungler meanwhile.
    const GK = S.gankCost
    if (enemyJungler != null) {
      for (let k = GK.fromSec / 60; k * 60 < GK.untilSec && k + 1 <= clock.last; k++) {
        const t0 = k * 60_000
        const here = pframe(k, pid)?.position as Point | undefined
        if (!here || laneOf(here) === 'JUNGLE' || zoneOf(here, team) === 'own-base' || zoneOf(here, team) === 'enemy-base') continue
        if (!enemies.some((e) => !deadAt(e, t0) && within(pframe(k, e)?.position, here, GK.enemyRadius))) continue
        if (takedownIn(t0, t0 + 60_000) || deadAt(pid, t0) || downIn(pid, t0, t0 + 60_000)) continue
        const lost = (jungleCsOf(k + 1, enemyJungler) - jungleCsOf(k, enemyJungler)) - (jungleCsOf(k + 1, pid) - jungleCsOf(k, pid))
        if (lost < GK.cs) continue
        if (jungle(t0, here, 'jungle-camps-up-gank', 0.1 + Math.min(0.06, (lost - GK.cs) / 100), { jungleCsLost: lost })) break
      }
    }

    // V7 — the weak side left behind (before 16:00): our camps stolen (`steals`: proven by two snapshots) right after a back
    // — a purchase, starting items aside, from the minute before to the end of that minute — while the player, alive, is on
    // the other side of the map.
    const CS = S.campsStolen
    for (const s of steals) {
      const t0 = s.k * 60_000
      if (t0 >= CS.weakSideUntilSec * 1000) break
      const next = pframe(s.k + 1, pid)?.position as Point | undefined
      const backed = shopsOf(pid).some((t) => t > S.jungleFirstBack.startSec * 1000 && t >= t0 - 60_000 && t <= t0 + 60_000)
      if (!backed || next == null || sideOf(next) === s.side || downIn(pid, t0, t0 + 60_000)) continue
      if (jungle(t0, next, 'jungle-weakside-stolen', 0.1 + Math.min(0.06, (s.cs - CS.cs) / 100), { campsStolenCs: s.cs })) break
    }

    // V8 — fled an invade at very low HP (before 15:00), leaving the camp to an enemy jungler still healthy, an ally close by.
    const FL = S.fledInvade
    if (enemyJungler != null) {
      for (let k = 1; k * 60 < FL.untilSec && k + 1 <= clock.last; k++) {
        const mine = pframe(k, pid)?.position as Point | undefined
        const theirs = pframe(k, enemyJungler)?.position as Point | undefined
        const hp = hpPctOf(k, pid)
        const theirHp = hpPctOf(k, enemyJungler)
        if (!mine || !theirs || hp == null || theirHp == null || hp >= FL.hpPct || theirHp <= FL.enemyHpPct) continue
        if (territoryOf(mine, team) !== 'own' || laneOf(mine) !== 'JUNGLE' || dist(mine, theirs) > FL.radius) continue
        if (deadAt(pid, k * 60_000) || downIn(pid, k * 60_000, k * 60_000 + FL.aliveSec * 1000)) continue
        if (!allies.some((a) => !deadAt(a, k * 60_000) && within(pframe(k, a)?.position, mine, FL.radius))) continue
        if (jungleCsOf(k + 1, enemyJungler) - jungleCsOf(k, enemyJungler) < FL.campCs) continue
        if (jungle(k * 60_000, mine, 'jungle-fled-invade', 0.1, { hpPct: hp, opponentHpPct: theirHp })) break
      }
    }

    // V8.2 — an enemy side-lane T1 last-hit before 20:00 although a tower had already fallen (leave it at 1 HP).
    const ST = S.sideTower
    const firstTower = events.find((e) => e.type === 'BUILDING_KILL' && e.buildingType === 'TOWER_BUILDING')
    const t1 = firstTower && events.find((e) => e.type === 'BUILDING_KILL' && e.towerType === 'OUTER_TURRET' && e.teamId !== team && e.killerId === pid &&
      (e.laneType === 'TOP_LANE' || e.laneType === 'BOT_LANE') && e.timestamp > ST.fromSec * 1000 && e.timestamp <= ST.untilSec * 1000 && e.timestamp > firstTower.timestamp)
    if (t1) jungle(t1.timestamp, (t1.position as Point | undefined) ?? posAt(pid, t1.timestamp), 'jungle-side-t1-destroyed', 0.07, { turretLane: t1.laneType === 'TOP_LANE' ? 'TOP' : 'BOT' })
  }

  // ── 4b. Ahead jungler away during the Baron buff while the team fights forward (V6) — claims that fight (section 5) ──
  const claimedFights = new Set<number>()
  if (role === 'JUNGLE') {
    const B = S.baronRecall
    for (const baron of objectives.filter((o) => o.ours && o.kind === 'baron')) {
      const end = baron.ts + BARON_BUFF_MS
      const bi = clock.indexAt(baron.ts)
      const spent = goldOf(bi, pid) - (Number(pframe(bi, pid)?.currentGold) || 0)
      if (!(statsBefore(baron.ts).kda > B.kda || spent >= B.goldSpent)) continue
      for (const d0 of allyDeaths) {
        const t0: number = d0.timestamp
        if (t0 <= baron.ts || t0 > end) continue
        const until = t0 + B.fightWindowSec * 1000
        // The fight: 2+ allies dead in the enemy half within 30 s, more than the enemy lost, with 3+ allies forward when it broke out.
        const fight = allyDeaths.filter((e) => e.timestamp >= t0 && e.timestamp <= until && e.position && territoryOf(e.position, team) === 'enemy')
        if (fight.length < B.alliesDown || fight.length <= enemyDeaths.filter((e) => e.timestamp >= t0 && e.timestamp <= until).length) continue
        const forward = allies.filter((a) => {
          const p = deadAt(a, t0 - 1000) ? null : posAt(a, t0 - 1000)
          return p != null && territoryOf(p, team) === 'enemy'
        }).length
        if (forward < B.alliesForward) continue
        // The jungler: alive, not in the fight, and in base (a purchase around it) or clearing their own jungle away from it.
        if (deadAt(pid, t0) || kills.some((e) => e.timestamp >= t0 && e.timestamp <= until && involves(e, pid))) continue
        const recalled = shopsOf(pid).find((t) => t >= t0 - B.awayBeforeSec * 1000 && t <= t0 + B.awayAfterSec * 1000)
        const here = posAt(pid, t0)
        const k = clock.indexAt(t0)
        const farming = here != null && territoryOf(here, team) === 'own' && laneOf(here) === 'JUNGLE' &&
          (Number(pframe(k + 1, pid)?.jungleMinionsKilled) || 0) > (Number(pframe(k, pid)?.jungleMinionsKilled) || 0) &&
          !fight.some((e) => within(here, e.position, ALLY_RADIUS))
        if (recalled == null && !farming) continue
        const anchor = recalled != null ? Math.max(baron.ts, recalled - S.tradeRecall.channelSec * 1000) : Math.max(baron.ts, t0 - 15_000)
        for (const e of fight) claimedFights.add(e.timestamp)
        const before = track.before(t0)
        const after = track.at(t0 + 60_000)
        add('absent-objective', anchor, posAt(pid, anchor), 0.12 + fight.length * 0.04 + (before != null && after != null ? Math.max(0, before - after) : 0), {
          pattern: 'jungle-baron-recall', alliesDown: fight.length, alliedBaron: true,
          goldInPocket: Math.round(Number(snapshotAt(pid, anchor)?.currentGold) || 0),
        }, after, t0)
        break
      }
    }
  }

  // ── 5. Tempo line (> 15 min): the forward group dies while the player recalled late ──
  {
    const T = S.tempoLine
    let lastFight = -Infinity
    for (const d0 of allyDeaths) {
      const ts: number = d0.timestamp
      if (ts <= T.fromSec * 1000 || ts - lastFight < T.fightWindowSec * 1000) continue
      const high = allyDeaths.filter((e) => e.timestamp >= ts && e.timestamp <= ts + T.fightWindowSec * 1000 &&
        e.position && tempoLineD(e.position, team) > T.alliesHigh)
      if (high.length < T.minAllies) continue
      // The jungler's Baron recall (section 4b) already reports this fight.
      if (high.some((e) => claimedFights.has(e.timestamp))) continue
      lastFight = ts
      const at = ts - T.goldLookbackSec * 1000
      const dNow = tempoD(posAt(pid, ts))
      const dBefore = tempoD(posAt(pid, at))
      const goldBefore = Number(snapshotAt(pid, at)?.currentGold) || 0
      // In base because of a recall, not of a death: alive for the whole minute before and during the fight.
      const died = downIn(pid, ts - T.aliveBeforeSec * 1000, ts + T.fightWindowSec * 1000)
      if (dNow == null || dBefore == null || dNow >= T.userBase || dBefore < T.userBase || goldBefore <= T.goldBefore || died) continue
      const before = track.before(ts)
      const after = track.at(ts + 60_000)
      add('absent-objective', at, posAt(pid, at), 0.1 + high.length * 0.04 + (before != null && after != null ? Math.max(0, before - after) : 0),
        { pattern: 'tempo-late-recall', alliesHigh: high.length, goldInPocket: Math.round(goldBefore) }, after, ts)
    }
  }

  // ── 6. Roams (a mid roam that costs plates: < 20 min; then any lane rotation that costs waves, < 14 min) ──
  if (laneOpponent) {
    const opp: number = laneOpponent.participantId
    const csGap = (i: number) => csOf(i, pid) - csOf(i, opp)
    const xpGap = (i: number) => xpOf(i, pid) - xpOf(i, opp)
    const roamFrames = new Set<number>()
    /** The player left the lane alive at minute k — not walking back from a death. */
    const leftAlive = (k: number) => !myDeaths.some((d) => d.timestamp >= k * 60_000 - S.rotation.deathGuardSec * 1000 && d.timestamp <= k * 60_000 + 20_000)

    if (role === 'MIDDLE') {
      const ourMidPlates = events.filter((e) => {
        if (e.type !== 'TURRET_PLATE_DESTROYED') return false
        if (e.position) return dist(e.position, MID_OUTER_TURRET[team]) < 1500
        return e.laneType === 'MID_LANE' && typeof e.killerId === 'number' && e.killerId > 0 && teamOf(e.killerId) !== team
      })
      for (let k = 2; k * 60 < S.midRoam.untilSec && k + 2 < frames.length; k++) {
        const p0 = posAt(pid, k * 60_000)
        const p1 = posAt(pid, (k + 1) * 60_000)
        if (!p0 || !p1 || zoneOf(p0, team) !== 'mid-lane' || !leftAlive(k)) continue
        const z1 = zoneOf(p1, team)
        if (z1 === 'mid-lane' || z1 === 'own-base' || z1 === 'enemy-base') continue
        // A real excursion toward a side lane — not a step into the brush next to the lane.
        if (Math.abs(p1.x - p1.y) < S.midRoam.minOffAxis) continue
        const from = k * 60_000
        const to = (k + 2) * 60_000
        if (takedownIn(from, to)) continue
        const platesLost = ourMidPlates.filter((e) => e.timestamp >= from && e.timestamp <= to).length
        const csLost = csGap(k) - csGap(k + 2)
        if (platesLost < S.midRoam.plates || csLost < S.midRoam.cs) continue
        const t0 = from + 30_000
        roamFrames.add(k)
        const added = add('early-deficit', t0, posAt(pid, t0), 0.14 + Math.min(0.12, platesLost * 0.04 + csLost / 200), {
          pattern: 'mid-roam-plates', platesLost, csLost, xpLost: Math.round(xpGap(k) - xpGap(k + 2)), roamSide: p1.y > p1.x ? 'top' : 'bot',
          ...(objectives.some((o) => !o.ours && o.kind === 'grubs' && o.ts <= to) ? { enemyGrubs: true } : {}),
        })
        if (added) break
      }
    }

    const myLane: LaneBucket = role === 'TOP' ? 'TOP' : role === 'MIDDLE' ? 'MID' : 'BOT'
    const R = S.rotation
    const offLane = (p: Point | null) => p != null && laneOf(p) === 'JUNGLE' && zoneOf(p, team) !== 'own-base'
    for (let k = 2; k * 60 < R.untilSec && k + 2 < frames.length; k++) {
      if (roamFrames.has(k)) continue
      const atLane = posAt(pid, k * 60_000)
      if (!atLane || laneOf(atLane) !== myLane || zoneOf(atLane, team) === 'own-base' || !leftAlive(k)) continue
      // Off lane, in the river / jungle, at two points 30 s apart — and still off lane at the next snapshot:
      // two interpolated points alone would also "leave" an L-shaped side lane by cutting its corner.
      const t0 = k * 60_000 + 20_000
      if (![t0, t0 + R.awaySec * 1000, (k + 1) * 60_000].every((ms) => offLane(posAt(pid, ms)))) continue
      if (takedownIn(k * 60_000, (k + 2) * 60_000)) continue
      const csLost = csGap(k) - csGap(k + 2)
      const xpLost = Math.round(xpGap(k) - xpGap(k + 2))
      if (csLost <= R.cs || xpLost <= R.xp) continue
      if (add('early-deficit', t0, posAt(pid, t0), 0.1 + Math.min(0.15, csLost / 100), { pattern: 'bad-rotation', csLost, xpLost })) break
    }
  }

  // ── 7. Pit fights the zoner survived: in the pit instead of on a choke point, fight lost ──
  if (isZoner) {
    for (const f of pitFights) {
      if (myDeaths.some((d) => pitFightOf(d) === f)) continue // died in it: handled as a critical death
      const objectiveLost = objectives.some((o) => !o.ours && EPIC.includes(o.kind) && o.ts >= f.start && o.ts <= f.end + 60_000)
      if (f.allyDeaths <= f.enemyDeaths && !objectiveLost) continue
      if (!insidePitBefore(f)) continue
      const at = f.start - S.pit.beforeSec * 1000
      const pos = posAt(pid, at)
      add('absent-objective', at, pos, 0.12 + f.allyDeaths * 0.03 + (objectiveLost ? 0.08 : 0), {
        pattern: 'pit-chokepoint', alliesDown: f.allyDeaths, nearestPit: f.pit,
        pitDistance: pos ? Math.round(dist(pos, pitCenter(f.pit))) : undefined, nearObjective: true,
      }, track.at(f.start + 60_000), f.start)
    }
  }

  return {
    participantId: pid,
    teamId: team,
    champion: me.championName ?? '',
    position: role,
    winProb: track.curve,
    moments: pickMoments(candidates),
    contested,
    garbageDiscarded,
    laneAt10,
  }
}

/** The costliest moments, at least 25 s apart, then in game order. */
export function pickMoments(candidates: CriticalMoment[], max: number = MAX_MOMENTS): CriticalMoment[] {
  const kept: CriticalMoment[] = []
  for (const c of [...candidates].sort((a, b) => b.severity - a.severity || a.gameTimeSec - b.gameTimeSec)) {
    if (kept.some((k) => Math.abs(k.gameTimeSec - c.gameTimeSec) < DETECTOR_SPEC.minSpacingSec)) continue
    kept.push(c)
    if (kept.length >= max) break
  }
  return kept.sort((a, b) => a.gameTimeSec - b.gameTimeSec)
}
