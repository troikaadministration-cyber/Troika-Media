import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface StudentLesson {
  id: string;
  lesson_id: string;
  attended: boolean | null;
  absence_category: string | null;
  lesson: {
    id: string;
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
  const [totalCompleted, setTotalCompleted] = useState(0);

  const fetchLessons = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);

    const today = new Date().toISOString().split('T')[0];

    // Upcoming
    const { data: upcomingData } = await supabase
      .from('lesson_students')
      .select(`
        id, lesson_id, attended, absence_category,
        lesson:lessons(
          id, date, start_time, end_time, title, status, lesson_type, notes,
          teacher:profiles!lessons_teacher_id_fkey(full_name),
          location:locations(*),
          instrument:instruments(*)
        )
      `)
      .eq('student_id', studentId)
      .gte('lesson.date', today)
      .order('lesson(date)', { ascending: true });

    // Past
    const { data: pastData } = await supabase
      .from('lesson_students')
      .select(`
        id, lesson_id, attended, absence_category,
        lesson:lessons(
          id, date, start_time, end_time, title, status, lesson_type, notes,
          teacher:profiles!lessons_teacher_id_fkey(full_name),
          location:locations(*),
          instrument:instruments(*)
        )
      `)
      .eq('student_id', studentId)
      .lt('lesson.date', today)
      .order('lesson(date)', { ascending: false })
      .limit(20);

    if (upcomingData) setUpcoming(upcomingData.filter((d: any) => d.lesson) as any);
    if (pastData) {
      const filtered = pastData.filter((d: any) => d.lesson) as any;
      setPast(filtered);
      setTotalCompleted(filtered.filter((l: any) => l.attended === true).length);
    }

    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  return { upcoming, past, loading, totalCompleted, refresh: fetchLessons };
}
