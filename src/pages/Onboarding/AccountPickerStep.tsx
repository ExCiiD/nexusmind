import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useUserStore } from '@/store/useUserStore'
import { useToast } from '@/hooks/useToast'
import { SavedAccount } from '@/lib/ipc'
import { Loader2, Plus, RefreshCw } from 'lucide-react'

const REGION_LABELS: Record<string, string> = {
  EUW1: 'EUW', EUNE1: 'EUNE', NA1: 'NA', KR: 'KR', BR1: 'BR',
  LA1: 'LAN', LA2: 'LAS', OC1: 'OCE', TR1: 'TR', RU: 'RU',
  JP1: 'JP', SG2: 'SG', VN2: 'VN', TW2: 'TW', TH2: 'TH', PH2: 'PH',
}

interface AccountPickerStepProps {
  accounts: SavedAccount[]
  onNewAccount: () => void
}

export function AccountPickerStep({ accounts, onNewAccount }: AccountPickerStepProps) {
  const setUser = useUserStore((s) => s.setUser)
  const { toast } = useToast()
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const handleReactivate = async (account: SavedAccount) => {
    setLoadingId(account.id)
    try {
      const user = await window.api.reactivateAccount(account.id)
      setUser(user)
      toast({ title: `Welcome back, ${user.displayName || user.summonerName}!`, variant: 'gold' })
    } catch (err: any) {
      toast({ title: 'Could not reconnect', description: err.message, variant: 'destructive' })
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>
          Choose a saved account to reconnect instantly, or add a new one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts.map((account) => {
          const isLoading = loadingId === account.id
          const iconUrl = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${account.profileIconId}.jpg`
          const region = REGION_LABELS[account.region] ?? account.region
          const sessionCount = account._count.sessions

          return (
            <div
              key={account.id}
              className="flex items-center gap-3 rounded-lg border border-hextech-border-dim bg-hextech-elevated/40 p-3"
            >
              <img
                src={iconUrl}
                alt="icon"
                className="h-11 w-11 rounded-full border-2 border-hextech-border-dim object-cover shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).src = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/29.jpg` }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-hextech-text-bright truncate">
                  {account.displayName || account.summonerName}
                </div>
                <div className="text-xs text-hextech-text-dim truncate">
                  {account.summonerName}#{account.tagLine} · {region}
                </div>
                <div className="text-[10px] text-hextech-text-dim mt-0.5">
                  {sessionCount} session{sessionCount !== 1 ? 's' : ''}
                  {account.mainRole ? ` · ${account.mainRole}` : ''}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => handleReactivate(account)}
                disabled={isLoading || loadingId !== null}
                className="shrink-0"
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                {isLoading ? 'Connecting…' : 'Reconnect'}
              </Button>
            </div>
          )
        })}

        <div className="pt-2 border-t border-hextech-border-dim">
          <Button variant="outline" className="w-full gap-2" onClick={onNewAccount}>
            <Plus className="h-4 w-4" />
            Add a new account
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
