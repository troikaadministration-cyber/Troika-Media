import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ScheduledBreak } from '@troika/shared';

export function useBreaks() {
  const [breaks, setBreaks] = useState<ScheduledBreak[]>([]);
  const [pendingRescheduleCount, setPendingRescheduleCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchBreaks = useCallback(async () => {
    setLoading(true);
    const [breaksRes, countRes] = await Promise.all([
      supabase.from('scheduled_breaks').select('*').order('start_date', { ascending: false }),
      supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('pending_reschedule', true),
    ]);
    setBreaks((breaksRes.data as ScheduledBreak[]) || []);
    setPendingRescheduleCount(countRes.count || 0);
    setLoading(false);
  }, []);

  useEffect(() => { fetchBreaks(); }, [fetchBreaks]);

  async function createBreak(data: {
    title: string;
    start_date: string;
    end_date: string;
    student_ids: string[];
    created_by: string;
  }) {
    // Find all scheduled lessons in the range for selected students
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, students:lesson_students(student_id)')
      .gte('date', data.start_date)
      .lte('date', data.end_date)
      .eq('status', 'scheduled');

    // Filter lessons that involve any of the selected students
    const affectedLessons = (lessons || []).filter((l: any) => {
      if (data.student_ids.length === 0) return true; // "All students" mode
      return l.students?.some((s: any) => data.student_ids.includes(s.student_id));
    });

    // Create break record
    const { data: breakRecord, error: breakErr } = await supabase
      .from('scheduled_breaks')
      .insert({
        created_by: data.created_by,
        title: data.title,
        start_date: data.start_date,
        end_date: data.end_date,
        student_ids: data.student_ids,
        total_cancelled: affectedLessons.length,
        total_rescheduled: 0,
      })
      .select()
      .single();
    if (breakErr) throw breakErr;

    // Cancel all affected lessons
    if (affectedLessons.length > 0) {
      const ids = affectedLessons.map((l: any) => l.id);
      await supabase
        .from('lessons')
        .update({
          status: 'cancelled',
          pending_reschedule: true,
          source_break_id: breakRecord.id,
          cancelled_by_role: 'coordinator',
          cancelled_by_user_id: data.created_by,
        })
        .in('id', ids);
    }

    await fetchBreaks();
    return { cancelled: affectedLessons.length };
  }

  async function previewBreak(startDate: string, endDate: string, studentIds: string[]) {
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, students:lesson_students(student_id)')
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('status', 'scheduled');

    const affected = (lessons || []).filter((l: any) => {
      if (studentIds.length === 0) return true;
      return l.students?.some((s: any) => studentIds.includes(s.student_id));
    });
    return affected.length;
  }

  async function linkReschedule(pendingLessonId: string) {
    // Get the break ID from the pending lesson
    const { data: lesson } = await supabase
      .from('lessons')
      .select('source_break_id')
      .eq('id', pendingLessonId)
      .single();

    // Mark as rescheduled
    await supabase
      .from('lessons')
      .update({ pending_reschedule: false })
      .eq('id', pendingLessonId);

    // Increment break's rescheduled count
    if (lesson?.source_break_id) {
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

    await fetchBreaks();
  }

  return { breaks, pendingRescheduleCount, loading, fetchBreaks, createBreak, previewBreak, linkReschedule };
}
