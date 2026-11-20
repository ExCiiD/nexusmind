import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { PLATFORMS, type AccountRegionInfo } from '@/lib/riotRegionCore'

/**
 * Each linked Riot account's server (decision of 20/11/2026, contract docs/contracts/account-region.md): « Auto »
 * (detected from the puuid) or a server picked by hand, which detection never overrides. Desktop only.
 */
export function useAccountRegions() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [list, setList] = useState<AccountRegionInfo[] | null>(null)
  const [detecting, setDetecting] = useState(false)
  const available = !!window.api.listAccountRegions

  const load = useCallback(async (force = false) => {
    if (!window.api.listAccountRegions) return
    try { setList(await window.api.listAccountRegions({ force })) } catch { setList([]) }
  }, [])
  useEffect(() => { void load() }, [load])

  const redetect = async () => {
    setDetecting(true)
    await load(true)
    setDetecting(false)
    toast({ title: t('settings.region.redetected') })
  }
  const setMode = async (accountId: string, mode: string) => {
    if (!window.api.setAccountRegionMode) return
    try {
      const info = await window.api.setAccountRegionMode(accountId, mode)
      setList((l) => l?.map((x) => (x.accountId === accountId ? info : x)) ?? null)
      toast({ title: t('settings.region.saved'), variant: 'gold' })
    } catch (err) {
      const msg = (err as Error)?.message ?? ''
      toast({ title: t(/BAD_REGION/.test(msg) ? 'settings.region.errors.badRegion' : /NOT_FOUND/.test(msg) ? 'settings.region.errors.notFound' : 'settings.region.errors.generic'), variant: 'destructive' })
    }
  }
  const byAccount = (accountId: string) => list?.find((x) => x.accountId === accountId) ?? null
  return { available, list, byAccount, setMode, redetect, detecting }
}

/** One account's server: « Auto (détecté : EUW1) » or a server; the previous one after a transfer. */
export function AccountRegionControl({ info, fallback, onChange }: { info: AccountRegionInfo | null; fallback: string | null; onChange: (mode: string) => void }) {
  const { t } = useTranslation()
  if (!info) return <span className="text-xs text-hextech-text-dim">{fallback}</span>
  const autoLabel = info.detected ? t('settings.region.autoDetected', { region: info.detected }) : t('settings.region.autoPending')
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <Select value={info.mode} onValueChange={onChange}>
        <SelectTrigger className="h-7 w-52 text-xs" aria-label={t('settings.region.label', { account: `${info.gameName}#${info.tagLine}` })}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{autoLabel}</SelectItem>
          {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
        </SelectContent>
      </Select>
      {info.region && info.mode !== 'auto' && info.detected && info.detected !== info.mode && (
        <span className="text-hextech-gold">{t('settings.region.manualDiffers', { region: info.detected })}</span>
      )}
      {info.previousRegion && <span className="text-hextech-text-dim">{t('settings.region.previous', { region: info.previousRegion })}</span>}
    </div>
  )
}

export function RedetectButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  const { t } = useTranslation()
  return (
    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onClick} disabled={busy}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{t('settings.region.redetect')}
    </Button>
  )
}
