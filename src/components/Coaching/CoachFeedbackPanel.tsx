import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCollab } from '@/hooks/useCollab'
import { CommentThread } from './CommentThread'

/**
 * Player side of a review: the coach's comments on it, with replies.
 * Renders nothing when the player is in no group or there is no feedback yet.
 */
export function CoachFeedbackPanel({ reviewId, gameId }: { reviewId: string; gameId?: string }) {
  const { t } = useTranslation()
  const { available, myUserId, groups, nameOf } = useCollab()
  const [count, setCount] = useState(0)

  if (!available || !myUserId || groups.length === 0) return null

  return (
    <Card className={count === 0 ? 'hidden' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-hextech-gold" />
          {t('coaching.feedback.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CommentThread
          reviewId={reviewId}
          gameId={gameId}
          myUserId={myUserId}
          authorName={nameOf}
          hideWhenEmpty
          onLoaded={(list) => setCount(list.length)}
        />
      </CardContent>
    </Card>
  )
}
