import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { KeyRound, Loader2, Megaphone, Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/useToast'
import { useCollab } from '@/hooks/useCollab'
import { useUserStore } from '@/store/useUserStore'
import { collabErrorKey, type GroupKind } from '@/lib/collab'
import { parseRiotIdInput } from '@/lib/groupTeamSyncCore'
import { cn } from '@/lib/utils'
import { LftDialog } from '@/components/lft/LftDialog'
import type { SoloLft } from '@/lib/organisation'
import type { Team } from '@/lib/ipc'

const card = 'flex flex-col gap-3 rounded-lg border border-hextech-border-dim bg-hextech-dark/50 p-4'

/**
 * « Rejoins une équipe » (docs/DESIGN_STATE.md § 18.2): /team for a player without a group — join with a code (a linked
 * Riot account is required), create a group, or look for a team. The Lobby, Planning, Coaching and team stats open as
 * soon as they are in a group (the sidebar's single « Équipe » entry turns back into the five).
 */
export function NoTeamPage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { reload } = useCollab()
  const user = useUserStore((s) => s.user)
  const localRiotId = user?.summonerName && user.tagLine ? `${user.summonerName}#${user.tagLine}` : null
  const [typedRiotId, setTypedRiotId] = useState('')
  const joinRiotId = localRiotId ?? parseRiotIdInput(typedRiotId)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<GroupKind>('team')
  const [busy, setBusy] = useState<'join' | 'create' | null>(null)

  const run = async (key: 'join' | 'create', fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn(); await reload() } catch (err) { toast({ title: t(collabErrorKey(err)), variant: 'destructive' }) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4 py-4 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('noTeam.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-hextech-text">{t('noTeam.subtitle')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <form className={card} onSubmit={(e) => { e.preventDefault(); if (code.trim() && joinRiotId) void run('join', async () => { await window.api.collabJoin(code.trim(), localRiotId ? null : joinRiotId); toast({ title: t('coaching.groups.joined'), variant: 'gold' }) }) }}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright"><KeyRound className="h-4 w-4 text-hextech-gold" />{t('noTeam.join')}</h2>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('noTeam.codePlaceholder')} aria-label={t('noTeam.code')} maxLength={16} />
          {!localRiotId && (
            <Input value={typedRiotId} onChange={(e) => setTypedRiotId(e.target.value)} placeholder="Nom#TAG" aria-label={t('noTeam.riotId')} />
          )}
          <p className="text-xs text-hextech-text-dim">
            {t('noTeam.riotRequired')}{' '}
            {!localRiotId && <Link to={window.api.cloudOpenWeb ? '/profile' : '/account'} className="text-hextech-gold hover:underline">{t('noTeam.linkRiot')}</Link>}
          </p>
          <Button type="submit" className="mt-auto" disabled={!code.trim() || !joinRiotId || busy !== null}>
            {busy === 'join' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t('noTeam.joinButton')}
          </Button>
        </form>

        <form className={card} onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run('create', async () => { await window.api.collabCreateGroup(name.trim(), kind) }) }}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright"><Plus className="h-4 w-4 text-hextech-gold" />{t('noTeam.create')}</h2>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('noTeam.namePlaceholder')} aria-label={t('noTeam.name')} maxLength={60} />
          <div role="radiogroup" aria-label={t('noTeam.kind')} className="inline-flex self-start overflow-hidden rounded-md border border-hextech-border-dim text-xs">
            {(['team', 'coaching'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                className={cn('px-3 py-1', kind === k ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text-dim hover:text-hextech-text')}>
                {t(`noTeam.kinds.${k}`)}
              </button>
            ))}
          </div>
          <Button type="submit" className="mt-auto" disabled={!name.trim() || busy !== null}>
            {busy === 'create' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t('noTeam.createButton')}
          </Button>
        </form>

        <SoloLftCard />
      </div>
    </div>
  )
}

/**
 * « Je cherche une équipe »: on the desktop, the LFT poster in solo mode from my own games (lftMySolo: my Riot ID, main
 * role, champion pool of my last 100 games, rank), « Looking for » pre-filled with my role. The web has no local
 * games: it keeps the link to the app's player card.
 */
function SoloLftCard() {
  const { t } = useTranslation()
  const [solo, setSolo] = useState<SoloLft | null | undefined>(window.api.lftMySolo ? undefined : null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!window.api.lftMySolo) return
    let alive = true
    window.api.lftMySolo?.().then((s) => { if (alive) setSolo(s) }).catch(() => { if (alive) setSolo(null) })
    return () => { alive = false }
  }, [])
  const team: Team | null = solo ? { id: 'solo', userId: '', name: solo.member.displayName, isOpponent: false, members: [solo.member] } as unknown as Team : null

  return (
    <div className={card}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-hextech-text-bright"><Megaphone className="h-4 w-4 text-hextech-gold" />{t('noTeam.lft')}</h2>
      {solo && team ? (
        <>
          <p className="text-sm text-hextech-text">{t('noTeam.lftSoloDesc', { name: solo.member.displayName, role: solo.member.role })}</p>
          <Button className="mt-auto gap-1.5" onClick={() => setOpen(true)}><Megaphone className="h-4 w-4" />{t('noTeam.lftPublish')}</Button>
          {open && <LftDialog team={team} open={open} onOpenChange={setOpen} soloRank={solo.rank} lookingFor={solo.member.role} />}
        </>
      ) : (
        <>
          <p className="text-sm text-hextech-text">{solo === undefined ? t('common.loading') : t('noTeam.lftDesc')}</p>
          <Button asChild variant="outline" className="mt-auto gap-1.5">
            <Link to="/profile"><Users className="h-4 w-4" />{t('noTeam.lftButton')}</Link>
          </Button>
        </>
      )}
    </div>
  )
}
