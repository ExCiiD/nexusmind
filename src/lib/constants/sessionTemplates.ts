import { getAllFundamentals } from './fundamentals'

export interface SessionTemplate {
  id: string
  name: string
  nameFr: string
  description: string
  descriptionFr: string
  objectiveIds: string[]
  selectedKpiIds: string[]
  customNote: string
}

export const SESSION_TEMPLATES: SessionTemplate[] = [
  // ── Laning / Aggression ──────────────────────────────────────────────────────

  {
    id: 'lane-more-aggressive',
    name: 'Lane More Aggressive',
    nameFr: 'Lane plus agressive',
    description: 'Push your aggression windows with proper wave and limit awareness.',
    descriptionFr: 'Exploiter les fenêtres d\'aggression avec une bonne lecture des waves et des limites.',
    objectiveIds: ['aggression_calibration', 'limits_knowledge', 'wave_management'],
    selectedKpiIds: [
      'trade_windows', 'all_in_timing',
      'punish_thresholds', 'lethal_calculation',
      'wave_manipulation_execution', 'enemy_wave_punish',
    ],
    customNote: 'Jouer plus proactif sur les bons timers sans forcer hors information jungle / wave state.',
  },
  {
    id: 'lane-trade-better',
    name: 'Lane Trade Better',
    nameFr: 'Meilleurs trades en lane',
    description: 'Fewer trades, higher quality. Focus on entry/exit and spacing.',
    descriptionFr: 'Moins de trades, mais de meilleure qualité. Focus entrée/sortie et spacing.',
    objectiveIds: ['trades', 'spacing', 'aggression_calibration'],
    selectedKpiIds: [
      'trade_timing', 'trade_pattern', 'damage_accounting',
      'trade_distance', 'tethering', 'trade_windows',
    ],
    customNote: 'Chercher moins de trades, mais de meilleure qualité, avec meilleure entrée/sortie.',
  },
  {
    id: 'lane-safer-vs-pressure',
    name: 'Survive Pressure Lanes',
    nameFr: 'Survivre sous pression',
    description: 'Play safe when the map doesn\'t support aggression.',
    descriptionFr: 'Jouer safe quand la map ne permet pas de jouer agressif.',
    objectiveIds: ['weak_strong_side', 'jungle_tracking', 'map_awareness'],
    selectedKpiIds: [
      'weak_side_safety', 'dive_respect',
      'jungler_prediction', 'position_adjustment',
      'threat_anticipation', 'mia_reaction',
    ],
    customNote: 'Prioriser la survie et la conservation de wave quand la map ne te permet pas de jouer agressif.',
  },

  // ── Wave / Recall / Lane Control ─────────────────────────────────────────────

  {
    id: 'wave-control-fundamentals',
    name: 'Wave Control Fundamentals',
    nameFr: 'Fondamentaux de wave control',
    description: 'Master wave states, manipulation, and recall timing.',
    descriptionFr: 'Maîtriser les états de wave, la manipulation et le timing de recall.',
    objectiveIds: ['wave_management', 'recall_timing', 'csing_pathing'],
    selectedKpiIds: [
      'wave_state_awareness', 'wave_manipulation_execution',
      'freeze_setup', 'slow_push_setup',
      'recall_window', 'wave_catch_rate',
    ],
    customNote: 'Avant chaque recall ou trade important, verbaliser l\'état de wave et le plan associé.',
  },
  {
    id: 'convert-prio-into-roam',
    name: 'Convert Prio into Roams',
    nameFr: 'Convertir la prio en roam',
    description: 'Only roam when the wave allows it and lane cost is acceptable.',
    descriptionFr: 'Ne roam que quand la wave autorise la sortie et que le coût lane est acceptable.',
    objectiveIds: ['roam_gank_timing', 'wave_management', 'fog_usage'],
    selectedKpiIds: [
      'priority_recognition', 'wave_prep_before_roam',
      'roam_pathing', 'roam_cost_assessment',
      'fog_pressure', 'fake_roam',
    ],
    customNote: 'Ne roam que quand la wave autorise la sortie et que le coût lane est acceptable.',
  },

  // ── Macro / Objective Setup ──────────────────────────────────────────────────

  {
    id: 'dragon-herald-setup',
    name: 'Dragon / Herald Setup',
    nameFr: 'Préparation Drake / Herald',
    description: 'Synchronize waves, vision, and resets 45-60s before spawn.',
    descriptionFr: 'Synchroniser waves, vision et resets 45 à 60s avant le spawn.',
    objectiveIds: ['wave_management_objectives', 'vision_control', 'decision_making'],
    selectedKpiIds: [
      'objective_prep_timing', 'multi_lane_setup',
      'objective_vision', 'vision_denial',
      'objective_priority', 'commit_vs_reset',
    ],
    customNote: 'Préparer l\'objectif 45 à 60 secondes avant le spawn avec wave + vision + reset synchronisés.',
  },
  {
    id: 'mid-game-side-lane-discipline',
    name: 'Side Lane Discipline',
    nameFr: 'Discipline side lane',
    description: 'Reduce pointless rotations and always know your lane assignment.',
    descriptionFr: 'Réduire les rotations inutiles et toujours savoir quelle lane occuper.',
    objectiveIds: ['lane_assignment', 'rotation_positioning', 'tempo'],
    selectedKpiIds: [
      'assignment_awareness', 'pressure_distribution',
      'side_lane_fog', 'catch_prevention',
      'reset_timing', 'sequence_chaining',
    ],
    customNote: 'Réduire les rotations inutiles et toujours savoir quelle lane tu dois occuper avant de bouger.',
  },

  // ── Teamfighting ─────────────────────────────────────────────────────────────

  {
    id: 'front-to-back-cleaner',
    name: 'Cleaner Front-to-Back',
    nameFr: 'Front-to-back plus propre',
    description: 'Enter fights with a clear priority target and a role-compatible angle.',
    descriptionFr: 'Entrer dans le fight avec une cible prioritaire claire et un angle compatible.',
    objectiveIds: ['role_identification', 'threat_assessment', 'prefight_positioning'],
    selectedKpiIds: [
      'role_clarity', 'focus_target', 'peel_priority',
      'arrival_positioning', 'safe_angle', 'threat_range_awareness',
    ],
    customNote: 'Entrer dans le fight avec une cible prioritaire claire et un angle compatible avec ton rôle.',
  },
  {
    id: 'fight-cooldown-discipline',
    name: 'Fight Cooldown Discipline',
    nameFr: 'Discipline de cooldowns en fight',
    description: 'Play fights around cooldown windows, not instinct.',
    descriptionFr: 'Jouer les fights sur les fenêtres de cooldown plutôt que l\'instinct.',
    objectiveIds: ['cd_management_fights', 'limits_knowledge', 'positioning'],
    selectedKpiIds: [
      'patience', 'key_cd_tracking', 'reengage_timing',
      'power_spike_awareness', 'terrain_usage', 'threat_line_awareness',
    ],
    customNote: 'Jouer les fights sur les fenêtres de cooldown plutôt que sur l\'instinct ou l\'urgence.',
  },

  // ── Consistency / Climbing ───────────────────────────────────────────────────

  {
    id: 'low-death-consistency',
    name: 'Low Death Consistency',
    nameFr: 'Consistance faible en morts',
    description: 'Reduce avoidable deaths and preserve tempo across the whole game.',
    descriptionFr: 'Réduire les morts évitables et préserver le tempo sur toute la partie.',
    objectiveIds: ['tempo', 'map_awareness', 'resilience'],
    selectedKpiIds: [
      'death_regulation', 'threat_anticipation', 'crossmap_reaction',
      'mistake_reset_speed', 'tilt_management',
    ],
    customNote: 'La priorité absolue est de réduire les morts évitables et de préserver ton tempo sur toute la partie.',
  },
  {
    id: 'resource-and-cs-discipline',
    name: 'Resource & CS Discipline',
    nameFr: 'Discipline CS et ressources',
    description: 'Build leads through CS, resources, and clean recalls.',
    descriptionFr: 'Construire des leads via CS, ressources et recalls propres.',
    objectiveIds: ['csing_pathing', 'resource_management', 'recall_timing'],
    selectedKpiIds: [
      'last_hit_accuracy', 'cs_per_min', 'downtime_optimization',
      'mana_management', 'resource_to_wave_conversion', 'recall_window',
    ],
    customNote: 'Construire des leads simples via CS, ressources et recalls propres avant de chercher des outplays.',
  },
  {
    id: 'soloq-carry-snowball',
    name: 'SoloQ Carry Snowball',
    nameFr: 'Snowball carry en SoloQ',
    description: 'Identify carry condition early and accelerate on real windows.',
    descriptionFr: 'Identifier tôt la condition de carry et accélérer sur les vraies fenêtres.',
    objectiveIds: ['wincon_identification', 'aggression_calibration', 'decision_making'],
    selectedKpiIds: [
      'draft_reading', 'adapting_wincon',
      'trade_windows', 'all_in_timing',
      'numbers_advantage_play', 'risk_reward_assessment',
    ],
    customNote: 'Identifier tôt la condition de carry puis accélérer uniquement sur les fenêtres qui augmentent vraiment ton avance.',
  },
]

/**
 * Validates that every template references only existing fundamental IDs and
 * KPI IDs that belong to those fundamentals. Returns an array of error strings
 * (empty if all templates are valid).
 */
export function validateTemplates(): string[] {
  const allFundamentals = getAllFundamentals()
  const errors: string[] = []

  for (const tpl of SESSION_TEMPLATES) {
    for (const objId of tpl.objectiveIds) {
      const f = allFundamentals.find((ff) => ff.id === objId)
      if (!f) {
        errors.push(`Template "${tpl.id}": unknown objective "${objId}"`)
        continue
      }
      const allKpiIds = new Set([
        ...f.kpis.map((k) => k.id),
        ...(f.subcategories?.flatMap((s) => s.kpis.map((k) => k.id)) ?? []),
      ])
      for (const kpiId of tpl.selectedKpiIds) {
        if (allKpiIds.has(kpiId)) continue
        const belongsToOther = tpl.objectiveIds.some((otherId) => {
          if (otherId === objId) return false
          const other = allFundamentals.find((ff) => ff.id === otherId)
          if (!other) return false
          const otherKpis = new Set([
            ...other.kpis.map((k) => k.id),
            ...(other.subcategories?.flatMap((s) => s.kpis.map((k) => k.id)) ?? []),
          ])
          return otherKpis.has(kpiId)
        })
        if (!belongsToOther) {
          errors.push(`Template "${tpl.id}": KPI "${kpiId}" not found in any of its objectives`)
        }
      }
    }
  }

  return errors
}
