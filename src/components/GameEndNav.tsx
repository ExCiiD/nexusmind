import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUserStore } from '@/store/useUserStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useToast } from '@/hooks/useToast'
import { ToastAction } from '@/components/ui/toast'

/**
 * Handles post-match navigation inside React Router (HashRouter-safe). `window.location.hash`
 * alone can fail to trigger route updates reliably when the shell is minimized/restored.
 */
export function GameEndNav() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const user = useUserStore((s) => s.user)

  useEffect(() => {
    if (!user) return
    const off = window.api.onGameEnd((data) => {
      useUserStore.getState().setGameEndData(data)

      if (data?.game?.id && data.isSessionEligible !== false) {
        navigate(`/review?gameId=${encodeURIComponent(data.game.id)}`, { replace: true })
      }

      if (data?.isOffRole && data?.game?.id) {
        const gameId = data.game.id as string
        const playedRole = (data.stats?.role as string | undefined) ?? 'inconnu'
        toast({
          title: '⚠️ Rôle secondaire détecté',
          description: `Tu as joué ${playedRole} — pas ton main role. Retirer cette game de la session ?`,
          variant: 'destructive',
          duration: 12000,
          action: (
            <ToastAction
              altText="Retirer de la session"
              onClick={async () => {
                await window.api.deleteGame(gameId)
                useUserStore.getState().setGameEndData(null)
                navigate('/session', { replace: true })
              }}
            >
              Retirer
            </ToastAction>
          ),
        })
      }
    })
    return off
  }, [navigate, toast, user])

  // Subscribe to the post-enrich `game:updated` signal — fired when the
  // background Match-V5 enrich has replaced the provisional `win: false`
  // placeholder with the real result. Without this, victories that
  // ended via enemy FF could keep showing as "Defeat" until the user
  // navigated away and back.
  useEffect(() => {
    if (!user) return
    const off = window.api.onGameUpdated(() => {
      useSessionStore.getState().refreshSession()
    })
    return off
  }, [user])

  return null
}
