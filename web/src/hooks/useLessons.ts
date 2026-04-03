import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { LessonWithDetails, LessonType } from '../types';

export function useLessons(filters?: {
  date?: string;
  teacherId?: string;
  instrumentId?: string;
}) {
  const [lessons, setLessons] = useState<LessonWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLessons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
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

      const { data, error: err } = await query;
      if (err) throw err;
      setLessons((data as LessonWithDetails[]) || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch lessons');
    } finally {
      setLoading(false);
    }
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

  async function cancelLesson(id: string, studentId?: string, reason?: string, cancelledByRole?: string, cancelledByUserId?: string) {
    const updates: Record<string, unknown> = { status: 'cancelled' };
    if (studentId) updates.cancelled_by_student_id = studentId;
    if (reason) updates.cancel_reason = reason;
    if (cancelledByRole) updates.cancelled_by_role = cancelledByRole;
    if (cancelledByUserId) updates.cancelled_by_user_id = cancelledByUserId;

    const { error } = await supabase.from('lessons').update(updates).eq('id', id);
    if (error) throw error;

    // Return cancelled lesson with full details for the makeup match panel
    const { data } = await supabase
      .from('lessons')
      .select(`
        *,
        teacher:profiles!lessons_teacher_id_fkey(id, full_name, email),
        location:locations(*),
        instrument:instruments(*),
        students:lesson_students(*, student:students(*))
      `)
      .eq('id', id)
      .single();

    await fetchLessons();
    return data as LessonWithDetails;
  }

  async function deleteLesson(id: string) {
    const { error } = await supabase.from('lessons').delete().eq('id', id);
    if (error) throw error;
    await fetchLessons();
  }

  return { lessons, loading, error, createLesson, updateLesson, cancelLesson, deleteLesson, refresh: fetchLessons };
}
