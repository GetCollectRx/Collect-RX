import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './.storybook/**/*.{ts,tsx}',
  ],
  // Disable preflight — the app has its own CSS reset in App.css
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // Mapped to match existing App.css --green-* tokens
        // Used as the "emerald" design system palette per MASTER.md
        emerald: {
          50:  '#F4FAF6',
          100: '#EBF5EF',
          200: '#D1E9DB',
          300: '#A3D3B7',
          400: '#6DB898',
          500: '#40916C',   // primary action  (--green-500)
          600: '#358560',   // hover state     (--green-600)
          700: '#2D6A4F',   // pressed state   (--green-700)
          800: '#235239',
          900: '#1A3D2B',   // headings        (--green-900)
          950: '#0D1F15',
        },
        // Keep standard Tailwind grays available
        gray: {
          50:  '#F9FAFB',
          100: '#F0F3F1',   // --gray-100
          200: '#E5E7EB',   // --gray-200
          300: '#C5CEC9',   // --gray-300
          400: '#9CA3AF',   // --gray-400
          500: '#5C6B63',   // --gray-500
          600: '#4B5563',   // --gray-600
          700: '#374151',
          800: '#1C2826',   // --gray-800
          900: '#111827',   // --gray-900
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      spacing: {
        // 8dp base grid
        '0.5': '4px',
        '1':   '8px',
        '1.5': '12px',
        '2':   '16px',
        '3':   '24px',
        '4':   '32px',
        '6':   '48px',
        '8':   '64px',
        '12':  '96px',
      },
      fontSize: {
        'xs':   ['11px', { lineHeight: '1.6' }],
        'sm':   ['13px', { lineHeight: '1.5' }],
        'base': ['16px', { lineHeight: '1.5' }],
        'lg':   ['18px', { lineHeight: '1.4' }],
        'xl':   ['20px', { lineHeight: '1.3' }],
        '2xl':  ['24px', { lineHeight: '1.25' }],
        '3xl':  ['28px', { lineHeight: '1.2' }],
        '4xl':  ['32px', { lineHeight: '1.2' }],
      },
      borderRadius: {
        'sm':  '4px',
        DEFAULT: '6px',
        'md':  '8px',
        'lg':  '12px',
        'xl':  '16px',
        'full': '9999px',
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0,0,0,0.05)',
        DEFAULT: '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
        'md': '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
        'lg': '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
      },
      keyframes: {
        'slide-in-right': {
          from: { transform: 'translateX(110%)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        'slide-out-right': {
          from: { transform: 'translateX(0)',    opacity: '1' },
          to:   { transform: 'translateX(110%)', opacity: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
      },
      animation: {
        'slide-in-right':  'slide-in-right 200ms ease-out',
        'slide-out-right': 'slide-out-right 150ms ease-in',
        'fade-in':         'fade-in 150ms ease-out',
      },
    },
  },
  plugins: [],
}

export default config
