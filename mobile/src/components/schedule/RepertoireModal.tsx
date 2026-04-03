import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import type { StudentPiece, PieceStatus } from '@troika/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
  studentName: string;
  pieces: StudentPiece[];
  onAddPiece: (title: string) => Promise<void>;
  onDeletePiece: (pieceId: string) => Promise<void>;
  onUpdateStatus: (pieceId: string, status: PieceStatus) => Promise<void>;
}

export function RepertoireModal({
  visible, onClose, studentName, pieces,
  onAddPiece, onDeletePiece, onUpdateStatus,
}: Props) {
  const [newPiece, setNewPiece] = useState('');
  const [localPieces, setLocalPieces] = useState<StudentPiece[]>([]);

  useEffect(() => {
    setLocalPieces(pieces);
  }, [pieces]);

  const handleAdd = async () => {
    if (!newPiece.trim()) return;
    try {
      await onAddPiece(newPiece.trim());
      setNewPiece('');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const cycleStatus = (piece: StudentPiece) => {
    const cycle: PieceStatus[] = ['not_started', 'in_progress', 'completed'];
    const currentIdx = cycle.indexOf(piece.status);
    const nextStatus = cycle[(currentIdx + 1) % cycle.length];
    onUpdateStatus(piece.id, nextStatus);
  };

  const statusVariant = (status: PieceStatus) => {
    if (status === 'completed') return 'completed';
    if (status === 'in_progress') return 'inProgress';
    return 'notStarted';
  };

  const statusLabel = (status: PieceStatus) => {
    if (status === 'completed') return 'Completed';
    if (status === 'in_progress') return 'In Progress';
    return 'Not Started';
  };

  return (
    <Modal visible={visible} onClose={onClose} title="Repertoire" subtitle={studentName} borderColor="#F0C93B">
      {/* Add piece input */}
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="Enter piece name..."
          placeholderTextColor="#9CA3AF"
          value={newPiece}
          onChangeText={setNewPiece}
          onSubmitEditing={handleAdd}
        />
        <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Pieces list */}
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {pieces.map((piece) => (
          <View key={piece.id} style={styles.pieceRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pieceTitle}>{piece.title}</Text>
              <View style={styles.pieceBottom}>
                <Text style={styles.pieceDate}>Added {piece.added_date}</Text>
                <TouchableOpacity onPress={() => cycleStatus(piece)}>
                  <Badge label={statusLabel(piece.status)} variant={statusVariant(piece.status)} />
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity onPress={() => onDeletePiece(piece.id)} style={styles.deleteBtn}>
              <Ionicons name="trash-outline" size={18} color="#E8604C" />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      {/* Footer buttons */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveBtn} onPress={onClose}>
          <Text style={styles.saveText}>Save Changes</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  addRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1A1A2E',
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#F0C93B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    maxHeight: 300,
  },
  pieceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  pieceTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A2E',
  },
  pieceBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  pieceDate: {
    fontSize: 12,
    color: '#2A9D8F',
  },
  deleteBtn: {
    padding: 8,
    marginLeft: 8,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A2E',
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#F0C93B',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
