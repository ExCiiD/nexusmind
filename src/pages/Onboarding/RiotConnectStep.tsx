import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { regionDisplayNames } from '@/lib/validation'
import { useUserStore } from '@/store/useUserStore'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/useToast'
import { useTranslation } from 'react-i18next'

interface RiotConnectStepProps {
  onNext: () => void
  displayName?: string
}

export function RiotConnectStep({ onNext, displayName }: RiotConnectStepProps) {
  const { t } = useTranslation()
  const [gameName, setGameName] = useState('')
  const [tagLine, setTagLine] = useState('')
  const [region, setRegion] = useState('')
  const [loading, setLoading] = useState(false)
  const setUser = useUserStore((s) => s.setUser)
  const { toast } = useToast()

  const connectRiot = async () => {
    if (!gameName || !tagLine || !region) return
    setLoading(true)
    try {
      const user = await window.api.connectRiot(gameName, tagLine, region, displayName)
      setUser(user)
      toast({ title: t('riotConnect.toast.successTitle'), description: t('riotConnect.toast.successDesc', { name: displayName || `${gameName}#${tagLine}` }), variant: 'gold' })
      onNext()
    } catch (err: any) {
      toast({ title: t('riotConnect.toast.errorTitle'), description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('riotConnect.title')}</CardTitle>
        <CardDescription>{t('riotConnect.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="gameName">{t('riotConnect.gameName')}</Label>
            <Input id="gameName" placeholder={t('riotConnect.gameNamePlaceholder')} value={gameName} onChange={(e) => setGameName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tagLine">{t('riotConnect.tag')}</Label>
            <Input id="tagLine" placeholder={t('riotConnect.tagPlaceholder')} value={tagLine} onChange={(e) => setTagLine(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('riotConnect.region')}</Label>
          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger>
              <SelectValue placeholder={t('riotConnect.regionPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(regionDisplayNames).map(([code, name]) => (
                <SelectItem key={code} value={code}>{name} ({code})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={connectRiot} disabled={!gameName || !tagLine || !region || loading} className="w-full">
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {t('riotConnect.connectButton')}
        </Button>
      </CardContent>
    </Card>
  )
}
