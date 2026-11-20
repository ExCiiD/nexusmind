import { create } from 'zustand'
import { useUserStore } from './useUserStore'

interface Session {
  id: string
  objectiveId: string
  objectiveIds: string
  selectedKpiIds: string
  subObjective: string | null
  customNote: string | null
  status: string
  aiSummary: string | null
  sessionConclusion: string | null
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

  loadActiveSession: () => Promise<void>
  createSession: (data: { objectiveId: string; objectiveIds?: string[]; selectedKpiIds?: string[]; subObjective?: string; customNote?: string; date?: string; isRetroactive?: boolean }) => Promise<void>
  endSession: (sessionConclusion?: string) => Promise<void>
  cancelSession: () => Promise<void>
  updateSession: (data: { objectiveIds?: string[]; selectedKpiIds?: string[]; customNote?: string }) => Promise<void>
  refreshSession: () => Promise<void>
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  activeSession: null,

  loadActiveSession: async () => {
    try {
      const session = await window.api.getActiveSession()
      set({ activeSession: session })
    } catch {
      set({ activeSession: null })
    }
  },

  createSession: async (data) => {
    const session = await window.api.createSession(data)
    set({ activeSession: session })
  },

  endSession: async (sessionConclusion?: string) => {
    const session = get().activeSession
    if (session) {
      await window.api.endSession(session.id, undefined, sessionConclusion)
      set({ activeSession: null })
      // Ending a session gives XP (main process): the sidebar level reads the user store.
      void useUserStore.getState().refreshUser()
    }
  },

  cancelSession: async () => {
    const session = get().activeSession
    if (session) {
      await window.api.cancelSession(session.id)
      set({ activeSession: null })
    }
  },

  updateSession: async (data) => {
    const session = get().activeSession
    if (session) {
      const updated = await window.api.updateSession(session.id, data)
      set({ activeSession: updated })
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
