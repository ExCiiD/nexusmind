import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Hourglass, Loader2 } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/ui/data-state'
import { useToast } from '@/hooks/useToast'
import { DiscussionThread } from '@/components/team/DiscussionThread'
import type { CalendarEvent } from '@/lib/calendar'
import type { NameOf } from '@/hooks/useCollab'
import { type MatchDetailPatch, type MatchEventDetail, type OpponentRole } from '@/lib/matchEvent'
import { OPPONENT_ROLES, applyOpponentRoles, matchErrorKey } from '@/lib/matchEventView'
import { MatchDetailPanel, type MatchPlayerLine } from './MatchDetailPanel'

/**
 * #49: the Planning inspector for a Scrim / Officiel slot — loads its detail (calendarGetMatchEvent) and writes the
 * preparation, review, status and drafts (calendarUpdateMatchDetail). Presence goes through calendarRespond.
 */
export function MatchInspector({ event, groupId, roster, myUserId, nameOf, canEditSlot, canEditPrep, onRespond, onEdit, onDelete, onClose, onChanged }: {
  event: CalendarEvent
  groupId: string
  roster: Array<{ userId: string; displayName: string; role: string }>
  myUserId: string
  nameOf: NameOf
  canEditSlot: boolean
  canEditPrep: boolean
  onRespond: (status: 'confirmed' | 'declined') => void
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
  /** The grid reloads (status, badge). */
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<MatchEventDetail | null | undefined>(undefined)
  const [drafts, setDrafts] = useState<Array<{ id: string; name: string }>>([])
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFailed(null)
    try { setDetail(await window.api.calendarGetMatchEvent!(event.id)) }
    catch (err) { setFailed(matchErrorKey(err)); setDetail(null) }
  }, [event.id])
  useEffect(() => { setDetail(undefined); void load() }, [load, event.updatedAt])
  useEffect(() => {
    window.api.listDrafts().then((d) => setDrafts(d.map((x) => ({ id: x.id, name: x.name || '—' })))).catch(() => setDrafts([]))
  }, [groupId])

  const patch = async (p: MatchDetailPatch) => {
    if (!detail) return
    const { opponentRoles, ...fields } = p
    setDetail(applyOpponentRoles({ ...detail, ...fields }, opponentRoles ?? []))
    try { await window.api.calendarUpdateMatchDetail!(detail.scrimId, p); onChanged() }
    catch (err) { toast({ title: t(matchErrorKey(err)), variant: 'destructive' }); void load() }
  }

  // Our players on the slot, by role (the published roster's), with their answer.
  const players: MatchPlayerLine[] = useMemo(() => {
    const ev = detail?.event ?? event
    const lines = ev.attendeeUserIds.map((userId) => {
      const r = roster.find((x) => x.userId === userId)
      const role = r && (OPPONENT_ROLES as string[]).includes(r.role.toUpperCase()) ? r.role.toUpperCase() as OpponentRole : null
      const answer = ev.responses?.find((x) => x.userId === userId)
      return { userId, name: r?.displayName || nameOf(userId), role, response: answer?.status ?? null, note: answer?.note ?? null }
    })
    return lines.sort((a, b) => (a.role ? OPPONENT_ROLES.indexOf(a.role) : 9) - (b.role ? OPPONENT_ROLES.indexOf(b.role) : 9))
  }, [detail, event, roster, nameOf])

  if (detail === undefined) return <Loader2 className="h-4 w-4 animate-spin text-hextech-text-dim" aria-label={t('common.loading')} />
  if (detail === null && failed === 'planning.match.errors.notDeployed') {
    return <EmptyState icon={Hourglass} title={t('analyst.common.notDeployedTitle')} description={t(failed)} />
  }
  if (detail === null) {
    return <ErrorState title={t('planning.match.loadFailed')} cause={t(failed ?? 'planning.match.errors.NOT_FOUND')} onRetry={() => { void load() }} />
  }
  // The desktop has Coaching (Scouting, Draft Sim); the web has the Team page.
  const onWeb = !window.api.cloudOpenWeb
  return (
    <MatchDetailPanel
      key={detail.scrimId}
      detail={detail}
      players={players}
      myUserId={myUserId}
      canEditSlot={canEditSlot}
      canEditPrep={canEditPrep}
      drafts={drafts}
      onRespond={(present) => onRespond(present ? 'confirmed' : 'declined')}
      onPatch={(p) => { void patch(p) }}
      onOpenScouting={detail.opponent ? () => navigate(`${onWeb ? '/team' : '/coaching'}?tab=scouting&dossier=${encodeURIComponent(detail.opponent!.key)}`) : undefined}
      onPrepareDraft={() => navigate(`${onWeb ? '/team' : '/coaching'}?tab=draft`)}
      onEdit={onEdit}
      onDelete={onDelete}
      onClose={onClose}
      discussion={<DiscussionThread groupId={groupId} subjectType="scrim" subjectId={detail.scrimId} myUserId={myUserId} nameOf={nameOf} isStaff={canEditPrep} />}
    />
  )
}
