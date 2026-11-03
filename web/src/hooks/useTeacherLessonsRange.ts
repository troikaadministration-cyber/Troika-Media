import { useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap } from '../lib/queryCache';
import type { LessonWithDetails } from '../types';

export function useTeacherLessonsRange(
  teacherId: string | undefined,
  startDate: string,
  endDate: string,
) {
  const key = teacherId ? `teacher-lessons:range:${teacherId}:${startDate}:${endDate}` : null;

  const { data, loading, error, refresh } = useQuery<LessonWithDetails[]>(key, async () => {
    const res = await supabase
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
      .eq('teacher_id', teacherId!)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });
    return unwrap(res, []) as LessonWithDetails[];
  });

  const lessons = useMemo(() => data ?? [], [data]);

  // Group lessons by date string for fast calendar lookup
  const byDate = useMemo(() => {
    const map: Record<string, LessonWithDetails[]> = {};
    for (const lesson of lessons) {
      (map[lesson.date] ||= []).push(lesson);
    }
    return map;
  }, [lessons]);

  return { lessons, byDate, loading: !!teacherId && loading, error, refresh };
}
