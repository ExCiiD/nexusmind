/**
 * Team logos (Coaching → Groupes, the group picker, the player cards).
 *
 * `GroupLogo` shows a group's logo, else a crest with its initials.
 * `GroupLogoEditor` lets the group's management (owner, coach, manager,
 * captain) pick an image: it is fitted into a 256 px square (transparent
 * margins, any format the browser reads, SVG included), sent as WebP and
 * stored in the cloud (collab:set-group-logo).
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import type { Group, GroupLogoImage } from '@/lib/collab'
import { initialsOf } from '@/lib/playerCard'
import { cn } from '@/lib/utils'

const LOGO_PX = 256
const MAX_INPUT_BYTES = 8 * 1024 * 1024

export function GroupLogo({ group, className }: { group: Pick<Group, 'name' | 'logoUrl'>; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (group.logoUrl && !broken) {
    return <img src={group.logoUrl} alt="" draggable={false} onError={() => setBroken(true)} className={cn('h-8 w-8 shrink-0 object-contain', className)} />
  }
  return (
    <span
      aria-hidden
      className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-hextech-border-dim bg-hextech-black/40 font-display text-[0.7rem] leading-none text-hextech-text-dim', className)}
    >
      {initialsOf(group.name)}
    </span>
  )
}

/** Fits an image file into a LOGO_PX square, as WebP. */
async function toLogoImage(file: File): Promise<GroupLogoImage> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('not an image'))
      el.src = url
    })
    const w0 = img.naturalWidth || LOGO_PX
    const h0 = img.naturalHeight || LOGO_PX
    const scale = Math.min(LOGO_PX / w0, LOGO_PX / h0)
    const w = Math.max(1, Math.round(w0 * scale))
    const h = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = LOGO_PX
    canvas.height = LOGO_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (LOGO_PX - w) / 2, (LOGO_PX - h) / 2, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9))
    if (!blob) throw new Error('encode failed')
    return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: 'image/webp' }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function GroupLogoEditor({ group, onChanged }: { group: Group; onChanged: () => Promise<void> | void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'set' | 'clear' | null>(null)

  const save = async (kind: 'set' | 'clear', image: GroupLogoImage | null) => {
    setBusy(kind)
    try {
      await window.api.collabSetGroupLogo(group.id, image)
      await onChanged()
      toast({ title: t(image ? 'coaching.groups.logo.updated' : 'coaching.groups.logo.removed') })
    } catch (err) {
      toast({ title: t('coaching.groups.logo.failed'), description: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast({ title: t('coaching.groups.logo.notImage'), variant: 'destructive' })
    if (file.size > MAX_INPUT_BYTES) return toast({ title: t('coaching.groups.logo.tooBig'), variant: 'destructive' })
    let image: GroupLogoImage
    try {
      image = await toLogoImage(file)
    } catch {
      return toast({ title: t('coaching.groups.logo.notImage'), variant: 'destructive' })
    }
    await save('set', image)
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-hextech-border-dim p-3">
      <GroupLogo group={group} className="h-14 w-14 text-base" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-hextech-text-bright">{t('coaching.groups.logo.title')}</div>
        <p className="text-xs text-hextech-text-dim">{t('coaching.groups.logo.desc')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
            className="hidden"
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
          />
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={() => input.current?.click()}>
            {busy === 'set' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {t(group.logoUrl ? 'coaching.groups.logo.change' : 'coaching.groups.logo.add')}
          </Button>
          {group.logoUrl && (
            <Button size="sm" variant="ghost" className="gap-1.5" disabled={busy !== null} onClick={() => void save('clear', null)}>
              {busy === 'clear' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {t('coaching.groups.logo.remove')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
