import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import type { Group } from '@/lib/collab'

/**
 * E1 (docs/PLAN_GESTION_EQUIPE.md): snapshots this local team into a
 * group's shared workspace, so the staff can see it on the web. One-shot
 * "publish" (overwrites the group's previous snapshot) — no live two-way
 * sync yet, matching the "migration" wording in the plan.
 */
export function PublishTeamDialog({
  open, onOpenChange, teamId, teamName,
}: { open: boolean; onOpenChange: (open: boolean) => void; teamId: string; teamName: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setGroups(null)
    setSelected(null)
    window.api.collabListGroups().then((gs) => {
      setGroups(gs)
      if (gs.length === 1) setSelected(gs[0].id)
    }).catch(() => setGroups([]))
  }, [open])

  const publish = async () => {
    if (!selected || !window.api.teamPublishToGroup) return
    setBusy(true)
    try {
      const result = await window.api.teamPublishToGroup(selected, teamId)
      toast({ title: t('team.publishDone', { defaultValue: 'Team published' }), description: t('team.publishCount', { count: result.published, defaultValue: '{{count}} rows shared' }), variant: 'gold' })
      onOpenChange(false)
    } catch (err) {
      toast({ title: t('cloud.errors.title'), description: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-hextech-gold" />
            {t('team.publishTitle', { defaultValue: 'Publish "{{name}}" to a group', name: teamName })}
          </DialogTitle>
          <DialogDescription>
            {t('team.publishDesc', { defaultValue: 'The staff (owner/coach/analyst) of the group you pick will see your roster, champion pools, drafts and scouting notes on the web. This replaces whatever was published there before — it does not sync live, publish again after changes.' })}
          </DialogDescription>
        </DialogHeader>
        {groups === null ? (
          <p className="py-6 text-center text-sm text-hextech-text-dim">{t('common.loading')}</p>
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-hextech-text-dim">{t('team.publishNoGroups', { defaultValue: 'You are not in any group yet — create or join one from Coaching first.' })}</p>
        ) : (
          <div className="space-y-1.5">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelected(g.id)}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  selected === g.id
                    ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright'
                    : 'border-hextech-border-dim text-hextech-text hover:bg-hextech-elevated'
                }`}
              >
                <span>{g.name}</span>
                <span className="text-xs text-hextech-text-dim">{g.myRole}</span>
              </button>
            ))}
          </div>
        )}
        <Button className="w-full gap-2" disabled={!selected || busy} onClick={publish}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('team.publishButton', { defaultValue: 'Publish' })}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
