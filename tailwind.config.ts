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
        green: { DEFAULT: '#b4ca92', bg: '#425047' },
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
      // Spacing intentionally uses Tailwind's default scale (p-4 = 16px, gap-2 = 8px, ...): the Figma tokens
      // (4/8/12/16/24/32/48/64 px) are steps 1/2/3/4/6/8/12/16 of it. Redefining the numeric keys as pixel
      // values would shrink every p-4, gap-4, w-16, h-64 in the app to a quarter of what the design shows.
      borderRadius: {
        none: '0px',
        4: '4px',
        8: '8px',
      },
    },
  },
  plugins: [],
} satisfies Config;
