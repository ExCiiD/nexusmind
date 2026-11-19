import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/useToast'

/**
 * #34: unlinks the group's Discord server (desktop and web, through
 * `window.api.discordUnlinkGuild`). Group staff only — the server answers
 * FORBIDDEN otherwise, and we say who may do it. `unlinked: false` means
 * there was no server to unlink.
 */
export function DiscordUnlinkButton({ groupId, groupName, onUnlinked, size = 'sm' }: {
  groupId: string
  groupName: string
  /** Called after an actual unlink (not when nothing was linked). */
  onUnlinked?: () => void
  size?: 'sm' | 'default'
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (typeof window.api?.discordUnlinkGuild !== 'function') return null

  const unlink = async () => {
    setBusy(true)
    try {
      const { unlinked } = await window.api.discordUnlinkGuild(groupId)
      if (unlinked) {
        toast({ title: t('discordUnlink.done', { name: groupName }), variant: 'gold' })
        onUnlinked?.()
      } else {
        toast({ title: t('discordUnlink.noneLinked', { name: groupName }) })
      }
    } catch (err) {
      const forbidden = (err as Error)?.message?.includes('FORBIDDEN')
      toast({
        title: forbidden ? t('discordUnlink.forbidden') : t('discordUnlink.failed'),
        description: forbidden ? undefined : (err as Error)?.message,
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size={size} className="gap-2" disabled={busy} onClick={() => setConfirmOpen(true)}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Unlink className="h-3.5 w-3.5" aria-hidden />}
        {t('discordUnlink.button')}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('discordUnlink.title', { name: groupName })}
        description={t('discordUnlink.desc')}
        confirmLabel={t('discordUnlink.confirm')}
        onConfirm={() => { void unlink() }}
      />
    </>
  )
}
