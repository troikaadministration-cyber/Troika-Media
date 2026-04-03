import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { LessonWithDetails, StudentPiece } from '@troika/shared';

interface Props {
  lesson: LessonWithDetails;
  pieces?: StudentPiece[];
  onToggleComplete: () => void;
  onPiecesPress: () => void;
  onNotesPress: () => void;
  onMediaPress: () => void;
}

export function LessonCard({
  lesson,
  pieces = [],
  onToggleComplete,
  onPiecesPress,
  onNotesPress,
  onMediaPress,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const isCompleted = lesson.status === 'completed';
  const borderColor = isCompleted ? '#2A9D8F' : '#E8604C';
  const student = lesson.students?.[0]?.student;
  const studentName = student?.full_name || 'No student';
  const completedCount = 0; // Would come from aggregated data
  const time = lesson.start_time?.slice(0, 5) || '';

  return (
    <Card borderColor={borderColor}>
      {/* Header row: time + badge + icon */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.time}>{time}</Text>
          <Badge
            label={isCompleted ? 'Completed' : 'Pending'}
            variant={isCompleted ? 'completed' : 'pending'}
          />
        </View>
        <View style={styles.headerRight}>
          <View style={[styles.instrumentIcon, { backgroundColor: isCompleted ? '#E8F5E9' : '#FDECEA' }]}>
            <Ionicons name="musical-note" size={18} color={borderColor} />
          </View>
        </View>
      </View>

      {/* Checkmark toggle + Title */}
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.instrumentTitle}>{lesson.title || `${lesson.instrument?.name || ''} Lessons`}</Text>
          <View style={styles.studentRow}>
            <Text style={styles.studentName}>{studentName}</Text>
            {lesson.students && lesson.students.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>
                  {lesson.students.filter(s => s.attended !== false).length > 0
                    ? `${lesson.students.length} classes completed`
                    : `${lesson.students.length} student${lesson.students.length > 1 ? 's' : ''}`
                  }
                </Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity onPress={onToggleComplete} style={styles.checkmarkContainer}>
          <View style={[
            styles.checkmark,
            isCompleted ? styles.checkmarkCompleted : styles.checkmarkPending,
          ]}>
            {isCompleted && <Ionicons name="checkmark" size={22} color="#FFFFFF" />}
          </View>
        </TouchableOpacity>
      </View>

      {/* Location */}
      {lesson.location && (
        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={16} color="#E8604C" />
          <Text style={styles.locationText}>{lesson.location.address || lesson.location.name}</Text>
        </View>
      )}

      {/* Current Pieces (expandable) */}
      {pieces.length > 0 && (
        <TouchableOpacity onPress={() => setExpanded(!expanded)}>
          <View style={styles.piecesSection}>
            <View style={styles.piecesHeader}>
              <Ionicons name="musical-notes-outline" size={16} color="#E8604C" />
              <Text style={styles.piecesTitle}>Current Pieces ({pieces.length})</Text>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#6B7280" />
            </View>
            {expanded && pieces.map((piece) => (
              <View key={piece.id} style={styles.pieceRow}>
                <Text style={styles.pieceTitle}>{piece.title}</Text>
                <Badge
                  label={piece.status === 'completed' ? 'Completed' : piece.status === 'in_progress' ? 'In Progress' : 'Not Started'}
                  variant={piece.status === 'completed' ? 'completed' : piece.status === 'in_progress' ? 'inProgress' : 'notStarted'}
                />
              </View>
            ))}
          </View>
        </TouchableOpacity>
      )}

      {/* Class notes bubble */}
      {lesson.notes && (
        <View style={styles.notesBubble}>
          <Ionicons name="chatbubble-outline" size={14} color="#6B7280" style={{ marginRight: 6, marginTop: 2 }} />
          <Text style={styles.notesText}>{lesson.notes}</Text>
        </View>
      )}

      {/* Action buttons row */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FFF8E1' }]} onPress={onPiecesPress}>
          <Ionicons name="musical-notes" size={18} color="#E8604C" />
          <Text style={[styles.actionLabel, { color: '#E8604C' }]}>Pieces</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F3F4F6' }]} onPress={onNotesPress}>
          <Ionicons name="create-outline" size={18} color="#6B7280" />
          <Text style={[styles.actionLabel, { color: '#6B7280' }]}>Notes</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FDECEA' }]} onPress={onMediaPress}>
          <Ionicons name="cloud-upload-outline" size={18} color="#E8604C" />
          <Text style={[styles.actionLabel, { color: '#E8604C' }]}>Media</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerRight: {},
  time: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  instrumentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  instrumentTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  studentName: {
    fontSize: 14,
    color: '#2A9D8F',
    fontWeight: '500',
  },
  countBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 11,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  checkmarkContainer: {
    marginLeft: 8,
  },
  checkmark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkCompleted: {
    backgroundColor: '#2A9D8F',
  },
  checkmarkPending: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  locationText: {
    fontSize: 13,
    color: '#6B7280',
  },
  piecesSection: {
    backgroundColor: '#FDF6E3',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  piecesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  piecesTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A2E',
    flex: 1,
  },
  pieceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingLeft: 22,
  },
  pieceTitle: {
    fontSize: 13,
    color: '#1A1A2E',
    flex: 1,
  },
  notesBubble: {
    backgroundColor: '#FDF6E3',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
  },
  notesText: {
    fontSize: 13,
    color: '#1A1A2E',
    fontStyle: 'italic',
    flex: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 4,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});
