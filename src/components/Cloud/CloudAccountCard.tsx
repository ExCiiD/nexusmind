import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, ExternalLink, Loader2, LogOut, RotateCcw, Trash2, UploadCloud, FileText } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import type { CloudBackup, CloudStatus } from '@/lib/ipc'
import { LegalDialog } from './LegalDialog'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

/** Settings → NexusMind account: cloud backups, sign-out, GDPR erasure. */
export function CloudAccountCard() {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [backups, setBackups] = useState<CloudBackup[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<CloudBackup | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteText, setDeleteText] = useState('')
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null)

  const refresh = useCallback(async () => {
    const s = await window.api.cloudStatus()
    setStatus(s)
    if (s.user) setBackups(await window.api.cloudListBackups().catch(() => []))
  }, [])

  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  if (!status?.configured) return null
  const fmtDate = (iso: string) => new Date(iso).toLocaleString(i18n.language)

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn() } catch (err) {
      toast({ title: t('cloud.errors.title'), description: (err as Error).message, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  const backupNow = () => run('backup', async () => {
    const b = await window.api.cloudBackupNow()
    toast({ title: t('cloud.backup.done'), description: formatSize(b.size_bytes), variant: 'gold' })
    await refresh()
  })

  const restore = (b: CloudBackup) => run(`restore-${b.id}`, async () => {
    const s = await window.api.cloudRestoreBackup(b.id)
    setConfirmRestore(null)
    toast({
      title: t('cloud.backup.restored'),
      description: t('settings.backup.importSummary', {
        sessions: s.sessionsAdded, games: s.gamesAdded, reviews: s.reviewsAdded,
        recordings: s.recordingsAdded, conflicts: s.conflicts,
      }),
      variant: 'gold',
    })
  })

  const remove = (b: CloudBackup) => run(`delete-${b.id}`, async () => {
    await window.api.cloudDeleteBackup(b.id)
    await refresh()
  })

  const signOut = () => run('signout', async () => {
    await window.api.cloudSignOut()
  })

  const openWeb = () => run('open-web', async () => {
    await window.api.cloudOpenWeb?.()
  })

  const deleteAccount = () => run('delete-account', async () => {
    await window.api.cloudDeleteAccount('DELETE')
    setDeleteOpen(false)
    toast({ title: t('cloud.account.deleted') })
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5 text-hextech-gold" />
          {t('cloud.title')}
        </CardTitle>
        <CardDescription>{t('cloud.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-hextech-text">
            {t('cloud.account.signedInAs')} <strong className="text-hextech-text-bright">{status.user?.email}</strong>
          </span>
          <div className="flex flex-wrap gap-2">
            {window.api.cloudOpenWeb && (
              <Button variant="outline" size="sm" onClick={openWeb} disabled={busy !== null} className="gap-2" title={t('cloud.account.openWebHint')}>
                {busy === 'open-web' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                {t('cloud.account.openWeb')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={signOut} disabled={busy !== null} className="gap-2">
              <LogOut className="h-4 w-4" />{t('cloud.account.signOut')}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-hextech-text-dim">
            {status.lastBackupAt
              ? t('cloud.backup.last', { date: fmtDate(status.lastBackupAt) })
              : t('cloud.backup.never')}
            {' · '}{t('cloud.backup.auto')}
          </span>
          <Button onClick={backupNow} disabled={busy !== null} className="gap-2">
            {busy === 'backup' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {t('cloud.backup.now')}
          </Button>
        </div>

        {backups.length > 0 && (
          <ul className="divide-y divide-hextech-border-dim rounded-lg border border-hextech-border-dim">
            {backups.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <div className="text-hextech-text-bright">{fmtDate(b.created_at)}</div>
                  <div className="text-xs text-hextech-text-dim">
                    {formatSize(b.size_bytes)} · {b.device ?? '—'} · v{b.app_version ?? '?'} ·{' '}
                    {t('cloud.backup.counts', { games: b.counts.Game ?? 0, reviews: b.counts.Review ?? 0 })}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="gap-1" disabled={busy !== null} onClick={() => setConfirmRestore(b)}>
                    <RotateCcw className="h-3.5 w-3.5" />{t('cloud.backup.restore')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => remove(b)} aria-label={t('common.delete')}>
                    {busy === `delete-${b.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-hextech-border-dim pt-3 text-xs">
          <button className="flex items-center gap-1 text-hextech-text-dim hover:text-hextech-text" onClick={() => setLegal('privacy')}>
            <FileText className="h-3.5 w-3.5" />{t('cloud.legal.privacy')}
          </button>
          <button className="flex items-center gap-1 text-hextech-text-dim hover:text-hextech-text" onClick={() => setLegal('terms')}>
            <FileText className="h-3.5 w-3.5" />{t('cloud.legal.terms')}
          </button>
          <button className="ml-auto text-[#FF4655]/80 hover:text-[#FF4655]" onClick={() => { setDeleteText(''); setDeleteOpen(true) }}>
            {t('cloud.account.delete')}
          </button>
        </div>
      </CardContent>

      <Dialog open={confirmRestore !== null} onOpenChange={(o) => !o && setConfirmRestore(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cloud.backup.restoreTitle')}</DialogTitle>
            <DialogDescription>{t('cloud.backup.restoreDesc')}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmRestore(null)}>{t('common.cancel')}</Button>
            <Button disabled={busy !== null} onClick={() => confirmRestore && restore(confirmRestore)} className="gap-2">
              {busy?.startsWith('restore-') && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('cloud.backup.restore')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[#FF4655]">{t('cloud.account.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('cloud.account.deleteDesc')}</DialogDescription>
          </DialogHeader>
          <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="DELETE" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              disabled={deleteText !== 'DELETE' || busy !== null}
              onClick={deleteAccount}
              className="gap-2"
            >
              {busy === 'delete-account' && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('cloud.account.deleteConfirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <LegalDialog doc={legal} onClose={() => setLegal(null)} />
    </Card>
  )
}
