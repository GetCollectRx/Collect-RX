/**
 * CollectRx — Tailwind CSS Design System
 *
 * Source of truth for all design tokens.
 * The inline config in index.html MUST mirror this file exactly.
 *
 * Usage:
 *   npm install -D tailwindcss @tailwindcss/vite autoprefixer
 *   Then update vite.config.ts to import tailwindcss from '@tailwindcss/vite'
 */

import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './.storybook/**/*.{ts,tsx}',
  ],
  darkMode: 'class',

  theme: {
    extend: {
      // ── Brand palette ──────────────────────────────────────────────────────
      // Primary: #0f9d58 — matches marketing site (brandTokens.css)
      colors: {
        crx: {
          50:  '#f0faf5',
          100: '#d6f0e4',
          200: '#a8dfc8',
          300: '#6ec9a4',
          400: '#2db872',
          500: '#0f9d58',
          600: '#0b5b47',
          700: '#094938',
          800: '#063629',
          900: '#042419',
          950: '#021410',
        },
      },

      // ── Typography ─────────────────────────────────────────────────────────
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Source Serif 4', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['DM Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },

      // ── Radii ──────────────────────────────────────────────────────────────
      borderRadius: {
        'xl':  '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },

      // ── Shadows ────────────────────────────────────────────────────────────
      boxShadow: {
        'card':       '0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.07)',
        'card-hover': '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.08)',
        'modal':      '0 20px 25px -5px rgb(0 0 0 / 0.12), 0 8px 10px -6px rgb(0 0 0 / 0.08)',
        'sidebar':    '1px 0 0 0 rgb(0 0 0 / 0.06)',
      },

      // ── Motion ─────────────────────────────────────────────────────────────
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-in':  'fade-in 0.2s ease-out both',
        'slide-in': 'slide-in 0.2s ease-out both',
        'spin-slow': 'spin-slow 0.8s linear infinite',
      },
    },
  },

  plugins: [],
}

export default config
