import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, MessageSquare } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AssignedObjectivesCard } from '@/components/Coaching/AssignedObjectivesCard'
import { useCollab } from '@/hooks/useCollab'
import type { ReviewComment } from '@/lib/collab'
import { listScrims, type Scrim } from '../scrims'

/** What changed since you last opened your PC: coach feedback, objectives, next scrims. */
export function HomePage() {
  const { t, i18n } = useTranslation()
  const { groups, nameOf } = useCollab()
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [scrims, setScrims] = useState<Scrim[]>([])

  useEffect(() => {
    window.api.collabMyOpenComments().then(setComments).catch(() => setComments([]))
  }, [])
  useEffect(() => {
    listScrims(groups.map((g) => g.id))
      .then((all) => setScrims(all.filter((s) => s.status === 'planned' && Date.parse(s.scheduledAt) > Date.now() - 3 * 3600_000).slice(0, 3)))
      .catch(() => setScrims([]))
  }, [groups])

  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? ''

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('web.home.title')}</h1>

      <AssignedObjectivesCard />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-hextech-gold" />{t('web.home.feedback')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {comments.length === 0 ? (
            <p className="text-sm text-hextech-text-dim">{t('web.home.noFeedback')}</p>
          ) : (
            <ul className="space-y-2">
              {comments.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link to={`/reviews?review=${encodeURIComponent(c.reviewId)}`} className="block rounded-lg border border-hextech-border-dim p-3 text-sm hover:border-hextech-gold/40">
                    <div className="mb-1 text-xs text-hextech-text-dim">
                      {nameOf(c.authorId)} · {new Date(c.createdAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                    <p className="line-clamp-2 text-hextech-text">{c.body}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-hextech-gold" />{t('web.home.nextScrims')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scrims.length === 0 ? (
            <p className="text-sm text-hextech-text-dim">{t('web.home.noScrims')}</p>
          ) : (
            <ul className="space-y-2">
              {scrims.map((s) => (
                <li key={s.id}>
                  <Link to={`/scrims?scrim=${s.id}`} className="flex items-center justify-between rounded-lg border border-hextech-border-dim p-3 text-sm hover:border-hextech-gold/40">
                    <span>
                      <span className="text-hextech-text-bright">{s.title}</span>
                      {s.opponent && <span className="text-hextech-text-dim"> · {s.opponent}</span>}
                      <span className="block text-xs text-hextech-text-dim">{groupName(s.groupId)}</span>
                    </span>
                    <span className="text-xs text-hextech-gold">
                      {new Date(s.scheduledAt).toLocaleString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
