import { useTranslation } from 'react-i18next'
import { FUNDAMENTALS } from './fundamentals'
import { FUNDAMENTALS_FR } from './fundamentals.fr'
import type { FundamentalCategory } from './fundamentals'

export function useLocalizedFundamentals(): FundamentalCategory[] {
  const { i18n } = useTranslation()
  return i18n.language.startsWith('fr') ? FUNDAMENTALS_FR : FUNDAMENTALS
}

export function useLocalizedFundamental(id: string) {
  const cats = useLocalizedFundamentals()
  for (const cat of cats) {
    const f = cat.fundamentals.find((f) => f.id === id)
    if (f) return f
  }
  return undefined
}
