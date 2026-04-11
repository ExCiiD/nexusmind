export interface KPI {
  id: string
  label: string
  description: string
  /** When true, this KPI is highlighted as top priority in the UI */
  priority?: boolean
}

export interface Subcategory {
  id: string
  label: string
  description: string
  kpis: KPI[]
}

export interface Fundamental {
  id: string
  label: string
  description: string
  kpis: KPI[]
  subcategories?: Subcategory[]
}

export interface FundamentalCategory {
  id: string
  label: string
  fundamentals: Fundamental[]
}

export const FUNDAMENTALS: FundamentalCategory[] = [
  {
    id: 'general_champion_pool',
    label: 'General — Champion Pool',
    fundamentals: [
      {
        id: 'mastery',
        label: 'Mastery',
        description: 'Your mechanical proficiency on your champions: combos, ability sequencing, animation cancels, and edge-case mechanics.',
        kpis: [
          { id: 'combo_execution', label: 'Combo Execution', description: 'Ability to consistently execute full combos and animation cancels' },
          { id: 'ability_sequencing', label: 'Ability Sequencing', description: 'Using abilities in optimal order based on the situation' },
          { id: 'edge_case_mechanics', label: 'Edge-Case Mechanics', description: 'Handling rare or complex mechanical interactions (flash combos, terrain tricks)' },
          { id: 'mechanical_consistency', label: 'Mechanical Consistency', description: 'Reproducing your core mechanics reliably across the whole game, not only in ideal spots' },
          { id: 'input_cleanliness', label: 'Input Cleanliness', description: 'Avoiding misclicks, buffered spell errors, and panic inputs under pressure' },
        ],
      },
      {
        id: 'champion_identity',
        label: 'Champion Identity',
        description: 'Understanding your champion\'s role in each draft, matchup archetypes, and win conditions per team composition.',
        kpis: [
          { id: 'draft_role_understanding', label: 'Draft Role Understanding', description: 'Knowing what your champion should do in the current team comp' },
          { id: 'matchup_archetypes', label: 'Matchup Archetypes', description: 'Recognizing lane matchup dynamics (poke vs sustain, all-in vs short trade)' },
          { id: 'wincon_per_comp', label: 'Win Condition per Comp', description: 'Adapting playstyle to the team\'s optimal win condition' },
          { id: 'lane_plan_clarity', label: 'Lane Plan Clarity', description: 'Having a clear early-game lane plan based on matchup, jungle paths, and wave goals' },
          { id: 'skirmish_role_understanding', label: 'Skirmish Role Understanding', description: 'Understanding whether your champion should engage, peel, flank, or follow in small fights' },
        ],
      },
      {
        id: 'pool_coherence',
        label: 'Pool Coherence',
        description: 'How well your champion pool covers the meta, adapts to bans, and avoids gaps across situations.',
        kpis: [
          { id: 'meta_adaptability', label: 'Meta Adaptability', description: 'Ability to adjust your pool as the meta shifts' },
          { id: 'situational_picks', label: 'Situational Picks', description: 'Having fallback picks when your mains are banned or countered' },
          { id: 'role_coverage', label: 'Role Coverage', description: 'No critical gaps in your pool (AP vs AD, tank vs carry)' },
          { id: 'blind_pick_safety', label: 'Blind Pick Safety', description: 'Including at least one reliable blind pick that remains playable into most matchups' },
          { id: 'depth_over_width', label: 'Depth Over Width', description: 'Maintaining enough repetition on key champions instead of spreading games too thin' },
        ],
      },
    ],
  },
  {
    id: 'general_overall',
    label: 'General — Overall',
    fundamentals: [
      {
        id: 'summoner_spells',
        label: 'Summoner Spells',
        description: 'Mastery of summoner spell usage — Flash timing, Ignite/Heal/TP/Ghost usage for maximum impact.',
        kpis: [
          { id: 'flash_timing', label: 'Flash Timing', description: 'Using Flash at the right moment (offensive plays, clutch escapes)' },
          { id: 'combat_spell_usage', label: 'Combat Spell Usage', description: 'Optimal Ignite/Heal/Barrier timing in trades and all-ins' },
          { id: 'tp_macro', label: 'Teleport Macro', description: 'TP to the right location at the right time for objectives/flanks' },
          { id: 'defensive_spell_discipline', label: 'Defensive Spell Discipline', description: 'Not wasting defensive summoners too late, too early, or for low-value situations' },
          { id: 'enemy_summoner_punish', label: 'Enemy Summoner Punish', description: 'Recognizing and immediately exploiting windows when enemy summoners are unavailable' },
        ],
      },
      {
        id: 'cooldown_tracking',
        label: 'Cooldown Tracking',
        description: 'Tracking enemy summoner spells, key ability cooldowns, and your own cooldown windows.',
        kpis: [
          { id: 'enemy_summs_tracking', label: 'Enemy Summoner Tracking', description: 'Mental note of enemy Flash/TP/Ignite timers' },
          { id: 'key_ability_cds', label: 'Key Ability CDs', description: 'Tracking enemy ultimates, CC spells, and escape abilities' },
          { id: 'own_cd_awareness', label: 'Own CD Awareness', description: 'Not overcommitting when your own key spells are down' },
          { id: 'window_punishment', label: 'Window Punishment', description: 'Actually taking action when a tracked cooldown window becomes favorable' },
        ],
      },
      {
        id: 'itemization',
        label: 'Itemization',
        description: 'Building the right items at the right time based on matchup, game state, and team needs.',
        kpis: [
          { id: 'first_item_priority', label: 'First Item Priority', description: 'Choosing correct first item based on lane matchup' },
          { id: 'situational_builds', label: 'Situational Builds', description: 'Adapting build path to the game state (armor vs MR, damage vs survivability)' },
          { id: 'component_timing', label: 'Component Timing', description: 'Buying the right components at each recall (not sitting on gold)' },
          { id: 'defensive_item_timing', label: 'Defensive Item Timing', description: 'Respecting enemy damage profile by timing defensive purchases before you start getting punished' },
          { id: 'utility_item_value', label: 'Utility Item Value', description: 'Recognizing when anti-heal, cleanse tools, or support utility items bring more value than raw damage' },
        ],
      },
      {
        id: 'map_awareness',
        label: 'Map Awareness',
        description: 'Minimap check frequency, anticipating threats, and reacting to missing pings and global plays.',
        kpis: [
          { id: 'minimap_frequency', label: 'Minimap Check Frequency', description: 'Regularly glancing at minimap every few seconds' },
          { id: 'threat_anticipation', label: 'Threat Anticipation', description: 'Predicting ganks or roams before they happen' },
          { id: 'mia_reaction', label: 'MIA Reaction', description: 'Adjusting positioning when enemies go missing' },
          { id: 'camera_control', label: 'Camera Control', description: 'Using camera movement to collect more information than the minimap alone provides' },
          { id: 'crossmap_reaction', label: 'Crossmap Reaction', description: 'Responding quickly to skirmishes, dives, and global plays happening elsewhere on the map' },
        ],
      },
      {
        id: 'csing_pathing',
        label: 'CSing / Pathing',
        description: 'Last-hitting efficiency, CS/min benchmarks (7+ for laners), and optimal pathing under pressure.',
        kpis: [
          { id: 'last_hit_accuracy', label: 'Last Hit Accuracy', description: 'Consistently last-hitting minions including under tower' },
          { id: 'cs_per_min', label: 'CS/min', description: 'Maintaining high CS numbers throughout the game (7+ target)' },
          { id: 'pathing_efficiency', label: 'Pathing Efficiency', description: 'Moving efficiently between camps/lanes to maximize gold income' },
          { id: 'wave_catch_rate', label: 'Wave Catch Rate', description: 'Collecting side waves before they die unnecessarily to towers' },
          { id: 'downtime_optimization', label: 'Downtime Optimization', description: 'Filling dead time with camps, wards, resets, or wave prep instead of drifting aimlessly' },
        ],
      },
      {
        id: 'tempo',
        label: 'Tempo',
        description: 'Knowing when to accelerate the game (post-kill, post-objective) vs. slowing down to reset and farm.',
        kpis: [
          { id: 'death_regulation', label: 'Death Regulation', description: 'Spend the maximum time possible alive — avoid any avoidable death. Every death is a tempo loss for you and your team.', priority: true },
          { id: 'accelerate_timing', label: 'Accelerate Timing', description: 'Pushing advantages after kills, objectives, or first blood' },
          { id: 'slow_down_judgment', label: 'Slow Down Judgment', description: 'Recognizing when to farm and wait instead of forcing plays' },
          { id: 'reset_timing', label: 'Reset Timing', description: 'Recalling and resetting at optimal moments without losing tempo' },
          { id: 'sequence_chaining', label: 'Sequence Chaining', description: 'Linking waves, recalls, camps, and objectives into clean sequences without wasting tempo' },
        ],
      },
      {
        id: 'wincon_identification',
        label: 'Win Condition Identification',
        description: 'Reading the draft and game state to identify how your team wins (teamfight, pick, split-push, scale).',
        kpis: [
          { id: 'draft_reading', label: 'Draft Reading', description: 'Identifying your team\'s win condition from champion select' },
          { id: 'adapting_wincon', label: 'Adapting Win Condition', description: 'Adjusting the plan when original win condition is failing' },
          { id: 'snowball_vs_scale', label: 'Snowball vs Scale', description: 'Knowing when to push a lead vs. when to play safe and outscale' },
          { id: 'resource_allocation', label: 'Resource Allocation', description: 'Putting waves, camps, vision, and pressure toward the lane or champion that best serves the win condition' },
          { id: 'fallback_plan', label: 'Fallback Plan', description: 'Having a secondary path to victory when the primary plan becomes unrealistic' },
        ],
      },
    ],
  },
  {
    id: 'general_mental',
    label: 'General — Mental',
    fundamentals: [
      {
        id: 'resilience',
        label: 'Resilience',
        description: 'Playing from behind without tilting, recovering from loss streaks, and maintaining focus.',
        kpis: [
          { id: 'tilt_management', label: 'Tilt Management', description: 'Staying calm and focused after deaths, bad plays, or teammate mistakes' },
          { id: 'playing_from_behind', label: 'Playing From Behind', description: 'Making smart, low-risk plays when your team is losing' },
          { id: 'loss_streak_recovery', label: 'Loss Streak Recovery', description: 'Taking breaks and resetting mental after consecutive losses' },
          { id: 'mistake_reset_speed', label: 'Mistake Reset Speed', description: 'Recovering mentally within the next minute instead of mentally losing the rest of the game' },
        ],
      },
      {
        id: 'fortitude',
        label: 'Fortitude',
        description: 'Never-surrender mentality, extracting lessons even from losing games, and staying in the game mentally.',
        kpis: [
          { id: 'never_give_up', label: 'Never Give Up', description: 'Playing to win even in hard games (enemy throws happen)' },
          { id: 'lesson_extraction', label: 'Lesson Extraction', description: 'Finding at least one takeaway from every game, win or lose' },
          { id: 'mental_endurance', label: 'Mental Endurance', description: 'Maintaining quality play throughout long sessions' },
          { id: 'discipline_under_frustration', label: 'Discipline Under Frustration', description: 'Keeping your game plan intact instead of forcing low-percentage plays out of frustration' },
        ],
      },
      {
        id: 'shotcalling_communication',
        label: 'Shotcalling / Communication',
        description: 'Positive leadership pings, avoiding spam pings, and proactively sharing useful information.',
        kpis: [
          { id: 'positive_pings', label: 'Positive Pings', description: 'Using pings to communicate objectives, danger, and plays constructively' },
          { id: 'no_spam', label: 'Avoiding Spam', description: 'Not tilting teammates with excessive pinging or negative chat' },
          { id: 'info_sharing', label: 'Info Sharing', description: 'Pinging summoner spell timers, enemy positions, and objective timers' },
          { id: 'ping_clarity', label: 'Ping Clarity', description: 'Making your pings easy to understand by avoiding contradictory or messy communication' },
          { id: 'timer_callouts', label: 'Timer Callouts', description: 'Proactively communicating objective, wave, and cooldown timings before they become urgent' },
        ],
      },
    ],
  },
  {
    id: 'micro',
    label: 'Micro',
    fundamentals: [
      {
        id: 'spacing',
        label: 'Spacing',
        description: 'Managing distance during trades, sidestepping skillshots, and kiting patterns.',
        kpis: [
          { id: 'trade_distance', label: 'Trade Distance', description: 'Staying at the edge of your range during trades to minimize retaliation' },
          { id: 'skillshot_dodging', label: 'Skillshot Dodging', description: 'Consistently sidestepping key enemy skillshots' },
          { id: 'kiting_patterns', label: 'Kiting Patterns', description: 'Attack-moving efficiently while maintaining optimal distance' },
          { id: 'tethering', label: 'Tethering', description: 'Floating just in and out of enemy threat range to bait abilities and control trades' },
        ],
      },
      {
        id: 'aggression_calibration',
        label: 'Aggression Calibration',
        description: 'Reading when to trade, poke, all-in, or disengage based on HP, mana, and cooldown states.',
        kpis: [
          { id: 'trade_windows', label: 'Trade Windows', description: 'Recognizing when you have a favorable trade window (enemy CD used, minion advantage)' },
          { id: 'all_in_timing', label: 'All-in Timing', description: 'Committing to all-in only when you have kill pressure' },
          { id: 'disengage_judgment', label: 'Disengage Judgment', description: 'Knowing when to back off a losing trade before it gets worse' },
          { id: 'resource_check_before_commit', label: 'Resource Check Before Commit', description: 'Checking HP, mana, sums, and nearby wave size before forcing aggression' },
          { id: 'jungle_respect_in_aggression', label: 'Jungle Respect in Aggression', description: 'Adjusting aggression level based on likely jungle position instead of trading in a vacuum' },
        ],
      },
      {
        id: 'positioning',
        label: 'Positioning',
        description: 'Using walls/terrain as tools, staying at optimal attack range, and not overextending.',
        kpis: [
          { id: 'terrain_usage', label: 'Terrain Usage', description: 'Using walls, bushes, and choke points to your advantage' },
          { id: 'attack_range_management', label: 'Attack Range Management', description: 'Staying at max range while dealing damage consistently' },
          { id: 'overextend_awareness', label: 'Overextend Awareness', description: 'Not pushing too far without vision or backup' },
          { id: 'threat_line_awareness', label: 'Threat Line Awareness', description: 'Understanding which angles enemies can realistically threaten from before stepping forward' },
        ],
      },
      {
        id: 'limits_knowledge',
        label: 'Limits Knowledge',
        description: 'Knowing your champion\'s power spike windows, opponent\'s \"silent triggers\" (level 6, item spikes), and thresholds for punishing.',
        kpis: [
          { id: 'power_spike_awareness', label: 'Power Spike Awareness', description: 'Knowing when your champion is strong and playing accordingly' },
          { id: 'enemy_spike_respect', label: 'Enemy Spike Respect', description: 'Respecting enemy power spikes (level 6, completed item)' },
          { id: 'punish_thresholds', label: 'Punish Thresholds', description: 'Knowing exact damage output to decide when to commit for a kill' },
          { id: 'lethal_calculation', label: 'Lethal Calculation', description: 'Estimating whether your full combo actually kills before committing to the play' },
          { id: 'limit_testing_quality', label: 'Limit Testing Quality', description: 'Testing limits intentionally and learning from it, instead of coinflipping without context' },
        ],
      },
    ],
  },
  {
    id: 'early_game_laning',
    label: 'Early Game — Laning',
    fundamentals: [
      {
        id: 'matchup_knowledge',
        label: 'Matchup',
        description: 'Pre-game research on counters and runes, plus in-game adaptation to unexpected picks.',
        kpis: [
          { id: 'pregame_research', label: 'Pre-game Research', description: 'Looking up matchup-specific runes, builds, and playstyle before the game starts' },
          { id: 'adaptation', label: 'In-game Adaptation', description: 'Adjusting to unexpected picks or playstyles you haven\'t prepared for' },
          { id: 'level_one_plan', label: 'Level 1 Plan', description: 'Starting lane with a clear idea of who wins level 1, level 2, and the first three waves' },
          { id: 'rune_setup_accuracy', label: 'Rune Setup Accuracy', description: 'Choosing rune pages and shards that actually fit the matchup and lane plan' },
        ],
      },
      {
        id: 'wave_management',
        label: 'Wave Management',
        description: 'Controlling minion waves to create advantages: freeze, slow push, fast push, bounce, and advanced wave manipulation.',
        kpis: [
          { id: 'wave_state_awareness', label: 'Wave State Awareness', description: 'Knowing the current wave state and what it will become' },
          { id: 'wave_manipulation_execution', label: 'Wave Manipulation Execution', description: 'Successfully executing the desired wave setup' },
          { id: 'wave_objective_sync', label: 'Wave-Objective Sync', description: 'Aligning wave states with objectives and recalls' },
          { id: 'enemy_wave_punish', label: 'Enemy Wave Punish', description: 'Punishing enemy mistakes when they thin, crash, or hold the wave incorrectly' },
          { id: 'lane_safety_through_wave', label: 'Lane Safety Through Wave', description: 'Using the wave to reduce gank risk instead of treating wave management as isolated mechanics' },
        ],
        subcategories: [
          {
            id: 'freeze',
            label: 'Freeze',
            description: 'Keeping the wave just inside your tower range to deny enemy CS and enable ganks.',
            kpis: [
              { id: 'freeze_setup', label: 'Freeze Setup', description: 'Successfully setting up and maintaining a freeze position' },
              { id: 'freeze_hold', label: 'Freeze Hold', description: 'Holding the freeze for multiple waves without breaking it' },
              { id: 'freeze_deny', label: 'Freeze Deny', description: 'Using the freeze to deny significant CS from the enemy' },
              { id: 'freeze_break_response', label: 'Freeze Break Response', description: 'Reacting correctly when the enemy tries to break the freeze with abilities, recalls, or jungle help' },
            ],
          },
          {
            id: 'slow_push',
            label: 'Slow Push',
            description: 'Building a large wave to crash for tower damage, dive setup, or recall advantage.',
            kpis: [
              { id: 'slow_push_setup', label: 'Slow Push Setup', description: 'Correctly building a slow push by killing caster minions only' },
              { id: 'slow_push_crash', label: 'Slow Push Crash', description: 'Timing the crash to maximize tower damage or dive opportunity' },
              { id: 'slow_push_timing', label: 'Slow Push Timing', description: 'Starting the slow push at the right moment for your plan' },
              { id: 'stacked_wave_protection', label: 'Stacked Wave Protection', description: 'Keeping the stacked wave healthy enough to reach tower without taking unnecessary damage' },
            ],
          },
          {
            id: 'fast_push',
            label: 'Fast Push',
            description: 'Clearing the wave instantly to create time for roaming, recalling, or contesting objectives.',
            kpis: [
              { id: 'fast_push_speed', label: 'Fast Push Speed', description: 'Clearing the wave as quickly as possible without missing CS' },
              { id: 'fast_push_purpose', label: 'Fast Push Purpose', description: 'Having a clear reason for fast pushing (roam, recall, objective)' },
              { id: 'post_push_conversion', label: 'Post-Push Conversion', description: 'Actually using the created tempo window for a valuable action after the shove' },
            ],
          },
          {
            id: 'bounce',
            label: 'Bounce',
            description: 'Timing a slow push crash so the wave bounces back to you with lane priority.',
            kpis: [
              { id: 'bounce_timing', label: 'Bounce Timing', description: 'Correctly timing the crash so the wave pushes back to you' },
              { id: 'bounce_exploitation', label: 'Bounce Exploitation', description: 'Using the bounce to set up a freeze or safe farming position' },
              { id: 'bounce_patience', label: 'Bounce Patience', description: 'Letting the bounce develop naturally instead of breaking it by overhitting the next wave' },
            ],
          },
          {
            id: 'wave_for_trade',
            label: 'Advanced — Wave for Trade',
            description: 'Positioning a crashing wave to force the enemy under tower before engaging for a favorable trade.',
            kpis: [
              { id: 'wave_trade_setup', label: 'Wave Trade Setup', description: 'Building a wave advantage before initiating a trade' },
              { id: 'minion_damage_awareness', label: 'Minion Damage Awareness', description: 'Using your larger wave\'s minion damage in extended trades' },
              { id: 'tower_pressure_trade_window', label: 'Tower Pressure Trade Window', description: 'Recognizing when tower pressure forces the enemy to choose between CSing and answering your trade' },
            ],
          },
          {
            id: 'wave_for_objective',
            label: 'Advanced — Wave for Objective',
            description: 'Syncing slow pushes to Baron/Drake timers to create map pressure and force decisions.',
            kpis: [
              { id: 'objective_wave_sync', label: 'Objective Wave Sync', description: 'Starting slow pushes 60-90s before an objective spawns' },
              { id: 'cross_map_pressure', label: 'Cross-map Pressure', description: 'Creating pressure in a side-lane while your team contests an objective' },
              { id: 'recall_after_setup', label: 'Recall After Setup', description: 'Using the created wave pressure to secure a timely reset before the objective fight' },
            ],
          },
        ],
      },
      {
        id: 'trades',
        label: 'Trades',
        description: 'Timing trades with ability cooldowns and wave state, executing trade patterns, and recognizing losing trades early.',
        kpis: [
          { id: 'trade_timing', label: 'Trade Timing', description: 'Engaging when enemy key abilities are on cooldown' },
          { id: 'trade_pattern', label: 'Trade Pattern', description: 'Executing correct trade combos (short trade vs extended vs all-in)' },
          { id: 'losing_trade_recognition', label: 'Losing Trade Recognition', description: 'Backing off early when a trade starts going badly' },
          { id: 'minion_advantage_usage', label: 'Minion Advantage Usage', description: 'Accounting for wave size so you trade harder with minion support and softer against it' },
          { id: 'damage_accounting', label: 'Damage Accounting', description: 'Evaluating whether the trade actually favored you in HP, cooldowns, and lane state afterward' },
        ],
      },
      {
        id: 'recall_timing',
        label: 'Recall Timing',
        description: 'Recalling on optimal HP/mana windows, syncing with wave crash, and minimizing CS loss.',
        kpis: [
          { id: 'recall_window', label: 'Recall Window', description: 'Choosing the right moment to recall (after crash, with good HP/mana)' },
          { id: 'cs_loss_minimization', label: 'CS Loss Minimization', description: 'Losing minimal CS during recall by timing with wave state' },
          { id: 'item_spike_recall', label: 'Item Spike Recall', description: 'Recalling when you have enough gold for a key component' },
          { id: 'objective_sync_recall', label: 'Objective Sync Recall', description: 'Timing recalls so you return with tempo before dragon, herald, or major side-wave decisions' },
        ],
      },
      {
        id: 'fog_usage',
        label: 'Fog Usage',
        description: 'Using river/tri-brush fog to feign roams, bait aggression, or set up flanks.',
        kpis: [
          { id: 'fog_pressure', label: 'Fog Pressure', description: 'Stepping into fog to create uncertainty and force enemy to play safe' },
          { id: 'fake_roam', label: 'Fake Roam', description: 'Faking a roam to force enemy to follow or lose CS' },
          { id: 'bush_control', label: 'Bush Control', description: 'Using lane and river bushes to your advantage in trades and ganks' },
          { id: 'reentry_timing', label: 'Re-entry Timing', description: 'Reappearing from fog at the best moment to punish enemy greed or bad positioning' },
        ],
      },
      {
        id: 'roam_gank_timing',
        label: 'Roam / Gank Timing',
        description: 'Identifying when lane priority opens a roam window and choosing efficient roam paths.',
        kpis: [
          { id: 'priority_recognition', label: 'Priority Recognition', description: 'Knowing when you have lane priority to roam safely' },
          { id: 'roam_pathing', label: 'Roam Pathing', description: 'Taking the fastest or most surprising path to the target lane' },
          { id: 'roam_cost_assessment', label: 'Roam Cost Assessment', description: 'Weighing CS/tower loss against the potential roam reward' },
          { id: 'wave_prep_before_roam', label: 'Wave Prep Before Roam', description: 'Preparing the lane properly before leaving so your roam is not instantly punished' },
          { id: 'roam_commit_quality', label: 'Roam Commit Quality', description: 'Cancelling bad roams early instead of stubbornly finishing a low-value move' },
        ],
      },
      {
        id: 'gank_effectiveness',
        label: 'Gank Effectiveness',
        description: 'Setting up vision before ganks, body-blocking escape routes, and coordinating kills.',
        kpis: [
          { id: 'gank_setup', label: 'Gank Setup', description: 'Setting up vision and positioning before ganking a lane' },
          { id: 'gank_execution', label: 'Gank Execution', description: 'Properly body-blocking, timing CC, and securing kills' },
          { id: 'countergank_awareness', label: 'Countergank Awareness', description: 'Being aware of enemy jungler position before ganking' },
          { id: 'flash_forcing_value', label: 'Flash Forcing Value', description: 'Treating burned flashes or teleports as meaningful wins even when the gank does not kill' },
          { id: 'post_gank_conversion', label: 'Post-Gank Conversion', description: 'Turning successful ganks into plates, waves denied, vision, or objective control' },
        ],
      },
      {
        id: 'vision_setup',
        label: 'Vision Setup',
        description: 'Warding in key locations early — river, tri-brush, pink wards on entrances.',
        kpis: [
          { id: 'early_warding', label: 'Early Warding', description: 'Placing first ward at a useful time and location' },
          { id: 'pink_ward_usage', label: 'Pink Ward Usage', description: 'Buying and placing control wards in high-value spots' },
          { id: 'ward_timing', label: 'Ward Timing', description: 'Warding proactively (before ganks) rather than reactively' },
          { id: 'lane_specific_warding', label: 'Lane-Specific Warding', description: 'Choosing ward spots that fit your matchup, lane state, and the enemy jungle path' },
          { id: 'vision_refresh_cycle', label: 'Vision Refresh Cycle', description: 'Refreshing expiring or cleared vision instead of letting long blind windows happen' },
        ],
      },
      {
        id: 'jungle_tracking',
        label: 'Jungle Tracking',
        description: 'Using camp timers, river vision, and map information to predict the enemy jungler\'s location.',
        kpis: [
          { id: 'jungler_prediction', label: 'Jungler Prediction', description: 'Predicting which quadrant the enemy jungler is in' },
          { id: 'camp_timer_knowledge', label: 'Camp Timer Knowledge', description: 'Knowing camp respawn timers to track jungler pathing' },
          { id: 'position_adjustment', label: 'Position Adjustment', description: 'Adjusting lane position based on predicted jungler location' },
          { id: 'opening_info_gathering', label: 'Opening Info Gathering', description: 'Using level 1 vision, first lane states, and the jungler\'s first reveal to identify their likely opening route' },
          { id: 'jungler_cs_verification', label: 'Jungler CS Verification', description: 'Checking the enemy jungler\'s CS when seen to infer their clear, starting side, and which camps are still up' },
          { id: 'camp_deduction', label: 'Camp Deduction', description: 'Deducing which camps remain based on timing, CS count, route logic, and map reveals' },
        ],
      },
      {
        id: 'resource_management',
        label: 'Resource Management',
        description: 'Managing HP and mana trading ratios, and knowing when to play passive to recover.',
        kpis: [
          { id: 'hp_management', label: 'HP Management', description: 'Not taking unnecessary damage and managing health in trades' },
          { id: 'mana_management', label: 'Mana Management', description: 'Not running out of mana before key moments (fights, ganks, recalls)' },
          { id: 'potion_timing', label: 'Potion Timing', description: 'Using potions at optimal times (during trades, not at full HP)' },
          { id: 'resource_to_wave_conversion', label: 'Resource-to-Wave Conversion', description: 'Spending HP and mana in ways that secure wave control, crash timing, or lane priority' },
        ],
      },
      {
        id: 'weak_strong_side',
        label: 'Weak / Strong Side',
        description: 'Playing weak side safely (just farming) and maximizing strong side agency and pressure.',
        kpis: [
          { id: 'weak_side_safety', label: 'Weak Side Safety', description: 'Playing safe and farming when your jungler is on the opposite side' },
          { id: 'strong_side_aggression', label: 'Strong Side Aggression', description: 'Being proactive and aggressive when you have jungler support' },
          { id: 'side_identification', label: 'Side Identification', description: 'Correctly identifying which side you are and adapting play' },
          { id: 'dive_respect', label: 'Dive Respect', description: 'Respecting stacked waves and enemy setup when you are isolated on weak side' },
          { id: 'crossmap_trade_understanding', label: 'Crossmap Trade Understanding', description: 'Understanding what your team should gain elsewhere when you must concede pressure on weak side' },
        ],
      },
      {
        id: 'level_up_timers',
        label: 'Level Up Timers',
        description: 'Exploiting level 2/3/6/9/11/16 power spikes by managing lane priority to hit them first.',
        kpis: [
          { id: 'level_2_spike', label: 'Level 2 Spike', description: 'Pushing for level 2 first and trading when you hit it' },
          { id: 'level_6_spike', label: 'Level 6 Spike', description: 'Timing your level 6 power spike for a kill opportunity' },
          { id: 'xp_lead_maintenance', label: 'XP Lead Maintenance', description: 'Maintaining XP advantages through good wave management' },
          { id: 'pre_spike_preparation', label: 'Pre-Spike Preparation', description: 'Setting up the wave and spacing correctly before the level spike actually happens' },
          { id: 'enemy_spike_denial', label: 'Enemy Spike Denial', description: 'Backing off or adjusting the wave so the enemy cannot fully exploit their own level spike' },
        ],
      },
    ],
  },
  {
    id: 'mid_late_macro',
    label: 'Mid / Late Game — Macro',
    fundamentals: [
      {
        id: 'decision_making',
        label: 'Decision Making',
        description: 'Choosing between objectives, lanes, bounties — reading game clock and knowing when to commit vs. reset.',
        kpis: [
          { id: 'objective_priority', label: 'Objective Priority', description: 'Choosing the most valuable play when multiple options exist' },
          { id: 'game_clock_reading', label: 'Game Clock Reading', description: 'Understanding which plays are appropriate for the game timer' },
          { id: 'commit_vs_reset', label: 'Commit vs Reset', description: 'Deciding correctly when to fight and when to back off' },
          { id: 'risk_reward_assessment', label: 'Risk / Reward Assessment', description: 'Judging whether the downside of a play is acceptable compared with its realistic upside' },
          { id: 'numbers_advantage_play', label: 'Numbers Advantage Play', description: 'Recognizing and acting quickly when your team temporarily has more players on the map segment' },
        ],
      },
      {
        id: 'lane_assignment',
        label: 'Lane Assignment',
        description: 'Optimal role dispatch before leaving base — who goes where for maximum pressure.',
        kpis: [
          { id: 'assignment_awareness', label: 'Assignment Awareness', description: 'Going to the correct lane after each recall or death' },
          { id: 'matchup_consideration', label: 'Matchup Consideration', description: 'Assigning lanes based on who can handle the opposing laner' },
          { id: 'pressure_distribution', label: 'Pressure Distribution', description: 'Ensuring all lanes are covered and pressure is spread' },
          { id: 'objective_side_assignment', label: 'Objective-Side Assignment', description: 'Sending the right champions to the side of the map that matters for the next objective' },
        ],
      },
      {
        id: 'wave_management_objectives',
        label: 'Wave Management for Objectives',
        description: 'Building slow pushes on 2–3 lanes before Baron/Dragon to create pressure and recall windows.',
        kpis: [
          { id: 'multi_lane_setup', label: 'Multi-lane Setup', description: 'Setting up slow pushes in multiple lanes before objectives' },
          { id: 'objective_prep_timing', label: 'Objective Prep Timing', description: 'Starting wave setup 60-90s before objective spawn' },
          { id: 'pressure_creation', label: 'Pressure Creation', description: 'Forcing enemy to choose between waves and objectives' },
          { id: 'crash_timing_precision', label: 'Crash Timing Precision', description: 'Making sure side waves hit at the exact time your team wants to start objective setup' },
          { id: 'reset_sync_after_setup', label: 'Reset Sync After Setup', description: 'Using wave setup to buy, heal, and move first before the objective fight begins' },
        ],
      },
      {
        id: 'vision_control',
        label: 'Vision Control',
        description: 'Strategic warding around objectives, using sweepers to deny vision, and fog of war manipulation.',
        kpis: [
          { id: 'objective_vision', label: 'Objective Vision', description: 'Warding Baron/Dragon pit area before spawn' },
          { id: 'vision_denial', label: 'Vision Denial', description: 'Using sweeper to clear enemy wards in key areas' },
          { id: 'fog_manipulation', label: 'Fog Manipulation', description: 'Rotating through unwarded areas to create uncertainty' },
          { id: 'vision_line_discipline', label: 'Vision Line Discipline', description: 'Holding a coherent line of wards instead of placing isolated vision with no protection' },
          { id: 'zone_ownership', label: 'Zone Ownership', description: 'Using vision advantage to actually control entrances and deny enemy access to the area' },
        ],
        subcategories: [
          {
            id: 'ward_timing_macro',
            label: 'Ward Timing',
            description: 'Warding Dragon/Baron pit 60s before spawn to track enemy approach.',
            kpis: [
              { id: 'pre_objective_ward', label: 'Pre-Objective Ward', description: 'Placing vision 60+ seconds before objective spawn' },
              { id: 'rotation_vision', label: 'Rotation Vision', description: 'Warding paths enemies use to rotate to objectives' },
              { id: 'ward_refresh', label: 'Ward Refresh', description: 'Refreshing expired or cleared wards before the fight window opens' },
            ],
          },
          {
            id: 'control_ward_placement',
            label: 'Control Ward Placement',
            description: 'Placing control wards in high-value spots — pit entrance, river bush, enemy jungle tri.',
            kpis: [
              { id: 'pink_high_value', label: 'High-Value Pink', description: 'Placing control wards in locations that provide maximum vision value' },
              { id: 'pink_maintenance', label: 'Pink Maintenance', description: 'Keeping a control ward on the map at all times' },
              { id: 'pink_protection', label: 'Pink Protection', description: 'Defending your control wards when it is safe instead of giving them up for free' },
            ],
          },
          {
            id: 'vision_denial_macro',
            label: 'Vision Denial',
            description: 'Sweeper usage to deny enemy vision before key plays.',
            kpis: [
              { id: 'sweeper_usage', label: 'Sweeper Usage', description: 'Using sweeper when approaching objectives or setting up picks' },
              { id: 'clearing_priority', label: 'Clearing Priority', description: 'Prioritizing clearing the most impactful enemy wards' },
              { id: 'denial_timing', label: 'Denial Timing', description: 'Clearing vision close enough to the play window that the enemy cannot fully replace it' },
            ],
          },
          {
            id: 'fog_of_war_play',
            label: 'Fog of War Play',
            description: 'Rotating while hidden to deceive enemy and create advantages.',
            kpis: [
              { id: 'hidden_rotation', label: 'Hidden Rotation', description: 'Moving through unwarded areas to surprise the enemy' },
              { id: 'macro_fog_pressure', label: 'Fog Pressure', description: 'Disappearing from the map to create pressure without committing' },
              { id: 'reveal_discipline', label: 'Reveal Discipline', description: 'Avoiding unnecessary reveals on waves or wards before a hidden play is ready' },
            ],
          },
        ],
      },
      {
        id: 'rotation_positioning',
        label: 'Rotation Positioning',
        description: 'Playing with fog on side-lanes, tempo management during rotations, and not over-rotating.',
        kpis: [
          { id: 'side_lane_fog', label: 'Side Lane Fog', description: 'Using fog of war in side-lanes to threaten without being seen' },
          { id: 'rotation_tempo', label: 'Rotation Tempo', description: 'Arriving at fights and objectives with good timing' },
          { id: 'over_rotation_avoidance', label: 'Over-Rotation Avoidance', description: 'Not leaving your lane too early and losing CS/towers unnecessarily' },
          { id: 'catch_prevention', label: 'Catch Prevention', description: 'Pathing during rotations in a way that avoids facechecking and getting picked before the play' },
          { id: 'teammate_sync', label: 'Teammate Sync', description: 'Rotating on the same timer as teammates instead of arriving alone or too late' },
        ],
      },
    ],
  },
  {
    id: 'teamfighting',
    label: 'Teamfighting',
    fundamentals: [
      {
        id: 'role_identification',
        label: 'Role Identification',
        description: 'Pre-fight role assignment — frontliner, diver, peeler, DPS, or engage — based on team composition.',
        kpis: [
          { id: 'role_clarity', label: 'Role Clarity', description: 'Knowing your exact job in teamfights before they start' },
          { id: 'role_execution', label: 'Role Execution', description: 'Executing your assigned role consistently during fights' },
          { id: 'role_adaptation', label: 'Role Adaptation', description: 'Adapting your fight role when the situation requires it (e.g., peeling instead of diving)' },
          { id: 'target_access_planning', label: 'Target Access Planning', description: 'Planning beforehand how you will realistically reach or threaten the targets that matter' },
        ],
      },
      {
        id: 'cd_management_fights',
        label: 'Cooldown Management',
        description: 'Waiting for enemy key cooldowns before engaging, tracking spells during fights.',
        kpis: [
          { id: 'patience', label: 'Patience', description: 'Not blowing everything immediately — waiting for the right moment' },
          { id: 'key_cd_tracking', label: 'Key CD Tracking', description: 'Tracking enemy Zhonyas, GA, key ultimates during fights' },
          { id: 'spell_staggering', label: 'Spell Staggering', description: 'Not overlapping CC or burst with teammates' },
          { id: 'reengage_timing', label: 'Re-engage Timing', description: 'Recognizing the exact moment to re-enter after major cooldowns or invulnerability tools are gone' },
          { id: 'cooldown_baiting', label: 'Cooldown Baiting', description: 'Using movement or light commitment to draw key enemy spells before the real engage' },
        ],
      },
      {
        id: 'threat_assessment',
        label: 'Threat Assessment',
        description: 'Identifying the highest danger source (fed carry, engage tank) and reacting first.',
        kpis: [
          { id: 'primary_threat_id', label: 'Primary Threat ID', description: 'Quickly identifying who deals the most damage or has the most impact' },
          { id: 'focus_target', label: 'Focus Target', description: 'Focusing the correct target (not always the closest enemy)' },
          { id: 'threat_re_evaluation', label: 'Threat Re-evaluation', description: 'Switching focus when priorities change mid-fight' },
          { id: 'peel_priority', label: 'Peel Priority', description: 'Recognizing when protecting your own carry is more valuable than chasing enemy backliners' },
          { id: 'threat_range_awareness', label: 'Threat Range Awareness', description: 'Respecting the engage and damage ranges of key enemy threats before they connect' },
        ],
      },
      {
        id: 'prefight_positioning',
        label: 'Pre-fight Positioning',
        description: 'Arriving at optimal position before fights start — flank angles, vision cover, range control.',
        kpis: [
          { id: 'arrival_positioning', label: 'Arrival Positioning', description: 'Being in the right spot before the fight starts (not catching up)' },
          { id: 'flank_setup', label: 'Flank Setup', description: 'Setting up flanks when your champion benefits from them' },
          { id: 'safe_angle', label: 'Safe Angle', description: 'Positioning with an escape route in mind before committing' },
          { id: 'choke_control', label: 'Choke Control', description: 'Using terrain and choke points to limit enemy options before the fight starts' },
          { id: 'information_setup', label: 'Information Setup', description: 'Positioning close enough to act while still using vision and fog to keep information advantage' },
        ],
      },
    ],
  },
]

export function getAllFundamentals(): Fundamental[] {
  return FUNDAMENTALS.flatMap((c) => c.fundamentals)
}

export function getFundamentalById(id: string): Fundamental | undefined {
  return getAllFundamentals().find((f) => f.id === id)
}

export function getCategoryForFundamental(fundamentalId: string): FundamentalCategory | undefined {
  return FUNDAMENTALS.find((c) => c.fundamentals.some((f) => f.id === fundamentalId))
}

export function getSubcategoryById(fundamentalId: string, subcategoryId: string): Subcategory | undefined {
  const fundamental = getFundamentalById(fundamentalId)
  return fundamental?.subcategories?.find((s) => s.id === subcategoryId)
}

export function getKPIsForObjective(fundamentalId: string, subcategoryId?: string): KPI[] {
  const fundamental = getFundamentalById(fundamentalId)
  if (!fundamental) return []

  if (subcategoryId) {
    const sub = fundamental.subcategories?.find((s) => s.id === subcategoryId)
    return sub?.kpis ?? fundamental.kpis
  }

  return fundamental.kpis
}
