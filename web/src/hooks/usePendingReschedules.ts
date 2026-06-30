import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { PendingLesson, AutoReschedulePreviewItem, LessonType, LessonStatus } from '../types';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function nextDayOfWeek(from: Date, dow: number): Date {
  const d = addDays(from, 1);
  while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
  return d;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function usePendingReschedules() {
  const [lessons, setLessons] = useState<PendingLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLessons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('lessons')
        .select(`
          id, teacher_id, instrument_id, location_id, title, date, start_time, source_break_id,
          students:lesson_students(student_id, student:students(full_name)),
          teacher:profiles!lessons_teacher_id_fkey(full_name),
          instrument:instruments(name, icon),
          break:scheduled_breaks(title, end_date, student_ids)
        `)
        .eq('pending_reschedule', true)
        .eq('status', 'cancelled')
        .order('source_break_id')
        .order('date');
      if (err) throw err;
      setLessons((data as unknown as PendingLesson[]) || []);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch pending reschedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLessons(); }, [fetchLessons]);

  const reschedule = useCallback(async (lessonId: string, newDate: string, newTime: string): Promise<void> => {
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) throw new Error('Lesson not found');

    const { data: makeup, error: insertErr } = await supabase
      .from('lessons')
      .insert({
        teacher_id: lesson.teacher_id,
        instrument_id: lesson.instrument_id,
        location_id: lesson.location_id,
        title: lesson.title,
        lesson_type: 'makeup' as LessonType,
        date: newDate,
        start_time: newTime,
        status: 'scheduled' as LessonStatus,
        is_charged: false,
      })
      .select('id')
      .single();
    if (insertErr) throw insertErr;

    if (lesson.students.length > 0) {
      const { error: lsErr } = await supabase.from('lesson_students').insert(
        lesson.students.map(s => ({ lesson_id: makeup!.id, student_id: s.student_id }))
      );
      if (lsErr) throw lsErr;
    }
    // pending_reschedule is cleared by the resolve_pending_on_makeup DB trigger
    // when the makeup's lesson_students rows are inserted above.

    if (lesson.source_break_id) {
      const { data: brk } = await supabase
        .from('scheduled_breaks')
        .select('total_rescheduled')
        .eq('id', lesson.source_break_id)
        .single();
      if (brk) {
        await supabase
          .from('scheduled_breaks')
          .update({ total_rescheduled: brk.total_rescheduled + 1 })
          .eq('id', lesson.source_break_id);
      }
    }

    await fetchLessons();
  }, [lessons, fetchLessons]);

  const autoRescheduleBreak = useCallback(async (breakId: string): Promise<AutoReschedulePreviewItem[]> => {
    const breakLessons = lessons.filter(l => l.source_break_id === breakId);
    if (breakLessons.length === 0) return [];

    const breakEndDate = breakLessons[0].break.end_date;
    const windowEnd = toDateStr(addDays(new Date(breakEndDate + 'T00:00'), 52 * 7));

    const teacherIds = [...new Set(breakLessons.map(l => l.teacher_id))];
    const teacherSlotsMap = new Map<string, Set<string>>();

    for (const tid of teacherIds) {
      const { data } = await supabase
        .from('lessons')
        .select('date, start_time')
        .eq('teacher_id', tid)
        .gt('date', breakEndDate)
        .lte('date', windowEnd)
        .neq('status', 'cancelled');
      const set = new Set<string>((data || []).map((l: any) => `${l.date}|${l.start_time}`));
      teacherSlotsMap.set(tid, set);
    }

    return breakLessons.map(lesson => {
      const targetDow = new Date(lesson.date + 'T00:00').getDay();
      const takenSlots = teacherSlotsMap.get(lesson.teacher_id) ?? new Set<string>();
      let candidate = nextDayOfWeek(new Date(breakEndDate + 'T00:00'), targetDow);

      for (let i = 0; i < 52; i++) {
        const dateStr = toDateStr(candidate);
        const key = `${dateStr}|${lesson.start_time}`;
        if (!takenSlots.has(key)) {
          takenSlots.add(key);
          return { original: lesson, newDate: dateStr, newTime: lesson.start_time, found: true };
        }
        candidate = addDays(candidate, 7);
      }

      return { original: lesson, newDate: '', newTime: '', found: false };
    });
  }, [lessons]);

  const confirmAutoReschedule = useCallback(async (preview: AutoReschedulePreviewItem[]): Promise<void> => {
    const toSchedule = preview.filter(p => p.found);
    if (toSchedule.length === 0) return;

    const breakIds = new Set(toSchedule.map(p => p.original.source_break_id));
    if (breakIds.size > 1) throw new Error('confirmAutoReschedule: all items must belong to the same break');

    const { data: insertedLessons, error: insertErr } = await supabase
      .from('lessons')
      .insert(toSchedule.map(p => ({
        teacher_id: p.original.teacher_id,
        instrument_id: p.original.instrument_id,
        location_id: p.original.location_id,
        title: p.original.title,
        lesson_type: 'makeup' as LessonType,
        date: p.newDate,
        start_time: p.newTime,
        status: 'scheduled' as LessonStatus,
        is_charged: false,
      })))
      .select('id');
    if (insertErr) throw insertErr;

    const lessonStudents = (insertedLessons || []).flatMap((ml, i) =>
      toSchedule[i].original.students.map(s => ({ lesson_id: ml.id, student_id: s.student_id }))
    );
    if (lessonStudents.length > 0) {
      const { error: lsErr } = await supabase.from('lesson_students').insert(lessonStudents);
      if (lsErr) throw lsErr;
    }

    // pending_reschedule cleared by the resolve_pending_on_makeup DB trigger
    // on the lesson_students inserts above.

    const breakId = toSchedule[0].original.source_break_id;
    const { data: brk } = await supabase
      .from('scheduled_breaks')
      .select('total_rescheduled')
      .eq('id', breakId)
      .single();
    if (brk) {
      await supabase
        .from('scheduled_breaks')
        .update({ total_rescheduled: brk.total_rescheduled + toSchedule.length })
        .eq('id', breakId);
    }

    await fetchLessons();
  }, [fetchLessons]);

  return { lessons, loading, error, refresh: fetchLessons, reschedule, autoRescheduleBreak, confirmAutoReschedule };
}
