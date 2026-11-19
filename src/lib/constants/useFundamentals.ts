import { useTranslation } from 'react-i18next'
import { FUNDAMENTALS } from './fundamentals'
import { FUNDAMENTALS_FR } from './fundamentals.fr'
import type { Fundamental, FundamentalCategory } from './fundamentals'

export function useLocalizedFundamentals(): FundamentalCategory[] {
  const { i18n } = useTranslation()
  return i18n.language.startsWith('fr') ? FUNDAMENTALS_FR : FUNDAMENTALS
}

// Built once: the same array between renders, so it is safe in hook dependencies.
const FLAT_EN = FUNDAMENTALS.flatMap((c) => c.fundamentals)
const FLAT_FR = FUNDAMENTALS_FR.flatMap((c) => c.fundamentals)

/** Every fundamental of the current language in one list (all categories). */
export function useLocalizedFundamentalList(): Fundamental[] {
  const { i18n } = useTranslation()
  return i18n.language.startsWith('fr') ? FLAT_FR : FLAT_EN
}

export function useLocalizedFundamental(id: string) {
  const cats = useLocalizedFundamentals()
  for (const cat of cats) {
    const f = cat.fundamentals.find((f) => f.id === id)
    if (f) return f
  }
  return undefined
}
