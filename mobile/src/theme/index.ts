export { colors } from '@troika/shared';

export const typography = {
  logo: {
    fontFamily: 'Pacifico-Regular',
    fontSize: 42,
  },
  h1: {
    fontFamily: 'System',
    fontSize: 24,
    fontWeight: '700' as const,
  },
  h2: {
    fontFamily: 'System',
    fontSize: 20,
    fontWeight: '700' as const,
  },
  h3: {
    fontFamily: 'System',
    fontSize: 16,
    fontWeight: '600' as const,
  },
  body: {
    fontFamily: 'System',
    fontSize: 14,
  },
  bodySmall: {
    fontFamily: 'System',
    fontSize: 12,
  },
  caption: {
    fontFamily: 'System',
    fontSize: 11,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const borderRadius = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
};
