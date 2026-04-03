import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../../../components/brand/Header';
import { TodayOverview } from '../../../components/schedule/TodayOverview';
import { DatePickerCard } from '../../../components/schedule/DatePickerCard';
import { LessonCard } from '../../../components/schedule/LessonCard';
import { RepertoireModal } from '../../../components/schedule/RepertoireModal';
import { ClassNotesModal } from '../../../components/schedule/ClassNotesModal';
import { UploadMediaModal } from '../../../components/schedule/UploadMediaModal';
import { useAuth } from '../../../hooks/useAuth';
import { useLessons } from '../../../hooks/useLessons';
import { useStudentPieces } from '../../../hooks/useStudentPieces';
import { useMediaUpload } from '../../../hooks/useMediaUpload';
import type { LessonWithDetails } from '@troika/shared';

export default function ScheduleScreen() {
  const { profile } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const dateStr = selectedDate.toISOString().split('T')[0];
  const { lessons, loading, markComplete, markPending, updateNotes } = useLessons(profile?.id, dateStr);

  // Modal state
  const [repertoireLesson, setRepertoireLesson] = useState<LessonWithDetails | null>(null);
  const [notesLesson, setNotesLesson] = useState<LessonWithDetails | null>(null);
  const [mediaLesson, setMediaLesson] = useState<LessonWithDetails | null>(null);

  // Get selected student for repertoire
  const selectedStudent = repertoireLesson?.students?.[0]?.student;
  const { pieces, addPiece, deletePiece, updateStatus } = useStudentPieces(
    selectedStudent?.id,
    profile?.id
  );
  const { pickAndUpload, uploading } = useMediaUpload(
    mediaLesson?.id || '',
    profile?.id || ''
  );

  const completed = lessons.filter((l) => l.status === 'completed').length;
  const remaining = lessons.filter((l) => l.status !== 'completed').length;

  const dateLabel = selectedDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const handleToggleComplete = async (lesson: LessonWithDetails) => {
    if (lesson.status === 'completed') {
      await markPending(lesson.id);
    } else {
      await markComplete(lesson.id);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title="Teaching Schedule" unreadCount={1} />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <TodayOverview completed={completed} remaining={remaining} dateLabel={dateLabel} />
        <DatePickerCard date={selectedDate} onDateChange={setSelectedDate} />

        <Text style={styles.sectionTitle}>Today's Classes</Text>

        {loading ? (
          <Text style={styles.loadingText}>Loading...</Text>
        ) : lessons.length === 0 ? (
          <Text style={styles.emptyText}>No classes scheduled for this date</Text>
        ) : (
          lessons.map((lesson) => {
            const studentForPieces = lesson.students?.[0]?.student;
            return (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                pieces={studentForPieces ? pieces.filter(p => true) : []}
                onToggleComplete={() => handleToggleComplete(lesson)}
                onPiecesPress={() => setRepertoireLesson(lesson)}
                onNotesPress={() => setNotesLesson(lesson)}
                onMediaPress={() => setMediaLesson(lesson)}
              />
            );
          })
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Modals */}
      <RepertoireModal
        visible={!!repertoireLesson}
        onClose={() => setRepertoireLesson(null)}
        studentName={selectedStudent?.full_name || ''}
        pieces={pieces}
        onAddPiece={addPiece}
        onDeletePiece={deletePiece}
        onUpdateStatus={updateStatus}
      />

      <ClassNotesModal
        visible={!!notesLesson}
        onClose={() => setNotesLesson(null)}
        initialNotes={notesLesson?.notes || ''}
        onSave={async (notes) => {
          if (notesLesson) await updateNotes(notesLesson.id, notes);
        }}
      />

      <UploadMediaModal
        visible={!!mediaLesson}
        onClose={() => setMediaLesson(null)}
        onChooseFiles={pickAndUpload}
        uploading={uploading}
      />
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
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A2E',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  loadingText: {
    textAlign: 'center',
    color: '#6B7280',
    marginTop: 32,
    fontSize: 15,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    marginTop: 32,
    fontSize: 15,
  },
});
