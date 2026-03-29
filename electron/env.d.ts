/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_OPENAI_API_KEY: string
  readonly MAIN_VITE_RIOT_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
