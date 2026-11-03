import { toDateStr } from '../lib/dates';
import { useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap } from '../lib/queryCache';

export type AbsenceStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

/** A student's request not to attend one lesson (see request_absence RPC). */
export interface AbsenceRequest {
  id: string;
  lesson_id: string;
  status: AbsenceStatus;
  late_notice: boolean;
  charged: boolean | null;
  decision_note: string | null;
  created_at: string;
}

export interface StudentLesson {
  id: string;
  attended: boolean | null;
  absence_category: string | null;
  lesson: {
    id: string;
    date: string;
    start_time: string;
    title: string;
    status: string;
    lesson_type: string;
    teacher: { full_name: string } | null;
    location: { name: string } | null;
    instrument: { name: string; icon: string | null } | null;
  };
}

// `!inner` is required: a filter on a plain embed only nulls the embed and
// leaves every parent row in the result (and breaks ordering/limit).
const LESSON_EMBED = `lesson:lessons!inner(id, date, start_time, title, status, lesson_type,
  teacher:profiles!lessons_teacher_id_fkey(full_name),
  location:locations(name), instrument:instruments(name, icon))`;
export const STUDENT_LESSON_SELECT = `id, attended, absence_category, ${LESSON_EMBED}`;

const UPCOMING_LIMIT = 50;
const PAST_LIMIT = 20;
// Portal pages remount on every navigation; don't refetch on each one.
const STALE_MS = 60_000;

/**
 * Upcoming + recent lessons for the signed-in student. Filters by the
 * student's `user_id` through an inner join so these run in parallel with the
 * student-record lookup instead of waiting for its id.
 */
export function useStudentLessons(userId: string | undefined) {
  const today = toDateStr(new Date());
  const base = userId ? `student-lessons:${userId}` : null;
  const byUser = () =>
    supabase
      .from('lesson_students')
      .select(`${STUDENT_LESSON_SELECT}, student:students!inner(user_id)`)
      .eq('student.user_id', userId!);

  const up = useQuery<StudentLesson[]>(base && `${base}:upcoming:${today}`, async () =>
    unwrap(await byUser()
      .gte('lesson.date', today)
      .order('lesson(date)', { ascending: true })
      .order('lesson(start_time)', { ascending: true })
      .limit(UPCOMING_LIMIT), []) as unknown as StudentLesson[], { staleTime: STALE_MS });

  const past = useQuery<StudentLesson[]>(base && `${base}:past:${today}`, async () =>
    unwrap(await byUser()
      .lt('lesson.date', today)
      .order('lesson(date)', { ascending: false })
      .order('lesson(start_time)', { ascending: false })
      .limit(PAST_LIMIT), []) as unknown as StudentLesson[], { staleTime: STALE_MS });

  // All-time attendance totals as two HEAD counts (no rows downloaded).
  const stats = useQuery<{ attended: number; missed: number }>(base && `${base}:stats`, async () => {
    const count = (attended: boolean) =>
      supabase
        .from('lesson_students')
        .select('id, student:students!inner(user_id)', { count: 'exact', head: true })
        .eq('student.user_id', userId!)
        .eq('attended', attended);
    const [a, m] = await Promise.all([count(true), count(false)]);
    if (a.error) throw new Error(a.error.message);
    if (m.error) throw new Error(m.error.message);
    return { attended: a.count ?? 0, missed: m.count ?? 0 };
  }, { staleTime: STALE_MS });

  const { refresh: r1 } = up;
  const { refresh: r2 } = past;
  const { refresh: r3 } = stats;
  const refresh = useCallback(async () => { await Promise.all([r1(), r2(), r3()]); }, [r1, r2, r3]);

  return {
    upcoming: up.data ?? [],
    past: past.data ?? [],
    totalCompleted: stats.data?.attended ?? 0,
    totalMissed: stats.data?.missed ?? 0,
    loading: up.loading,
    loadingPast: past.loading,
    error: up.error || past.error || stats.error,
    refresh,
  };
}

/**
 * The signed-in student's absence requests, latest per lesson (keyed by
 * lesson id). A withdrawn latest request means "no request" for that lesson.
 * Failures are swallowed: lessons must still render if this can't load.
 */
export function useStudentAbsenceRequests(userId: string | undefined) {
  const q = useQuery<Record<string, AbsenceRequest>>(userId ? `student-lessons:${userId}:absences` : null, async () => {
    const rows = unwrap(await supabase
      .from('absence_requests')
      .select('id, lesson_id, status, late_notice, charged, decision_note, created_at, student:students!inner(user_id)')
      .eq('student.user_id', userId!)
      .order('created_at', { ascending: false })
      .limit(200), []) as unknown as AbsenceRequest[];
    const byLesson: Record<string, AbsenceRequest> = {};
    for (const r of rows) if (!byLesson[r.lesson_id]) byLesson[r.lesson_id] = r;
    for (const k of Object.keys(byLesson)) if (byLesson[k].status === 'withdrawn') delete byLesson[k];
    return byLesson;
  }, { staleTime: STALE_MS });

  const { refresh } = q;
  const requestAbsence = useCallback(async (lessonId: string, reason: string) => {
    const { data, error } = await supabase.rpc('request_absence', { p_lesson_id: lessonId, p_reason: reason });
    if (error) throw new Error(error.message);
    await refresh();
    return data as { id: string; late_notice: boolean };
  }, [refresh]);
  const withdrawAbsence = useCallback(async (requestId: string) => {
    const { error } = await supabase.rpc('withdraw_absence_request', { p_request_id: requestId });
    if (error) throw new Error(error.message);
    await refresh();
  }, [refresh]);

  return { absences: q.data ?? {}, requestAbsence, withdrawAbsence, refresh };
}

/** One calendar month of a student's lessons (YYYY-MM). */
export function useStudentLessonsMonth(studentId: string | undefined, ym: string) {
  const range = useMemo(() => {
    const [y, m] = ym.split('-').map(Number);
    return { from: `${ym}-01`, to: toDateStr(new Date(y, m, 0)) };
  }, [ym]);

  const q = useQuery<StudentLesson[]>(studentId ? `student-lessons:${studentId}:month:${ym}` : null, async () =>
    unwrap(await supabase
      .from('lesson_students')
      .select(STUDENT_LESSON_SELECT)
      .eq('student_id', studentId!)
      .gte('lesson.date', range.from)
      .lte('lesson.date', range.to)
      .order('lesson(date)', { ascending: true })
      .order('lesson(start_time)', { ascending: true }), []) as unknown as StudentLesson[],
  { staleTime: STALE_MS });

  return { ...q, lessons: q.data ?? [] };
}
