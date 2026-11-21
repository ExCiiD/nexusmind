import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { DDRAGON_BASE, getDdragonVersion } from '@/lib/ddragon'
import { skinLocale, skinTiles, type SkinTile } from '@/lib/cardChampionView'
import type { CardChampion, CardSkin } from '@/lib/collab'

/** All of a champion's skins from Data Dragon (number and name), empty when they cannot be read. */
export async function ddragonSkins(championId: string, locale: string): Promise<Array<{ num: number; name: string | null }>> {
  try {
    const version = await getDdragonVersion()
    const res = await fetch(`${DDRAGON_BASE}/cdn/${version}/data/${locale}/champion/${championId}.json`)
    if (!res.ok) return []
    const json = await res.json() as { data?: Record<string, { skins?: Array<{ num?: unknown; name?: unknown; parentSkin?: unknown }> }> }
    return (json.data?.[championId]?.skins ?? [])
      // Chromas are listed as skins too (with their parent skin): not skins of their own here.
      .filter((s): s is { num: number; name: unknown } => typeof s.num === 'number' && s.parentSkin === undefined)
      .map((s) => ({ num: s.num, name: s.num === 0 || typeof s.name !== 'string' ? null : s.name }))
  } catch {
    return []
  }
}

/**
 * Team Lobby, my card's champion and skin (docs/DESIGN_STATE.md § 14): the skins of the clicked champion only — a live
 * preview of the card on the left, the grid on the right (base skin, then the skins with a hosted cut-out; the
 * others folded at the end, greyed, not selectable). « Afficher sur ma carte » saves (collabSetMyCardChampion),
 * « Revenir en automatique » clears the choice; Cancel or Escape change nothing.
 */
export function CardSkinDialog({ championId, championName, current, preview, onSave, onClose }: {
  championId: string
  championName: string
  /** My saved choice (any champion), null in automatic. */
  current: CardChampion | null
  /** The front of my card with this champion and skin. */
  preview: (skinNum: number) => ReactNode
  /** Saves (null: automatic). False when it could not be saved: the pop-up stays open. */
  onSave: (choice: CardChampion | null) => Promise<boolean>
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = skinLocale(i18n.language)
  const [tiles, setTiles] = useState<{ withCutout: SkinTile[]; without: SkinTile[] } | null>(null)
  const isCurrent = current?.championId === championId
  const [selected, setSelected] = useState<number>(isCurrent ? current!.skinNum : 0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [showWithout, setShowWithout] = useState(false)
  const [saving, setSaving] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setTiles(null)
    const hosted: Promise<CardSkin[]> = window.api.collabListCardSkins?.(championId, locale).catch(() => []) ?? Promise.resolve([])
    void Promise.all([hosted, ddragonSkins(championId, locale)]).then(([h, all]) => {
      if (!alive) return
      const out = skinTiles(h, all.length ? all : h.map((s) => ({ num: s.num, name: s.name })))
      setTiles(out)
      // A saved skin that lost its cut-out falls back to the first selectable one.
      setSelected((s) => (out.withCutout.some((x) => x.num === s) ? s : out.withCutout[0]?.num ?? 0))
    })
    return () => { alive = false }
  }, [championId, locale])

  const nameOf = (tile: Pick<SkinTile, 'num' | 'name'>) => tile.name ?? t('team.roster.card.pick.classic', { name: championName })
  const selectable = tiles?.withCutout ?? []
  const shown = hovered ?? selected
  const shownTile = [...selectable, ...(tiles?.without ?? [])].find((x) => x.num === shown)
  const hostedCount = selectable.filter((x) => x.cutoutUrl).length

  // Roving focus in the radiogroup: arrows move the selection, the selected tile holds Tab.
  const move = (e: KeyboardEvent<HTMLButtonElement>, num: number) => {
    const i = selectable.findIndex((x) => x.num === num)
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!delta || i < 0) return
    e.preventDefault()
    const next = selectable[(i + delta + selectable.length) % selectable.length]
    setSelected(next.num)
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-skin="${next.num}"]`)?.focus()
  }

  const save = async (choice: CardChampion | null) => {
    setSaving(true)
    const ok = await onSave(choice).catch(() => false)
    setSaving(false)
    if (ok) onClose()
  }

  const tile = (s: SkinTile) => {
    const name = nameOf(s)
    const isSel = s.selectable && s.num === selected
    const label = [name, t(s.cutoutUrl ? 'team.roster.card.pick.withCutoutA11y' : 'team.roster.card.pick.noCutout'), isSel ? t('team.roster.card.pick.selectedA11y') : null]
      .filter(Boolean).join(', ')
    return (
      <button
        key={s.num}
        type="button"
        role="radio"
        data-skin={s.num}
        aria-checked={isSel}
        aria-disabled={!s.selectable || undefined}
        aria-label={label}
        tabIndex={s.selectable && s.num === selected ? 0 : -1}
        title={s.selectable ? name : t('team.roster.card.pick.noCutoutHelp')}
        onClick={() => { if (s.selectable) setSelected(s.num) }}
        onKeyDown={(e) => { if (s.selectable) move(e, s.num) }}
        onMouseEnter={() => setHovered(s.num)}
        onMouseLeave={() => setHovered(null)}
        onFocus={() => setHovered(null)}
        className={cn(
          'group relative h-[150px] w-[112px] overflow-hidden rounded-lg bg-[radial-gradient(120%_90%_at_50%_10%,#3A2552,#140D1E)] text-left transition-shadow',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold focus-visible:ring-offset-2 focus-visible:ring-offset-hextech-dark',
          s.selectable
            ? cn('border hover:shadow-lg', isSel ? 'border-2 border-hextech-gold' : 'border-hextech-border-dim hover:border-hextech-border')
            : 'cursor-not-allowed border border-dashed border-hextech-border',
        )}
      >
        {/* Only cut-outs, never the raw art (docs/DECISIONS.md, 20/11): a skin without one is the empty halo + its badge. */}
        {s.cutoutUrl && (
          <img src={s.cutoutUrl} alt="" loading="lazy" draggable={false} className="absolute bottom-0 left-1/2 h-[92%] w-auto max-w-none -translate-x-1/2 object-contain" />
        )}
        {!s.selectable && (
          <span className="absolute inset-x-1 top-1 rounded bg-black/70 px-1 py-0.5 text-center font-mono text-[9px] font-bold uppercase tracking-wider text-hextech-text-dim">
            {t('team.roster.card.pick.noCutout')}
          </span>
        )}
        {isSel && (
          <span aria-hidden className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-hextech-gold text-hextech-black shadow">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 to-transparent px-1.5 pb-1.5 pt-4 text-[11px] font-semibold text-hextech-text-bright">
          {name}
        </span>
      </button>
    )
  }

  const noCutoutAtAll = !!tiles && hostedCount === 0
  const title = useMemo(() => championName.toUpperCase(), [championName])

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent className="max-w-[880px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-wide">{title}</DialogTitle>
          <DialogDescription>{t('team.roster.card.pick.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[260px_1fr]">
          {/* Live preview: the real front of my card. */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-[240px]">{preview(shownTile && !shownTile.selectable ? selected : shown)}</div>
            <p className="text-xs text-hextech-text-dim">
              {t('team.roster.card.pick.previewOf', { name: shownTile ? nameOf(shownTile) : championName })}
            </p>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-hextech-gold">{t('team.roster.card.pick.skinsOf', { name: championName })}</span>
              {tiles && <span className="font-mono text-xs text-hextech-text-dim">{t('team.roster.card.pick.withCutout', { count: hostedCount })}</span>}
            </div>
            <div className="max-h-[56vh] overflow-y-auto pr-1">
              {!tiles ? (
                <div className="flex flex-wrap gap-[10px]" aria-busy>
                  {Array.from({ length: 10 }, (_, i) => <div key={i} className="h-[150px] w-[112px] animate-pulse rounded-lg bg-hextech-elevated" />)}
                </div>
              ) : (
                <>
                  {noCutoutAtAll && <p className="mb-2 text-sm text-hextech-text-dim">{t('team.roster.card.pick.noneWithCutout', { name: championName })}</p>}
                  <div ref={gridRef} role="radiogroup" aria-label={t('team.roster.card.pick.skinsOf', { name: championName })} className="flex flex-wrap gap-[10px]">
                    {selectable.map(tile)}
                  </div>
                  {tiles.without.length > 0 && (
                    <div className="mt-3">
                      <button type="button" onClick={() => setShowWithout((v) => !v)} aria-expanded={showWithout}
                        className="inline-flex items-center gap-1 text-xs text-hextech-text-dim hover:text-hextech-text-bright">
                        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showWithout && 'rotate-90')} aria-hidden />
                        {t('team.roster.card.pick.withoutCount', { count: tiles.without.length })}
                      </button>
                      {showWithout && <div className="mt-2 flex flex-wrap gap-[10px]">{tiles.without.map(tile)}</div>}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <footer className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-hextech-border-dim pt-3">
          <div className="flex items-center gap-3 text-xs text-hextech-text-dim">
            <span>{t('team.roster.card.pick.visible')}</span>
            {isCurrent && (
              <button type="button" disabled={saving} onClick={() => { void save(null) }} className="text-hextech-gold hover:underline disabled:opacity-50">
                {t('team.roster.card.pick.backToAuto')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={saving} onClick={onClose}>{t('common.cancel')}</Button>
            <Button disabled={saving || !tiles} onClick={() => { void save({ championId, skinNum: selected }) }}>
              {t('team.roster.card.pick.save')}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
