import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
    plugins: [react()]
  }
})
