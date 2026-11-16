import type { Config } from 'tailwindcss'

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
          black: 'var(--hextech-black)',
          dark: 'var(--hextech-dark)',
          elevated: 'var(--hextech-elevated)',
          panel: 'var(--hextech-panel)',
          border: 'var(--hextech-border)',
          'border-dim': 'var(--hextech-border-dim)',
          cyan: 'var(--hextech-cyan)',
          teal: 'var(--hextech-teal)',
          gold: 'var(--hextech-gold)',
          'gold-bright': 'var(--hextech-gold-bright)',
          red: 'var(--hextech-red)',
          green: 'var(--hextech-green)',
          text: 'var(--hextech-text)',
          'text-bright': 'var(--hextech-text-bright)',
          'text-dim': 'var(--hextech-text-dim)',
          blue: 'var(--hextech-blue)',
          'blue-bright': 'var(--hextech-blue-bright)',
        },
        background: 'var(--hextech-black)',
        foreground: 'var(--hextech-gold-bright)',
        card: {
          DEFAULT: 'var(--hextech-dark)',
          foreground: 'var(--hextech-text)',
        },
        primary: {
          DEFAULT: 'var(--hextech-gold)',
          foreground: 'var(--hextech-black)',
        },
        secondary: {
          DEFAULT: 'var(--hextech-cyan)',
          foreground: 'var(--hextech-black)',
        },
        accent: {
          DEFAULT: 'var(--hextech-teal)',
          foreground: 'var(--hextech-gold-bright)',
        },
        destructive: {
          DEFAULT: 'var(--hextech-red)',
          foreground: 'var(--hextech-gold-bright)',
        },
        muted: {
          DEFAULT: 'var(--hextech-elevated)',
          foreground: 'var(--hextech-text)',
        },
        border: 'var(--hextech-border)',
        input: 'var(--hextech-elevated)',
        ring: 'var(--hextech-gold)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Beaufort for LOL"', 'Inter', 'system-ui', 'sans-serif'],
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
