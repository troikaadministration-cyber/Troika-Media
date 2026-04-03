import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { LessonWithDetails } from '@troika/shared';

export function useLessons(teacherId: string | undefined, date: string) {
  const [lessons, setLessons] = useState<LessonWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLessons = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
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

      if (fetchError) throw fetchError;
      setLessons((data as LessonWithDetails[]) || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [teacherId, date]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  // Realtime subscription
  useEffect(() => {
    if (!teacherId) return;

    const channel = supabase
      .channel('lessons-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lessons',
          filter: `teacher_id=eq.${teacherId}`,
        },
        () => {
          fetchLessons();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teacherId, fetchLessons]);

  async function markComplete(lessonId: string) {
    const { error } = await supabase
      .from('lessons')
      .update({ status: 'completed' })
      .eq('id', lessonId);

    if (error) throw error;
    await fetchLessons();
  }

  async function markPending(lessonId: string) {
    const { error } = await supabase
      .from('lessons')
      .update({ status: 'scheduled' })
      .eq('id', lessonId);

    if (error) throw error;
    await fetchLessons();
  }

  async function updateNotes(lessonId: string, notes: string) {
    const { error } = await supabase
      .from('lessons')
      .update({ notes })
      .eq('id', lessonId);

    if (error) throw error;
    await fetchLessons();
  }

  return { lessons, loading, error, refresh: fetchLessons, markComplete, markPending, updateNotes };
}
