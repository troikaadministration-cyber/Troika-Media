import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap, invalidateQueries } from '../lib/queryCache';
import { invalidateLessonViews } from './useLessons';

export interface CoordAbsenceRequest {
  id: string;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  reason: string;
  late_notice: boolean;
  charged: boolean | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  student: { id: string; full_name: string } | null;
  lesson: {
    id: string;
    date: string;
    start_time: string;
    end_time: string | null;
    status: string;
    title: string;
    teacher: { full_name: string } | null;
    students: { count: number }[];
  } | null;
}

const COLUMNS = `id, status, reason, late_notice, charged, decision_note, created_at, decided_at,
  student:students(id, full_name),
  lesson:lessons(id, date, start_time, end_time, status, title,
    teacher:profiles!lessons_teacher_id_fkey(full_name),
    students:lesson_students(count))`;

const RECENT_LIMIT = 15;

/** Coordinator: open absence requests (oldest first) + the most recently closed ones. */
export function useAbsenceRequests() {
  const q = useQuery<{ pending: CoordAbsenceRequest[]; recent: CoordAbsenceRequest[] }>('absence-requests:dashboard', async () => {
    const [pending, recent] = await Promise.all([
      supabase.from('absence_requests').select(COLUMNS)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(200),
      supabase.from('absence_requests').select(COLUMNS)
        .neq('status', 'pending')
        .order('decided_at', { ascending: false, nullsFirst: false })
        .limit(RECENT_LIMIT),
    ]);
    return {
      pending: unwrap(pending, []) as unknown as CoordAbsenceRequest[],
      recent: unwrap(recent, []) as unknown as CoordAbsenceRequest[],
    };
  });

  const decide = useCallback(async (requestId: string, approve: boolean, charged: boolean | null, note: string | null) => {
    const { data, error } = await supabase.rpc('decide_absence_request', {
      p_request_id: requestId,
      p_approve: approve,
      p_charged: charged,
      p_note: note,
    });
    if (error) throw new Error(error.message);
    await Promise.all([
      invalidateQueries('absence-requests:'),
      invalidateQueries('pending-reschedules'),
      invalidateLessonViews(),
    ]);
    return data as { status: string; charged?: boolean; lesson_cancelled?: boolean };
  }, []);

  return {
    pending: q.data?.pending ?? [],
    recent: q.data?.recent ?? [],
    loading: q.loading,
    error: q.error,
    refresh: q.refresh,
    decide,
  };
}
