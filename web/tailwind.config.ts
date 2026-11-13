import { resolve } from 'path'
import type { Config } from 'tailwindcss'
import base from '../tailwind.config'

/** Same Hextech theme as the desktop app; scans the web pages + shared UI. */
const config: Config = {
  ...base,
  content: [
    resolve(__dirname, 'index.html'),
    resolve(__dirname, 'src/**/*.{ts,tsx}'),
    resolve(__dirname, '../src/**/*.{ts,tsx}'),
  ],
}

export default config
