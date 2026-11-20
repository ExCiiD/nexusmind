import { useEffect, useState } from 'react'
import { parallax } from '@/components/team/TiltCard'
import { cutoutUrl } from '@/lib/cardSkinsCore'
import { cutoutCandidates } from '@/lib/cardChampionView'
import { cn } from '@/lib/utils'

/** The skin numbers of a champion with a hosted cut-out, once per champion for the session (null: unknown). */
const hostedSkins = new Map<string, Promise<number[] | null>>()
function loadHostedSkins(championKey: string): Promise<number[] | null> {
  let p = hostedSkins.get(championKey)
  if (!p) {
    const list = window.api.collabListCardSkins
    p = list
      ? list(championKey).then((skins) => skins.map((s) => s.num)).catch(() => null)
      : Promise.resolve(null)
    // A failure (offline) is asked again by the next card that needs it.
    void p.then((nums) => { if (nums === null) hostedSkins.delete(championKey) })
    hostedSkins.set(championKey, p)
  }
  return p
}

/**
 * The main champion on the front of a player card: its hosted cut-out (the `ascend-cutouts` Worker, WebP with a
 * transparent background), large, standing on the bottom edge, bleeding past the left one, with a violet glow and a
 * soft shadow so it reads over the card's own background.
 *
 * Never the raw art (user rule, 21/11/2026): the picked skin's cut-out, else the first skin of that champion that has
 * one (the hosted manifest, through collabListCardSkins), else — no cut-out at all, offline, an error — only the
 * neutral glow. The glow also holds the place while the image loads.
 */
export function CardChampionArt({ championKey, skinNum = 0 }: { championKey: string; skinNum?: number }) {
  const [hosted, setHosted] = useState<{ key: string; nums: number[] | null } | null>(null)
  const [failed, setFailed] = useState<string[]>([])
  const [loaded, setLoaded] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void loadHostedSkins(championKey).then((nums) => { if (alive) setHosted({ key: championKey, nums }) })
    return () => { alive = false }
  }, [championKey])

  const nums = hosted?.key === championKey ? hosted.nums : null
  const url = cutoutCandidates(skinNum, nums)
    .map((n) => cutoutUrl(championKey, n))
    .find((u) => !failed.includes(u)) ?? null
  const shown = !!url && loaded === url

  return (
    <>
      {/* Neutral glow where the champion stands: while the cut-out loads, and alone when there is none. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute bottom-[-4%] left-[8%] h-[62%] w-[84%] rounded-[50%] bg-[radial-gradient(closest-side,rgba(167,112,255,0.18),transparent)] transition-opacity duration-500',
          shown ? 'opacity-0' : url ? 'animate-pulse opacity-100' : 'opacity-100',
        )}
      />
      {url && (
        <img
          key={url}
          src={url}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setLoaded(url)}
          onError={() => setFailed((f) => (f.includes(url) ? f : [...f, url]))}
          className={cn(
            'absolute bottom-[-1.5%] left-[-6cqw] h-[84%] w-auto max-w-none transition-opacity duration-500',
            '[filter:drop-shadow(0_0_3.5cqw_rgba(167,112,255,0.42))_drop-shadow(0_1.5cqw_2.5cqw_rgba(6,3,10,0.7))]',
            shown ? 'opacity-100' : 'opacity-0',
          )}
          style={{ transform: parallax(9) }}
        />
      )}
    </>
  )
}
