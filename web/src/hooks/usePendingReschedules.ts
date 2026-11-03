import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, invalidateQueries } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import { parseDateStr, toDateStr } from '../lib/dates';
import { invalidateLessonViews } from './useLessons';
import type { PendingLesson, AutoReschedulePreviewItem, LessonType, LessonStatus } from '../types';

const PENDING_COLUMNS = `
  id, teacher_id, instrument_id, location_id, title, date, start_time, source_break_id,
  students:lesson_students(student_id, student:students(full_name)),
  teacher:profiles!lessons_teacher_id_fkey(full_name),
  instrument:instruments(name, icon),
  break:scheduled_breaks(title, end_date, student_ids)
`;

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

/** Bump a break's "rescheduled" counter (read-modify-write; coordinators only). */
async function addRescheduled(breakId: string, n: number) {
  const { data: brk, error } = await supabase
    .from('scheduled_breaks').select('total_rescheduled').eq('id', breakId).single();
  if (error) throw new Error(`Makeup created, but the break's progress couldn't be updated: ${error.message}`);
  const { error: upErr } = await supabase
    .from('scheduled_breaks').update({ total_rescheduled: brk.total_rescheduled + n }).eq('id', breakId);
  if (upErr) throw new Error(`Makeup created, but the break's progress couldn't be updated: ${upErr.message}`);
}

function afterReschedule() {
  invalidateLessonViews();
  invalidateQueries('breaks:');
}

export function usePendingReschedules() {
  const { data, loading, error, refresh } = useQuery<PendingLesson[]>('pending-reschedules', () =>
    fetchAll<PendingLesson>((from, to) =>
      supabase.from('lessons').select(PENDING_COLUMNS)
        .eq('pending_reschedule', true)
        .eq('status', 'cancelled')
        .order('source_break_id')
        .order('date')
        .order('id')
        .range(from, to)));
  const lessons = data ?? [];

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
        lesson.students.map(s => ({ lesson_id: makeup.id, student_id: s.student_id }))
      );
      if (lsErr) {
        await supabase.from('lessons').delete().eq('id', makeup.id); // don't leave an empty makeup behind
        throw lsErr;
      }
    }
    // pending_reschedule is cleared by the resolve_pending_on_makeup DB trigger
    // when the makeup's lesson_students rows are inserted above.

    try {
      if (lesson.source_break_id) await addRescheduled(lesson.source_break_id, 1);
    } finally {
      afterReschedule();
      await refresh();
    }
  }, [lessons, refresh]);

  const autoRescheduleBreak = useCallback(async (breakId: string): Promise<AutoReschedulePreviewItem[]> => {
    const breakLessons = lessons.filter(l => l.source_break_id === breakId);
    if (breakLessons.length === 0) return [];

    const breakEnd = parseDateStr(breakLessons[0].break.end_date);
    const breakEndStr = toDateStr(breakEnd);
    const windowEnd = toDateStr(addDays(breakEnd, 52 * 7));

    // Every affected teacher's booked slots after the break, in one query.
    const teacherIds = [...new Set(breakLessons.map(l => l.teacher_id))];
    const booked = await fetchAll<{ teacher_id: string; date: string; start_time: string }>((from, to) =>
      supabase.from('lessons')
        .select('teacher_id, date, start_time')
        .in('teacher_id', teacherIds)
        .gt('date', breakEndStr)
        .lte('date', windowEnd)
        .neq('status', 'cancelled')
        .order('id')
        .range(from, to));
    const teacherSlotsMap = new Map<string, Set<string>>(teacherIds.map(id => [id, new Set<string>()]));
    for (const l of booked) teacherSlotsMap.get(l.teacher_id)?.add(`${l.date}|${l.start_time}`);

    return breakLessons.map(lesson => {
      const targetDow = parseDateStr(lesson.date).getDay();
      const takenSlots = teacherSlotsMap.get(lesson.teacher_id) ?? new Set<string>();
      let candidate = nextDayOfWeek(breakEnd, targetDow);

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
      if (lsErr) {
        // One insert = one transaction, so nothing was linked: remove the empty makeups.
        await supabase.from('lessons').delete().in('id', (insertedLessons || []).map(l => l.id));
        throw lsErr;
      }
    }

    // pending_reschedule cleared by the resolve_pending_on_makeup DB trigger
    // on the lesson_students inserts above.

    try {
      await addRescheduled(toSchedule[0].original.source_break_id, toSchedule.length);
    } finally {
      afterReschedule();
      await refresh();
    }
  }, [refresh]);

  return { lessons, loading, error, refresh, reschedule, autoRescheduleBreak, confirmAutoReschedule };
}
