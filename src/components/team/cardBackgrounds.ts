/**
 * The card line patterns as files, and the look the user picked for the
 * player cards (kept on this device, shared live by every card on screen).
 */
import { useEffect, useState } from 'react'
import { DEFAULT_CARD_LOOK, sanitizeCardLook, type CardBackgroundId, type CardLook } from '@/lib/cardLookCore'
import topo from '@/assets/cards/topo.svg'
import hextech from '@/assets/cards/hextech.svg'
import ripples from '@/assets/cards/ripples.svg'
import currents from '@/assets/cards/currents.svg'
import shards from '@/assets/cards/shards.svg'
import constellation from '@/assets/cards/constellation.svg'
import circuit from '@/assets/cards/circuit.svg'
export { default as scratchesUrl } from '@/assets/cards/scratches.svg'

export const CARD_PATTERN_URLS: Record<CardBackgroundId, string> = { topo, hextech, ripples, currents, shards, constellation, circuit }

const KEY = 'ascend_card_look'
const EVENT = 'ascend-card-look'

export function loadCardLook(): CardLook {
  try {
    return sanitizeCardLook(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return DEFAULT_CARD_LOOK
  }
}

export function saveCardLook(look: CardLook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(look))
  } catch {
    /* private mode: the look lasts until the app closes */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: look }))
}

/** The player cards' look; every card follows a change at once. */
export function useCardLook(): [CardLook, (patch: Partial<CardLook>) => void] {
  const [look, setLook] = useState<CardLook>(loadCardLook)
  useEffect(() => {
    const on = (e: Event) => setLook(sanitizeCardLook((e as CustomEvent).detail))
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  const update = (patch: Partial<CardLook>) => saveCardLook(sanitizeCardLook({ ...loadCardLook(), ...patch }))
  return [look, update]
}
