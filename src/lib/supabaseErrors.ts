/**
 * Error mapper shared by the Supabase-backed `*Core.ts` modules (desktop main
 * process, web app and Discord bot): an RLS or permission failure becomes
 * 'FORBIDDEN', which the UI turns into its "no access" message; any other
 * error keeps its own message, or `fallback` when there is none.
 */
export function fail(error: { message: string; code?: string } | null, fallback: string): never {
  const msg = error?.message ?? fallback
  if (/permission|forbidden/i.test(msg) || error?.code === '42501') throw new Error('FORBIDDEN')
  throw new Error(msg)
}
