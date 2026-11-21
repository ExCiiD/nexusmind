/// <reference types="electron-vite/node" />

/**
 * Build-time values inlined into the main bundle. Only PUBLIC values belong
 * here (they ship inside the installer). Secrets never use the MAIN_VITE_
 * prefix: the Riot key lives in the Cloudflare Worker, and the local dev key
 * (`RIOT_DEV_API_KEY`) is read from .env at runtime by riotTransport.ts.
 */
interface ImportMetaEnv {
  readonly MAIN_VITE_SUPABASE_URL?: string
  /** Supabase publishable/anon key — public by design, protected by RLS. */
  readonly MAIN_VITE_SUPABASE_ANON_KEY?: string
  /** https://<worker>.workers.dev — the Ascend Riot proxy. */
  readonly MAIN_VITE_RIOT_PROXY_URL?: string
  /** Public web app URL ("Ouvrir l'app web"). */
  readonly MAIN_VITE_WEB_URL?: string
  /**
   * The Google project's OAuth client, type "Desktop app" (21/11/2026, decision "client Desktop app + PKCE"). Google
   * treats a Desktop client's secret as not confidential: it ships in the installer, the flow is protected by PKCE.
   * Set in the git-ignored .env or the environment of the build; never committed, never logged.
   */
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
