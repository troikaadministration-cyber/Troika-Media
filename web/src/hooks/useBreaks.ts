import { supabase } from '../lib/supabase';
import { useQuery, unwrap, invalidateQueries } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import { invalidateLessonViews } from './useLessons';
import type { ScheduledBreak } from '../types';

const BREAK_COLUMNS = 'id, created_by, title, start_date, end_date, student_ids, total_cancelled, total_rescheduled, created_at';
// Keep id lists short enough for the request URL.
const ID_CHUNK = 150;

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Scheduled lessons a break would cancel. Used by BOTH the preview and the
 * create, so the number previewed is exactly what gets cancelled.
 * `studentIds` empty = every student (school-wide break).
 */
async function findAffectedLessonIds(startDate: string, endDate: string, studentIds: string[]): Promise<string[]> {
  if (studentIds.length === 0) {
    const rows = await fetchAll<{ id: string }>((from, to) =>
      supabase.from('lessons').select('id')
        .eq('status', 'scheduled').gte('date', startDate).lte('date', endDate)
        .order('id').range(from, to));
    return rows.map(r => r.id);
  }
  // Lessons with at least one of the selected students (filtered server-side).
  const batches = await Promise.all(chunks(studentIds, ID_CHUNK).map(ids =>
    fetchAll<{ id: string }>((from, to) =>
      supabase.from('lessons').select('id, lesson_students!inner(student_id)')
        .in('lesson_students.student_id', ids)
        .eq('status', 'scheduled').gte('date', startDate).lte('date', endDate)
        .order('id').range(from, to))));
  return [...new Set(batches.flat().map(r => r.id))];
}

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

  async function createBreak(input: {
    title: string;
    start_date: string;
    end_date: string;
    student_ids: string[];
    created_by: string;
  }) {
    const ids = await findAffectedLessonIds(input.start_date, input.end_date, input.student_ids);

    const { data: breakRecord, error: breakErr } = await supabase
      .from('scheduled_breaks')
      .insert({
        created_by: input.created_by,
        title: input.title,
        start_date: input.start_date,
        end_date: input.end_date,
        student_ids: input.student_ids,
        total_cancelled: ids.length,
        total_rescheduled: 0,
      })
      .select('id')
      .single();
    if (breakErr) throw breakErr;

    // Cancel the lessons (only ones still scheduled) and mark them for reschedule.
    const results = await Promise.all(chunks(ids, ID_CHUNK).map(batch =>
      supabase.from('lessons')
        .update({
          status: 'cancelled',
          pending_reschedule: true,
          source_break_id: breakRecord.id,
          cancelled_by_role: 'coordinator',
          cancelled_by_user_id: input.created_by,
        }, { count: 'exact' })
        .in('id', batch)
        .eq('status', 'scheduled')));
    const failed = results.find(r => r.error);
    if (failed?.error) {
      // Undo: restore any lessons already cancelled for this break, then drop the break.
      await supabase.from('lessons')
        .update({ status: 'scheduled', pending_reschedule: false, source_break_id: null, cancelled_by_role: null, cancelled_by_user_id: null })
        .eq('source_break_id', breakRecord.id);
      await supabase.from('scheduled_breaks').delete().eq('id', breakRecord.id);
      invalidateLessonViews();
      await refresh();
      throw new Error(`Couldn't cancel the lessons, so the break was not created: ${failed.error.message}`);
    }

    // A lesson may have changed between lookup and update; record what actually happened.
    const cancelled = results.reduce((n, r) => n + (r.count ?? 0), 0);
    if (cancelled !== ids.length) {
      await supabase.from('scheduled_breaks').update({ total_cancelled: cancelled }).eq('id', breakRecord.id);
    }

    invalidateLessonViews();
    invalidateQueries('pending-reschedules');
    await refresh();
    return { cancelled };
  }

  async function previewBreak(startDate: string, endDate: string, studentIds: string[]) {
    return (await findAffectedLessonIds(startDate, endDate, studentIds)).length;
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
