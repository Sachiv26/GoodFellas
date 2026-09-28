import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          200: '#bce0ff',
          300: '#8ecdff',
          400: '#59b0ff',
          500: '#338ffb',
          600: '#1d6ef0',
          700: '#1659dc',
          800: '#1849b2',
          900: '#1a408c',
          950: '#152a56',
        },
      },
    },
  },
  plugins: [],
};
export default config;
