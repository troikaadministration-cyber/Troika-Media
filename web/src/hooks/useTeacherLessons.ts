import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { LessonWithDetails } from '../types';

export function useTeacherLessons(teacherId: string | undefined, date: string) {
  const [lessons, setLessons] = useState<LessonWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLessons = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('lessons')
        .select(`
          *,
          location:locations(*),
          instrument:instruments(*),
          students:lesson_students(
            *,
            student:students(*)
          )
        `)
        .eq('teacher_id', teacherId)
        .eq('date', date)
        .neq('status', 'cancelled')
        .order('start_time', { ascending: true });

      if (err) throw err;
      setLessons((data as LessonWithDetails[]) || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch lessons');
    } finally {
      setLoading(false);
    }
  }, [teacherId, date]);

  useEffect(() => { fetchLessons(); }, [fetchLessons]);

  useEffect(() => {
    if (!teacherId) return;
    let debounce: ReturnType<typeof setTimeout>;

    const channel = supabase
      .channel(`lessons-${teacherId}-${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lessons', filter: `teacher_id=eq.${teacherId}` },
        () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => fetchLessons(), 400);
        }
      )
      .subscribe();

    return () => {
      clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [teacherId, date, fetchLessons]);

  async function markComplete(lessonId: string) {
    await supabase.from('lessons').update({ status: 'completed' }).eq('id', lessonId);
    await fetchLessons();
  }

  async function markPending(lessonId: string) {
    await supabase.from('lessons').update({ status: 'scheduled' }).eq('id', lessonId);
    await fetchLessons();
  }

  async function updateNotes(lessonId: string, notes: string) {
    await supabase.from('lessons').update({ notes }).eq('id', lessonId);
    await fetchLessons();
  }

  async function markAttendance(lessonStudentId: string, lessonId: string, attended: boolean | null) {
    await supabase.from('lesson_students').update({ attended }).eq('id', lessonStudentId);

    // Auto-complete lesson when all students are marked
    if (attended !== null) {
      const { data: allStudents } = await supabase
        .from('lesson_students')
        .select('attended')
        .eq('lesson_id', lessonId);

      const allMarked = allStudents && allStudents.length > 0 && allStudents.every(s => s.attended !== null);
      if (allMarked) {
        await supabase.from('lessons').update({ status: 'completed' }).eq('id', lessonId);
      }
    }

    await fetchLessons();
  }

  async function cancelLesson(lessonId: string, userId: string, reason?: string) {
    const updates: Record<string, unknown> = {
      status: 'cancelled',
      cancelled_by_role: 'teacher',
      cancelled_by_user_id: userId,
    };
    if (reason) updates.cancel_reason = reason;
    await supabase.from('lessons').update(updates).eq('id', lessonId);
    await fetchLessons();
  }

  return { lessons, loading, error, refresh: fetchLessons, markComplete, markPending, updateNotes, cancelLesson, markAttendance };
}
