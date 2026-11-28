/**
 * Health check of 28/11/2026: 100 `scriptThrewException` out of 950 invocations over 30 days, all between
 * 18/11 19:03 UTC (first deploy) and 19/11 ~17:00 UTC (secrets set, redeployed), each with 0 subrequests: the
 * Worker ran without its secrets, `createClient` threw before any request, and every 15-minute cron failed.
 * Since then: 0 errors. So the Worker now checks its configuration first and says what is missing, instead of
 * throwing an unnamed exception (and observability is on in wrangler.toml so the next failure has a log).
 */
export const REQUIRED_CONFIG = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN'] as const

/** The names of the required variables/secrets that are absent or empty. */
export function missingConfig(env: Partial<Record<(typeof REQUIRED_CONFIG)[number], unknown>>): string[] {
  return REQUIRED_CONFIG.filter((k) => typeof env[k] !== 'string' || (env[k] as string).trim() === '')
}
