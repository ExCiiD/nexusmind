/**
 * Entry point of the looking-for-team announcements, for Espace d'équipe:
 * a button that opens the builder for the team's roster. Desktop only (the
 * picture is rendered by the main process): nothing on the web app.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Megaphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Team } from '@/lib/ipc'
import { LftDialog } from './LftDialog'

export function LftExportButton({ team }: { team: Team }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!window.api.lftExportPng) return null
  const empty = (team.members?.length ?? 0) === 0
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={empty} title={empty ? t('team.lft.noPlayers') : t('team.lft.buttonHint')}>
        <Megaphone className="mr-1.5 h-3.5 w-3.5" />
        {t('team.lft.button')}
      </Button>
      {open && <LftDialog team={team} open={open} onOpenChange={setOpen} />}
    </>
  )
}
