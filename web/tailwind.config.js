/** @type {import('tailwindcss').Config} */
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        coral: {
          DEFAULT: '#E8604C', // destructive / danger only
          light: '#FDECEA',
        },
        teal: {
          DEFAULT: '#1F9488', // the single accent
          light: '#E6F4F1',
        },
        cream: '#FDF6E3',
        // navy (ink) + the gray ramp are token-driven so they flip in dark mode
        // app-wide without touching components. white/teal/coral stay literal so
        // on-accent text (text-white on buttons) is never remapped.
        navy: rgb('--c-navy'),
        yellow: {
          DEFAULT: '#C98A00', // warning only (muted from bright)
          light: '#FBF3E0',
        },
        gray: {
          50: rgb('--c-gray-50'),
          100: rgb('--c-gray-100'),
          200: rgb('--c-gray-200'),
          300: rgb('--c-gray-300'),
          400: rgb('--c-gray-400'),
          500: rgb('--c-gray-500'),
          600: rgb('--c-gray-600'),
          700: rgb('--c-gray-700'),
          800: rgb('--c-gray-800'),
          900: rgb('--c-gray-900'),
        },
      },
      fontFamily: {
        // Native system stack → renders SF Pro on macOS/iOS, Segoe on Windows.
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'system-ui', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        logo: ['Pacifico', 'cursive'],
      },
      letterSpacing: {
        tightish: '-0.02em',
      },
      boxShadow: {
        // Soft, layered — cards float a millimetre off the canvas, no hard drops.
        sm: '0 1px 2px rgba(18,18,25,0.05), 0 1px 3px rgba(18,18,25,0.04)',
        DEFAULT: '0 1px 2px rgba(18,18,25,0.05), 0 6px 16px rgba(18,18,25,0.06)',
        md: '0 2px 4px rgba(18,18,25,0.05), 0 10px 24px rgba(18,18,25,0.07)',
        lg: '0 4px 8px rgba(18,18,25,0.06), 0 16px 40px rgba(18,18,25,0.10)',
      },
    },
  },
  plugins: [],
};
