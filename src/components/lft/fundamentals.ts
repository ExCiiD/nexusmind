/**
 * The fundamentals list (src/lib/constants/fundamentals*.ts) as the
 * announcements use it: names in the image's language, by category.
 */
import { FUNDAMENTALS, type FundamentalCategory } from '@/lib/constants/fundamentals'
import { FUNDAMENTALS_FR } from '@/lib/constants/fundamentals.fr'

export function fundamentalCatalog(lang: 'fr' | 'en'): FundamentalCategory[] {
  return lang === 'fr' ? FUNDAMENTALS_FR : FUNDAMENTALS
}

const KNOWN = new Set(FUNDAMENTALS.flatMap((c) => c.fundamentals.map((f) => f.id)))
export const isFundamentalId = (id: string) => KNOWN.has(id)

const labels = { fr: new Map<string, string>(), en: new Map<string, string>() }
for (const lang of ['fr', 'en'] as const) {
  for (const c of fundamentalCatalog(lang)) for (const f of c.fundamentals) labels[lang].set(f.id, f.label)
}

export function fundamentalLabel(id: string, lang: 'fr' | 'en'): string {
  return labels[lang].get(id) ?? labels.en.get(id) ?? id
}
