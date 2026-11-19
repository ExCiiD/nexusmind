import { z } from 'zod'
import { validatedHandle } from './validate'
import { getChampionCutout } from '../championCutout'

/** Player cards: the main champion cut out of its loading art (electron/main/championCutout.ts). */
export function registerChampionCutoutHandlers(): void {
  validatedHandle(
    'champion-cutout:get',
    z.tuple([z.string().regex(/^[A-Za-z0-9]{1,40}$/), z.number().int().min(0).max(999).optional()]),
    async (_e, championKey, skin) => getChampionCutout(championKey, skin ?? 0),
  )
}
