import { create } from 'zustand'

interface Session {
  id: string
  objectiveId: string
  objectiveIds: string
  selectedKpiIds: string
  subObjective: string | null
  customNote: string | null
  status: string
  aiSummary: string | null
  date: string
  games: Game[]
}

interface Game {
  id: string
  matchId: string
  champion: string
  opponentChampion: string | null
  reviewStatus: 'pending' | 'to_be_reviewed' | 'reviewed'
  role: string
  kills: number
  deaths: number
  assists: number
  cs: number
  visionScore: number
  duration: number
  win: boolean
  rank: string | null
  lp: number | null
  gameEndAt: string
  accountName?: string
  accountProfileIconId?: number
  review: Review | null
}

interface Review {
  id: string
  timelineNotes: string
  kpiScores: string
  freeText: string | null
  aiSummary: string | null
  objectiveRespected: boolean
}

interface SessionStore {
  activeSession: Session | null
  loading: boolean

  loadActiveSession: () => Promise<void>
  createSession: (data: { objectiveId: string; objectiveIds?: string[]; selectedKpiIds?: string[]; subObjective?: string; customNote?: string; date?: string; isRetroactive?: boolean }) => Promise<void>
  endSession: (manualSummary?: string) => Promise<void>
  refreshSession: () => Promise<void>
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  activeSession: null,
  loading: false,

  loadActiveSession: async () => {
    set({ loading: true })
    try {
      const session = await window.api.getActiveSession()
      set({ activeSession: session, loading: false })
    } catch {
      set({ activeSession: null, loading: false })
    }
  },

  createSession: async (data) => {
    const session = await window.api.createSession(data)
    set({ activeSession: session })
  },

  endSession: async (manualSummary?: string) => {
    const session = get().activeSession
    if (session) {
      await window.api.endSession(session.id, manualSummary)
      set({ activeSession: null })
    }
  },

  refreshSession: async () => {
    const session = get().activeSession
    if (session) {
      const updated = await window.api.getActiveSession()
      set({ activeSession: updated })
    }
  },
}))
