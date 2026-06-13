import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { PendingLesson } from '../types';

interface Props {
  lesson: PendingLesson;
  date: string; // YYYY-MM-DD — pre-filled from calendar click
  onClose: () => void;
  onConfirm: (lessonId: string, newDate: string, newTime: string) => Promise<void>;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function RescheduleModal({ lesson, date, onClose, onConfirm }: Props) {
  const [time, setTime] = useState(lesson.start_time.slice(0, 5)); // HH:MM:SS → HH:MM for <input type="time">
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const studentName = lesson.students[0]?.student?.full_name ?? 'Unknown';
  const extraStudents = lesson.students.length - 1;

  const originalDate = new Date(lesson.date + 'T00:00');
  const originalLabel = `${DAY_NAMES[originalDate.getDay()]} ${originalDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${lesson.start_time.slice(0, 5)}`;

  const newDateObj = new Date(date + 'T00:00');
  const newDateLabel = `${DAY_NAMES[newDateObj.getDay()]} ${newDateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  async function handleConfirm() {
    if (!time) { setError('Please set a time'); return; }
    setLoading(true);
    setError(null);
    try {
      await onConfirm(lesson.id, date, time + ':00'); // append seconds for DB
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reschedule');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-navy">Reschedule Lesson</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-navy"><X size={18} /></button>
        </div>

        <div className="space-y-3 mb-5">
          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Student</span>
              <span className="font-medium text-navy">
                {studentName}{extraStudents > 0 && <span className="text-gray-400"> +{extraStudents}</span>}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Teacher</span>
              <span className="font-medium text-navy">{lesson.teacher.full_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Original</span>
              <span className="text-gray-600">{originalLabel}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">New Date</label>
            <div className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-navy bg-gray-50">
              {newDateLabel}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">New Time</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Makeup'}
          </button>
        </div>
      </div>
    </div>
  );
}
