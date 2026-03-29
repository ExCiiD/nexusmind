import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ── helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── data constants ────────────────────────────────────────────────────────────

const CHAMPIONS = [
  'Jinx', 'Caitlyn', 'Ahri', 'Zed', 'Thresh', 'Lux', 'Yasuo', 'Vi',
  'Jhin', 'Nautilus', 'Orianna', 'Syndra', 'Kaisa', 'Ezreal', 'Leona',
  'Akali', 'Lee Sin', 'Graves', 'Vayne', 'Twisted Fate',
]
const ROLES = ['TOP', 'JUNGLE', 'MID', 'BOT', 'SUPPORT']

const FUNDAMENTALS = [
  'wave_management', 'vision_control', 'trading_combat',
  'map_movements', 'objective_control', 'team_coordination',
  'mental_decisions', 'champion_mastery', 'resource_management', 'laning_phase',
]

const TIMELINE_EXAMPLES = [
  [{ time: '3:20', note: 'Missed 4 CS in a row under pressure' }, { time: '7:45', note: 'Good freeze maintained for 2 full waves' }, { time: '12:30', note: 'Overextended and got dove — should have reset' }],
  [{ time: '2:00', note: 'Lost 3v1 bush control at level 1' }, { time: '5:15', note: 'Hit 40 CS@5 — improving' }, { time: '9:00', note: 'Roamed mid after crash, secured kill' }],
  [{ time: '4:10', note: 'Traded badly into their power spike at level 6' }, { time: '8:30', note: 'Vision score 0 before 10 min — forgot wards' }, { time: '15:00', note: 'Baron call was wrong, team disengaged' }],
  [{ time: '1:30', note: 'Positive level 2 trade, zoned them off wave' }, { time: '6:45', note: 'Placed control ward in pixel bush before drag' }, { time: '11:20', note: 'TP flanked correctly for a 5-man stun' }],
  [{ time: '3:00', note: 'Died to cheese — need to track jungler at start' }, { time: '10:00', note: 'Mana wasted on poke when I needed it for all-in' }, { time: '18:45', note: 'Correct split push decision — they had to answer' }],
]

const FREE_TEXT_EXAMPLES = [
  'Overall decent game. My early wave management was much better but I still need to practice freezing under pressure when the jungler is near.',
  'Lost the early game but managed to scale. Need to remember to buy control wards every back — I went 3 backs without buying one.',
  'Felt really tilted after the first death and made poor decisions. Need to reset mentally between fights.',
  'Good objective control this game. Warded baron 2 minutes early and we stole it successfully.',
  'My mechanics felt off today. Missed 3 skill shots that would have turned fights. Need to warm up more.',
  'Excellent roam timing — wave was crashing and I had 4 seconds to impact mid before they pushed. Got assist and back in time.',
  null,
]

const AI_SUMMARIES = [
  'Your wave management showed clear improvement in the early phase — the freeze at 7 minutes was textbook. However, you repeatedly overextended when the objective was already secured, costing HP and reset timing. Focus on identifying "safe to reset" windows during your next session.',
  'Good defensive awareness in lane but your roam decision-making needs work. The roam at 9 minutes came without crashing the wave first, trading a potential 20 CS for an uncertain kill. Ensure your wave state is favorable before leaving lane.',
  'Solid vision control with an above-average vision score. Your habit of placing wards before objective spawns (2-minute pre-ward) is developing well. The main gap is reactive sweeping — you left the enemy trinket active in river for 4 minutes.',
  'Your trading patterns showed good level 1-3 aggression but fell off after their first item spike. Identify your power spikes vs theirs before each fight and only commit to trades where you have the advantage.',
  null,
]

// ── seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding NexusMind database...')

  // Wipe existing data
  await prisma.badge.deleteMany()
  await prisma.review.deleteMany()
  await prisma.game.deleteMany()
  await prisma.session.deleteMany()
  await prisma.assessmentScore.deleteMany()
  await prisma.assessment.deleteMany()
  await prisma.user.deleteMany()

  console.log('  ✓ Cleared existing data')

  // ── User ─────────────────────────────────────────────────────────────────

  const user = await prisma.user.create({
    data: {
      summonerName: 'NexusMind',
      tagLine: 'DEV',
      puuid: 'dev-puuid-nexusmind-seed-001',
      region: 'EUW1',
      xp: 2850,
      streakDays: 5,
      lastActiveDate: daysAgo(0),
      assessmentFreqDays: 14,
      nextAssessmentAt: daysAgo(-7), // 7 days in the future
      createdAt: daysAgo(60),
    },
  })

  console.log(`  ✓ Created user: ${user.summonerName}#${user.tagLine}`)

  // ── Assessments ───────────────────────────────────────────────────────────

  // Assessment 1 — 50 days ago (baseline)
  const baseScores: Record<string, number> = {
    wave_management: 2, vision_control: 2, trading_combat: 3,
    map_movements: 2, objective_control: 2, team_coordination: 3,
    mental_decisions: 2, champion_mastery: 3, resource_management: 2, laning_phase: 2,
  }

  const assessment1 = await prisma.assessment.create({
    data: {
      userId: user.id,
      createdAt: daysAgo(50),
      scores: {
        create: Object.entries(baseScores).map(([fundamentalId, score]) => ({
          fundamentalId, score,
        })),
      },
    },
  })

  // Assessment 2 — 25 days ago (improvement)
  const midScores: Record<string, number> = {
    wave_management: 3, vision_control: 2, trading_combat: 3,
    map_movements: 3, objective_control: 3, team_coordination: 3,
    mental_decisions: 2, champion_mastery: 3, resource_management: 3, laning_phase: 3,
  }

  const assessment2 = await prisma.assessment.create({
    data: {
      userId: user.id,
      createdAt: daysAgo(25),
      scores: {
        create: Object.entries(midScores).map(([fundamentalId, score]) => ({
          fundamentalId, score,
        })),
      },
    },
  })

  // Assessment 3 — 5 days ago (recent)
  const recentScores: Record<string, number> = {
    wave_management: 4, vision_control: 3, trading_combat: 4,
    map_movements: 3, objective_control: 3, team_coordination: 4,
    mental_decisions: 3, champion_mastery: 4, resource_management: 3, laning_phase: 4,
  }

  const assessment3 = await prisma.assessment.create({
    data: {
      userId: user.id,
      createdAt: daysAgo(5),
      scores: {
        create: Object.entries(recentScores).map(([fundamentalId, score]) => ({
          fundamentalId, score,
        })),
      },
    },
  })

  // Update nextAssessmentAt after assessment3
  await prisma.user.update({
    where: { id: user.id },
    data: { nextAssessmentAt: daysAgo(-9) }, // 9 days in future
  })

  console.log(`  ✓ Created 3 assessments (days -50, -25, -5)`)

  // ── Sessions + Games + Reviews ────────────────────────────────────────────

  const sessionConfigs = [
    // Completed sessions
    { daysBack: 48, objective: 'wave_management', gamesCount: 3, status: 'completed' },
    { daysBack: 44, objective: 'wave_management', gamesCount: 4, status: 'completed' },
    { daysBack: 40, objective: 'vision_control', gamesCount: 3, status: 'completed' },
    { daysBack: 36, objective: 'trading_combat', gamesCount: 5, status: 'completed' },
    { daysBack: 30, objective: 'map_movements', gamesCount: 3, status: 'completed' },
    { daysBack: 26, objective: 'objective_control', gamesCount: 4, status: 'completed' },
    { daysBack: 22, objective: 'wave_management', gamesCount: 4, status: 'completed' },
    { daysBack: 18, objective: 'champion_mastery', gamesCount: 3, status: 'completed' },
    { daysBack: 12, objective: 'laning_phase', gamesCount: 5, status: 'completed' },
    { daysBack: 8, objective: 'vision_control', gamesCount: 4, status: 'completed' },
    { daysBack: 4, objective: 'trading_combat', gamesCount: 3, status: 'completed' },
    // Active session
    { daysBack: 1, objective: 'wave_management', gamesCount: 2, status: 'active' },
  ]

  let totalGames = 0
  let totalReviews = 0
  let objectiveRespectedCount = 0

  for (let si = 0; si < sessionConfigs.length; si++) {
    const cfg = sessionConfigs[si]
    const sessionDate = daysAgo(cfg.daysBack)

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        objectiveId: cfg.objective,
        status: cfg.status,
        date: sessionDate,
        aiSummary: cfg.status === 'completed' ? pick([...AI_SUMMARIES.filter(Boolean) as string[], null]) : null,
      },
    })

    for (let gi = 0; gi < cfg.gamesCount; gi++) {
      const hoursOffset = gi * 90 // ~90 minutes per game
      const gameEnd = new Date(sessionDate.getTime() + hoursOffset * 60 * 1000)
      const win = Math.random() > 0.45
      const deaths = rand(0, 8)
      const kills = rand(0, 12)
      const assists = rand(0, 15)
      const duration = rand(20 * 60, 45 * 60)

      const game = await prisma.game.create({
        data: {
          sessionId: session.id,
          matchId: `SEED-EUW1-${Date.now()}-${si}-${gi}`,
          champion: pick(CHAMPIONS),
          role: pick(ROLES),
          kills, deaths, assists,
          cs: rand(120, 280),
          visionScore: rand(15, 55),
          duration,
          win,
          gameEndAt: gameEnd,
        },
      })

      totalGames++

      // Reviews: always for completed sessions, skip one per session to add variety
      const skipReview = cfg.status === 'completed' && gi === cfg.gamesCount - 1 && Math.random() > 0.7
      if (!skipReview && cfg.status === 'completed') {
        const objectiveRespected = Math.random() > 0.35
        if (objectiveRespected) objectiveRespectedCount++

        const kpiScores: Record<string, number> = {}
        const kpiKeys = ['cs_efficiency', 'trade_efficiency', 'objective_participation', 'vision_coverage', 'positioning']
        for (const k of kpiKeys) kpiScores[k] = rand(2, 5)

        await prisma.review.create({
          data: {
            gameId: game.id,
            timelineNotes: JSON.stringify(pick(TIMELINE_EXAMPLES)),
            kpiScores: JSON.stringify(kpiScores),
            freeText: pick(FREE_TEXT_EXAMPLES),
            aiSummary: pick(AI_SUMMARIES),
            objectiveRespected,
            createdAt: new Date(gameEnd.getTime() + 10 * 60 * 1000),
          },
        })

        totalReviews++
      }
    }

    if (si % 3 === 0) process.stdout.write('.')
  }

  console.log(`\n  ✓ Created ${sessionConfigs.length} sessions (${sessionConfigs.length - 1} completed, 1 active)`)
  console.log(`  ✓ Created ${totalGames} games, ${totalReviews} reviews`)

  // ── Badges ────────────────────────────────────────────────────────────────

  const badgesToUnlock = [
    'first_review',
    'streak_3',
    'streak_7',
    'objective_5',
    'sessions_10',
    'improvement_1',
  ]

  for (const badgeId of badgesToUnlock) {
    await prisma.badge.create({
      data: {
        userId: user.id,
        badgeId,
        unlockedAt: daysAgo(rand(5, 40)),
      },
    })
  }

  console.log(`  ✓ Unlocked ${badgesToUnlock.length} badges`)

  // ── Final user XP update ──────────────────────────────────────────────────

  const finalXp =
    totalReviews * 50 +
    (sessionConfigs.length - 1) * (totalGames * 25) +
    3 * 100 // assessments
  await prisma.user.update({
    where: { id: user.id },
    data: { xp: finalXp },
  })

  console.log(`  ✓ Set XP to ${finalXp}`)
  console.log('\n✅ Seed complete! Restart the app to see the seeded data.')
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
