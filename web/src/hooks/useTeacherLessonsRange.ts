import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { LessonWithDetails } from '../types';

export function useTeacherLessonsRange(
  teacherId: string | undefined,
  startDate: string,
  endDate: string,
) {
  const [lessons, setLessons] = useState<LessonWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLessons = useCallback(async () => {
    if (!teacherId) { setLoading(false); return; }
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
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true });

      if (err) throw err;
      setLessons((data as LessonWithDetails[]) || []);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to fetch lessons');
    } finally {
      setLoading(false);
    }
  }, [teacherId, startDate, endDate]);

  useEffect(() => { fetchLessons(); }, [fetchLessons]);

  // Group lessons by date string for fast calendar lookup
  const byDate: Record<string, LessonWithDetails[]> = {};
  for (const lesson of lessons) {
    if (!byDate[lesson.date]) byDate[lesson.date] = [];
    byDate[lesson.date].push(lesson);
  }

  return { lessons, byDate, loading, error, refresh: fetchLessons };
}
