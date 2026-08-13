/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          deep: '#08080f',
          base: '#0f0f1a',
          card: '#141428',
          input: '#1a1a30',
        },
        border: {
          DEFAULT: '#1e1e35',
          active: '#7c3aed',
        },
        purple: {
          DEFAULT: '#7c3aed',
          light: '#a78bfa',
          ghost: 'rgba(124,58,237,0.18)',
        },
        green: {
          quality: '#10b981',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      textColor: {
        primary: '#f0edf5',
        secondary: '#a8a3b5',
        muted: '#5c5870',
      },
    },
  },
  plugins: [],
}
