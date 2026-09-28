import type { Config } from 'tailwindcss';

// Tokens from the Figma design system ("Textus — Everforest · Desktop + Mobile",
// file ywJrgCQb0yXsVkSEf2f7J3, page "00 · Guide & components"). Keep in sync by hand;
// there is no design-token pipeline yet (see ARCHITECTURE_AND_REQUIREMENTS.md §15 if that changes).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#2d353b',
        dim: '#232a2e',
        surface: '#343f44',
        raised: '#3d484d',
        border: '#475258',
        fg: '#d3c6aa',
        muted: '#9da9a0',
        green: { DEFAULT: '#a7c080', bg: '#425047' },
        blue: { DEFAULT: '#7fbbb3' },
        red: { DEFAULT: '#e67e80', bg: '#514045' },
        yellow: { DEFAULT: '#dbbc7f', bg: '#4d4c43' },
      },
      fontFamily: {
        serif: ['Lora', 'serif'],
        sans: ['Inter', 'sans-serif'],
      },
      fontSize: {
        title: ['36px', { lineHeight: '46px' }],
        heading: ['20px', { lineHeight: '28px', fontWeight: '500' }],
        body: ['16px', { lineHeight: '26px' }],
        label: ['14px', { lineHeight: '20px', fontWeight: '500' }],
        small: ['12px', { lineHeight: '18px' }],
      },
      spacing: {
        0: '0px',
        4: '4px',
        8: '8px',
        12: '12px',
        16: '16px',
        24: '24px',
        32: '32px',
        48: '48px',
        64: '64px',
      },
      borderRadius: {
        none: '0px',
        4: '4px',
        8: '8px',
      },
    },
  },
  plugins: [],
} satisfies Config;
