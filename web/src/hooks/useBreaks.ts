import { supabase } from '../lib/supabase';
import { useQuery, unwrap, invalidateQueries } from '../lib/queryCache';
import { invalidateLessonViews } from './useLessons';
import type { ScheduledBreak } from '../types';

const BREAK_COLUMNS = 'id, created_by, title, start_date, end_date, student_ids, total_cancelled, total_rescheduled, created_at';

export function useBreaks() {
  const { data, loading, error, refresh } = useQuery('breaks:list', async () => {
    const [breaksRes, countRes] = await Promise.all([
      supabase.from('scheduled_breaks').select(BREAK_COLUMNS).order('start_date', { ascending: false }),
      supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('pending_reschedule', true),
    ]);
    if (countRes.error) throw new Error(countRes.error.message);
    return {
      breaks: unwrap(breaksRes, []) as ScheduledBreak[],
      pendingRescheduleCount: countRes.count ?? 0,
    };
  });

  // One database transaction (create_break): cancels lessons where everyone is
  // on break; in group classes only the students on break are split off, so the
  // class goes ahead for the others. Empty student list = whole school.
  async function createBreak(input: {
    title: string;
    start_date: string;
    end_date: string;
    student_ids: string[];
    created_by: string;
  }) {
    const { data: result, error: err } = await supabase.rpc('create_break', {
      p_title: input.title,
      p_start_date: input.start_date,
      p_end_date: input.end_date,
      p_student_ids: input.student_ids,
    });
    if (err) throw err;
    invalidateLessonViews();
    invalidateQueries('pending-reschedules');
    await refresh();
    const r = result as { cancelled: number; split_group_lessons: number };
    return { cancelled: r.cancelled, split: r.split_group_lessons };
  }

  async function previewBreak(startDate: string, endDate: string, studentIds: string[]) {
    const { data: result, error: err } = await supabase.rpc('create_break', {
      p_title: 'preview', p_start_date: startDate, p_end_date: endDate, p_student_ids: studentIds, p_dry_run: true,
    });
    if (err) throw err;
    return (result as { cancelled: number }).cancelled;
  }

  return {
    breaks: data?.breaks ?? [],
    pendingRescheduleCount: data?.pendingRescheduleCount ?? 0,
    loading,
    error,
    fetchBreaks: refresh,
    createBreak,
    previewBreak,
  };
}
