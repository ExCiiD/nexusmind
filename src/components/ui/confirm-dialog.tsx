import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * In-app replacement for `window.confirm()`: themed, translated, focus-trapped
 * (Radix). Controlled — the caller keeps what is being confirmed in state and
 * passes `open={state != null}`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = true,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Defaults to the generic "Delete" label. */
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  // No DialogTrigger here, so Radix has nothing to refocus on close: remember
  // the element focused when the dialog opened (onOpenAutoFocus runs before
  // focus moves in) and give focus back to it if it is still on the page.
  const returnTo = useRef<HTMLElement | null>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={() => { returnTo.current = document.activeElement as HTMLElement | null }}
        onCloseAutoFocus={(e) => {
          const el = returnTo.current
          returnTo.current = null
          if (el?.isConnected) { e.preventDefault(); el.focus() }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => { onConfirm(); onOpenChange(false) }}
          >
            {confirmLabel ?? t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
