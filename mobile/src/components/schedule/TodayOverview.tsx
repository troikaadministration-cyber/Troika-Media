import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';

interface Props {
  completed: number;
  remaining: number;
  dateLabel: string;
}

export function TodayOverview({ completed, remaining, dateLabel }: Props) {
  const total = completed + remaining;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Card borderColor="#E8604C">
      <View style={styles.headerRow}>
        <Text style={styles.title}>Today's Overview</Text>
        <Text style={styles.date}>{dateLabel}</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statBox, { backgroundColor: '#E8F5E9' }]}>
          <Text style={[styles.statNumber, { color: '#2A9D8F' }]}>{completed}</Text>
          <Text style={[styles.statLabel, { color: '#2A9D8F' }]}>Completed</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: '#FDECEA' }]}>
          <Text style={[styles.statNumber, { color: '#E8604C' }]}>{remaining}</Text>
          <Text style={[styles.statLabel, { color: '#E8604C' }]}>Remaining</Text>
        </View>
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>Progress</Text>
          <Text style={styles.progressPercent}>{progress}%</Text>
        </View>
        <ProgressBar progress={progress} color="#2A9D8F" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  date: {
    fontSize: 14,
    color: '#2A9D8F',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 32,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  progressSection: {},
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A2E',
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A2E',
  },
});
