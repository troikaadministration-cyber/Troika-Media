import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  title: string;
  unreadCount?: number;
  onNotificationPress?: () => void;
}

export function Header({ title, unreadCount = 0, onNotificationPress }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <Text style={styles.logo}>troika</Text>
        <Text style={styles.subtitle}>music lessons</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={onNotificationPress} style={styles.bellContainer}>
          <Ionicons name="notifications-outline" size={24} color="#1A1A2E" />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <View style={styles.badgeDot} />
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  left: {},
  logo: {
    fontFamily: 'Pacifico-Regular',
    fontSize: 24,
    color: '#1A1A2E',
  },
  subtitle: {
    fontSize: 11,
    color: '#2A9D8F',
    marginTop: -2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  bellContainer: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
  },
  badgeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E8604C',
  },
});
