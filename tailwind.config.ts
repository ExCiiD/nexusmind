import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        hextech: {
          black: '#0D0A06',
          dark: '#1C140C',
          elevated: '#2A1D11',
          panel: '#2A1D11',
          border: '#8A6A34',
          'border-dim': '#4A3A24',
          cyan: '#3E8E7E',
          teal: '#2B6358',
          gold: '#D4A24C',
          'gold-bright': '#F5E3BE',
          red: '#E24C3A',
          green: '#6FA84A',
          text: '#B5A68C',
          'text-bright': '#F5E3BE',
          'text-dim': '#6B5C44',
          blue: '#241A10',
          'blue-bright': '#E8B86B',
        },
        background: '#0D0A06',
        foreground: '#F5E3BE',
        card: {
          DEFAULT: '#1C140C',
          foreground: '#B5A68C',
        },
        primary: {
          DEFAULT: '#D4A24C',
          foreground: '#0D0A06',
        },
        secondary: {
          DEFAULT: '#3E8E7E',
          foreground: '#0D0A06',
        },
        accent: {
          DEFAULT: '#2B6358',
          foreground: '#F5E3BE',
        },
        destructive: {
          DEFAULT: '#E24C3A',
          foreground: '#F5E3BE',
        },
        muted: {
          DEFAULT: '#2A1D11',
          foreground: '#B5A68C',
        },
        border: '#8A6A34',
        input: '#2A1D11',
        ring: '#D4A24C',
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
