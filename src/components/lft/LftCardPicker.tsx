import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { championArtUrl } from '@/lib/lftCore'
import { skinLocale, skinTiles, type SkinTile } from '@/lib/cardChampionView'
import { ddragonSkins } from '@/components/team/CardSkinDialog'
import type { CardSkin } from '@/lib/collab'
import type { LftPlayerView } from './types'
import type { SkinChoice } from './useLftData'

/** The hosted cut-outs of a champion (desktop; empty elsewhere), shared by the picker and the poster. */
const hostedCache = new Map<string, Promise<CardSkin[]>>()
export function hostedCutouts(championId: string, locale: 'fr_FR' | 'en_US'): Promise<CardSkin[]> {
  const key = `${championId}:${locale}`
  let p = hostedCache.get(key)
  if (!p) {
    p = window.api.collabListCardSkins?.(championId, locale).catch(() => []) ?? Promise.resolve([])
    hostedCache.set(key, p)
  }
  return p
}

/**
 * The announcement's card (DECISIONS 21/11, spec § 22): like the Lobby card. « Champion · parmi ton top »: « Auto »
 * and the 5 champions of the card's back (tiles 56 px, gold 2 px when picked); « Skin · avec détouré seulement »:
 * the picked champion's skins that have a cut-out (tiles 96 × 128). Changing it here changes the announcement only.
 */
export function LftCardPicker({ player, value, version, onChange }: {
  player: LftPlayerView
  /** The member's choice for the announcement; null: « Auto » (the Lobby card's choice, else the first champion). */
  value: SkinChoice | null
  version: string
  onChange: (next: SkinChoice | null) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = skinLocale(i18n.language)
  const champions = player.champions.slice(0, 5)
  const championKey = value?.key ?? player.artKey ?? champions[0]?.key ?? null
  const [tiles, setTiles] = useState<SkinTile[] | null>(null)

  useEffect(() => {
    if (!championKey) { setTiles([]); return }
    let alive = true
    setTiles(null)
    void Promise.all([hostedCutouts(championKey, locale), ddragonSkins(championKey, locale)]).then(([hosted, all]) => {
      if (alive) setTiles(skinTiles(hosted, all.length ? all : hosted.map((s) => ({ num: s.num, name: s.name }))).withCutout)
    })
    return () => { alive = false }
  }, [championKey, locale])

  const championName = champions.find((c) => c.key === championKey)?.name ?? championKey ?? ''
  const tile = (selected: boolean) => cn('overflow-hidden rounded-md border-2 transition-colors', selected ? 'border-hextech-gold' : 'border-transparent hover:border-hextech-gold/40')

  return (
    <div className="ml-7 mt-2 space-y-3" data-testid="lft-card-picker">
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-hextech-text">{t('team.lft.card.champion')}</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('team.lft.card.champion')}>
          <button type="button" role="radio" aria-checked={!value} onClick={() => onChange(null)}
            className={cn(tile(!value), 'flex h-14 w-14 items-center justify-center bg-hextech-black text-xs font-semibold text-hextech-text')}>
            {t('team.lft.card.auto')}
          </button>
          {champions.map((c) => (
            <button key={c.key} type="button" role="radio" aria-checked={value?.key === c.key} title={c.name}
              onClick={() => onChange({ key: c.key, num: 0 })} className={cn(tile(value?.key === c.key), 'h-14 w-14')}>
              <img src={championArtUrl('icon', c.key, version)} alt={c.name} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </div>
      {value && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-hextech-text">{t('team.lft.card.skin')}</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label={t('team.lft.skinOf', { champion: championName })}>
            {tiles === null ? (
              <div className="h-32 w-24 animate-pulse rounded-md bg-hextech-elevated" />
            ) : tiles.map((s) => (
              <button key={s.num} type="button" role="radio" aria-checked={value.num === s.num} title={s.name ?? championName}
                onClick={() => onChange({ key: value.key, num: s.num })} className={cn(tile(value.num === s.num), 'h-32 w-24 shrink-0 bg-hextech-black')}>
                <img src={s.cutoutUrl ?? championArtUrl('loading', value.key, version, s.num)} alt={s.name ?? championName}
                  className={cn('h-full w-full', s.cutoutUrl ? 'object-contain' : 'object-cover')} />
              </button>
            ))}
          </div>
          <p className="font-mono text-[10px] text-hextech-text-dim">{t('team.lft.card.cutoutOnly')}</p>
        </div>
      )}
    </div>
  )
}
