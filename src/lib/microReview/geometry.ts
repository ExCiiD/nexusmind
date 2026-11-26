/**
 * Summoner's Rift geometry (about 15000 × 15000, blue base at (0,0), red base
 * at (14800,14800)). Pure helpers shared by the anomaly detector, the QCM
 * generator and the micro-review minimap. Coordinates are Riot's timeline
 * coordinates.
 */

export interface Point { x: number; y: number }
export type TeamId = 100 | 200

/** What Riot's minimap of Summoner's Rift (Data Dragon `img/map/map11.png`)
 *  covers, in timeline coordinates — Riot's own map data for map 11. */
export const RIFT_BOUNDS = { minX: -120, minY: -120, maxX: 14870, maxY: 14980 } as const

/** A game position on the minimap, as fractions of its width and height
 *  (0 to 1, y pointing down as on screen). */
export function toMinimap(p: Point): { x: number; y: number } {
  return {
    x: (p.x - RIFT_BOUNDS.minX) / (RIFT_BOUNDS.maxX - RIFT_BOUNDS.minX),
    y: 1 - (p.y - RIFT_BOUNDS.minY) / (RIFT_BOUNDS.maxY - RIFT_BOUNDS.minY),
  }
}

/** Baron / Herald / Voidgrubs pit (top side of the river). */
export const BARON_PIT: Point = { x: 5007, y: 10471 }
/** Dragon / Elder pit (bot side of the river). */
export const DRAGON_PIT: Point = { x: 9866, y: 4414 }
/** "Near an objective" radius. */
export const OBJECTIVE_RADIUS = 2800
/** Allies within this radius count as "nearby" at a death. */
export const ALLY_RADIUS = 2500
/** Ward search radius around a pit before an objective. */
export const WARD_RADIUS = 3500

/** x+y below this → blue half; above RED_SIDE_MIN → red half; between → river band. */
export const BLUE_SIDE_MAX = 14500
export const RED_SIDE_MIN = 15500
/** Both pits and their entrances are neutral ground, whichever half their centre falls in. */
export const PIT_RIVER_RADIUS = 1500
/** Where a champion stands when it respawns. */
export const FOUNTAIN: Record<TeamId, Point> = { 100: { x: 400, y: 450 }, 200: { x: 14400, y: 14400 } }

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

export type Pit = 'baron' | 'dragon'
export function nearestPit(p: Point): { pit: Pit; distance: number } {
  const b = dist(p, BARON_PIT)
  const d = dist(p, DRAGON_PIT)
  return b <= d ? { pit: 'baron', distance: b } : { pit: 'dragon', distance: d }
}

export type Territory = 'own' | 'enemy' | 'river'
/**
 * Whose ground a point is on. The dragon pit is carved into the blue bank
 * (x+y = 14280) and the Baron pit into the red one (15478): without the pit
 * rule the same play would read "own side" for one team and "river" for the
 * other, so both pits are river for both teams.
 */
export function territoryOf(p: Point, team: TeamId): Territory {
  if (nearestPit(p).distance <= PIT_RIVER_RADIUS) return 'river'
  const s = p.x + p.y
  if (s < BLUE_SIDE_MAX) return team === 100 ? 'own' : 'enemy'
  if (s > RED_SIDE_MIN) return team === 200 ? 'own' : 'enemy'
  return 'river'
}

export type LaneBucket = 'TOP' | 'MID' | 'BOT' | 'JUNGLE'
/** Lane corridors: top = left/top edges, bot = bottom/right edges, mid = the diagonal. */
export function laneOf(p: Point): LaneBucket {
  // Base corners sit at both ends of the mid diagonal.
  if ((p.x < 2200 && p.y < 2200) || (p.x > 12800 && p.y > 12800)) return 'MID'
  if (p.x < 2200 || p.y > 12800) return 'TOP'
  if (p.y < 2200 || p.x > 12800) return 'BOT'
  if (Math.abs(p.x - p.y) < 1700) return 'MID'
  return 'JUNGLE'
}

export type Zone =
  | 'own-base' | 'enemy-base'
  | 'top-lane' | 'mid-lane' | 'bot-lane'
  | 'top-river' | 'bot-river'
  | 'own-jungle' | 'enemy-jungle'

/** Human-meaningful zone for the one-line summary ("Rivière haute"). */
export function zoneOf(p: Point, team: TeamId): Zone {
  const blueBase = p.x < 4200 && p.y < 4200 && p.x + p.y < 6500
  const redBase = p.x > 10600 && p.y > 10600 && p.x + p.y > 23500
  if (blueBase) return team === 100 ? 'own-base' : 'enemy-base'
  if (redBase) return team === 200 ? 'own-base' : 'enemy-base'
  const lane = laneOf(p)
  if (lane === 'TOP') return 'top-lane'
  if (lane === 'BOT') return 'bot-lane'
  if (lane === 'MID') return 'mid-lane'
  // For naming, the river is wider than the strict territory band: the pits
  // and their entrances read as "river" to a player.
  const s = p.x + p.y
  if (Math.abs(s - 15000) <= 1500 || nearestPit(p).distance <= PIT_RIVER_RADIUS) return p.y > p.x ? 'top-river' : 'bot-river'
  return territoryOf(p, team) === 'own' ? 'own-jungle' : 'enemy-jungle'
}

// ── Tempo line (V3) ─────────────────────────────────────────────────────
/**
 * Progress of a point along the base-to-base diagonal, from the player's own
 * fountain (0) to the enemy one (1): D = (x + y) / 30000 for blue side,
 * mirrored (1 − D) for red side.
 */
export function tempoLineD(p: Point, team: TeamId): number {
  const d = (p.x + p.y) / 30000
  return team === 100 ? d : 1 - d
}

// ── Pits (V4, choke points) ─────────────────────────────────────────────
/** A fight is "around the pit" when its kills happen within this distance of the pit centre. */
export const PIT_FIGHT_RADIUS = 3000
/** Standing within this distance of the pit centre = inside the pit (not holding a choke point). */
export const PIT_INSIDE_RADIUS = 900
export const pitCenter = (pit: Pit): Point => (pit === 'baron' ? BARON_PIT : DRAGON_PIT)

// ── Turrets (V5) ────────────────────────────────────────────────────────
/** Outer (T1) turrets, by owning team and lane, as Riot's BUILDING_KILL events place them. */
export const OUTER_TURRETS: Record<TeamId, Record<'TOP' | 'MID' | 'BOT', Point>> = {
  100: { TOP: { x: 981, y: 10441 }, MID: { x: 5846, y: 6396 }, BOT: { x: 10504, y: 1029 } },
  200: { TOP: { x: 4318, y: 13875 }, MID: { x: 8955, y: 8510 }, BOT: { x: 13866, y: 4505 } },
}

/** Every turret, as Riot's BUILDING_KILL events place them: per lane outer,
 *  inner and inhibitor turrets, then the two nexus turrets. Drawn on the
 *  minimap; the outer ones are OUTER_TURRETS. */
export const TURRETS: Record<TeamId, Point[]> = {
  100: [
    OUTER_TURRETS[100].TOP, { x: 1512, y: 6699 }, { x: 1169, y: 4287 },
    OUTER_TURRETS[100].MID, { x: 5048, y: 4812 }, { x: 3651, y: 3696 },
    OUTER_TURRETS[100].BOT, { x: 6919, y: 1483 }, { x: 4281, y: 1253 },
    { x: 1748, y: 2270 }, { x: 2177, y: 1807 },
  ],
  200: [
    OUTER_TURRETS[200].TOP, { x: 7943, y: 13411 }, { x: 10481, y: 13650 },
    OUTER_TURRETS[200].MID, { x: 9767, y: 10113 }, { x: 11134, y: 11207 },
    OUTER_TURRETS[200].BOT, { x: 13327, y: 8226 }, { x: 13624, y: 10572 },
    { x: 12611, y: 13084 }, { x: 13052, y: 12612 },
  ],
}

// ── Base platform (V6) ──────────────────────────────────────────────────
/** "In base" as the V6 brief draws it: x and y under 2000 for blue, over 12800 for red (fountain and nexus platform). */
export const BASE_BOX = { blueMax: 2000, redMin: 12800 } as const
export function inBaseBox(p: Point | null | undefined, team: TeamId): boolean {
  if (!p) return false
  return team === 100 ? p.x < BASE_BOX.blueMax && p.y < BASE_BOX.blueMax : p.x > BASE_BOX.redMin && p.y > BASE_BOX.redMin
}

// ── Places in words (20/11/2026, docs/moteur/engine-reports/2026-11-20-lieux-et-extraits-video-des-cartes.md) ──
// The cards never show a distance ("aucun user ne pourra se situer avec ça"): a point is told as top / mid / bot,
// river top / river bot, a pit named by its objective, "near the [camp] blue / red side", or a base. The rules keep
// deciding in game units (OBJECTIVE_RADIUS, PIT_INSIDE_RADIUS…): only what is shown changes.

export type CampName = 'blue' | 'gromp' | 'wolves' | 'raptors' | 'red' | 'krugs'
export type MapSide = 'blue' | 'red'

/**
 * The 12 jungle camps (camp centre, Riot timeline coordinates, current map). Blue side from the community map data,
 * red side its point mirror. Checked on 200 cached games (20/11/2026): 800 jungler positions at 1:00 and 2:00 sit
 * 400-600 units (median) from the camp they are clearing; blue, red and raptors, the usual first camps, within
 * 450-800. Enough to name the nearest camp, which is all the cards do with it.
 */
export const JUNGLE_CAMPS: Record<MapSide, Record<CampName, Point>> = {
  blue: {
    blue: { x: 3821, y: 8101 }, gromp: { x: 2288, y: 8448 }, wolves: { x: 3783, y: 6495 },
    raptors: { x: 6823, y: 5508 }, red: { x: 7772, y: 4031 }, krugs: { x: 8394, y: 2641 },
  },
  red: {
    blue: { x: 10984, y: 6960 }, gromp: { x: 12703, y: 6443 }, wolves: { x: 11008, y: 8387 },
    raptors: { x: 7852, y: 9324 }, red: { x: 7101, y: 10856 }, krugs: { x: 6317, y: 12146 },
  },
}

export type PitObjective = 'dragon' | 'elder' | 'grubs' | 'herald' | 'baron'

export type Place =
  | { kind: 'lane'; lane: 'top' | 'mid' | 'bot' }
  | { kind: 'river'; side: 'top' | 'bot' }
  | { kind: 'pit'; pit: Pit; objective: PitObjective | null }
  | { kind: 'camp'; camp: CampName; side: MapSide }
  | { kind: 'base'; side: MapSide }

/** The objective a pit holds at `sec` with the 2026 timers (Elder only once it is known to be up). */
export function pitObjectiveAt(pit: Pit, sec: number, opts: { elderUp?: boolean } = {}): PitObjective | null {
  if (pit === 'dragon') return opts.elderUp ? 'elder' : sec >= 300 ? 'dragon' : null
  if (sec >= 1200) return 'baron'
  if (sec >= 900) return 'herald'
  if (sec >= 480) return 'grubs'
  return null
}

/**
 * Where a point is, in the words of the cards. In order: inside a pit (or its entrance), a lane, the river, near a
 * jungle camp, a base. `pitObjective` names the pit when the caller knows what was in it (a card about that very
 * objective); otherwise the 2026 timers decide.
 */
export function placeOf(p: Point, sec: number, opts: { pitObjective?: PitObjective | null; elderUp?: boolean } = {}): Place {
  if (p.x < 4200 && p.y < 4200 && p.x + p.y < 6500) return { kind: 'base', side: 'blue' }
  if (p.x > 10600 && p.y > 10600 && p.x + p.y > 23500) return { kind: 'base', side: 'red' }
  const near = nearestPit(p)
  if (near.distance <= PIT_RIVER_RADIUS) {
    return { kind: 'pit', pit: near.pit, objective: opts.pitObjective !== undefined ? opts.pitObjective : pitObjectiveAt(near.pit, sec, opts) }
  }
  // A camp next to a lane (the raptors sit inside the mid corridor of laneOf) reads as the camp when close to it.
  const camp = nearestCamp(p)
  if (camp.d <= CAMP_RADIUS) return { kind: 'camp', camp: camp.camp, side: camp.side }
  const lane = laneOf(p)
  if (lane === 'TOP') return { kind: 'lane', lane: 'top' }
  if (lane === 'MID') return { kind: 'lane', lane: 'mid' }
  if (lane === 'BOT') return { kind: 'lane', lane: 'bot' }
  if (Math.abs(p.x + p.y - 15000) <= 1500) return { kind: 'river', side: p.y > p.x ? 'top' : 'bot' }
  return { kind: 'camp', camp: camp.camp, side: camp.side }
}

/** Within this distance of a camp centre, a point is "near" that camp even inside a lane corridor. */
export const CAMP_RADIUS = 600

export function nearestCamp(p: Point): { camp: CampName; side: MapSide; d: number } {
  let best: { camp: CampName; side: MapSide; d: number } | null = null
  for (const side of ['blue', 'red'] as const) {
    for (const camp of Object.keys(JUNGLE_CAMPS[side]) as CampName[]) {
      const d = dist(p, JUNGLE_CAMPS[side][camp])
      if (!best || d < best.d) best = { camp, side, d }
    }
  }
  return best!
}
