import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Check, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn, formatGameTime } from '@/lib/utils'
import type { MatchHeaderSummary } from '@/lib/teamSessionStatsCore'

interface Props {
  header: MatchHeaderSummary
  ourTeamName: string
  enemyTeamName: string | null
  canEditEnemyName: boolean
  onSaveEnemyName: (name: string | null) => Promise<void>
}

/** KDA/Gold/Vision/duration side-by-side (Phase 4, Planning rework). The
 *  higher value of each pair is highlighted — same idea as the duel table,
 *  just at the team level. */
export function MatchHeaderStrip({ header, ourTeamName, enemyTeamName, canEditEnemyName, onSaveEnemyName }: Props) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(enemyTeamName ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await onSaveEnemyName(draft.trim() || null)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const enemyLabel = enemyTeamName || t('teamSession.enemyDefault', { defaultValue: 'Ennemy' })
  const ourKda = header.our.deaths > 0 ? (header.our.kills + header.our.assists) / header.our.deaths : header.our.kills + header.our.assists
  const enemyKda = header.enemy.deaths > 0 ? (header.enemy.kills + header.enemy.assists) / header.enemy.deaths : header.enemy.kills + header.enemy.assists

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright">
            <span>{ourTeamName}</span>
            <span className="text-hextech-text-dim">{t('teamSession.vs', { defaultValue: 'vs' })}</span>
            {editing ? (
              <div className="flex items-center gap-1">
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={80} className="h-7 w-40 text-sm" />
                <button onClick={save} disabled={saving} className="text-hextech-green hover:text-hextech-green/80"><Check className="h-4 w-4" /></button>
                <button onClick={() => setEditing(false)} className="text-hextech-text-dim hover:text-hextech-text"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span>{enemyLabel}</span>
                {canEditEnemyName && (
                  <button onClick={() => { setDraft(enemyTeamName ?? ''); setEditing(true) }} className="text-hextech-text-dim hover:text-hextech-gold">
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={header.ourWin ? 'success' : 'destructive'}>
              {header.ourWin ? t('history.win', { defaultValue: 'Victory' }) : t('history.loss', { defaultValue: 'Defeat' })}
            </Badge>
            <span className="text-xs text-hextech-text-dim">{formatGameTime(header.durationSec)}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <HeaderStat label={t('teamSession.statKda', { defaultValue: 'KDA' })} ours={ourKda.toFixed(2)} enemy={enemyKda.toFixed(2)} oursHigher={ourKda >= enemyKda} />
          <HeaderStat label={t('teamSession.statGold', { defaultValue: 'Gold' })} ours={Math.round(header.our.gold).toLocaleString()} enemy={Math.round(header.enemy.gold).toLocaleString()} oursHigher={header.our.gold >= header.enemy.gold} />
          <HeaderStat label={t('teamSession.statVision', { defaultValue: 'Vision' })} ours={Math.round(header.our.vision).toString()} enemy={Math.round(header.enemy.vision).toString()} oursHigher={header.our.vision >= header.enemy.vision} />
        </div>
      </CardContent>
    </Card>
  )
}

function HeaderStat({ label, ours, enemy, oursHigher }: { label: string; ours: string; enemy: string; oursHigher: boolean }) {
  return (
    <div className="rounded-md bg-hextech-elevated py-2">
      <p className="text-[10px] uppercase tracking-wide text-hextech-text-dim">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">
        <span className={cn(oursHigher ? 'text-hextech-green' : 'text-hextech-text-dim')}>{ours}</span>
        <span className="mx-1 text-hextech-text-dim">–</span>
        <span className={cn(!oursHigher ? 'text-[#E24C3A]' : 'text-hextech-text-dim')}>{enemy}</span>
      </p>
    </div>
  )
}
