/**
 * Espace d'équipe → "Apparence des cartes": the line pattern of the player
 * cards and the same filters as Settings → Appearance (colour filter, blur,
 * dark ↔ light). The cards on screen follow every change at once.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Palette, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { CARD_BACKGROUNDS, CARD_LOOK_LIMITS, CARD_PATTERN_OPACITY, DEFAULT_CARD_LOOK, cardLookStyle, type CardBackgroundId, type CardLook } from '@/lib/cardLookCore'
import { CARD_PATTERN_URLS, scratchesUrl, useCardLook } from './cardBackgrounds'

const TINTS = ['#3EC2D4', '#D4A24C', '#E0473A', '#4FBF8F', '#A97BF0', '#E07AA0']

/** A small card back with the pattern and the look, as on the cards. */
export function CardPatternThumb({ id, look, className }: { id: CardBackgroundId; look: CardLook; className?: string }) {
  const s = cardLookStyle(look, 0.5)
  return (
    <span className={cn('relative block overflow-hidden rounded-md bg-[#120b19]', className)}>
      <span className="absolute inset-0" style={{ filter: s.filter }}>
        <span className="absolute inset-0 bg-[radial-gradient(130%_80%_at_50%_0%,#432a5e_0%,#1f1430_48%,#0c0812_100%)]" />
        <span className="absolute inset-[-6%]" style={{ opacity: CARD_PATTERN_OPACITY[id] * 1.6, backgroundImage: `url(${CARD_PATTERN_URLS[id]})`, backgroundSize: '135% auto', backgroundPosition: '30% 40%' }} />
        <span className="absolute inset-[-6%] opacity-50" style={{ backgroundImage: `url(${scratchesUrl})`, backgroundSize: '120% auto' }} />
      </span>
      {s.tint && <span className="absolute inset-0" style={{ background: s.tint.color, opacity: s.tint.opacity, mixBlendMode: 'color' }} />}
      <span className="absolute inset-[4%] rounded-[2px] border border-[#E4C285]/45" />
    </span>
  )
}

function LabeledSlider({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-hextech-text-bright">{label}</span>
        <span className="font-mono text-[11px] text-hextech-text-dim">{value > 0 && min < 0 ? '+' : ''}{value}{suffix}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={1} onValueChange={([v]) => onChange(v)} aria-label={label} />
    </div>
  )
}

export function CardLookButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [look, update] = useCardLook()
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Palette className="mr-1.5 h-3.5 w-3.5" />
        {t('team.cardLook.button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('team.cardLook.title')}</DialogTitle>
            <DialogDescription>{t('team.cardLook.desc')}</DialogDescription>
          </DialogHeader>

          <section>
            <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{t('team.cardLook.pattern')}</h4>
            <div role="radiogroup" aria-label={t('team.cardLook.pattern')} className="grid grid-cols-7 gap-2">
              {CARD_BACKGROUNDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={look.background === id}
                  title={t(`team.cardLook.patterns.${id}`)}
                  onClick={() => update({ background: id })}
                  className={cn(
                    'rounded-lg border-2 p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold',
                    look.background === id ? 'border-hextech-gold' : 'border-transparent hover:border-hextech-border',
                  )}
                >
                  <CardPatternThumb id={id} look={{ ...look, blur: 0 }} className="aspect-[4/7] w-full" />
                  <span className="mt-1 block truncate text-center text-[10px] text-hextech-text">{t(`team.cardLook.patterns.${id}`)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-hextech-text-bright">{t('team.cardLook.filter')}</span>
              <span className="font-mono text-[11px] text-hextech-text-dim">{look.tintStrength}%</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {TINTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => update({ tintColor: c, tintStrength: look.tintStrength || 50 })}
                  className={cn('h-6 w-6 rounded-full border-2', look.tintColor === c && look.tintStrength > 0 ? 'border-white' : 'border-transparent')}
                  style={{ background: c }}
                />
              ))}
              <label className="relative ml-1 flex h-6 cursor-pointer items-center gap-1.5 rounded-md border border-hextech-border-dim px-2 font-mono text-[11px] text-hextech-text">
                <span className="h-3 w-3 rounded-sm" style={{ background: look.tintColor }} />
                {look.tintColor}
                <input
                  type="color"
                  value={look.tintColor.toLowerCase()}
                  onChange={(e) => update({ tintColor: e.target.value, tintStrength: look.tintStrength || 50 })}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label={t('team.cardLook.filterColor')}
                />
              </label>
            </div>
            <Slider value={[look.tintStrength]} min={0} max={100} step={1} onValueChange={([v]) => update({ tintStrength: v })} aria-label={t('team.cardLook.filter')} />
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledSlider label={t('team.cardLook.light')} value={look.light} min={-CARD_LOOK_LIMITS.light} max={CARD_LOOK_LIMITS.light} suffix="" onChange={(light) => update({ light })} />
            <LabeledSlider label={t('team.cardLook.blur')} value={look.blur} min={0} max={CARD_LOOK_LIMITS.blur} suffix="px" onChange={(blur) => update({ blur })} />
          </div>
          <p className="-mt-2 text-[11px] text-hextech-text-dim">{t('team.cardLook.hint')}</p>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-hextech-text-dim" onClick={() => update(DEFAULT_CARD_LOOK)}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t('team.cardLook.reset')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
