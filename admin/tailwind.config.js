/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        coral: {
          DEFAULT: '#E8604C',
          light: '#FDECEA',
        },
        teal: {
          DEFAULT: '#2A9D8F',
          light: '#E8F5E9',
        },
        cream: '#FDF6E3',
        navy: '#1A1A2E',
      },
      fontFamily: {
        logo: ['Pacifico', 'cursive'],
      },
    },
  },
  plugins: [],
};
