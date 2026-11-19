import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DraftLogInput, DraftPick, TeamSide } from '@/lib/analyst'
import type { TeamRole } from '@/lib/team'
import { Segmented } from './shared'

const ROLES: TeamRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']
const empty5 = () => ['', '', '', '', '']

/** "Ahri, Zed" → ['Ahri', 'Zed'] (at most 5). */
const listOf = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5)

/**
 * #40 · 2/3: « Ajouter une draft à la main » (§ 11, empty state): opponent, date, side, result, the 10 picks (by
 * role) and the bans. Bans can stay empty (a custom without draft mode).
 */
export function DraftManualDialog({ open, onOpenChange, onSubmit }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: DraftLogInput) => Promise<void>
}) {
  const { t } = useTranslation()
  const [opponent, setOpponent] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [side, setSide] = useState<TeamSide>('blue')
  const [result, setResult] = useState<'win' | 'loss' | 'unknown'>('unknown')
  const [ours, setOurs] = useState(empty5)
  const [theirs, setTheirs] = useState(empty5)
  const [ourBans, setOurBans] = useState('')
  const [theirBans, setTheirBans] = useState('')
  const [busy, setBusy] = useState(false)
  // No DialogTrigger: remember what had the focus when it opened, give it back on close (Escape included).
  const returnTo = useRef<HTMLElement | null>(null)

  const picks = (names: string[]): DraftPick[] => names.map((c, i) => ({ champion: c.trim(), role: ROLES[i] })).filter((p) => p.champion)
  const canSave = opponent.trim() !== '' && picks(ours).length > 0

  const submit = async () => {
    setBusy(true)
    try {
      const ob = listOf(ourBans), tb = listOf(theirBans)
      await onSubmit({
        playedAt: new Date(`${date}T12:00:00`).toISOString(), source: 'manual', opponentName: opponent.trim(), side,
        win: result === 'unknown' ? null : result === 'win', ourPicks: picks(ours), theirPicks: picks(theirs),
        ourBans: ob.length ? ob : null, theirBans: tb.length ? tb : null,
      })
      onOpenChange(false)
      setOpponent(''); setOurs(empty5()); setTheirs(empty5()); setOurBans(''); setTheirBans(''); setResult('unknown')
    } finally {
      setBusy(false)
    }
  }

  const pickRow = (label: string, values: string[], set: (v: string[]) => void) => (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-hextech-text">{label}</legend>
      <div className="grid grid-cols-5 gap-1">
        {values.map((v, i) => (
          <Input key={i} value={v} aria-label={`${label} · ${t(`team.roster.roles.${ROLES[i]}`, { defaultValue: ROLES[i] })}`} placeholder={ROLES[i]}
            className="h-8 text-xs" onChange={(e) => { const n = [...values]; n[i] = e.target.value; set(n) }} />
        ))}
      </div>
    </fieldset>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        onOpenAutoFocus={() => { returnTo.current = document.activeElement as HTMLElement | null }}
        onCloseAutoFocus={(e) => {
          const el = returnTo.current
          returnTo.current = null
          if (el && el !== document.body && el.isConnected) { e.preventDefault(); el.focus() }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('analyst.draftLog.manual.title')}</DialogTitle>
          <DialogDescription>{t('analyst.draftLog.manual.desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-hextech-text">
              <span>{t('analyst.draftLog.manual.opponent')}</span>
              <Input value={opponent} onChange={(e) => setOpponent(e.target.value)} maxLength={80} />
            </label>
            <label className="space-y-1 text-xs text-hextech-text">
              <span>{t('analyst.draftLog.manual.date')}</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label={t('analyst.filters.side')} value={side} onChange={setSide}
              options={[{ id: 'blue', label: t('analyst.common.side.blue') }, { id: 'red', label: t('analyst.common.side.red') }]} />
            <Segmented label={t('analyst.draftLog.filters.result')} value={result} onChange={setResult}
              options={[{ id: 'win', label: t('analyst.common.win') }, { id: 'loss', label: t('analyst.common.loss') }, { id: 'unknown', label: t('analyst.draftLog.manual.noResult') }]} />
          </div>
          {pickRow(t('analyst.draftLog.cols.ourPicks'), ours, setOurs)}
          {pickRow(t('analyst.draftLog.cols.theirPicks'), theirs, setTheirs)}
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-hextech-text">
              <span>{t('analyst.draftLog.cols.ourBans')}</span>
              <Input value={ourBans} onChange={(e) => setOurBans(e.target.value)} placeholder={t('analyst.draftLog.manual.bansHint')} />
            </label>
            <label className="space-y-1 text-xs text-hextech-text">
              <span>{t('analyst.draftLog.cols.theirBans')}</span>
              <Input value={theirBans} onChange={(e) => setTheirBans(e.target.value)} placeholder={t('analyst.draftLog.manual.bansHint')} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => { void submit() }} disabled={!canSave || busy}>{t('analyst.draftLog.manual.save')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
