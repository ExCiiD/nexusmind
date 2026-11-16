import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { MatchHeaderStrip } from './MatchHeaderStrip'
import { TeamSessionStatsTable } from './TeamSessionStatsTable'
import { DuelComparisonTable } from './DuelComparisonTable'
import {
  resolveOurTeamId, buildSideStats, buildHeaderSummary, buildDuelRows, matchParticipantToMember, participantName,
  type RiotMatch,
} from '@/lib/teamSessionStatsCore'
import type { Group } from '@/lib/collab'
import type { TeamSessionGame } from '@/lib/teamSessions'

interface Props {
  game: TeamSessionGame
  group: Group
  canManage: boolean
  /** Called once ourTeamId is resolved+cached for the first time, so the
   *  parent re-fetches and the next render skips resolution entirely. */
  onOurTeamIdResolved: () => void
}

/**
 * One reported game's stats (Phase 4, Planning rework): fetches (or reads
 * the cache for) the raw match, resolves which side is "ours" the first
 * time, then renders the header strip + full stats table + duel
 * comparison. Each game card fetches independently on mount — a session
 * typically has a handful of games, not hundreds, and the match is cached
 * server-side after the first fetch either way.
 */
export function TeamSessionGameCard({ game, group, canManage, onOurTeamIdResolved }: Props) {
  const { t } = useTranslation()
  const [match, setMatch] = useState<RiotMatch | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [ourTeamId, setOurTeamId] = useState<100 | 200 | null>(game.ourTeamId)
  const [enemyTeamName, setEnemyTeamName] = useState(game.enemyTeamName)

  useEffect(() => {
    let cancelled = false
    setError(null)
    window.api.teamSessionFetchMatch(game.id)
      .then(async (raw) => {
        if (cancelled) return
        const m = raw as RiotMatch
        setMatch(m)
        if (!game.ourTeamId) {
          const memberRiotIds = group.members.map((mm) => mm.riotId).filter((x): x is string => !!x)
          const resolved = resolveOurTeamId(m.info.participants, memberRiotIds)
          if (resolved) {
            setOurTeamId(resolved)
            await window.api.teamSessionSetOurTeamId(game.id, resolved)
            onOurTeamIdResolved()
          }
        }
      })
      .catch((err) => { if (!cancelled) setError((err as Error).message) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the game itself changes, not on every parent re-render
  }, [game.id])

  const saveEnemyName = async (name: string | null) => {
    setEnemyTeamName(name)
    await window.api.teamSessionSetEnemyTeamName(game.id, name)
  }

  if (error) {
    return <Card><CardContent className="p-4 text-sm text-[#E24C3A]">{error}</CardContent></Card>
  }
  if (!match) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-hextech-text-dim">
          <Loader2 className="h-4 w-4 animate-spin" />{t('teamSession.loadingGame', { defaultValue: 'Loading game stats…' })}
        </CardContent>
      </Card>
    )
  }
  if (!ourTeamId) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-hextech-text-dim">
          {t('teamSession.cantIdentifySide', { defaultValue: "Couldn't tell which side is yours for this game — check that the group's Riot IDs are set." })}
        </CardContent>
      </Card>
    )
  }

  const durationSec = match.info.gameDuration
  const participants = match.info.participants
  const ourParticipants = participants.filter((p) => p.teamId === ourTeamId)
  const enemyParticipants = participants.filter((p) => p.teamId !== ourTeamId && (p.teamId === 100 || p.teamId === 200))
  const ourWin = ourParticipants[0]?.win ?? false

  const ourSide = buildSideStats(ourParticipants, durationSec, (p) => {
    const member = matchParticipantToMember(p, group.members)
    return member
      ? { id: member.userId, displayName: member.displayName || member.riotId || participantName(p) }
      : { id: p.puuid, displayName: participantName(p) }
  })
  const enemySide = buildSideStats(enemyParticipants, durationSec, (p) => ({ id: p.puuid, displayName: participantName(p) }))
  const header = buildHeaderSummary(ourSide, enemySide, durationSec, ourWin)
  const duelRows = buildDuelRows(ourSide, enemySide)

  return (
    <div className="space-y-3">
      <MatchHeaderStrip
        header={header}
        ourTeamName={group.name}
        enemyTeamName={enemyTeamName}
        canEditEnemyName={canManage}
        onSaveEnemyName={saveEnemyName}
      />
      <TeamSessionStatsTable
        ourSide={ourSide}
        enemySide={enemySide}
        ourTeamName={group.name}
        enemyTeamName={enemyTeamName || t('teamSession.enemyDefault', { defaultValue: 'Ennemy' })}
      />
      <DuelComparisonTable rows={duelRows} />
    </div>
  )
}
