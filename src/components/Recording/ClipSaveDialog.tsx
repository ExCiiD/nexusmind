import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Link2, Loader2, Save, Send, Share2, Youtube } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import { useYoutubeUploadAvailable } from '@/hooks/useYoutubeUploadAvailable'
import { formatMs } from '@/lib/mediaCore'
import type { ClipRange } from '@/lib/clipEdit'
import type { DiscordWebhook } from '@/lib/ipc'
import { YoutubeTermsNote, markYoutubeTermsSeen } from './YoutubeTermsNote'
import { DiscordLinkDialog } from './DiscordLinkDialog'

/** Discord takes a file up to 8 MB; above, the clip goes through a temporary link. */
const MAX_DISCORD_BYTES = 8 * 1024 * 1024
const YT_ERRORS = ['NOT_AUTHENTICATED', 'AUTH_EXPIRED', 'QUOTA_EXCEEDED', 'YOUTUBE_UNAVAILABLE', 'UPLOAD_IN_PROGRESS', 'ENCRYPTION_UNAVAILABLE']

type Step = 'choose' | 'share' | 'discord' | 'link'

/**
 * « Valider » in clip mode (DECISIONS 21/11 « Mode clip, nouvelle interface »): a pop-up with an optional title, then
 * « Sauvegarder » (in Mes clips) or « Partager »: YouTube (unlisted, youtubeUploadClip), Discord (the file through a
 * webhook, or a temporary link above 8 MB) or a temporary link (litterbox, after its one-line warning). The clip is
 * saved once, whatever is chosen after.
 */
export function ClipSaveDialog({ recordingId, range, onClose, onSaved }: {
  recordingId: string
  range: ClipRange
  onClose: () => void
  /** The clip is in Mes clips (lists to refresh). */
  onSaved: (clip: { id: string; title: string }) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const navigate = useNavigate()
  const ytAvailable = useYoutubeUploadAvailable()
  const [title, setTitle] = useState('')
  const [step, setStep] = useState<Step>('choose')
  const [busy, setBusy] = useState<string | null>(null)
  const [clipId, setClipId] = useState<string | null>(null)
  const [file, setFile] = useState<{ filePath: string; fileSize: number } | null>(null)
  const [ytConnected, setYtConnected] = useState<boolean | null>(null)
  const [ytProgress, setYtProgress] = useState<number | null>(null)
  const [hooks, setHooks] = useState<DiscordWebhook[] | null>(null)
  const [hookId, setHookId] = useState('')
  const [result, setResult] = useState<{ kind: 'youtube' | 'link'; url: string } | null>(null)
  // The YouTube link sent to a Discord webhook (the existing « Envoyer sur Discord »).
  const [ytDiscord, setYtDiscord] = useState(false)

  const clipTitle = () => title.trim() || t('recording.clip.defaultTitle')

  useEffect(() => {
    if (step !== 'share' || !ytAvailable) return
    window.api.youtubeGetStatus?.().then((s) => setYtConnected(!!s?.connected)).catch(() => setYtConnected(false))
  }, [step, ytAvailable])
  useEffect(() => {
    if (busy !== 'youtube') return
    return window.api.onYoutubeUploadProgress?.((d: { percent: number }) => setYtProgress(d.percent))
  }, [busy])
  useEffect(() => {
    if (step !== 'discord') return
    window.api.listWebhooks().then((l) => { setHooks(l); setHookId(l[0]?.id ?? '') }).catch(() => setHooks([]))
  }, [step])

  /** Saves the clip once (Mes clips); the later choices reuse it. */
  const ensureSaved = async (): Promise<string | null> => {
    if (clipId) return clipId
    try {
      const created = await window.api.createClip({ recordingId, startMs: range.startMs, endMs: range.endMs, title: title.trim() || undefined })
      setClipId(created.id)
      onSaved({ id: created.id, title: title.trim() })
      return created.id
    } catch (err) {
      const msg = (err as Error)?.message ?? ''
      const key = msg.includes('CLIP_TOO_LONG') ? 'tooLong' : msg.includes('BAD_CLIP_RANGE') ? 'badRange' : 'saveFailed'
      toast({ title: t(`recording.clip.errors.${key}`), variant: 'destructive' })
      return null
    }
  }
  /** The clip as an MP4 (exported once). */
  const ensureFile = async () => {
    if (file) return file
    const res = await window.api.exportClip({ recordingId, startMs: range.startMs, endMs: range.endMs, title: title.trim() || undefined })
    const f = { filePath: res.filePath, fileSize: res.fileSize }
    setFile(f)
    return f
  }
  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind)
    try { await fn() } catch (err) {
      const msg = (err as Error)?.message ?? ''
      if (kind === 'youtube') {
        const code = YT_ERRORS.find((c) => msg.includes(c))
        if (code === 'NOT_AUTHENTICATED' || code === 'AUTH_EXPIRED') setYtConnected(false)
        toast({ title: t(`recording.clip.youtubeErrors.${code ?? 'generic'}`), variant: 'destructive' })
      } else toast({ title: t(kind === 'discord' ? 'recording.clip.discordFailed' : 'recording.clip.actionFailed'), variant: 'destructive' })
    } finally { setBusy(null); setYtProgress(null) }
  }

  const save = () => run('save', async () => {
    if (!(await ensureSaved())) return
    toast({ title: t('recording.clip.dialog.saved'), variant: 'gold' })
    onClose()
  })
  const share = () => run('share', async () => { if (await ensureSaved()) setStep('share') })
  const youtube = () => run('youtube', async () => {
    const id = await ensureSaved()
    if (!id) return
    setYtProgress(0)
    const res = await window.api.youtubeUploadClip?.(id, { visibility: 'unlisted' })
    if (!res) throw new Error('YOUTUBE_UNAVAILABLE')
    markYoutubeTermsSeen()
    await navigator.clipboard.writeText(res.url).catch(() => {})
    setResult({ kind: 'youtube', url: res.url })
    toast({ title: t('recording.clip.youtubeDone'), variant: 'gold' })
  })
  const hook = hooks?.find((h) => h.id === hookId) ?? null
  const bigFile = !!file && file.fileSize > MAX_DISCORD_BYTES
  const discord = () => run('discord', async () => {
    if (!hook) return
    const f = await ensureFile()
    if (f.fileSize <= MAX_DISCORD_BYTES) {
      await window.api.sendFileToDiscord(f.filePath, hook.url, clipTitle())
    } else {
      // Above 8 MB: the temporary link (its warning is shown before this button), sent as a message.
      const { url } = await window.api.uploadToTemp(f.filePath, 24)
      await window.api.sendToDiscord([{ title: clipTitle(), url, description: url }], hook.url)
    }
    toast({ title: t('recording.clip.discordSent', { name: hook.name }), variant: 'gold' })
    onClose()
  })
  const tempLink = () => run('link', async () => {
    const f = await ensureFile()
    const { url } = await window.api.uploadToTemp(f.filePath, 24)
    await navigator.clipboard.writeText(url).catch(() => {})
    setResult({ kind: 'link', url })
    toast({ title: t('recording.clip.linkCopied'), variant: 'gold' })
  })

  const choice = (key: string, Icon: typeof Save, label: string, onClick: () => void, disabled = false) => (
    <Button key={key} variant="outline" className="h-auto flex-1 flex-col gap-1.5 py-3" disabled={!!busy || disabled} onClick={onClick} data-testid={`clip-dialog-${key}`}>
      {busy === key ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      <span className="text-sm">{label}</span>
    </Button>
  )

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md" data-testid="clip-save-dialog">
        <DialogHeader>
          <DialogTitle>{t('recording.clip.dialog.title')}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{formatMs(range.startMs)} → {formatMs(range.endMs)}</DialogDescription>
        </DialogHeader>

        <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder={t('recording.clip.title')} aria-label={t('recording.clip.title')}
          disabled={!!clipId} autoFocus
          className="w-full rounded-md border border-hextech-border-dim bg-hextech-black px-2.5 py-1.5 text-sm text-hextech-text focus:border-hextech-gold focus:outline-none disabled:opacity-60" />

        {step === 'choose' && (
          <div className="flex gap-2">
            {choice('save', Save, t('recording.clip.dialog.save'), () => void save())}
            {choice('share', Share2, t('recording.clip.dialog.share'), () => void share())}
          </div>
        )}

        {step === 'share' && !result && (
          <div className="space-y-2">
            <p className="text-xs text-hextech-green">✓ {t('recording.clip.inMyClips')}</p>
            <div className="flex gap-2">
              {ytAvailable && (ytConnected === false
                ? choice('youtube', Youtube, t('recording.clip.youtubeConnect'), () => navigate('/settings'))
                : choice('youtube', Youtube, busy === 'youtube' && ytProgress != null ? t('recording.clip.youtubeProgress', { percent: Math.round(ytProgress) }) : t('recording.clip.youtube'), () => void youtube(), ytConnected === null))}
              {choice('discord', Send, t('recording.clip.dialog.discord'), () => setStep('discord'))}
              {choice('link', Link2, t('recording.clip.dialog.tempLink'), () => setStep('link'))}
            </div>
            {ytAvailable && ytConnected && <YoutubeTermsNote />}
          </div>
        )}

        {step === 'discord' && (
          hooks === null ? <Loader2 className="h-5 w-5 animate-spin text-hextech-gold" />
          : hooks.length === 0 ? <p className="text-sm text-hextech-text-dim">{t('recording.clip.noWebhook')}</p>
          : (
            <div className="space-y-2">
              <select value={hookId} onChange={(e) => setHookId(e.target.value)} aria-label={t('recording.clip.webhook')}
                className="w-full rounded-md border border-hextech-border-dim bg-hextech-elevated px-2 py-2 text-sm text-hextech-text">
                {hooks.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
              {bigFile && <p className="text-[11px] text-hextech-gold" data-testid="temp-link-warning">{t('share.tempLinkWarning')}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setStep('share')}>{t('recording.clip.dialog.back')}</Button>
                <Button size="sm" disabled={!hook || !!busy} onClick={() => void discord()}>
                  {busy === 'discord' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('recording.clip.discordSend')}
                </Button>
              </div>
            </div>
          )
        )}

        {step === 'link' && !result && (
          <div className="space-y-2" data-testid="temp-link-warning">
            <p className="text-[11px] text-hextech-gold">{t('share.tempLinkWarning')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setStep('share')}>{t('recording.clip.dialog.back')}</Button>
              <Button size="sm" disabled={!!busy} onClick={() => void tempLink()}>
                {busy === 'link' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('recording.clip.createLink')}
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <p className="break-all font-mono text-xs text-hextech-text-dim">
              {result.kind === 'youtube' ? t('recording.clip.youtubeLink') : t('recording.clip.dialog.linkLabel')}{' '}
              <a href={result.url} target="_blank" rel="noreferrer" className="text-hextech-gold hover:underline">{result.url}</a>
            </p>
            <div className="flex justify-end gap-2">
              {result.kind === 'youtube' && <Button variant="outline" size="sm" onClick={() => setYtDiscord(true)} data-testid="clip-discord">{t('recording.clip.discord')}</Button>}
              <Button size="sm" onClick={onClose}>{t('common.close')}</Button>
            </div>
          </div>
        )}
        {ytDiscord && result?.kind === 'youtube' && <DiscordLinkDialog url={result.url} title={clipTitle()} onClose={() => setYtDiscord(false)} />}
      </DialogContent>
    </Dialog>
  )
}
