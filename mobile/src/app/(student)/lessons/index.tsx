import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../../components/brand/Header';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { useAuth } from '../../../hooks/useAuth';
import { supabase } from '../../../lib/supabase';
import { useStudentLessons } from '../../../hooks/useStudentLessons';

export default function StudentLessonsScreen() {
  const { profile } = useAuth();
  const [studentId, setStudentId] = useState<string>();

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from('students')
      .select('id')
      .eq('user_id', profile.id)
      .single()
      .then(({ data }) => {
        if (data) setStudentId(data.id);
      });
  }, [profile?.id]);

  const { upcoming, past, loading, totalCompleted, refresh } = useStudentLessons(studentId);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title="My Lessons" />

      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      >
        {/* Stats */}
        <Card borderColor="#2A9D8F">
          <Text style={styles.statsTitle}>Attendance Summary</Text>
          <View style={styles.statsRow}>
            <View style={[styles.statBox, { backgroundColor: '#E8F5E9' }]}>
              <Text style={[styles.statNum, { color: '#2A9D8F' }]}>{totalCompleted}</Text>
              <Text style={[styles.statLabel, { color: '#2A9D8F' }]}>Attended</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: '#FDECEA' }]}>
              <Text style={[styles.statNum, { color: '#E8604C' }]}>{past.length - totalCompleted}</Text>
              <Text style={[styles.statLabel, { color: '#E8604C' }]}>Missed</Text>
            </View>
          </View>
        </Card>

        {/* Upcoming */}
        <Text style={styles.sectionTitle}>Upcoming Lessons</Text>
        {upcoming.length === 0 ? (
          <Text style={styles.emptyText}>No upcoming lessons</Text>
        ) : (
          upcoming.map((item: any) => (
            <Card key={item.id} borderColor="#F0C93B">
              <View style={styles.lessonHeader}>
                <Text style={styles.lessonTime}>{item.lesson?.start_time?.slice(0, 5)}</Text>
                <Badge label="Upcoming" variant="pending" />
              </View>
              <Text style={styles.lessonTitle}>{item.lesson?.title || item.lesson?.instrument?.name + ' Lesson'}</Text>
              <View style={styles.detailRow}>
                <Ionicons name="person-outline" size={14} color="#2A9D8F" />
                <Text style={styles.detailText}>{item.lesson?.teacher?.full_name || 'Teacher'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Ionicons name="calendar-outline" size={14} color="#6B7280" />
                <Text style={styles.detailText}>
                  {new Date(item.lesson?.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </Text>
              </View>
              {item.lesson?.location && (
                <View style={styles.detailRow}>
                  <Ionicons name="location-outline" size={14} color="#E8604C" />
                  <Text style={styles.detailText}>{item.lesson.location.address || item.lesson.location.name}</Text>
                </View>
              )}
            </Card>
          ))
        )}

        {/* Past */}
        <Text style={styles.sectionTitle}>Past Lessons</Text>
        {past.length === 0 ? (
          <Text style={styles.emptyText}>No past lessons</Text>
        ) : (
          past.map((item: any) => (
            <Card key={item.id} borderColor={item.attended ? '#2A9D8F' : '#E8604C'}>
              <View style={styles.lessonHeader}>
                <Text style={styles.lessonTime}>{item.lesson?.start_time?.slice(0, 5)}</Text>
                <Badge
                  label={item.attended ? 'Attended' : item.attended === false ? 'Absent' : 'Unknown'}
                  variant={item.attended ? 'completed' : 'pending'}
                />
              </View>
              <Text style={styles.lessonTitle}>{item.lesson?.title || 'Lesson'}</Text>
              <View style={styles.detailRow}>
                <Ionicons name="calendar-outline" size={14} color="#6B7280" />
                <Text style={styles.detailText}>
                  {new Date(item.lesson?.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
              </View>
            </Card>
          ))
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  scroll: {
    flex: 1,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statBox: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 28,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A2E',
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    marginTop: 16,
    fontSize: 14,
  },
  lessonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  lessonTime: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  lessonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A2E',
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  detailText: {
    fontSize: 13,
    color: '#6B7280',
  },
});
