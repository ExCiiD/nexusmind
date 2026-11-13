import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, Copy, Loader2, UserPlus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/useToast'
import type { AccessInvite } from '@/lib/accessCore'

/** Format shown to people: ABCD-EFGH-JKMN (the server accepts it with or without dashes). */
export function formatInviteCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code
}

function inviteStatus(i: AccessInvite): 'revoked' | 'used' | 'expired' | 'active' {
  if (i.revoked) return 'revoked'
  if (i.uses >= i.maxUses) return 'used'
  if (new Date(i.expiresAt).getTime() <= Date.now()) return 'expired'
  return 'active'
}

/**
 * Admins only (rows in public.app_admins): invite people to NexusMind.
 * Rendered on the desktop (Settings) and the web app (Account); hidden for
 * everyone else.
 */
export function AccessInvitesCard({ webUrl }: { webUrl?: string }) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const [admin, setAdmin] = useState(false)
  const [invites, setInvites] = useState<AccessInvite[]>([])
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const isAdmin = await window.api.accessIsAdmin().catch(() => false)
    setAdmin(isAdmin)
    if (isAdmin) setInvites(await window.api.accessListInvites().catch(() => []))
  }, [])

  useEffect(() => { refresh().catch(() => {}) }, [refresh])
  if (!admin) return null

  const copy = async (code: string) => {
    const text = webUrl
      ? t('access.copyText', { code: formatInviteCode(code), url: `${webUrl}/#invite=${code}` })
      : formatInviteCode(code)
    await navigator.clipboard.writeText(text).catch(() => {})
    toast({ title: t('access.copied'), variant: 'gold' })
  }

  const create = async () => {
    setBusy(true)
    try {
      const code = await window.api.accessCreateInvite({ email: email.trim() || null, note: note.trim() || null, days: 14, maxUses: 1 })
      setEmail('')
      setNote('')
      await copy(code)
      await refresh()
    } catch (err) {
      toast({ title: t('cloud.errors.title'), description: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (code: string) => {
    await window.api.accessRevokeInvite(code).catch(() => {})
    await refresh()
  }

  return (
    <Card data-testid="access-invites">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-5 w-5 text-hextech-gold" />
          {t('access.title')}
        </CardTitle>
        <CardDescription>{t('access.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (!busy) create() }}>
          <div className="space-y-1">
            <Label htmlFor="invite-email">{t('access.emailLabel')}</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('access.emailPlaceholder')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-note">{t('access.noteLabel')}</Label>
            <Input id="invite-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('access.notePlaceholder')} />
          </div>
          <Button type="submit" disabled={busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {t('access.create')}
          </Button>
        </form>
        <p className="text-xs text-hextech-text-dim">{t('access.rules')}</p>

        {invites.length > 0 && (
          <ul className="divide-y divide-hextech-border-dim rounded-lg border border-hextech-border-dim">
            {invites.map((i) => {
              const st = inviteStatus(i)
              return (
                <li key={i.code} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-mono tracking-wider text-hextech-text-bright">{formatInviteCode(i.code)}</div>
                    <div className="truncate text-xs text-hextech-text-dim">
                      {t(`access.status.${st}`)} · {i.email ?? t('access.anyEmail')}
                      {i.note ? ` · ${i.note}` : ''} · {t('access.expires', { date: new Date(i.expiresAt).toLocaleDateString(i18n.language) })}
                    </div>
                  </div>
                  {st === 'active' && (
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => copy(i.code)}>
                        <Copy className="h-3.5 w-3.5" />{t('access.copy')}
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1" onClick={() => revoke(i.code)} aria-label={t('access.revoke')}>
                        <Ban className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
