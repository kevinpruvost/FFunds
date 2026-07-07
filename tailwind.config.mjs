import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{astro,html,js,jsx,ts,tsx}',
    './node_modules/@tremor/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    transparent: 'transparent',
    current: 'currentColor',
    extend: {
      colors: {
        tremor: {
          brand: {
            faint: colors.emerald[50],
            muted: colors.emerald[200],
            subtle: colors.emerald[400],
            DEFAULT: colors.emerald[500],
            emphasis: colors.emerald[700],
            inverted: colors.white,
          },
          background: {
            muted: colors.slate[900],
            subtle: colors.slate[800],
            DEFAULT: colors.slate[950],
            emphasis: colors.slate[300],
          },
          border: {
            DEFAULT: colors.slate[800],
          },
          ring: {
            DEFAULT: colors.slate[700],
          },
          content: {
            subtle: colors.slate[500],
            DEFAULT: colors.slate[400],
            emphasis: colors.slate[200],
            strong: colors.slate[50],
            inverted: colors.slate[950],
          },
        },
      },
      boxShadow: {
        'tremor-input': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'tremor-card':
          '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'tremor-dropdown':
          '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      },
      borderRadius: {
        'tremor-small': '0.375rem',
        'tremor-default': '0.5rem',
        'tremor-full': '9999px',
      },
      fontSize: {
        'tremor-label': ['0.75rem', { lineHeight: '1rem' }],
        'tremor-default': ['0.875rem', { lineHeight: '1.25rem' }],
        'tremor-title': ['1.125rem', { lineHeight: '1.75rem' }],
        'tremor-metric': ['1.875rem', { lineHeight: '2.25rem' }],
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  safelist: [
    {
      pattern:
        /^(bg|text|border)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|100|200|300|400|500|600|700|800|900|950)$/,
      variants: ['hover', 'data-[selected]'],
    },
  ],
  plugins: [],
};
