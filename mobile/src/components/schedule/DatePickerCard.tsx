import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../ui/Card';

interface Props {
  date: Date;
  onDateChange: (date: Date) => void;
}

export function DatePickerCard({ date, onDateChange }: Props) {
  const [showPicker, setShowPicker] = useState(false);

  const formatted = date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  const goDay = (offset: number) => {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + offset);
    onDateChange(newDate);
  };

  return (
    <Card borderColor="#F0C93B">
      <Text style={styles.title}>Select Date</Text>
      <View style={styles.dateRow}>
        <TouchableOpacity onPress={() => goDay(-1)} style={styles.arrowBtn}>
          <Ionicons name="chevron-back" size={20} color="#6B7280" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dateDisplay}
          onPress={() => setShowPicker(!showPicker)}
        >
          <Text style={styles.dateText}>{formatted}</Text>
          <Ionicons name="calendar-outline" size={20} color="#6B7280" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => goDay(1)} style={styles.arrowBtn}>
          <Ionicons name="chevron-forward" size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 10,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  arrowBtn: {
    padding: 8,
  },
  dateDisplay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  dateText: {
    fontSize: 15,
    color: '#1A1A2E',
    fontWeight: '500',
  },
});
