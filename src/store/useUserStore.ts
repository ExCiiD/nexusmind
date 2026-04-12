import { create } from 'zustand'

interface User {
  id: string
  displayName: string
  summonerName: string
  puuid: string
  tagLine: string
  region: string
  assessmentFreqDays: number
  nextAssessmentAt: string
  xp: number
  streakDays: number
  lastActiveDate: string | null
  createdAt: string
  mainRole: string | null
  profileIconId: number
  isActive: boolean
  autoRecord: boolean
  recordingPath: string | null
  externalRecordingPath: string | null
  discordWebhookUrl: string | null
  recordQuality: string
  recordFps: number
  recordEncoder: string
  recordScope: string
  recordAllowCustom: boolean
  allowDesktopFallback: boolean
}

interface UserStore {
  user: User | null
  gameEndData: any | null
  loading: boolean

  loadUser: () => Promise<void>
  setUser: (user: User) => void
  clearUser: () => void
  setGameEndData: (data: any) => void
  clearGameEndData: () => void
  addXp: (amount: number) => void
}

export const useUserStore = create<UserStore>((set, get) => ({
  user: null,
  gameEndData: null,
  loading: true,

  loadUser: async () => {
    try {
      const user = await window.api.getUser()
      set({ user, loading: false })
    } catch {
      set({ user: null, loading: false })
    }
  },

  setUser: (user) => set({ user }),

  clearUser: () => set({ user: null }),

  setGameEndData: (data) => set({ gameEndData: data }),

  clearGameEndData: () => set({ gameEndData: null }),

  addXp: (amount) => {
    const user = get().user
    if (user) {
      set({ user: { ...user, xp: user.xp + amount } })
    }
  },
}))
