import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface TemplateWithTeacher {
  id: string;
  teacher_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string | null;
  location_id: string | null;
  instrument_id: string | null;
  title: string;
  student_ids: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  teacher?: { id: string; full_name: string };
}

export function useScheduleTemplates() {
  const [templates, setTemplates] = useState<TemplateWithTeacher[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('teacher_schedule_templates')
      .select('*, teacher:profiles(id, full_name)')
      .order('day_of_week')
      .order('start_time');
    setTemplates((data as TemplateWithTeacher[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  async function createTemplate(template: {
    teacher_id: string;
    day_of_week: number;
    start_time: string;
    end_time?: string;
    location_id?: string;
    instrument_id?: string;
    title: string;
    student_ids?: string[];
  }) {
    const { error } = await supabase.from('teacher_schedule_templates').insert(template);
    if (error) throw error;
    await fetchTemplates();
  }

  async function updateTemplate(id: string, updates: Partial<TemplateWithTeacher>) {
    const { error } = await supabase.from('teacher_schedule_templates').update(updates).eq('id', id);
    if (error) throw error;
    await fetchTemplates();
  }

  async function deleteTemplate(id: string) {
    const { error } = await supabase.from('teacher_schedule_templates').delete().eq('id', id);
    if (error) throw error;
    await fetchTemplates();
  }

  async function generateLessons(startDate: string, endDate: string) {
    const activeTemplates = templates.filter((t) => t.is_active);
    if (activeTemplates.length === 0) return { lessonsCreated: 0, teachersAffected: 0 };

    // Get all dates in range
    const dates: string[] = [];
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }

    // Fetch existing lessons in range to avoid duplicates
    const { data: existing } = await supabase
      .from('lessons')
      .select('teacher_id, date, start_time')
      .gte('date', startDate)
      .lte('date', endDate);
    const existingSet = new Set(
      (existing || []).map((l: any) => `${l.teacher_id}_${l.date}_${l.start_time}`)
    );

    const lessonsToInsert: any[] = [];
    const studentLinks: { lessonIndex: number; studentIds: string[] }[] = [];
    const teacherIds = new Set<string>();

    for (const tmpl of activeTemplates) {
      for (const dateStr of dates) {
        const dayOfWeek = new Date(dateStr + 'T00:00:00').getDay();
        if (dayOfWeek !== tmpl.day_of_week) continue;

        const key = `${tmpl.teacher_id}_${dateStr}_${tmpl.start_time}`;
        if (existingSet.has(key)) continue;

        lessonsToInsert.push({
          teacher_id: tmpl.teacher_id,
          location_id: tmpl.location_id || null,
          instrument_id: tmpl.instrument_id || null,
          lesson_type: 'regular',
          status: 'scheduled',
          date: dateStr,
          start_time: tmpl.start_time,
          end_time: tmpl.end_time || null,
          title: tmpl.title,
        });

        if (tmpl.student_ids && tmpl.student_ids.length > 0) {
          studentLinks.push({ lessonIndex: lessonsToInsert.length - 1, studentIds: tmpl.student_ids });
        }
        teacherIds.add(tmpl.teacher_id);
        existingSet.add(key);
      }
    }

    if (lessonsToInsert.length === 0) return { lessonsCreated: 0, teachersAffected: 0 };

    // Bulk insert lessons
    const { data: created, error } = await supabase
      .from('lessons')
      .insert(lessonsToInsert)
      .select('id');
    if (error) throw error;

    // Bulk insert student links
    if (created && studentLinks.length > 0) {
      const links: { lesson_id: string; student_id: string }[] = [];
      for (const { lessonIndex, studentIds } of studentLinks) {
        const lessonId = created[lessonIndex]?.id;
        if (!lessonId) continue;
        for (const sid of studentIds) {
          links.push({ lesson_id: lessonId, student_id: sid });
        }
      }
      if (links.length > 0) {
        await supabase.from('lesson_students').insert(links);
      }
    }

    return { lessonsCreated: created?.length || 0, teachersAffected: teacherIds.size };
  }

  return { templates, loading, fetchTemplates, createTemplate, updateTemplate, deleteTemplate, generateLessons };
}
