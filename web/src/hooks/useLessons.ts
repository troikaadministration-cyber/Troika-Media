import { supabase } from '../lib/supabase';
import { useQuery, unwrap, invalidateQueries } from '../lib/queryCache';
import type { LessonWithDetails, LessonType } from '../types';

const LESSON_DETAILS = `
  *,
  teacher:profiles!lessons_teacher_id_fkey(id, full_name, email),
  location:locations(*),
  instrument:instruments(*),
  students:lesson_students(*, student:students(*))
`;

/** Invalidate every cached lesson view (schedule, teacher views, dashboard…). */
export function invalidateLessonViews() {
  invalidateQueries('lessons:');
  invalidateQueries('teacher-lessons:');
  invalidateQueries('student-lessons:');
  invalidateQueries('dashboard:');
  invalidateQueries('reports:');
}

/**
 * Lessons for one day (optionally filtered by teacher/instrument).
 * Pass `null` to disable — a date is required so we never download the whole
 * lessons history.
 */
export function useLessons(filters: {
  date: string;
  teacherId?: string;
  instrumentId?: string;
} | null) {
  const key = filters
    ? `lessons:day:${filters.date}:${filters.teacherId ?? ''}:${filters.instrumentId ?? ''}`
    : null;

  const { data, loading, error, refresh } = useQuery<LessonWithDetails[]>(key, async () => {
    let query = supabase
      .from('lessons')
      .select(LESSON_DETAILS)
      .eq('date', filters!.date)
      .order('start_time', { ascending: true });
    if (filters?.teacherId) query = query.eq('teacher_id', filters.teacherId);
    if (filters?.instrumentId) query = query.eq('instrument_id', filters.instrumentId);
    return unwrap(await query, []) as LessonWithDetails[];
  });

  async function afterChange() {
    invalidateLessonViews();
    await refresh();
  }

  async function createLesson(lesson: {
    teacher_id: string;
    location_id?: string;
    instrument_id?: string;
    lesson_type: LessonType;
    date: string;
    start_time: string;
    end_time?: string;
    title: string;
    student_ids: string[];
  }) {
    const { student_ids, ...rest } = lesson;
    const lessonData = {
      ...rest,
      teacher_id: rest.teacher_id || null,
      instrument_id: rest.instrument_id || null,
      location_id: rest.location_id || null,
      end_time: rest.end_time || null,
    };
    const { data: created, error: err } = await supabase
      .from('lessons')
      .insert(lessonData)
      .select()
      .single();
    if (err) throw err;

    if (student_ids.length > 0 && created) {
      const { error: lsErr } = await supabase.from('lesson_students').insert(
        student_ids.map((sid) => ({ lesson_id: created.id, student_id: sid }))
      );
      if (lsErr) {
        // Don't leave a lesson with no students behind.
        await supabase.from('lessons').delete().eq('id', created.id);
        throw lsErr;
      }
    }
    await afterChange();
    return created;
  }

  async function updateLesson(id: string, updates: Partial<LessonWithDetails>) {
    const { error: err } = await supabase.from('lessons').update(updates).eq('id', id);
    if (err) throw err;
    await afterChange();
  }

  async function cancelLesson(id: string, studentId?: string, reason?: string, cancelledByRole?: string, cancelledByUserId?: string) {
    const updates: Record<string, unknown> = { status: 'cancelled' };
    if (studentId) updates.cancelled_by_student_id = studentId;
    if (reason) updates.cancel_reason = reason;
    if (cancelledByRole) updates.cancelled_by_role = cancelledByRole;
    if (cancelledByUserId) updates.cancelled_by_user_id = cancelledByUserId;

    const { error: err } = await supabase.from('lessons').update(updates).eq('id', id);
    if (err) throw err;

    // Return cancelled lesson with full details for the makeup match panel
    const { data: lessonRow } = await supabase
      .from('lessons')
      .select(LESSON_DETAILS)
      .eq('id', id)
      .single();

    // Notify enrolled students (in-app) that their lesson was cancelled.
    try {
      const students = (lessonRow as any)?.students || [];
      const userIds: string[] = students
        .map((ls: any) => ls.student?.user_id)
        .filter((uid: string | null): uid is string => !!uid);
      if (userIds.length && lessonRow) {
        const dateLabel = new Date((lessonRow as any).date + 'T00:00:00')
          .toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric' });
        const time = (lessonRow as any).start_time?.slice(0, 5) || '';
        await supabase.from('notifications').insert(
          userIds.map((uid) => ({
            user_id: uid,
            type: 'lesson_cancelled',
            title: 'Lesson cancelled',
            body: `Your lesson on ${dateLabel}${time ? ` at ${time}` : ''} has been cancelled${reason ? `: ${reason}` : ''}.`,
            read: false,
          }))
        );
      }
    } catch {
      // non-blocking — the lesson is already cancelled
    }

    await afterChange();
    return lessonRow as LessonWithDetails;
  }

  async function deleteLesson(id: string) {
    const { error: err } = await supabase.from('lessons').delete().eq('id', id);
    if (err) throw err;
    await afterChange();
  }

  return { lessons: data ?? [], loading, error, createLesson, updateLesson, cancelLesson, deleteLesson, refresh };
}
