import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { sessionPrefill, type CodexEntry } from '@/lib/microReview/codex'

export interface SessionPrefillState { prefill: { objectiveIds: string[]; customNote: string; codexId: string } }

/** "Préparer ma prochaine session": opens the session setup with the Codex objective + drill pre-filled. */
export function usePrepareSession() {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  return useCallback((entry: CodexEntry) => {
    const state: SessionPrefillState = { prefill: sessionPrefill(entry, i18n.language) }
    navigate('/session', { state })
  }, [navigate, i18n.language])
}
