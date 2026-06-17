import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Anthropic-warm remap: every existing black/white/gray utility in the
        // codebase re-themes through these tokens — no per-component edits.
        black: '#1F1D1A', // warm ink
        white: '#FAF9F5', // warm paper-white (cards, surfaces)
        paper: '#F0EEE6', // page background
        gray: {
          50: '#F5F4EF',
          100: '#EBE8E0',
          200: '#DEDAD1',
          300: '#CBC6BA',
          400: '#A8A292',
          500: '#7D7768',
          600: '#5D5749',
          700: '#46413A',
          800: '#2E2A25',
          900: '#211E19',
        },
        // Claude terracotta
        clay: {
          50: '#FBF3EF',
          100: '#F6E3DA',
          200: '#EECBBC',
          300: '#E5AE97',
          400: '#DF9377',
          500: '#D97757',
          600: '#C25D3D',
          700: '#A04A30',
          800: '#7E3A26',
          900: '#5F2C1E',
        },
      },
      fontFamily: {
        mono: [
          'var(--font-plex-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
}
export default config
