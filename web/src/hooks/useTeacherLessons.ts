import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap } from '../lib/queryCache';
import { invalidateLessonViews } from './useLessons';
import type { LessonWithDetails } from '../types';

export function useTeacherLessons(teacherId: string | undefined, date: string) {
  const key = teacherId ? `teacher-lessons:day:${teacherId}:${date}` : null;

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
      .eq('date', date)
      .neq('status', 'cancelled')
      .order('start_time', { ascending: true });
    return unwrap(res, []) as LessonWithDetails[];
  });

  // Live updates when a coordinator changes this teacher's lessons.
  useEffect(() => {
    if (!teacherId) return;
    let debounce: ReturnType<typeof setTimeout>;
    const channel = supabase
      .channel(`teacher-lessons-${teacherId}-${date}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lessons', filter: `teacher_id=eq.${teacherId}` },
        () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => { void refresh(); }, 400);
        }
      )
      .subscribe();

    return () => {
      clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [teacherId, date, refresh]);

  async function afterChange() {
    invalidateLessonViews();
    await refresh();
  }

  async function setStatus(lessonId: string, status: 'completed' | 'scheduled') {
    const { error: err } = await supabase.from('lessons').update({ status }).eq('id', lessonId);
    if (err) throw err;
    await afterChange();
  }

  const markComplete = (lessonId: string) => setStatus(lessonId, 'completed');
  const markPending = (lessonId: string) => setStatus(lessonId, 'scheduled');

  async function updateNotes(lessonId: string, notes: string) {
    const { error: err } = await supabase.from('lessons').update({ notes }).eq('id', lessonId);
    if (err) throw err;
    await refresh();
  }

  async function markAttendance(lessonStudentId: string, lessonId: string, attended: boolean | null) {
    const { error: err } = await supabase.from('lesson_students').update({ attended }).eq('id', lessonStudentId);
    if (err) throw err;

    // Auto-complete lesson when all students are marked
    if (attended !== null) {
      const { data: allStudents, error: readErr } = await supabase
        .from('lesson_students')
        .select('attended')
        .eq('lesson_id', lessonId);
      if (readErr) throw readErr;

      const allMarked = allStudents && allStudents.length > 0 && allStudents.every(s => s.attended !== null);
      if (allMarked) {
        const { error: upErr } = await supabase.from('lessons').update({ status: 'completed' }).eq('id', lessonId);
        if (upErr) throw upErr;
      }
    }

    await afterChange();
  }

  async function cancelLesson(lessonId: string, userId: string, reason?: string) {
    const updates: Record<string, unknown> = {
      status: 'cancelled',
      cancelled_by_role: 'teacher',
      cancelled_by_user_id: userId,
    };
    if (reason) updates.cancel_reason = reason;
    const { error: err } = await supabase.from('lessons').update(updates).eq('id', lessonId);
    if (err) throw err;
    await afterChange();
  }

  return { lessons: data ?? [], loading, error, refresh, markComplete, markPending, updateNotes, cancelLesson, markAttendance };
}
