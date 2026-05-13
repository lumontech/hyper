/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:    '#04060a',
        panel: '#0a0e16',
        line:  '#1a2030',
        text:  '#e5e9f0',
        muted: '#7a8398',
        gold:  '#f5c842',
        long:  '#00e096',
        short: '#ff3355',
        warn:  '#ff9933',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
