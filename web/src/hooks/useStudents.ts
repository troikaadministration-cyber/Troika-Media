import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Student } from '../types';

export function useStudents(filters?: {
  instrumentId?: string;
  locationId?: string;
  isActive?: boolean;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('students')
        .select('*, location:locations(*), instrument:instruments(*), user_id')
        .order('full_name')
        .limit(500);

      if (filters?.instrumentId) query = query.eq('instrument_id', filters.instrumentId);
      if (filters?.locationId) query = query.eq('location_id', filters.locationId);
      if (filters?.isActive !== undefined) query = query.eq('is_active', filters.isActive);

      const { data, error: err } = await query;
      if (err) throw err;
      setStudents((data as Student[]) || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch students');
    } finally {
      setLoading(false);
    }
  }, [filters?.instrumentId, filters?.locationId, filters?.isActive]);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  async function createStudent(student: Partial<Student>) {
    const { error } = await supabase.from('students').insert(student);
    if (error) throw error;
    await fetchStudents();
  }

  async function updateStudent(id: string, updates: Partial<Student>) {
    const { error } = await supabase.from('students').update(updates).eq('id', id);
    if (error) throw error;
    await fetchStudents();
  }

  return { students, loading, error, createStudent, updateStudent, refresh: fetchStudents };
}
