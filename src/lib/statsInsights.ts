/**
 * Stats page → "Analyse" tab. Pure — no I/O. Everything here is derived
 * from the match-history rows the renderer already gets
 * (`window.api.getMatchHistoryWithStatus`, capped at 50 games), so the tab
 * answers "what makes me win or lose" without any new backend work.
 *
 * Every helper returns `null`/empty rather than a misleading number when
 * the sample is too small: a 1-game "100% win rate after a loss" is noise.
 */

export interface InsightGame {
  matchId: string
  champion: string
  kills: number
  deaths: number
  assists: number
  cs: number
  visionScore: number
  /** Seconds. */
  duration: number
  win: boolean
  gameEndAt: string
}

/** Below this many games a bucket is shown greyed out as "not enough data". */
export const MIN_SAMPLE = 3

const mins = (g: InsightGame) => Math.max(g.duration / 60, 1)
const kdaOf = (k: number, d: number, a: number) => (d > 0 ? (k + a) / d : k + a)
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0)

export interface ChampionRow {
  champion: string
  games: number
  wins: number
  winrate: number
  kda: number
  csPerMin: number
  avgDeaths: number
}

export function championPool(games: InsightGame[]): ChampionRow[] {
  const by = new Map<string, InsightGame[]>()
  for (const g of games) {
    if (!g.champion) continue
    const list = by.get(g.champion) ?? []
    list.push(g)
    by.set(g.champion, list)
  }
  return [...by.entries()]
    .map(([champion, list]) => {
      const k = list.reduce((s, g) => s + g.kills, 0)
      const d = list.reduce((s, g) => s + g.deaths, 0)
      const a = list.reduce((s, g) => s + g.assists, 0)
      const wins = list.filter((g) => g.win).length
      return {
        champion,
        games: list.length,
        wins,
        winrate: pct(wins, list.length),
        kda: kdaOf(k, d, a),
        csPerMin: mean(list.map((g) => g.cs / mins(g))),
        avgDeaths: d / list.length,
      }
    })
    .sort((x, y) => y.games - x.games || y.winrate - x.winrate)
}

export interface SplitMetric {
  key: 'deaths' | 'kda' | 'csPerMin' | 'visionPerMin' | 'duration'
  wins: number
  losses: number
  /** True when a higher value is the better outcome. */
  higherIsBetter: boolean
}

/** Average of a few per-game metrics in wins vs. in losses — the gap is
 *  the "what changes when I lose" answer. Null until both sides have a
 *  minimal sample. */
export function winLossSplit(games: InsightGame[]): SplitMetric[] | null {
  const W = games.filter((g) => g.win)
  const L = games.filter((g) => !g.win)
  if (W.length < MIN_SAMPLE || L.length < MIN_SAMPLE) return null
  const side = (list: InsightGame[]) => ({
    deaths: mean(list.map((g) => g.deaths)),
    kda: mean(list.map((g) => kdaOf(g.kills, g.deaths, g.assists))),
    csPerMin: mean(list.map((g) => g.cs / mins(g))),
    visionPerMin: mean(list.map((g) => g.visionScore / mins(g))),
    duration: mean(list.map((g) => g.duration / 60)),
  })
  const w = side(W)
  const l = side(L)
  const keys: Array<[SplitMetric['key'], boolean]> = [
    ['deaths', false], ['kda', true], ['csPerMin', true], ['visionPerMin', true], ['duration', true],
  ]
  return keys.map(([key, higherIsBetter]) => ({ key, wins: w[key], losses: l[key], higherIsBetter }))
}

/** The split metric whose relative gap between wins and losses is the
 *  largest (duration excluded: it's a consequence, not a lever). */
export function biggestLever(split: SplitMetric[] | null): SplitMetric | null {
  if (!split) return null
  // Only metrics that are actually worse in losses are levers.
  const levers = split.filter((m) => m.key !== 'duration' && (m.higherIsBetter ? m.losses < m.wins : m.losses > m.wins))
  const rel = (m: SplitMetric) => Math.abs(m.wins - m.losses) / Math.max(Math.abs(m.wins), Math.abs(m.losses), 0.01)
  return levers.sort((a, b) => rel(b) - rel(a))[0] ?? null
}

export interface Bucket {
  key: string
  games: number
  wins: number
  winrate: number
  enough: boolean
}

function bucketize(games: InsightGame[], keys: string[], keyOf: (g: InsightGame) => string): Bucket[] {
  return keys.map((key) => {
    const list = games.filter((g) => keyOf(g) === key)
    const wins = list.filter((g) => g.win).length
    return { key, games: list.length, wins, winrate: pct(wins, list.length), enough: list.length >= MIN_SAMPLE }
  })
}

export const DURATION_KEYS = ['short', 'mid', 'long'] as const
/** < 25 min, 25–32 min, > 32 min. */
export function winrateByDuration(games: InsightGame[]): Bucket[] {
  return bucketize(games, [...DURATION_KEYS], (g) => (g.duration < 25 * 60 ? 'short' : g.duration <= 32 * 60 ? 'mid' : 'long'))
}

export const DAYPART_KEYS = ['morning', 'afternoon', 'evening', 'night'] as const
/** Local time of the game end: 6–12, 12–18, 18–24, 0–6. */
export function winrateByDaypart(games: InsightGame[]): Bucket[] {
  return bucketize(games, [...DAYPART_KEYS], (g) => {
    const h = new Date(g.gameEndAt).getHours()
    return h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
  })
}

export interface TiltReport {
  afterWin: Bucket
  afterLoss: Bucket
  /** Longest run of consecutive losses in the sample. */
  longestLossStreak: number
}

/** Two games count as "back to back" when the second one ended within
 *  this window after the first — a rough proxy for the same play session. */
const SAME_SESSION_MS = 90 * 60 * 1000

/** Win rate of the game played right after a win vs. right after a loss
 *  (same sitting only). A big gap is the classic tilt signal. */
export function tiltReport(games: InsightGame[]): TiltReport {
  const chrono = [...games].sort((a, b) => new Date(a.gameEndAt).getTime() - new Date(b.gameEndAt).getTime())
  const afterWin: InsightGame[] = []
  const afterLoss: InsightGame[] = []
  let streak = 0
  let longest = 0
  for (let i = 0; i < chrono.length; i++) {
    const g = chrono[i]
    streak = g.win ? 0 : streak + 1
    longest = Math.max(longest, streak)
    if (i === 0) continue
    const prev = chrono[i - 1]
    const gap = new Date(g.gameEndAt).getTime() - new Date(prev.gameEndAt).getTime()
    // gameEndAt → gameEndAt includes the second game's own length.
    if (gap > SAME_SESSION_MS + g.duration * 1000) continue
    ;(prev.win ? afterWin : afterLoss).push(g)
  }
  const b = (key: string, list: InsightGame[]): Bucket => {
    const wins = list.filter((g) => g.win).length
    return { key, games: list.length, wins, winrate: pct(wins, list.length), enough: list.length >= MIN_SAMPLE }
  }
  return { afterWin: b('afterWin', afterWin), afterLoss: b('afterLoss', afterLoss), longestLossStreak: longest }
}

/** Riot match data carries the Data Dragon id ("MonkeyKing", "LeeSin",
 *  "Khazix"); this turns it into the name players know. */
const CHAMPION_NAME_EXCEPTIONS: Record<string, string> = {
  MonkeyKing: 'Wukong', DrMundo: 'Dr. Mundo', KSante: "K'Sante", Chogath: "Cho'Gath", Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix", Velkoz: "Vel'Koz", Belveth: "Bel'Veth", KogMaw: "Kog'Maw", RekSai: "Rek'Sai",
  Nunu: 'Nunu & Willump', Renata: 'Renata Glasc', FiddleSticks: 'Fiddlesticks', Leblanc: 'LeBlanc',
  JarvanIV: 'Jarvan IV', TahmKench: 'Tahm Kench', MasterYi: 'Master Yi',
}
export function championLabel(id: string): string {
  return CHAMPION_NAME_EXCEPTIONS[id] ?? id.replace(/([a-z])([A-Z])/g, '$1 $2')
}
