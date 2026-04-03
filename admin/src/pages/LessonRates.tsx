import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { LessonRate, Location } from '@troika/shared';

// ── Constants ────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear().toString();
const YEARS = [CURRENT_YEAR, (Number(CURRENT_YEAR) - 1).toString()];

interface CategoryRow {
  value: string;   // matches LessonCategory enum values
  label: string;
  group: '1:1' | 'group';
}

const CATEGORIES: CategoryRow[] = [
  { value: '1:1_instrumental', label: 'Instrumental',   group: '1:1' },
  { value: '1:1_theory',       label: 'Theory',         group: '1:1' },
  { value: '1:1_vocals',       label: 'Vocals',         group: '1:1' },
  { value: 'group_strings',    label: 'Cello / Violin', group: 'group' },
  { value: 'group_guitar',     label: 'Guitar',         group: 'group' },
  { value: 'group_vocals',     label: 'Vocals',         group: 'group' },
  { value: 'group_theory',     label: 'Theory',         group: 'group' },
];

interface Teacher { id: string; full_name: string; }

// ── RateKey: unique key for a (category, locationId|'online') cell ──────────
function rateKey(category: string, locationId: string | null) {
  return `${category}::${locationId ?? 'online'}`;
}

export function LessonRatesPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  // rateMap: rateKey → LessonRate record
  const [rateMap, setRateMap] = useState<Record<string, LessonRate>>({});
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);

  // Load teachers and locations once
  useEffect(() => {
    async function loadMeta() {
      const [teachersRes, locationsRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name'),
        supabase.from('locations').select('*').order('name'),
      ]);
      const ts = teachersRes.data ?? [];
      setTeachers(ts);
      setLocations(locationsRes.data ?? []);
      if (ts.length > 0) setSelectedTeacherId(ts[0].id);
    }
    loadMeta();
  }, []);

  // Load rates whenever teacher or year changes
  const loadRates = useCallback(async () => {
    if (!selectedTeacherId) return;
    setLoading(true);
    const { data } = await supabase
      .from('lesson_rates')
      .select('*')
      .eq('teacher_id', selectedTeacherId)
      .eq('academic_year', year);
    const map: Record<string, LessonRate> = {};
    for (const r of data ?? []) {
      map[rateKey(r.category, r.is_online ? null : r.location_id)] = r as LessonRate;
    }
    setRateMap(map);
    setLoading(false);
  }, [selectedTeacherId, year]);

  useEffect(() => { loadRates(); }, [loadRates]);

  return (
    <div>
      <p>Teachers loaded: {teachers.length}</p>
      <p>Locations loaded: {locations.length}</p>
      <p>Rates loaded: {Object.keys(rateMap).length}</p>
    </div>
  );
}
