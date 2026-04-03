import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type BadgeVariant = 'pending' | 'completed' | 'inProgress' | 'notStarted' | 'piece' | 'exercise' | 'activity' | 'beginner' | 'intermediate' | 'advanced' | 'count';

interface Props {
  label: string;
  variant: BadgeVariant;
}

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; text: string }> = {
  pending: { bg: '#E8604C', text: '#FFFFFF' },
  completed: { bg: '#2A9D8F', text: '#FFFFFF' },
  inProgress: { bg: '#E8604C', text: '#FFFFFF' },
  notStarted: { bg: '#E8604C', text: '#FFFFFF' },
  piece: { bg: '#1A1A2E', text: '#FFFFFF' },
  exercise: { bg: '#E8604C', text: '#FFFFFF' },
  activity: { bg: '#E8604C', text: '#FFFFFF' },
  beginner: { bg: '#2A9D8F', text: '#FFFFFF' },
  intermediate: { bg: '#2A9D8F', text: '#FFFFFF' },
  advanced: { bg: '#1A1A2E', text: '#FFFFFF' },
  count: { bg: '#F3F4F6', text: '#6B7280' },
};

export function Badge({ label, variant }: Props) {
  const style = VARIANT_STYLES[variant];
  return (
    <View style={[styles.badge, { backgroundColor: style.bg }]}>
      <Text style={[styles.text, { color: style.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});
