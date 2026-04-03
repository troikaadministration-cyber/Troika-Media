import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../hooks/useAuth';

export default function LandingScreen() {
  const router = useRouter();
  const { session, profile, loading } = useAuth();

  const handlePress = () => {
    if (session && profile) {
      if (profile.role === 'teacher') {
        router.replace('/(teacher)/schedule');
      } else if (profile.role === 'student') {
        router.replace('/(student)/lessons');
      }
    } else {
      router.push('/(auth)/login');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>troika</Text>
        <Text style={styles.subtitle}>music lessons</Text>
        <Text style={styles.tagline}>every note counts</Text>

        <Text style={styles.heading}>Teacher Dashboard</Text>
        <Text style={styles.description}>Manage your teaching schedule with ease</Text>

        <TouchableOpacity style={styles.button} onPress={handlePress}>
          <Text style={styles.buttonText}>View Schedule Dashboard</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  logo: {
    fontFamily: 'Pacifico-Regular',
    fontSize: 56,
    color: '#1A1A2E',
  },
  subtitle: {
    fontSize: 20,
    color: '#2A9D8F',
    marginTop: -4,
  },
  tagline: {
    fontSize: 14,
    color: '#E8604C',
    marginTop: 4,
    marginBottom: 40,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 32,
  },
  button: {
    backgroundColor: '#E8604C',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 28,
    shadowColor: '#E8604C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
});
