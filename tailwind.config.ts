import type { Config } from 'tailwindcss'

/**
 * Theme colors are CSS variables (runtime theme switch), which Tailwind 3
 * cannot split into channels — so opacity modifiers like `bg-hextech-green/20`
 * were silently dropped (no CSS generated). color-mix keeps the variable and
 * applies the modifier; without a modifier <alpha-value> is 1 (= the color).
 */
const c = (v: string) => `color-mix(in srgb, var(${v}) calc(<alpha-value> * 100%), transparent)`

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        // Every hextech.* slot (and the shadcn-style aliases below) reads a
        // CSS custom property instead of a literal hex, so a `data-theme`
        // attribute switch (src/lib/theme.ts, index.css) re-colors the
        // whole app without a rebuild. See index.css for the actual values
        // per theme.
        hextech: {
          black: c('--hextech-black'),
          dark: c('--hextech-dark'),
          elevated: c('--hextech-elevated'),
          panel: c('--hextech-panel'),
          border: c('--hextech-border'),
          'border-dim': c('--hextech-border-dim'),
          cyan: c('--hextech-cyan'),
          teal: c('--hextech-teal'),
          gold: c('--hextech-gold'),
          'gold-bright': c('--hextech-gold-bright'),
          red: c('--hextech-red'),
          green: c('--hextech-green'),
          text: c('--hextech-text'),
          'text-bright': c('--hextech-text-bright'),
          'text-dim': c('--hextech-text-dim'),
          blue: c('--hextech-blue'),
          'blue-bright': c('--hextech-blue-bright'),
        },
        background: c('--hextech-black'),
        foreground: c('--hextech-gold-bright'),
        card: {
          DEFAULT: c('--hextech-dark'),
          foreground: c('--hextech-text'),
        },
        primary: {
          DEFAULT: c('--hextech-gold'),
          foreground: c('--hextech-black'),
        },
        secondary: {
          DEFAULT: c('--hextech-cyan'),
          foreground: c('--hextech-black'),
        },
        accent: {
          DEFAULT: c('--hextech-teal'),
          foreground: c('--hextech-gold-bright'),
        },
        destructive: {
          DEFAULT: c('--hextech-red'),
          foreground: c('--hextech-gold-bright'),
        },
        muted: {
          DEFAULT: c('--hextech-elevated'),
          foreground: c('--hextech-text'),
        },
        border: c('--hextech-border'),
        input: c('--hextech-elevated'),
        ring: c('--hextech-gold'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Beaufort for LOL"', 'Inter', 'system-ui', 'sans-serif'],
        // Condensed display + mono (self-hosted, OFL) — the direction chosen for
        // the site and the redesigned screens (planning).
        condensed: ['"Big Shoulders Display"', '"Arial Narrow"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.25rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(212, 162, 76, 0.3)' },
          '50%': { boxShadow: '0 0 20px rgba(212, 162, 76, 0.6)' },
        },
        'xp-fill': {
          from: { width: '0%' },
          to: { width: 'var(--xp-width)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in': 'slide-in 0.3s ease-out',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'xp-fill': 'xp-fill 1s ease-out forwards',
      },
    },
  },
  plugins: [],
}

export default config
