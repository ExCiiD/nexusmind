import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as { version: string }

/**
 * WSC-25: stamps dist/sw.js with a build id (version + build time), so the service worker's cache name changes on
 * every deployment and the old build's cached assets are dropped. public/sw.js keeps the placeholder.
 */
function swBuildId(): Plugin {
  const placeholder = '__ASCEND_BUILD_ID__'
  return {
    name: 'ascend-sw-build-id',
    apply: 'build',
    closeBundle() {
      const file = resolve(__dirname, 'dist/sw.js')
      const src = readFileSync(file, 'utf-8')
      if (!src.includes(placeholder)) throw new Error('sw.js: build id placeholder missing')
      writeFileSync(file, src.replace(placeholder, `${pkg.version}-${Date.now().toString(36)}`))
    },
  }
}

/**
 * Ascend web companion (W4): read your reviews, coach feedback and plan
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
  plugins: [react(), swBuildId()],
  define: {
    // Shown in bug reports so issues can be tied to a web build.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
