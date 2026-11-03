import { supabase } from '../lib/supabase';
import { useQuery, unwrap, invalidateQueries } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import type { Instrument, Location, Profile, Student } from '../types';

// Small, rarely-changing lists shared by many pages. Cached for a few minutes
// and invalidated explicitly by the pages that edit them.
const REF_STALE_MS = 5 * 60 * 1000;

export function useInstruments() {
  const q = useQuery<Instrument[]>('ref:instruments', async () =>
    unwrap(await supabase.from('instruments').select('*').order('name'), []) as Instrument[],
  { staleTime: REF_STALE_MS });
  return { ...q, instruments: q.data ?? [] };
}

export function useLocationsList() {
  const q = useQuery<Location[]>('ref:locations', async () =>
    unwrap(await supabase.from('locations').select('*').order('name'), []) as Location[],
  { staleTime: REF_STALE_MS });
  return { ...q, locations: q.data ?? [] };
}

/** Teachers for pickers/filters. By default only approved teachers. */
export function useTeachersList({ includeUnapproved = false }: { includeUnapproved?: boolean } = {}) {
  const q = useQuery<Profile[]>(`ref:teachers:${includeUnapproved ? 'all' : 'approved'}`, async () => {
    let query = supabase.from('profiles').select('*').eq('role', 'teacher').order('full_name');
    if (!includeUnapproved) query = query.eq('approved', true);
    return unwrap(await query, []) as Profile[];
  }, { staleTime: REF_STALE_MS });
  return { ...q, teachers: q.data ?? [] };
}

export function useActiveStudentsList() {
  const q = useQuery<Student[]>('ref:students:active', () =>
    fetchAll<Student>((from, to) =>
      supabase.from('students').select('*').eq('is_active', true).order('full_name').order('id').range(from, to)),
  { staleTime: 60 * 1000 });
  return { ...q, students: q.data ?? [] };
}

/** Call after editing instruments/locations/teachers/students so every page sees the change. */
export function invalidateReference(kind?: 'instruments' | 'locations' | 'teachers' | 'students') {
  invalidateQueries(kind ? `ref:${kind}` : 'ref:');
}
