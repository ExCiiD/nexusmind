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
  recordAudioDesktop: boolean
  recordAudioDesktopDevice: string | null
  recordAudioMic: boolean
  recordAudioMicDevice: string | null
  recordInBackground: boolean
  reviewPopup: boolean
}

interface UserStore {
  user: User | null
  /** True until the first loadUser() settles (App waits for it before routing). */
  loading: boolean

  loadUser: () => Promise<void>
  /** Re-reads the user after the main process changed it (XP). A failed read keeps the current user. */
  refreshUser: () => Promise<void>
  setUser: (user: User) => void
  clearUser: () => void
  addXp: (amount: number) => void
}

export const useUserStore = create<UserStore>((set, get) => ({
  user: null,
  loading: true,

  loadUser: async () => {
    try {
      const user = await window.api.getUser()
      set({ user, loading: false })
    } catch {
      set({ user: null, loading: false })
    }
  },

  refreshUser: async () => {
    try {
      const user = await window.api.getUser()
      if (user) set({ user })
    } catch { /* keep the user shown */ }
  },

  setUser: (user) => set({ user }),

  clearUser: () => set({ user: null }),

  addXp: (amount) => {
    const user = get().user
    if (user) {
      set({ user: { ...user, xp: user.xp + amount } })
    }
  },
}))
