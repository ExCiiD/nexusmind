import type { TFunction } from 'i18next'
import { riotErrorText } from '@/lib/riotErrors'

/**
 * #40: the analyst tables (team_game_timelines, draft_log, opponent_dossiers) arrive with a migration that is not in
 * production yet. A missing table (Postgres 42P01, PostgREST PGRST205 "Could not find the table") must read as "not
 * available yet", not as a crash or a generic error. Pure, tested.
 */
export function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null
  const code = typeof e?.code === 'string' ? e.code : ''
  const msg = typeof e?.message === 'string' ? e.message : err instanceof Error ? err.message : String(err ?? '')
  return code === '42P01' || code === 'PGRST205' || /42P01|PGRST205|could not find the table|relation "[^"]+" does not exist/i.test(msg)
}

/** The cause shown by the analyst screens' error state. */
export function analystErrorText(err: unknown, t: TFunction): string {
  if (isMissingTableError(err)) return t('analyst.common.notDeployed')
  return riotErrorText(err, t) || t('analyst.common.genericError')
}
