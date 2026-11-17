import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Palette, Check, Image as ImageIcon, PaintBucket, RotateCcw, Eye } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { COLOR_THEMES, applyTheme, getStoredTheme, type ColorTheme } from '@/lib/theme'
import {
  BACKGROUND_IMAGES,
  BACKGROUND_IMAGE_IDS,
  DEFAULT_APPEARANCE,
  appearanceVars,
  applyAppearance,
  getStoredAppearance,
  type AppearancePrefs,
} from '@/lib/appearance'

const THEME_SWATCHES: Record<ColorTheme, [string, string, string]> = {
  hextech: ['#0D0A06', '#D4A24C', '#3E8E7E'],
  piltover: ['#060B10', '#4C9ED4', '#3EC2D4'],
  noxus: ['#100607', '#C23B3B', '#D4753E'],
  void: ['#0A0610', '#A24CD4', '#8E6AD4'],
  ionia: ['#0F080B', '#E07AA0', '#5FB89A'],
  shurima: ['#0E0B05', '#F0C24A', '#2FC1B8'],
  freljord: ['#070B0F', '#B8DDF5', '#9AD8F0'],
  zaun: ['#070A05', '#8EE04A', '#C9772F'],
}

/** Quick picks for the color filter / solid color — the native color input
 *  stays available for anything else. */
const COLOR_PRESETS = ['#D4A24C', '#C23B3B', '#4C9ED4', '#A24CD4', '#5FB89A', '#E07AA0', '#0D0A06', '#101826']

/**
 * Settings → Appearance: color theme + app background (image with a color
 * filter, or a plain color). Every change is applied to the whole app at
 * once — the page itself is the live preview — and mirrored in the small
 * preview tile for when the user is scrolled down in Settings.
 */
export function AppearanceCard() {
  const { t } = useTranslation()
  const [theme, setTheme] = useState<ColorTheme>(() => getStoredTheme())
  const [prefs, setPrefs] = useState<AppearancePrefs>(() => getStoredAppearance())

  const chooseTheme = (id: ColorTheme) => {
    applyTheme(id)
    setTheme(id)
  }
  const update = (patch: Partial<AppearancePrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    applyAppearance(next)
  }
  const reset = () => {
    setPrefs(DEFAULT_APPEARANCE)
    applyAppearance(DEFAULT_APPEARANCE)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-hextech-gold" />
          {t('appearance.title')}
        </CardTitle>
        <CardDescription>{t('appearance.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Color theme ── */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-hextech-text-dim">{t('appearance.themes')}</h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COLOR_THEMES.map((id) => {
              const active = theme === id
              return (
                <button
                  key={id}
                  onClick={() => chooseTheme(id)}
                  className={cn(
                    'flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-all',
                    active ? 'border-hextech-gold bg-hextech-gold/10' : 'border-hextech-border-dim hover:border-hextech-border',
                  )}
                >
                  <div className="flex w-full items-center gap-1.5">
                    {THEME_SWATCHES[id].map((c, i) => (
                      <span key={i} className="h-4 w-4 rounded-full border border-white/10" style={{ backgroundColor: c }} />
                    ))}
                    {active && <Check className="ml-auto h-4 w-4 text-hextech-gold" />}
                  </div>
                  <div>
                    <p className={cn('text-sm font-medium', active ? 'text-hextech-gold-bright' : 'text-hextech-text-bright')}>{t(`appearance.theme.${id}.label`)}</p>
                    <p className="text-[11px] text-hextech-text-dim">{t(`appearance.theme.${id}.desc`)}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── Background ── */}
        <section className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-hextech-text-dim">{t('appearance.background')}</h4>
              <div className="flex rounded-lg border border-hextech-border-dim p-0.5 text-xs">
                {(['image', 'color'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => update({ mode })}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors',
                      prefs.mode === mode ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text hover:text-hextech-text-bright',
                    )}
                  >
                    {mode === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : <PaintBucket className="h-3.5 w-3.5" />}
                    {t(`appearance.mode.${mode}`)}
                  </button>
                ))}
              </div>
            </div>

            {prefs.mode === 'image' ? (
              <>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {BACKGROUND_IMAGE_IDS.map((id) => {
                    const active = prefs.imageId === id
                    return (
                      <button
                        key={id}
                        onClick={() => update({ imageId: id, dim: BACKGROUND_IMAGES[id].dim })}
                        className={cn(
                          'group relative aspect-[4/3] overflow-hidden rounded-lg border-2 transition-all',
                          active ? 'border-hextech-gold' : 'border-transparent hover:border-hextech-border',
                        )}
                        title={t(`appearance.image.${id}`)}
                      >
                        <img src={BACKGROUND_IMAGES[id].thumb} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-3 text-left text-[10px] font-medium text-white">
                          {t(`appearance.image.${id}`)}
                        </span>
                        {active && <Check className="absolute right-1 top-1 h-4 w-4 rounded-full bg-hextech-gold p-0.5 text-hextech-black" />}
                      </button>
                    )
                  })}
                </div>

                <div className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-hextech-text-bright">{t('appearance.filter')}</span>
                    <span className="font-mono text-[11px] text-hextech-text-dim">{prefs.tintStrength}%</span>
                  </div>
                  <ColorRow value={prefs.tintColor} onChange={(tintColor) => update({ tintColor, tintStrength: prefs.tintStrength || 50 })} />
                  <Slider value={[prefs.tintStrength]} min={0} max={100} step={1} onValueChange={([v]) => update({ tintStrength: v })} />
                </div>

                <LabeledSlider label={t('appearance.dim')} value={prefs.dim} max={95} suffix="%" onChange={(dim) => update({ dim })} />
                <LabeledSlider label={t('appearance.blur')} value={prefs.blur} max={16} suffix="px" onChange={(blur) => update({ blur })} />
              </>
            ) : (
              <div className="space-y-2 rounded-lg border border-hextech-border-dim p-3">
                <span className="text-xs font-medium text-hextech-text-bright">{t('appearance.solidColor')}</span>
                <ColorRow value={prefs.solidColor} onChange={(solidColor) => update({ solidColor })} />
                <p className="text-[11px] text-hextech-text-dim">{t('appearance.solidHint')}</p>
              </div>
            )}

            <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5 text-xs text-hextech-text-dim">
              <RotateCcw className="h-3.5 w-3.5" /> {t('appearance.reset')}
            </Button>
          </div>

          <PreviewTile prefs={prefs} />
        </section>
      </CardContent>
    </Card>
  )
}

function ColorRow({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {COLOR_PRESETS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn('h-6 w-6 rounded-full border-2 transition-transform hover:scale-110', value.toLowerCase() === c.toLowerCase() ? 'border-white' : 'border-white/10')}
          style={{ backgroundColor: c }}
          aria-label={c}
        />
      ))}
      <label className="relative ml-1 flex h-6 cursor-pointer items-center gap-1.5 rounded-md border border-hextech-border-dim px-2 font-mono text-[11px] text-hextech-text">
        <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: value }} />
        {value.toUpperCase()}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  )
}

function LabeledSlider({ label, value, max, suffix, onChange }: { label: string; value: number; max: number; suffix: string; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-hextech-text-bright">{label}</span>
        <span className="font-mono text-[11px] text-hextech-text-dim">{value}{suffix}</span>
      </div>
      <Slider value={[value]} min={0} max={max} step={1} onValueChange={([v]) => onChange(v)} />
    </div>
  )
}

/** Miniature of the app (sidebar + a few cards) painted with the same
 *  CSS variables and layers as the real background. */
function PreviewTile({ prefs }: { prefs: AppearancePrefs }) {
  const { t } = useTranslation()
  const vars = appearanceVars(prefs) as CSSProperties
  return (
    <div className="space-y-1.5">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-hextech-text-dim">
        <Eye className="h-3.5 w-3.5" /> {t('appearance.preview')}
      </h4>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-hextech-border-dim" style={{ ...vars, backgroundColor: 'var(--app-bg-color)' }}>
        <div
          className="absolute inset-0 scale-105 bg-cover bg-center"
          style={{ backgroundImage: 'var(--app-bg-image)', filter: 'blur(calc(var(--app-bg-blur) / 3)) brightness(var(--app-bg-brightness))' }}
        />
        <div className="absolute inset-0" style={{ backgroundColor: 'var(--app-bg-tint)', opacity: 'var(--app-bg-tint-opacity)' as any, mixBlendMode: 'color' }} />
        <div className="absolute inset-0 flex gap-1.5 p-1.5">
          <div className="w-1/4 space-y-1 rounded-md bg-hextech-dark/90 p-1.5">
            <div className="h-2 w-3/4 rounded bg-hextech-gold/70" />
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className={cn('h-1.5 rounded', i === 0 ? 'bg-hextech-gold/40' : 'bg-hextech-text-dim/40')} />)}
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-1/2 rounded bg-hextech-text-bright/70" />
            <div className="h-10 rounded-md border border-hextech-border-dim/70 bg-hextech-dark/85" />
            <div className="grid grid-cols-3 gap-1">
              {[0, 1, 2].map((i) => <div key={i} className="h-7 rounded-md border border-hextech-border-dim/70 bg-hextech-dark/85" />)}
            </div>
            <div className="h-12 rounded-md border border-hextech-border-dim/70 bg-hextech-dark/85" />
          </div>
        </div>
      </div>
      <p className="text-[11px] text-hextech-text-dim">{t('appearance.liveHint')}</p>
    </div>
  )
}
