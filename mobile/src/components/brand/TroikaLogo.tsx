import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  size?: 'small' | 'large';
}

export function TroikaLogo({ size = 'large' }: Props) {
  const isSmall = size === 'small';
  return (
    <View style={styles.container}>
      <Text style={[styles.logo, isSmall && styles.logoSmall]}>troika</Text>
      <Text style={[styles.subtitle, isSmall && styles.subtitleSmall]}>music lessons</Text>
      {!isSmall && <Text style={styles.tagline}>every note counts</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  logo: {
    fontFamily: 'Pacifico-Regular',
    fontSize: 48,
    color: '#1A1A2E',
  },
  logoSmall: {
    fontSize: 24,
  },
  subtitle: {
    fontSize: 18,
    color: '#2A9D8F',
    marginTop: -4,
  },
  subtitleSmall: {
    fontSize: 11,
    marginTop: -2,
  },
  tagline: {
    fontSize: 14,
    color: '#E8604C',
    marginTop: 2,
  },
});
