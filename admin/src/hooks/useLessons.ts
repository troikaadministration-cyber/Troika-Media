import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { LessonWithDetails, LessonType } from '@troika/shared';

export function useLessons(filters?: {
  date?: string;
  teacherId?: string;
  instrumentId?: string;
}) {
  const [lessons, setLessons] = useState<LessonWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLessons = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('lessons')
      .select(`
        *,
        teacher:profiles!lessons_teacher_id_fkey(id, full_name, email),
        location:locations(*),
        instrument:instruments(*),
        students:lesson_students(*, student:students(*))
      `)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (filters?.date) query = query.eq('date', filters.date);
    if (filters?.teacherId) query = query.eq('teacher_id', filters.teacherId);
    if (filters?.instrumentId) query = query.eq('instrument_id', filters.instrumentId);

    const { data } = await query;
    setLessons((data as LessonWithDetails[]) || []);
    setLoading(false);
  }, [filters?.date, filters?.teacherId, filters?.instrumentId]);

  useEffect(() => { fetchLessons(); }, [fetchLessons]);

  async function createLesson(lesson: {
    teacher_id: string;
    location_id?: string;
    instrument_id?: string;
    lesson_type: LessonType;
    date: string;
    start_time: string;
    end_time?: string;
    title: string;
    student_ids: string[];
  }) {
    const { student_ids, ...lessonData } = lesson;
    const { data, error } = await supabase
      .from('lessons')
      .insert(lessonData)
      .select()
      .single();
    if (error) throw error;

    if (student_ids.length > 0 && data) {
      await supabase.from('lesson_students').insert(
        student_ids.map((sid) => ({ lesson_id: data.id, student_id: sid }))
      );
    }
    await fetchLessons();
    return data;
  }

  async function updateLesson(id: string, updates: Partial<LessonWithDetails>) {
    const { error } = await supabase.from('lessons').update(updates).eq('id', id);
    if (error) throw error;
    await fetchLessons();
  }

  async function cancelLesson(id: string, cancelledByUserId?: string, reason?: string) {
    const updates: Record<string, unknown> = {
      status: 'cancelled',
      cancelled_by_role: 'coordinator',
    };
    if (cancelledByUserId) updates.cancelled_by_user_id = cancelledByUserId;
    if (reason) updates.cancel_reason = reason;
    const { error } = await supabase.from('lessons').update(updates).eq('id', id);
    if (error) throw error;
    await fetchLessons();
  }

  async function deleteLesson(id: string) {
    const { error } = await supabase.from('lessons').delete().eq('id', id);
    if (error) throw error;
    await fetchLessons();
  }

  return { lessons, loading, createLesson, updateLesson, cancelLesson, deleteLesson, refresh: fetchLessons };
}
