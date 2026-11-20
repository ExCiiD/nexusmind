import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUserStore } from '@/store/useUserStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useToast } from '@/hooks/useToast'
import { ToastAction } from '@/components/ui/toast'
import { invalidateCached } from '@/lib/queryCache'

/**
 * Handles post-match navigation inside React Router (HashRouter-safe). `window.location.hash`
 * alone can fail to trigger route updates reliably when the shell is minimized/restored.
 */
export function GameEndNav() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { toast } = useToast()
  const user = useUserStore((s) => s.user)

  useEffect(() => {
    if (!user) return
    const off = window.api.onGameEnd((data) => {
      // A new game: the cached game lists (dashboard, history, stats) refetch, still shown meanwhile.
      invalidateCached('games:')
      if (data?.game?.id && data.isSessionEligible !== false) {
        navigate(`/review?gameId=${encodeURIComponent(data.game.id)}`, { replace: true })
      }

      if (data?.isOffRole && data?.game?.id) {
        const gameId = data.game.id as string
        const playedRole = (data.stats?.role as string | undefined) ?? t('session.offRole.unknownRole')
        toast({
          title: t('session.offRole.title'),
          description: t('session.offRole.description', { role: playedRole }),
          variant: 'destructive',
          duration: 12000,
          action: (
            <ToastAction
              altText={t('session.offRole.actionAlt')}
              onClick={async () => {
                await window.api.deleteGame(gameId)
                navigate('/session', { replace: true })
              }}
            >
              {t('session.offRole.action')}
            </ToastAction>
          ),
        })
      }
    })
    return off
  }, [navigate, t, toast, user])

  // Subscribe to the post-enrich `game:updated` signal — fired when the
  // background Match-V5 enrich has replaced the provisional `win: false`
  // placeholder with the real result. Without this, victories that
  // ended via enemy FF could keep showing as "Defeat" until the user
  // navigated away and back.
  useEffect(() => {
    if (!user) return
    const off = window.api.onGameUpdated(() => {
      invalidateCached('games:')
      useSessionStore.getState().refreshSession()
    })
    return off
  }, [user])

  return null
}
