import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, PlusCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import { invalidateCached } from '@/lib/queryCache'
import type { MistakeTag } from '@/lib/ipc'
import { parseClock } from './answerExtras'
import { useReviewPlayerStore } from '@/store/useReviewPlayerStore'
import { fmtClock } from '@/lib/mistakeInsights'
import { TagAutocomplete } from './TagAutocomplete'

/**
 * « Ajouter une erreur non détectée » (DECISIONS 21/11): the player adds a critical mistake the micro-review missed,
 * as a manual tag at its game time (createMistake).
 */
export function UndetectedMistakeButton({ gameId, tags, durationSec }: { gameId: string; tags: MistakeTag[]; durationSec: number }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [tagId, setTagId] = useState('')
  const [clock, setClock] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  // Beta.20: the player's current time, read when the dialog opens (no typed time when the video plays).
  const playerGameTime = useReviewPlayerStore((s) => s.playerGameTime)
  const [playerAt, setPlayerAt] = useState<number | null>(null)
  const at = playerAt ?? parseClock(clock)
  const valid = !!tagId && at != null && at <= durationSec

  const save = async () => {
    if (!valid || at == null) return
    setSaving(true)
    try {
      await window.api.createMistake({ gameId, tagId, gameTimeSec: at, note: note.trim() || undefined, severity: 3 })
      invalidateCached('games:')
      toast({ title: t('microReview.undetected.saved'), variant: 'gold' })
      setOpen(false); setTagId(''); setClock(''); setNote('')
    } catch {
      toast({ title: t('microReview.undetected.failed'), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPlayerAt(playerGameTime ? playerGameTime() : null); setOpen(true) }} data-testid="undetected-mistake-button">
        <PlusCircle className="h-4 w-4" />{t('microReview.undetected.button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('microReview.undetected.title')}</DialogTitle>
            <DialogDescription>{t('microReview.undetected.desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <TagAutocomplete tags={tags} placeholder={t('microReview.extras.pickTag')}
              value={tags.find((x) => x.id === tagId) ?? null} onPick={(x) => setTagId(x.id)} />
            {playerAt != null ? (
              <p className="text-sm text-hextech-text" data-testid="undetected-player-time">
                {t('microReview.undetected.atPlayer')} <span className="font-mono text-hextech-gold">{fmtClock(playerAt)}</span>
              </p>
            ) : (
              <>
                <Input value={clock} onChange={(e) => setClock(e.target.value)} placeholder={t('microReview.undetected.timePlaceholder')}
                  aria-label={t('microReview.undetected.time')} className="font-mono" />
                {clock && at == null && <p className="text-xs text-hextech-red">{t('microReview.undetected.badTime')}</p>}
              </>
            )}
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder={t('microReview.extras.tagNote')}
              aria-label={t('microReview.extras.tagNote')} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={!valid || saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('microReview.undetected.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
