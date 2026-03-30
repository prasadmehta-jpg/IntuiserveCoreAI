/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          900: '#0B1426',
          800: '#111E35',
          700: '#172444',
        },
        gold: {
          400: '#F5C842',
          500: '#D4A017',
          600: '#B8860B',
        },
        cream: '#F5F0E8',
      },
      fontFamily: {
        display: ['Georgia', 'serif'],
        body:    ['system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
