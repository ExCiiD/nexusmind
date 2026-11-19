import { z } from 'zod'
import { validatedHandle, id } from './validate'
import { getWeeklyAwards } from '../weeklyAwards'

/**
 * team:weekly-awards — MVP and Grinder holders of a local team, their streaks
 * and totals, and the current week's race (electron/main/weeklyAwards.ts,
 * rules in src/lib/weeklyAwardsCore.ts). Registered next to the team IPCs.
 */
export function registerWeeklyAwardsHandlers(): void {
  validatedHandle('team:weekly-awards', z.tuple([id]), async (_e, teamId) => getWeeklyAwards(teamId))
}
