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

interface GameStore {
  stats: GameStats | null
  progressData: ProgressPoint[]
  gameHistory: any[]
  loading: boolean

  loadStats: () => Promise<void>
  loadProgressData: () => Promise<void>
  loadGameHistory: (limit?: number) => Promise<void>
}

export const useGameStore = create<GameStore>((set) => ({
  stats: null,
  progressData: [],
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

  loadGameHistory: async (limit = 20) => {
    try {
      const games = await window.api.getGameHistory(limit)
      set({ gameHistory: games })
    } catch {
      /* empty */
    }
  },
}))
