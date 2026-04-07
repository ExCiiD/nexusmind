import { create } from 'zustand'

interface GameStats {
  totalGames: number
  wins: number
  losses: number
  avgKDA: number
  avgCSPerMin: number
  avgVisionScore: number
  objectiveSuccessRate: number
}

interface ProgressPoint {
  date: string
  fundamentalId: string
  score: number
}

export interface KpiTimelinePoint {
  date: string
  objectiveId: string
  avgScore: number
  gamesReviewed: number
}

interface GameStore {
  stats: GameStats | null
  progressData: ProgressPoint[]
  kpiTimeline: KpiTimelinePoint[]
  gameHistory: any[]
  loading: boolean

  loadStats: () => Promise<void>
  loadProgressData: () => Promise<void>
  loadKpiTimeline: () => Promise<void>
  loadGameHistory: (limit?: number) => Promise<void>
}

export const useGameStore = create<GameStore>((set) => ({
  stats: null,
  progressData: [],
  kpiTimeline: [],
  gameHistory: [],
  loading: false,

  loadStats: async () => {
    set({ loading: true })
    try {
      const stats = await window.api.getSessionStats()
      set({ stats, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  loadProgressData: async () => {
    try {
      const data = await window.api.getProgressData()
      set({ progressData: data })
    } catch {
      /* empty */
    }
  },

  loadKpiTimeline: async () => {
    try {
      const data = await window.api.getKpiTimeline()
      set({ kpiTimeline: data })
    } catch {
      /* empty */
    }
  },

  loadGameHistory: async (limit = 20) => {
    try {
      const games = await window.api.getGameHistory(limit)
      set({ gameHistory: games })
    } catch {
      /* empty */
    }
  },
}))
