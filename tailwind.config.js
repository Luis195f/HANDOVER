// INSTALAR: nativewind tailwindcss
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'news2-green': '#10B981',
        'news2-amber': '#F59E0B',
        'news2-red': '#EF4444',
      },
    },
  },
  plugins: [],
};
