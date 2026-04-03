// Supabase Edge Function: Find makeup lesson matches

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || '';

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = allowedOrigin && origin === allowedOrigin ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) throw new Error('Unauthorized');

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { lesson_id } = await req.json();
    if (!lesson_id) throw new Error('lesson_id is required');

    // Fetch the cancelled lesson with all details
    const { data: lesson } = await supabase
      .from('lessons')
      .select(`
        *,
        location:locations(*),
        instrument:instruments(*),
        teacher:profiles!lessons_teacher_id_fkey(id, full_name),
        students:lesson_students(*, student:students(id, full_name))
      `)
      .eq('id', lesson_id)
      .single();

    if (!lesson) throw new Error('Lesson not found');

    // Get cancelled student names from the lesson's enrolled students
    const cancelledStudents = (lesson.students || [])
      .map((ls: any) => ls.student?.full_name)
      .filter(Boolean);

    const cancelledStudentIds = (lesson.students || [])
      .map((ls: any) => ls.student_id)
      .filter(Boolean);

    // Fetch teacher's other lessons on the same day
    const { data: teacherSchedule } = await supabase
      .from('lessons')
      .select('start_time, end_time, title, status')
      .eq('teacher_id', lesson.teacher_id)
      .eq('date', lesson.date)
      .neq('id', lesson_id)
      .order('start_time');

    // Fetch all active students (excluding those already in this lesson)
    let query = supabase
      .from('students')
      .select('*, location:locations(*), instrument:instruments(name)')
      .eq('is_active', true);

    const { data: allCandidates } = await query;

    // Filter out students already in this lesson
    const candidates = (allCandidates || []).filter(
      (s: any) => !cancelledStudentIds.includes(s.id)
    );

    // Conflict checking: find students who already have a lesson at the same date+time
    const { data: conflictingLessonStudents } = await supabase
      .from('lesson_students')
      .select('student_id, lesson:lessons!inner(date, start_time, end_time, status)')
      .neq('lesson.status', 'cancelled');

    const conflictingStudentIds = new Set<string>();
    for (const cls of conflictingLessonStudents || []) {
      const cl = cls.lesson as any;
      if (cl.date !== lesson.date) continue;
      // Check time overlap
      const candStart = cl.start_time;
      const candEnd = cl.end_time || cl.start_time;
      const lessonEnd = lesson.end_time || lesson.start_time;
      if (candStart < lessonEnd && candEnd > lesson.start_time) {
        conflictingStudentIds.add(cls.student_id);
      }
    }

    // Score candidates
    const scored = candidates
      .filter((s: any) => !conflictingStudentIds.has(s.id))
      .map((student: any) => {
        let score = 0;
        const sameLocation = student.location_id === lesson.location_id;
        const sameZone =
          !sameLocation &&
          student.location?.zone &&
          lesson.location?.zone &&
          student.location.zone === lesson.location.zone;
        const sameCity =
          !sameLocation &&
          !sameZone &&
          student.location?.city &&
          lesson.location?.city &&
          student.location.city === lesson.location.city;

        if (sameLocation) score += 10;
        else if (sameZone) score += 7;
        else if (sameCity) score += 4;

        if (student.instrument_id === lesson.instrument_id) score += 3;

        return {
          ...student,
          match_score: score,
          same_location: sameLocation,
          same_zone: !!sameZone,
          same_city: !!sameCity,
        };
      });

    scored.sort((a: any, b: any) => b.match_score - a.match_score);

    const topCandidates = scored.slice(0, 15);

    // Enrich with stats (charged absences)
    const enriched = await Promise.all(
      topCandidates.map(async (student: any) => {
        const { data: stats } = await supabase
          .from('student_stats')
          .select('*')
          .eq('student_id', student.id)
          .single();

        return {
          id: student.id,
          full_name: student.full_name,
          instrument: student.instrument?.name,
          location_name: student.location?.name,
          zone: student.location?.zone || '',
          match_score: student.match_score,
          same_location: student.same_location,
          same_zone: student.same_zone,
          charged_absences: stats?.charged_absences || 0,
          needs_makeup: (stats?.charged_absences || 0) > 0,
        };
      })
    );

    // Boost students who need makeup lessons
    for (const e of enriched) {
      if (e.needs_makeup) e.match_score += 5;
    }
    enriched.sort((a, b) => b.match_score - a.match_score);

    return new Response(
      JSON.stringify({
        success: true,
        lesson: {
          id: lesson.id,
          date: lesson.date,
          start_time: lesson.start_time,
          end_time: lesson.end_time,
          teacher: lesson.teacher?.full_name,
          location: lesson.location?.name,
          instrument: lesson.instrument?.name,
        },
        cancelled_students: cancelledStudents,
        teacher_schedule: teacherSchedule || [],
        matches: enriched,
      }),
      { headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.message === 'Unauthorized' ? 401 : 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
