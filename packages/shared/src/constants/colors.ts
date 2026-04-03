export const colors = {
  coral: '#E8604C',
  coralLight: '#FDECEA',
  teal: '#2A9D8F',
  tealLight: '#E8F5E9',
  cream: '#FDF6E3',
  yellow: '#F0C93B',
  yellowLight: '#FFF8E1',

  textPrimary: '#1A1A2E',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',

  cardBg: '#FFFFFF',
  pageBg: '#F8F9FA',
  border: '#E5E7EB',
  divider: '#F3F4F6',

  completedBg: '#E8F5E9',
  completedText: '#2A9D8F',
  remainingBg: '#FDECEA',
  remainingText: '#E8604C',

  pendingBadgeBg: '#E8604C',
  pendingBadgeText: '#FFFFFF',
  completedBadgeBg: '#2A9D8F',
  completedBadgeText: '#FFFFFF',
  inProgressBadgeBg: '#E8604C',
  inProgressBadgeText: '#FFFFFF',
  notStartedBadgeBg: '#E8604C',
  notStartedBadgeText: '#FFFFFF',

  pieceBadgeBg: '#1A1A2E',
  pieceBadgeText: '#FFFFFF',
  exerciseBadgeBg: '#E8604C',
  exerciseBadgeText: '#FFFFFF',
  activityBadgeBg: '#E8604C',
  activityBadgeText: '#FFFFFF',

  beginnerBadgeBg: '#2A9D8F',
  beginnerBadgeText: '#FFFFFF',
  intermediateBadgeBg: '#2A9D8F',
  intermediateBadgeText: '#FFFFFF',
  advancedBadgeBg: '#1A1A2E',
  advancedBadgeText: '#FFFFFF',

  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(0, 0, 0, 0.5)',
} as const;

export type ColorName = keyof typeof colors;
