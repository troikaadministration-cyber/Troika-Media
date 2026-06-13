// Supabase Edge Function: Generate lessons from a teacher's weekly schedule templates
//
// Replaces the previous client-side day-by-day loop (N+1 round-trips, no atomicity,
// real errors silently miscounted as "skipped"). Runs server-side with the service
// role, batches existence checks and inserts, and returns accurate created/skipped/error
// counts plus any error messages.

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

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });

interface Template {
  id: string;
  teacher_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string | null;
  location_id: string | null;
  instrument_id: string | null;
  title: string;
  student_ids: string[];
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

    // Only coordinators manage teacher schedules.
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (!profile || profile.role !== 'coordinator') {
      throw new Error('Unauthorized');
    }

    const { teacher_id, start_date, end_date, skip_existing = true } = await req.json();
    if (!teacher_id) throw new Error('teacher_id is required');
    if (!start_date || !end_date) throw new Error('start_date and end_date are required');

    const startDate = new Date(start_date + 'T00:00:00Z');
    const endDate = new Date(end_date + 'T00:00:00Z');
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid date');
    }
    if (endDate < startDate) throw new Error('end_date must be on or after start_date');
    const dayCount = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    if (dayCount > 366) throw new Error('Date range too large (max 1 year)');

    // Active templates for this teacher.
    const { data: templates, error: tplErr } = await supabase
      .from('teacher_schedule_templates')
      .select('*')
      .eq('teacher_id', teacher_id)
      .eq('is_active', true);
    if (tplErr) throw new Error(tplErr.message);
    if (!templates || templates.length === 0) {
      return json(req, { created: 0, skipped: 0, errors: 0, error_messages: [] });
    }

    const tpls = templates as Template[];

    // Expand templates across the date range into prospective lessons.
    const prospective: { tpl: Template; date: string; start_time: string }[] = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const dow = cursor.getUTCDay();
      const dateStr = cursor.toISOString().split('T')[0];
      for (const tpl of tpls) {
        if (tpl.day_of_week === dow) {
          prospective.push({ tpl, date: dateStr, start_time: tpl.start_time });
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    if (prospective.length === 0) {
      return json(req, { created: 0, skipped: 0, errors: 0, error_messages: [] });
    }

    // Batch existence check: one query for all lessons in range for this teacher.
    let existingKeys = new Set<string>();
    if (skip_existing) {
      const { data: existing, error: exErr } = await supabase
        .from('lessons')
        .select('date, start_time')
        .eq('teacher_id', teacher_id)
        .gte('date', start_date)
        .lte('date', end_date);
      if (exErr) throw new Error(exErr.message);
      existingKeys = new Set(
        (existing || []).map((e: { date: string; start_time: string }) => `${e.date}|${e.start_time}`)
      );
    }

    let created = 0;
    let skipped = 0;
    let errors = 0;
    const errorMessages: string[] = [];

    // Filter out duplicates, then batch-insert lessons.
    const toCreate = prospective.filter((p) => {
      if (skip_existing && existingKeys.has(`${p.date}|${p.start_time}`)) {
        skipped++;
        return false;
      }
      return true;
    });

    if (toCreate.length > 0) {
      const { data: inserted, error: insErr } = await supabase
        .from('lessons')
        .insert(
          toCreate.map((p) => ({
            teacher_id: p.tpl.teacher_id,
            location_id: p.tpl.location_id,
            instrument_id: p.tpl.instrument_id,
            lesson_type: 'regular',
            date: p.date,
            start_time: p.tpl.start_time,
            end_time: p.tpl.end_time,
            title: p.tpl.title,
          }))
        )
        .select('id');

      if (insErr) {
        errors += toCreate.length;
        errorMessages.push(insErr.message);
      } else if (inserted) {
        created = inserted.length;

        // Batch-insert lesson_students for lessons whose template has students.
        const links: { lesson_id: string; student_id: string }[] = [];
        toCreate.forEach((p, i) => {
          const lessonId = inserted[i]?.id;
          if (lessonId) {
            for (const sid of p.tpl.student_ids || []) {
              links.push({ lesson_id: lessonId, student_id: sid });
            }
          }
        });
        if (links.length > 0) {
          const { error: linkErr } = await supabase.from('lesson_students').insert(links);
          if (linkErr) errorMessages.push(`Student links: ${linkErr.message}`);
        }
      }
    }

    return json(req, { created, skipped, errors, error_messages: errorMessages });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'Unauthorized' ? 401 : 400;
    return json(req, { error: message }, status);
  }
});
