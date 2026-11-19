import { forwardRef } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** Minutes since midnight → "HH:MM" (1440 → "24:00", the end of the day). */
export const minToHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
/** "HH:MM" → minutes since midnight. */
export const hmToMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

const STEP = 15

/**
 * Time picker on a 15-minute grid (Planning keyboard access, #36, DESIGN_STATE § 8):
 * a Select, so it is operated with the keyboard like any other field.
 * `from` / `to` bound the choices in minutes (`to` may be 1440 = "24:00").
 */
export const TimeSelect = forwardRef<HTMLButtonElement, {
  id: string
  value: number
  onChange: (minutes: number) => void
  from?: number
  to?: number
  invalid?: boolean
  describedBy?: string
  labelledBy?: string
  className?: string
}>(({ id, value, onChange, from = 0, to = 1425, invalid, describedBy, labelledBy, className }, ref) => {
  const options: number[] = []
  for (let m = from; m <= to; m += STEP) options.push(m)
  if (!options.includes(value)) options.push(value)
  options.sort((a, b) => a - b)
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger
        ref={ref}
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        className={cn('w-[120px] font-mono', invalid && 'border-hextech-red focus-visible:ring-hextech-red', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {options.map((m) => <SelectItem key={m} value={String(m)} className="font-mono">{minToHm(m)}</SelectItem>)}
      </SelectContent>
    </Select>
  )
})
TimeSelect.displayName = 'TimeSelect'
