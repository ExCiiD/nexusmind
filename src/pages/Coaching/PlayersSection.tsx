import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Flag, GraduationCap, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { cn } from '@/lib/utils'
import { CommentThread } from '@/components/Coaching/CommentThread'
import { collabErrorKey, type AssignedObjective, type Group, type PlayerSessionView } from '@/lib/collab'

interface Props {
  staffGroups: Group[]
  myUserId: string
  nameOf: (userId: string) => string
}

interface PlayerRef { userId: string; groupId: string; label: string }

/** Coach / analyst view: a player's sessions and reviews, comments, assignments. */
export function PlayersSection({ staffGroups, myUserId, nameOf }: Props) {
  const { t } = useTranslation()
  const players = useMemo<PlayerRef[]>(() => {
    const seen = new Map<string, PlayerRef>()
    for (const g of staffGroups) {
      for (const m of g.members) {
        if (m.role === 'player' && m.userId !== myUserId && !seen.has(m.userId)) {
          seen.set(m.userId, { userId: m.userId, groupId: g.id, label: `${m.displayName || m.riotId || '—'} · ${g.name}` })
        }
      }
    }
    return [...seen.values()]
  }, [staffGroups, myUserId])
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    if (!selected && players[0]) setSelected(players[0].userId)
  }, [players, selected])

  const player = players.find((p) => p.userId === selected)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-hextech-gold" />{t('coaching.players.title')}
        </CardTitle>
        <CardDescription>{t('coaching.players.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {players.length === 0 ? (
          <p className="text-sm text-hextech-text-dim">{t('coaching.players.none')}</p>
        ) : (
          <>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-full md:w-96"><SelectValue /></SelectTrigger>
              <SelectContent>
                {players.map((p) => <SelectItem key={p.userId} value={p.userId}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {player && <PlayerView key={player.userId} player={player} myUserId={myUserId} nameOf={nameOf} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function PlayerView({ player, myUserId, nameOf }: { player: PlayerRef; myUserId: string; nameOf: (id: string) => string }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const fundamentals = useLocalizedFundamentals()
  const allObjectives = useMemo(() => fundamentals.flatMap((c) => c.fundamentals.map((f) => ({ id: f.id, label: f.label }))), [fundamentals])
  const label = (id: string) => allObjectives.find((o) => o.id === id)?.label ?? id

  const [sessions, setSessions] = useState<PlayerSessionView[] | null>(null)
  const [assignments, setAssignments] = useState<AssignedObjective[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [objective, setObjective] = useState('')
  const [note, setNote] = useState('')
  const [due, setDue] = useState('')
  const [assigning, setAssigning] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        window.api.collabPlayerSessions(player.userId),
        window.api.collabListAssignments(player.userId, false),
      ])
      setSessions(s)
      setAssignments(a)
    } catch (err) {
      setSessions([])
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    }
  }, [player.userId, t, toast])

  useEffect(() => { load() }, [load])

  const assign = async () => {
    if (!objective) return
    setAssigning(true)
    try {
      await window.api.collabAssignObjective({
        groupId: player.groupId, playerId: player.userId, objectiveIds: [objective],
        note: note.trim() || null, dueDate: due || null,
      })
      setObjective(''); setNote(''); setDue('')
      toast({ title: t('coaching.assign.sent'), variant: 'gold' })
      await load()
    } catch (err) {
      toast({ title: t(collabErrorKey(err)), variant: 'destructive' })
    } finally {
      setAssigning(false)
    }
  }

  const fmtDate = (v: number | string | null) => (v ? new Date(typeof v === 'number' ? v : Date.parse(v)).toLocaleDateString(i18n.language) : '—')

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-hextech-text-bright">
          <Flag className="h-4 w-4 text-hextech-gold" />{t('coaching.assign.title')}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={objective} onValueChange={setObjective}>
            <SelectTrigger className="w-64"><SelectValue placeholder={t('coaching.assign.pick')} /></SelectTrigger>
            <SelectContent>
              {allObjectives.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-44" aria-label={t('coaching.assign.due')} />
        </div>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder={t('coaching.assign.notePlaceholder')} />
        <Button size="sm" onClick={assign} disabled={!objective || assigning}>
          {assigning && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('coaching.assign.send')}
        </Button>
        {assignments.length > 0 && (
          <ul className="space-y-1 pt-2 text-xs text-hextech-text-dim">
            {assignments.map((a) => (
              <li key={a.id}>
                {a.objectiveIds.map(label).join(', ')} — {t(`coaching.assign.status.${a.status}`)} · {new Date(a.createdAt).toLocaleDateString(i18n.language)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {sessions === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-hextech-text-dim" />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-hextech-text-dim">{t('coaching.players.noData')}</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="rounded-lg border border-hextech-border-dim">
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(open === s.id ? null : s.id)}>
                {open === s.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="text-hextech-text-bright">{fmtDate(s.date)}</span>
                <span className="truncate text-hextech-text">{s.objectiveIds.map(label).join(', ')}</span>
                <span className="ml-auto text-xs text-hextech-text-dim">
                  {t('coaching.players.games', { count: s.games.length })} · {t('coaching.players.reviews', { count: s.games.filter((g) => g.review).length })}
                </span>
              </button>
              {open === s.id && (
                <div className="space-y-3 border-t border-hextech-border-dim p-3">
                  {s.sessionConclusion && <p className="text-sm italic text-hextech-text">{s.sessionConclusion}</p>}
                  {s.games.map((g) => (
                    <div key={g.id} className="space-y-2 rounded-lg bg-hextech-elevated/30 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={cn('font-medium', g.win ? 'text-hextech-green' : 'text-[#FF4655]')}>
                          {g.win ? t('coaching.players.win') : t('coaching.players.loss')}
                        </span>
                        <span className="text-hextech-text-bright">{g.champion}</span>
                        <span className="text-hextech-text-dim">{g.kills}/{g.deaths}/{g.assists} · {g.role ?? ''}</span>
                      </div>
                      {g.review ? (
                        <>
                          {g.review.freeText && <p className="whitespace-pre-wrap text-sm text-hextech-text">{g.review.freeText}</p>}
                          {g.review.timelineNotes.length > 0 && (
                            <ul className="space-y-0.5 text-xs text-hextech-text">
                              {g.review.timelineNotes.map((n, i) => <li key={i}><span className="text-hextech-gold">{n.time}</span> {n.note}</li>)}
                            </ul>
                          )}
                          {Object.keys(g.review.kpiScores).length > 0 && (
                            <div className="flex flex-wrap gap-1 text-xs">
                              {Object.entries(g.review.kpiScores).map(([k, v]) => (
                                <span key={k} className="rounded bg-hextech-dark px-1.5 py-0.5 text-hextech-text-dim">{k}: {v}/5</span>
                              ))}
                            </div>
                          )}
                          <CommentThread
                            reviewId={g.review.id}
                            playerId={player.userId}
                            groupId={player.groupId}
                            gameId={g.id}
                            myUserId={myUserId}
                            authorName={nameOf}
                          />
                        </>
                      ) : (
                        <p className="text-xs text-hextech-text-dim">{t('coaching.players.noReview')}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
