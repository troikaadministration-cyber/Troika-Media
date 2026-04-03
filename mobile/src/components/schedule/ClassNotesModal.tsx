import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Modal } from '../ui/Modal';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialNotes: string;
  onSave: (notes: string) => Promise<void>;
}

const MAX_CHARS = 500;

export function ClassNotesModal({ visible, onClose, initialNotes, onSave }: Props) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes, visible]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(notes);
      onClose();
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  const handleTextChange = (text: string) => {
    if (text.length <= MAX_CHARS) {
      setNotes(text);
    }
  };

  return (
    <Modal visible={visible} onClose={onClose} title="Class Notes" borderColor="#2A9D8F">
      <Text style={styles.subtitle}>Add your notes for this class</Text>

      <TextInput
        style={styles.textArea}
        placeholder="Enter class notes, student progress, homework assignments, or any observations..."
        placeholderTextColor="#9CA3AF"
        value={notes}
        onChangeText={handleTextChange}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
      />

      <View style={styles.charCount}>
        <Text style={styles.charHint}>Max {MAX_CHARS} characters</Text>
        <Text style={styles.charNumber}>{notes.length}/{MAX_CHARS}</Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          <Text style={styles.saveText}>Save Note</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
  },
  textArea: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 14,
    fontSize: 14,
    color: '#1A1A2E',
    minHeight: 140,
    lineHeight: 20,
  },
  charCount: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 16,
  },
  charHint: {
    fontSize: 12,
    color: '#2A9D8F',
  },
  charNumber: {
    fontSize: 12,
    color: '#6B7280',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
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
    backgroundColor: '#E8604C',
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
