import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileText, LogOut } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LegalDialog } from '@/components/Cloud/LegalDialog'

const DOWNLOAD_URL = 'https://github.com/ExCiiD/nexusmind/releases/latest'

export function AccountPage() {
  const { t, i18n } = useTranslation()
  const [email, setEmail] = useState<string | null>(null)
  const [legal, setLegal] = useState<'privacy' | 'terms' | null>(null)

  useEffect(() => { window.api.cloudStatus().then((s) => setEmail(s.user?.email ?? null)) }, [])

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="font-display text-2xl font-bold text-hextech-gold-bright">{t('web.nav.account')}</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">{t('cloud.title')}</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>{t('cloud.account.signedInAs')} <strong className="text-hextech-text-bright">{email}</strong></p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={() => window.api.cloudSignOut()}>
              <LogOut className="h-4 w-4" />{t('cloud.account.signOut')}
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => i18n.changeLanguage(i18n.language.startsWith('fr') ? 'en' : 'fr')}>
              {i18n.language.startsWith('fr') ? 'English' : 'Français'}
            </Button>
          </div>
          <p className="text-xs text-hextech-text-dim">{t('web.account.deleteHint')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
          <span>{t('web.account.desktop')}</span>
          <a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
            <Button className="gap-2"><Download className="h-4 w-4" />{t('web.account.download')}</Button>
          </a>
        </CardContent>
      </Card>
      <div className="flex gap-4 text-xs text-hextech-text-dim">
        <button className="flex items-center gap-1 hover:text-hextech-text" onClick={() => setLegal('privacy')}><FileText className="h-3.5 w-3.5" />{t('cloud.legal.privacy')}</button>
        <button className="flex items-center gap-1 hover:text-hextech-text" onClick={() => setLegal('terms')}><FileText className="h-3.5 w-3.5" />{t('cloud.legal.terms')}</button>
      </div>
      <LegalDialog doc={legal} onClose={() => setLegal(null)} />
    </div>
  )
}
