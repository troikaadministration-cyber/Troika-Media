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
    const channel = supabase
      .channel('lessons-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lessons', filter: `teacher_id=eq.${teacherId}` },
        () => { fetchLessons(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [teacherId, fetchLessons]);

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

  return { lessons, loading, error, refresh: fetchLessons, markComplete, markPending, updateNotes, cancelLesson };
}
