/**
 * One player's stats over one or several games (team stats, team sessions). Its own file so the main process and the
 * shared cores can use it without importing the renderer's ipc.ts (which re-exports it).
 */
export interface SynergyPlayerStats {
  memberId: string
  displayName: string
  role: string
  gamesPlayed: number
  wins: number
  winRate: number
  averages: {
    kda: number
    kills: number
    deaths: number
    assists: number
    cs: number
    csPerMin: number
    damage: number
    damagePerMin: number
    damageTaken: number
    ccTime: number
    visionScore: number
    wardsPlaced: number
    wardsKilled: number
    controlWards: number
    gold: number
    goldPerMin: number
    xpPerMin: number
    damagePerGold: number
  }
  shares: {
    damagePct: number
    goldPct: number
    visionPct: number
    damageTakenPct: number
    ccPct: number
    kpPct: number
  }
  byChampion: Array<{ championKey: string; games: number; wins: number; winRate: number }>
}
