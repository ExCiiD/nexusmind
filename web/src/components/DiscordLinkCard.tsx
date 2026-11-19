import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Copy, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import { useCollab } from '@/hooks/useCollab'
import { sb } from '../supabase'
import {
  generateGuildLinkCode, generateUserLinkCode, getGroupDiscordLink, getMyDiscordLink, unlinkMyDiscord,
} from '@/lib/discordBotCore'
import type { DiscordGuildLink, DiscordUserLink } from '@/lib/discord'
import { DiscordUnlinkButton } from '@/components/team/DiscordUnlinkButton'

/**
 * Discord bot linking (E11) — web-only by design: the bot is the staff's
 * tool for coordinating on Discord, where they already are, and this page
 * is "the staff control tower". Calls discordBotCore.ts directly against
 * the signed-in Supabase client rather than through window.api, since
 * desktop has no reason to implement these methods — except unlinking a
 * team's server (#34), which both apps do through window.api.discordUnlinkGuild.
 */
export function DiscordLinkCard() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { myUserId, staffGroups } = useCollab()
  const [myLink, setMyLink] = useState<DiscordUserLink | null | undefined>(undefined)
  const [myCode, setMyCode] = useState<{ code: string; expiresAt: string } | null>(null)

  useEffect(() => {
    if (!myUserId) return
    getMyDiscordLink(sb, myUserId).then(setMyLink).catch(() => setMyLink(null))
  }, [myUserId])

  const handleGenerateMyCode = async () => {
    try {
      setMyCode(await generateUserLinkCode(sb))
    } catch (err) {
      toast({ title: t('web.discord.failed', { defaultValue: 'Failed to generate a code' }), description: (err as Error).message, variant: 'destructive' })
    }
  }

  const handleUnlink = async () => {
    if (!myUserId) return
    try {
      await unlinkMyDiscord(sb, myUserId)
      setMyLink(null)
    } catch (err) {
      toast({ title: t('web.discord.failed', { defaultValue: 'Failed to unlink' }), description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4 text-hextech-gold" />{t('web.discord.title', { defaultValue: 'Discord bot' })}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <section className="space-y-2">
          <h3 className="font-medium text-hextech-text-bright">{t('web.discord.myAccount', { defaultValue: 'My Discord account' })}</h3>
          {myLink === undefined ? null : myLink ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-hextech-text-dim">{t('web.discord.linked', { defaultValue: 'Linked — the bot recognizes you in any server it\'s added to.' })}</p>
              <Button size="sm" variant="ghost" onClick={handleUnlink}>{t('web.discord.unlink', { defaultValue: 'Unlink' })}</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-hextech-text-dim">
                {t('web.discord.linkMeHint', { defaultValue: 'Generate a code, then run "/link-me <code>" in your team\'s Discord server.' })}
              </p>
              {myCode ? (
                <CodeDisplay code={myCode.code} expiresAt={myCode.expiresAt} command="/link-me" />
              ) : (
                <Button size="sm" onClick={handleGenerateMyCode}>{t('web.discord.generateCode', { defaultValue: 'Generate code' })}</Button>
              )}
            </div>
          )}
        </section>

        {staffGroups.length > 0 && (
          <section className="space-y-2 border-t border-hextech-border-dim pt-3">
            <h3 className="font-medium text-hextech-text-bright">{t('web.discord.teamServer', { defaultValue: 'Link a team to a Discord server' })}</h3>
            <p className="text-xs text-hextech-text-dim">
              {t('web.discord.linkTeamHint', { defaultValue: 'Generate a code for a group, then run "/link-team <code>" in the target Discord server (needs Manage Server there).' })}
            </p>
            {staffGroups.map((g) => <GuildLinkRow key={g.id} groupId={g.id} groupName={g.name} />)}
          </section>
        )}
      </CardContent>
    </Card>
  )
}

function GuildLinkRow({ groupId, groupName }: { groupId: string; groupName: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [link, setLink] = useState<DiscordGuildLink | null | undefined>(undefined)
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null)

  useEffect(() => {
    getGroupDiscordLink(sb, groupId).then(setLink).catch(() => setLink(null))
  }, [groupId])

  const handleGenerate = async () => {
    try {
      setCode(await generateGuildLinkCode(sb, groupId))
    } catch (err) {
      toast({ title: t('web.discord.failed', { defaultValue: 'Failed to generate a code' }), description: (err as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="rounded-lg bg-hextech-elevated/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-hextech-text-bright">{groupName}</span>
        {link === undefined ? null : link ? (
          <span className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-hextech-green">
              {t('web.discord.serverLinked', { defaultValue: 'Server linked' })}
              {!link.notifyChannelId && ` · ${t('web.discord.noChannel', { defaultValue: 'run /set-channel there' })}`}
            </span>
            <DiscordUnlinkButton groupId={groupId} groupName={groupName} onUnlinked={() => setLink(null)} />
          </span>
        ) : (
          <Button size="sm" variant="outline" onClick={handleGenerate}>{t('web.discord.generateCode', { defaultValue: 'Generate code' })}</Button>
        )}
      </div>
      {code && <div className="mt-2"><CodeDisplay code={code.code} expiresAt={code.expiresAt} command="/link-team" /></div>}
    </div>
  )
}

function CodeDisplay({ code, expiresAt, command }: { code: string; expiresAt: string; command: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const minutesLeft = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000))
  return (
    <div className="flex items-center gap-2">
      <code className="rounded bg-hextech-dark px-2 py-1 font-mono text-sm tracking-wider text-hextech-gold-bright">{command} {code}</code>
      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(`${command} ${code}`).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <span className="text-[10px] text-hextech-text-dim">{t('web.discord.expiresIn', { defaultValue: 'expires in {{n}} min', n: minutesLeft })}</span>
    </div>
  )
}
