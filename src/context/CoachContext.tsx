import { createContext, useContext, useState, ReactNode } from 'react'

export interface StudentEntry {
  relationId: string
  supabaseId: string
  displayName: string
  puuid: string
}

interface CoachContextValue {
  viewingStudent: StudentEntry | null
  setViewingStudent: (student: StudentEntry | null) => void
  isCoachView: boolean
}

const CoachContext = createContext<CoachContextValue>({
  viewingStudent: null,
  setViewingStudent: () => {},
  isCoachView: false,
})

export function CoachProvider({ children }: { children: ReactNode }) {
  const [viewingStudent, setViewingStudent] = useState<StudentEntry | null>(null)

  return (
    <CoachContext.Provider
      value={{
        viewingStudent,
        setViewingStudent,
        isCoachView: viewingStudent !== null,
      }}
    >
      {children}
    </CoachContext.Provider>
  )
}

export function useCoach() {
  return useContext(CoachContext)
}
