import { useState } from 'react'
import { parallax } from '@/components/team/TiltCard'
import { cutoutUrl } from '@/lib/cardSkinsCore'
import { loadingArtUrl } from '@/lib/playerCard'
import { cn } from '@/lib/utils'

/**
 * The main champion on the front of a player card: its hosted cut-out (the `ascend-cutouts` Worker, WebP with a
 * transparent background, since beta.10), large, standing on the bottom edge, bleeding past the left one, with a
 * violet glow and a soft shadow so it reads over the card's own background.
 *
 * No raw art while it loads (21/11/2026, user request): a neutral glow holds its place, then the cut-out fades in.
 * Only when there is no hosted cut-out for that skin (404, offline) does the card fall back to the loading art,
 * faded into the card. The local cut-out (electron/main/championCutout.ts, seconds per champion) is no longer
 * waited for here.
 */
export function CardChampionArt({ championKey, skinNum = 0, onBroken }: { championKey: string; skinNum?: number; onBroken: () => void }) {
  const url = cutoutUrl(championKey, skinNum)
  // Keyed by URL, so a new champion starts over from the placeholder.
  const [state, setState] = useState<{ url: string; status: 'loaded' | 'missing' } | null>(null)
  const status = state?.url === url ? state.status : 'loading'

  return (
    <>
      {status !== 'missing' && (
        <>
          {/* Neutral placeholder while the cut-out loads: a soft glow where the champion stands, no raw art. */}
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute bottom-[-4%] left-[8%] h-[62%] w-[84%] rounded-[50%] bg-[radial-gradient(closest-side,rgba(167,112,255,0.18),transparent)] transition-opacity duration-500',
              status === 'loading' ? 'animate-pulse opacity-100' : 'opacity-0',
            )}
          />
          <img
            key={url}
            src={url}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={() => setState({ url, status: 'loaded' })}
            onError={() => setState({ url, status: 'missing' })}
            className={cn(
              'absolute bottom-[-1.5%] left-[-6cqw] h-[84%] w-auto max-w-none transition-opacity duration-500',
              '[filter:drop-shadow(0_0_3.5cqw_rgba(167,112,255,0.42))_drop-shadow(0_1.5cqw_2.5cqw_rgba(6,3,10,0.7))]',
              status === 'loaded' ? 'opacity-100' : 'opacity-0',
            )}
            style={{ transform: parallax(9) }}
          />
        </>
      )}
      {status === 'missing' && (
        // No hosted cut-out for this skin: the original art, faded into the card.
        <img
          src={loadingArtUrl(championKey, skinNum)}
          alt=""
          draggable={false}
          onError={onBroken}
          className="absolute bottom-[-2%] left-[-8%] h-[72%] w-[116%] object-cover object-[50%_12%] [mask-image:linear-gradient(to_bottom,transparent_0%,black_26%)]"
          style={{ transform: parallax(9) }}
        />
      )}
    </>
  )
}
