import { toDateStr } from '../lib/dates';
import { useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap } from '../lib/queryCache';

export type AbsenceStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

/** A student's request not to attend one lesson (see request_absence RPC). */
export interface AbsenceRequest {
  id: string;
  lesson_id: string;
  student_id: string;
  status: AbsenceStatus;
  late_notice: boolean;
  charged: boolean | null;
  decision_note: string | null;
  created_at: string;
}

export interface StudentLesson {
  id: string;
  /** Which child this lesson row is for (a family login has several). */
  student_id: string;
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
export const STUDENT_LESSON_SELECT = `id, student_id, attended, absence_category, ${LESSON_EMBED}`;

const UPCOMING_LIMIT = 50;
const PAST_LIMIT = 20;
// Portal pages remount on every navigation; don't refetch on each one.
const STALE_MS = 60_000;

/**
 * Upcoming + recent lessons for the signed-in login — every child on it (a
 * family login has several students). Filters by `user_id` through an inner
 * join so these run in parallel with the student-record lookup instead of
 * waiting for the ids; RLS limits rows to the login's own children.
 */
export function useStudentLessons(userId: string | undefined, studentIds: string[] | undefined) {
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

  // All-time attendance totals per child: two HEAD counts each (no rows downloaded).
  const ids = studentIds ?? [];
  const stats = useQuery<Record<string, { attended: number; missed: number }>>(
    base && ids.length ? `${base}:stats:${ids.join(',')}` : null, async () => {
      const count = (studentId: string, attended: boolean) =>
        supabase
          .from('lesson_students')
          .select('id', { count: 'exact', head: true })
          .eq('student_id', studentId)
          .eq('attended', attended)
          .then((r) => { if (r.error) throw new Error(r.error.message); return r.count ?? 0; });
      const rows = await Promise.all(ids.map(async (id) => {
        const [attended, missed] = await Promise.all([count(id, true), count(id, false)]);
        return [id, { attended, missed }] as const;
      }));
      return Object.fromEntries(rows);
    }, { staleTime: STALE_MS });

  const { refresh: r1 } = up;
  const { refresh: r2 } = past;
  const { refresh: r3 } = stats;
  const refresh = useCallback(async () => { await Promise.all([r1(), r2(), r3()]); }, [r1, r2, r3]);

  return {
    upcoming: up.data ?? [],
    past: past.data ?? [],
    /** Attendance totals keyed by student id. */
    statsByStudent: stats.data ?? {},
    loading: up.loading,
    loadingPast: past.loading,
    error: up.error || past.error || stats.error,
    refresh,
  };
}

/** Key of one child's request for one lesson (two siblings can share a lesson). */
export function absenceKey(lessonId: string, studentId: string): string {
  return `${lessonId}:${studentId}`;
}

/**
 * The login's absence requests, latest per lesson per child (keyed by
 * absenceKey). A withdrawn latest request means "no request" for that lesson.
 * Failures are swallowed: lessons must still render if this can't load.
 */
export function useStudentAbsenceRequests(userId: string | undefined) {
  const q = useQuery<Record<string, AbsenceRequest>>(userId ? `student-lessons:${userId}:absences` : null, async () => {
    const rows = unwrap(await supabase
      .from('absence_requests')
      .select('id, lesson_id, student_id, status, late_notice, charged, decision_note, created_at, student:students!inner(user_id)')
      .eq('student.user_id', userId!)
      .order('created_at', { ascending: false })
      .limit(200), []) as unknown as AbsenceRequest[];
    const byLesson: Record<string, AbsenceRequest> = {};
    for (const r of rows) {
      const k = absenceKey(r.lesson_id, r.student_id);
      if (!byLesson[k]) byLesson[k] = r;
    }
    for (const k of Object.keys(byLesson)) if (byLesson[k].status === 'withdrawn') delete byLesson[k];
    return byLesson;
  }, { staleTime: STALE_MS });

  const { refresh } = q;
  const requestAbsence = useCallback(async (lessonId: string, studentId: string, reason: string) => {
    const { data, error } = await supabase.rpc('request_absence', {
      p_lesson_id: lessonId, p_reason: reason, p_student_id: studentId,
    });
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

/** One calendar month of lessons (YYYY-MM) for the given children. */
export function useStudentLessonsMonth(studentIds: string[], ym: string) {
  const range = useMemo(() => {
    const [y, m] = ym.split('-').map(Number);
    return { from: `${ym}-01`, to: toDateStr(new Date(y, m, 0)) };
  }, [ym]);

  const idsKey = [...studentIds].sort().join(',');
  const q = useQuery<StudentLesson[]>(idsKey ? `student-lessons:${idsKey}:month:${ym}` : null, async () =>
    unwrap(await supabase
      .from('lesson_students')
      .select(STUDENT_LESSON_SELECT)
      .in('student_id', studentIds)
      .gte('lesson.date', range.from)
      .lte('lesson.date', range.to)
      .order('lesson(date)', { ascending: true })
      .order('lesson(start_time)', { ascending: true }), []) as unknown as StudentLesson[],
  { staleTime: STALE_MS });

  return { ...q, lessons: q.data ?? [] };
}
