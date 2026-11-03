import { supabase } from '../lib/supabase';
import { useQuery, unwrap, invalidateQueries } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import type { Student } from '../types';

export function useStudents(filters?: {
  instrumentId?: string;
  locationId?: string;
  isActive?: boolean;
}) {
  const key = `students:${filters?.instrumentId ?? ''}:${filters?.locationId ?? ''}:${filters?.isActive ?? ''}`;

  const { data, loading, error, refresh } = useQuery<Student[]>(key, async () => {
    const [rows, approvedProfiles] = await Promise.all([
      fetchAll<Student>((from, to) => {
        let query = supabase
          .from('students')
          .select('*, location:locations(*), instrument:instruments(*)')
          .order('full_name')
          .order('id')
          .range(from, to);
        if (filters?.instrumentId) query = query.eq('instrument_id', filters.instrumentId);
        if (filters?.locationId) query = query.eq('location_id', filters.locationId);
        if (filters?.isActive !== undefined) query = query.eq('is_active', filters.isActive);
        return query;
      }),
      supabase.from('profiles').select('id').eq('approved', true).eq('role', 'student').then((r) => unwrap(r, [])),
    ]);
    const approvedIds = new Set((approvedProfiles as { id: string }[]).map((p) => p.id));
    // Show coordinator-created students (no user_id) and self-registered students whose profile is approved
    return rows.filter((s) => !s.user_id || approvedIds.has(s.user_id));
  });

  async function createStudent(student: Partial<Student>) {
    const { error: err } = await supabase.from('students').insert(student);
    if (err) throw err;
    invalidateQueries('students:');
    invalidateQueries('ref:students');
  }

  async function updateStudent(id: string, updates: Partial<Student>) {
    const { error: err } = await supabase.from('students').update(updates).eq('id', id);
    if (err) throw err;
    invalidateQueries('students:');
    invalidateQueries('ref:students');
  }

  return { students: data ?? [], loading, error, createStudent, updateStudent, refresh };
}
