import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface StudentLesson {
  id: string;
  lesson_id: string;
  attended: boolean | null;
  absence_category: string | null;
  lesson: {
    id: string;
    teacher_id: string;
    date: string;
    start_time: string;
    end_time: string | null;
    title: string;
    status: string;
    lesson_type: string;
    notes: string | null;
    teacher: { full_name: string } | null;
    location: { name: string; address: string } | null;
    instrument: { name: string; icon: string | null } | null;
  };
}

export function useStudentLessons(studentId: string | undefined) {
  const [upcoming, setUpcoming] = useState<StudentLesson[]>([]);
  const [past, setPast] = useState<StudentLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCompleted, setTotalCompleted] = useState(0);

  const fetchLessons = useCallback(async () => {
    if (!studentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const today = new Date().toISOString().split('T')[0];

      const [upcomingRes, pastRes] = await Promise.all([
        supabase
          .from('lesson_students')
          .select(`id, lesson_id, attended, absence_category,
            lesson:lessons(id, teacher_id, date, start_time, end_time, title, status, lesson_type, notes,
              teacher:profiles!lessons_teacher_id_fkey(full_name),
              location:locations(*), instrument:instruments(*))`)
          .eq('student_id', studentId)
          .gte('lesson.date', today)
          .order('lesson(date)', { ascending: true }),
        supabase
          .from('lesson_students')
          .select(`id, lesson_id, attended, absence_category,
            lesson:lessons(id, teacher_id, date, start_time, end_time, title, status, lesson_type, notes,
              teacher:profiles!lessons_teacher_id_fkey(full_name),
              location:locations(*), instrument:instruments(*))`)
          .eq('student_id', studentId)
          .lt('lesson.date', today)
          .order('lesson(date)', { ascending: false })
          .limit(20),
      ]);

      if (upcomingRes.error) throw upcomingRes.error;
      if (pastRes.error) throw pastRes.error;

      if (upcomingRes.data) setUpcoming(upcomingRes.data.filter((d: any) => d.lesson) as any);
      if (pastRes.data) {
        const filtered = pastRes.data.filter((d: any) => d.lesson) as any;
        setPast(filtered);
        setTotalCompleted(filtered.filter((l: any) => l.attended === true).length);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch lessons');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { fetchLessons(); }, [fetchLessons]);

  async function cancelLesson(
    lessonId: string,
    userId: string,
    options: {
      teacherId: string;
      date: string;
      startTime: string;
      studentName: string;
      reason?: string;
    }
  ) {
    const updates: Record<string, unknown> = {
      status: 'cancelled',
      cancelled_by_role: 'student',
      cancelled_by_user_id: userId,
    };
    if (options.reason) updates.cancel_reason = options.reason;

    const { error } = await supabase.from('lessons').update(updates).eq('id', lessonId);
    if (error) throw error;

    if (options.teacherId) {
      const dateLabel = new Date(options.date + 'T00:00:00').toLocaleDateString('en-IN', {
        weekday: 'long', month: 'short', day: 'numeric',
      });
      try {
        await supabase.from('notifications').insert({
          user_id: options.teacherId,
          type: 'lesson_cancelled',
          title: 'Lesson cancelled by student',
          body: `${options.studentName} cancelled their lesson on ${dateLabel} at ${options.startTime.slice(0, 5)}`,
          read: false,
        });
      } catch {
        // fire-and-forget — lesson is already cancelled
      }
    }

    await fetchLessons();
  }

  return { upcoming, past, loading, error, totalCompleted, cancelLesson, refresh: fetchLessons };
}
