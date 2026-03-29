import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        hextech: {
          black: '#010A13',
          dark: '#0A1628',
          elevated: '#1E2328',
          panel: '#1E2328',
          border: '#785A28',
          'border-dim': '#3C3C41',
          cyan: '#0AC8B9',
          teal: '#0397AB',
          gold: '#C8AA6E',
          'gold-bright': '#F0E6D2',
          red: '#FF4655',
          green: '#0ACE83',
          text: '#A09B8C',
          'text-bright': '#F0E6D2',
          'text-dim': '#5B5A56',
          blue: '#0A323C',
          'blue-bright': '#CDFAFA',
        },
        background: '#010A13',
        foreground: '#F0E6D2',
        card: {
          DEFAULT: '#0A1628',
          foreground: '#A09B8C',
        },
        primary: {
          DEFAULT: '#C8AA6E',
          foreground: '#010A13',
        },
        secondary: {
          DEFAULT: '#0AC8B9',
          foreground: '#010A13',
        },
        accent: {
          DEFAULT: '#0397AB',
          foreground: '#F0E6D2',
        },
        destructive: {
          DEFAULT: '#FF4655',
          foreground: '#F0E6D2',
        },
        muted: {
          DEFAULT: '#1E2328',
          foreground: '#A09B8C',
        },
        border: '#785A28',
        input: '#1E2328',
        ring: '#C8AA6E',
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
          '0%, 100%': { boxShadow: '0 0 8px rgba(200, 170, 110, 0.3)' },
          '50%': { boxShadow: '0 0 20px rgba(200, 170, 110, 0.6)' },
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
