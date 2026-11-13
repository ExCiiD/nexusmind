import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * NexusMind web companion (W4): read your reviews, coach feedback and plan
 * scrims from any device. Reuses the desktop UI from `../src` — the desktop
 * `window.api` is replaced by a Supabase-backed adapter (src/api.ts).
 *
 * Only the PUBLIC Supabase URL + publishable key are exposed, read from the
 * root `.env` (MAIN_VITE_SUPABASE_*) or from WEB_SUPABASE_* in CI.
 */
export default defineConfig({
  root: __dirname,
  envDir: resolve(__dirname, '..'),
  envPrefix: ['WEB_', 'MAIN_VITE_SUPABASE_'],
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, '../src'),
      '@web': resolve(__dirname, 'src'),
    },
  },
  css: {
    postcss: resolve(__dirname),
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: { port: 5180 },
})
