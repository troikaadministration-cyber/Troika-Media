import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Modal } from '../ui/Modal';

interface Props {
  visible: boolean;
  onClose: () => void;
  onChooseFiles: () => void;
  uploading: boolean;
}

export function UploadMediaModal({ visible, onClose, onChooseFiles, uploading }: Props) {
  return (
    <Modal visible={visible} onClose={onClose} title="Upload Media" borderColor="#E8604C">
      <View style={styles.dropzone}>
        <View style={styles.iconCircle}>
          {uploading ? (
            <ActivityIndicator size="large" color="#FFFFFF" />
          ) : (
            <Ionicons name="cloud-upload" size={32} color="#FFFFFF" />
          )}
        </View>
        <Text style={styles.dropTitle}>Upload Photos or Videos</Text>
        <Text style={styles.dropHint}>Drag and drop files here, or click to browse</Text>
        <TouchableOpacity style={styles.chooseBtn} onPress={onChooseFiles} disabled={uploading}>
          <Text style={styles.chooseBtnText}>Choose Files</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dropzone: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E8604C',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  dropTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 6,
  },
  dropHint: {
    fontSize: 13,
    color: '#2A9D8F',
    textAlign: 'center',
    marginBottom: 16,
  },
  chooseBtn: {
    backgroundColor: '#E8604C',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  chooseBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  doneBtn: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A2E',
  },
});
