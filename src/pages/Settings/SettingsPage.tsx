import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { useUserStore } from '@/store/useUserStore'
import { useToast } from '@/hooks/useToast'
import { useTranslation } from 'react-i18next'
import { UserCircle2, Plus, Trash2, Loader2, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

const REGIONS = [
  'BR1', 'EUN1', 'EUW1', 'JP1', 'KR', 'LA1', 'LA2', 'NA1',
  'OC1', 'PH2', 'RU', 'SG2', 'TH2', 'TR1', 'TW2', 'VN2',
]

interface AccountEntry {
  id: string
  gameName: string
  tagLine: string
  region: string
  createdAt: string
}

export function SettingsPage() {
  const { t } = useTranslation()
  const user = useUserStore((s) => s.user)
  const { toast } = useToast()

  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [gameName, setGameName] = useState('')
  const [tagLine, setTagLine] = useState('')
  const [region, setRegion] = useState('EUW1')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const loadAccounts = async () => {
    try {
      const data = await window.api.listAccounts()
      setAccounts(data)
    } catch {
      // non-critical
    } finally {
      setLoadingAccounts(false)
    }
  }

  useEffect(() => {
    loadAccounts()
  }, [])

  const handleAdd = async () => {
    if (!gameName.trim() || !tagLine.trim()) return
    setAdding(true)
    try {
      await window.api.addAccount(gameName.trim(), tagLine.trim(), region)
      toast({ title: t('settings.accounts.addedToast'), variant: 'success' })
      setGameName('')
      setTagLine('')
      setShowAddForm(false)
      await loadAccounts()
    } catch (err: any) {
      toast({ title: err.message ?? 'Error', variant: 'destructive' })
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (id: string) => {
    setRemovingId(id)
    try {
      await window.api.removeAccount(id)
      toast({ title: t('settings.accounts.removedToast'), variant: 'success' })
      setAccounts((prev) => prev.filter((a) => a.id !== id))
      setConfirmRemoveId(null)
    } catch (err: any) {
      toast({ title: err.message ?? 'Error', variant: 'destructive' })
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('settings.title')}</h1>
        <p className="text-sm text-hextech-text mt-1">{t('settings.subtitle')}</p>
      </div>

      {/* Accounts management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCircle2 className="h-5 w-5 text-hextech-gold" />
            {t('settings.accounts.title')}
          </CardTitle>
          <CardDescription>{t('settings.accounts.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Main account */}
          {user && (
            <div className="flex items-center gap-3 rounded-lg border border-hextech-gold/30 bg-hextech-gold/5 px-4 py-3">
              <ShieldCheck className="h-5 w-5 text-hextech-gold shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-hextech-text-bright">
                    {user.summonerName}#{user.tagLine}
                  </span>
                  <Badge variant="gold" className="text-[10px] h-5">{t('settings.accounts.main')}</Badge>
                </div>
                <span className="text-xs text-hextech-text-dim">{user.region}</span>
              </div>
            </div>
          )}

          {/* Secondary accounts */}
          {loadingAccounts ? (
            <div className="flex items-center gap-2 text-sm text-hextech-text-dim py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-hextech-text-dim">{t('settings.accounts.empty')}</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center gap-3 rounded-lg border border-hextech-border-dim bg-hextech-elevated px-4 py-3"
                >
                  <UserCircle2 className="h-5 w-5 text-hextech-text-dim shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-hextech-text-bright">
                        {acc.gameName}#{acc.tagLine}
                      </span>
                      <Badge variant="outline" className="text-[10px] h-5 text-hextech-text-dim">
                        {t('settings.accounts.secondary')}
                      </Badge>
                    </div>
                    <span className="text-xs text-hextech-text-dim">{acc.region}</span>
                  </div>
                  <div className="shrink-0">
                    {confirmRemoveId === acc.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-hextech-text-dim">{t('settings.accounts.removeConfirm')}</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={removingId === acc.id}
                          onClick={() => handleRemove(acc.id)}
                        >
                          {removingId === acc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t('settings.accounts.remove')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setConfirmRemoveId(null)}
                        >
                          {t('settings.accounts.removeCancel')}
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRemoveId(acc.id)}
                        className="rounded p-1.5 text-hextech-text-dim hover:text-[#FF4655] hover:bg-[#FF4655]/10 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add form toggle */}
          {!showAddForm ? (
            <Button
              variant="outline"
              onClick={() => setShowAddForm(true)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              {t('settings.accounts.add')}
            </Button>
          ) : (
            <div className={cn(
              'space-y-3 rounded-lg border border-hextech-gold/20 bg-hextech-gold/5 p-4',
            )}>
              <p className="text-xs text-hextech-text-dim">{t('settings.accounts.addDesc')}</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('settings.accounts.gameName')}</Label>
                  <input
                    type="text"
                    value={gameName}
                    onChange={(e) => setGameName(e.target.value)}
                    placeholder="PlayerName"
                    className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('settings.accounts.tagLine')}</Label>
                  <input
                    type="text"
                    value={tagLine}
                    onChange={(e) => setTagLine(e.target.value)}
                    placeholder="EUW"
                    className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-3 py-2 text-sm text-hextech-text placeholder:text-hextech-text-dim/50 focus:outline-none focus:border-hextech-gold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('settings.accounts.region')}</Label>
                  <Select value={region} onValueChange={setRegion}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REGIONS.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={handleAdd} disabled={adding || !gameName.trim() || !tagLine.trim()} className="gap-2">
                  {adding
                    ? <><Loader2 className="h-4 w-4 animate-spin" />{t('settings.accounts.addingButton')}</>
                    : <><Plus className="h-4 w-4" />{t('settings.accounts.addButton')}</>
                  }
                </Button>
                <Button variant="ghost" onClick={() => { setShowAddForm(false); setGameName(''); setTagLine('') }}>
                  {t('settings.accounts.removeCancel')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
