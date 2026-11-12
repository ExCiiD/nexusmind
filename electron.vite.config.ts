import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Content-Security-Policy for the packaged renderer. Injected as a <meta>
 * tag at build time only: the Vite dev server needs inline scripts
 * (react-refresh preamble) and a ws:// HMR socket that this policy blocks.
 *
 * Allowed origins mirror what the renderer actually uses:
 *  - nxm:            local recordings / thumbnails (custom protocol)
 *  - ddragon / communitydragon: champion, item and profile icons + JSON
 *  - youtube embeds: linked VODs
 * Everything else (Riot API, Discord, Google) goes through the main process.
 */
const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: nxm: https://ddragon.leagueoflegends.com https://raw.communitydragon.org",
  "media-src 'self' blob: nxm:",
  "connect-src 'self' nxm: https://ddragon.leagueoflegends.com https://raw.communitydragon.org",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'nexusmind-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: RENDERER_CSP },
        injectTo: 'head-prepend',
      },
    ],
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        // Two entry points:
        //  - `index.html` → main UI (React app)
        //  - `wgc-capture.html` → hidden capture renderer (vanilla TS,
        //    MediaRecorder + WGC). Keeping it as a separate entry avoids
        //    pulling React / Tailwind / i18n into the capture bundle.
        input: {
          index: resolve(__dirname, 'index.html'),
          'wgc-capture': resolve(__dirname, 'wgc-capture.html'),
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    plugins: [react(), cspPlugin()]
  }
})
