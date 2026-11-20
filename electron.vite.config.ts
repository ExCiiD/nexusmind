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
 *  - *.supabase.co (images only): team logos from Storage
 * Everything else (Riot API, Discord, Google) goes through the main process.
 */
const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // *.supabase.co: team logos (public group-logos bucket) — without it the
  // <img> errors and the crest falls back to the initials.
  // ascend-cutouts: the Team Lobby cards' hosted champion cut-outs (WebP). Images only: the skin list and the
  // manifest are fetched by the main process (collabListCardSkins), not by the renderer.
  // i.ytimg.com: the Codex cards' YouTube thumbnails (microReview/codex.ts).
  "img-src 'self' data: blob: nxm: https://ddragon.leagueoflegends.com https://raw.communitydragon.org https://*.supabase.co https://ascend-cutouts.nexusmind-riot-proxy.workers.dev https://i.ytimg.com",
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
    // onnxruntime-node (champion cut-outs) is only a transitive dependency, via
    // @huggingface/transformers: kept external so its native binding loads
    // from node_modules (asar-unpacked) instead of being bundled.
    // ws (Supabase Realtime, beta.15) stays external too: bundled, its optional `bufferutil` require
    // became an empty stub and every frame >= 48 bytes threw "bufferUtil.mask is not a function".
    // Loaded by Node from node_modules, the optional require fails cleanly and ws uses its JS fallback.
    plugins: [externalizeDepsPlugin({ include: ['onnxruntime-node', 'ws'] })],
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
    // Decision F (audit UI-08, 19/11/2026): the renderer is minified (about −43 %, 4.4 MB → ~2.5 MB) with
    // keepNames, so stack traces in bug reports still name the functions and components; no source maps shipped.
    esbuild: { keepNames: true },
    build: {
      minify: 'esbuild',
      sourcemap: false,
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
