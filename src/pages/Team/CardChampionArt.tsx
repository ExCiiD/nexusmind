import { useState } from 'react'
import { parallax } from '@/components/team/TiltCard'
import { useChampionCutout } from '@/hooks/useChampionCutout'
import { loadingArtUrl } from '@/lib/playerCard'
import { cn } from '@/lib/utils'

/**
 * The main champion on the front of a player card. Shows the loading art
 * fading into the card at the top, then, once the main process has cut the
 * champion out of its scene (electron/main/championCutout.ts, a few seconds
 * the first time, cached after), swaps to the cut-out: large, standing on
 * the bottom edge, bleeding past the left one, with a violet glow and a
 * soft shadow so it reads over the card's own background. Without a
 * cut-out (web app, offline, unusable mask) the faded art stays.
 */
export function CardChampionArt({ championKey, onBroken }: { championKey: string; onBroken: () => void }) {
  const cutout = useChampionCutout(championKey)
  const [cutoutShown, setCutoutShown] = useState<string | null>(null)
  const [cutoutBroken, setCutoutBroken] = useState<string | null>(null)
  const useCutout = !!cutout && cutoutBroken !== cutout
  const swapped = useCutout && cutoutShown === cutout

  return (
    <>
      <img
        src={loadingArtUrl(championKey)}
        alt=""
        draggable={false}
        onError={onBroken}
        className={cn(
          'absolute bottom-[-2%] left-[-8%] h-[72%] w-[116%] object-cover object-[50%_12%] transition-opacity duration-500 [mask-image:linear-gradient(to_bottom,transparent_0%,black_26%)]',
          swapped && 'opacity-0',
        )}
        style={{ transform: parallax(9) }}
      />
      {useCutout && (
        <img
          src={cutout}
          alt=""
          draggable={false}
          onLoad={() => setCutoutShown(cutout)}
          onError={() => setCutoutBroken(cutout)}
          className={cn(
            'absolute bottom-[-1.5%] left-[-6cqw] h-[84%] w-auto max-w-none opacity-0 transition-opacity duration-500',
            '[filter:drop-shadow(0_0_3.5cqw_rgba(167,112,255,0.42))_drop-shadow(0_1.5cqw_2.5cqw_rgba(6,3,10,0.7))]',
            swapped && 'opacity-100',
          )}
          style={{ transform: parallax(9) }}
        />
      )}
    </>
  )
}
