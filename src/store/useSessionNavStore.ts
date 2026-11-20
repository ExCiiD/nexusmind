import { create } from 'zustand'

/**
 * The sidebar's hint for /team-session/:id: a finished session (its history view is open) belongs to « Sessions
 * d'équipe », a scheduled or live one to Management. Set by TeamSessionHistoryView while it is mounted.
 */
interface SessionNavState {
  endedSessionOpen: boolean
  setEndedSessionOpen: (open: boolean) => void
}

export const useSessionNavStore = create<SessionNavState>((set) => ({
  endedSessionOpen: false,
  setEndedSessionOpen: (open) => set({ endedSessionOpen: open }),
}))
