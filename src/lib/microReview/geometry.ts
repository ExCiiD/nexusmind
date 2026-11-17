/**
 * Summoner's Rift geometry (15000 × 15000, blue base at (0,0), red base at
 * (14800,14800)). Pure helpers shared by the anomaly detector and the QCM
 * generator. Coordinates are Riot's timeline coordinates.
 */

export interface Point { x: number; y: number }
export type TeamId = 100 | 200

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
