/** @type {import('tailwindcss').Config} */
export default {
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
        navy: '#17171F',
        yellow: {
          DEFAULT: '#C98A00', // warning only (muted from bright)
          light: '#FBF3E0',
        },
        // Warm-neutral gray ramp — replaces Tailwind's cool default so 90% of
        // the UI reads warm and considered rather than clinical.
        gray: {
          50: '#FAFAF9',
          100: '#F5F5F3',
          200: '#EAE9E6',
          300: '#D8D6D1',
          400: '#A8A59E',
          500: '#78756E',
          600: '#57544E',
          700: '#413E39',
          800: '#28251F',
          900: '#1A1813',
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
