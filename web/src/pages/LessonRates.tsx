import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { LessonRate, Location } from '../types';

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

// ── RateCell: inline editable rate cell ──────────────────────────────────────
interface RateCellProps {
  rate: LessonRate | undefined;
  onSave: (value: number) => Promise<void>;
  onDelete: () => Promise<void>;
}

function RateCell({ rate, onSave, onDelete }: RateCellProps) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  function startEdit() {
    setInputVal(rate ? String(rate.rate_per_lesson) : '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function commit() {
    setEditing(false);
    const trimmed = inputVal.trim();
    if (trimmed === '') {
      await onDelete();
    } else {
      const num = parseFloat(trimmed);
      if (!isNaN(num) && num > 0) await onSave(num);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="px-2 py-1.5">
        <input
          ref={inputRef}
          autoFocus
          type="number"
          min={0}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="w-full border border-teal rounded-lg px-2 py-1.5 text-sm font-semibold text-navy text-center focus:outline-none focus:ring-2 focus:ring-teal/40"
          placeholder="e.g. 1750"
        />
      </div>
    );
  }

  if (rate) {
    return (
      <div
        onClick={startEdit}
        className="mx-2 my-1.5 rounded-lg px-2 py-1.5 text-sm font-bold text-center cursor-pointer select-none"
        style={{ background: '#ecfdf5', border: '1.5px solid #6ee7b7', color: '#065f46' }}
      >
        ₹{Number(rate.rate_per_lesson).toLocaleString('en-IN')}
      </div>
    );
  }

  return (
    <div
      onClick={startEdit}
      className="mx-2 my-1.5 rounded-lg px-2 py-1.5 text-xs text-center cursor-pointer select-none text-gray-400"
      style={{ border: '1.5px dashed #cbd5e1', background: '#fafafa' }}
    >
      + Set rate
    </div>
  );
}

export function LessonRatesPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  // rateMap: rateKey → LessonRate record
  const [rateMap, setRateMap] = useState<Record<string, LessonRate>>({});
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  // Upsert a rate for the currently selected teacher
  async function saveCell(category: string, locationId: string | null, value: number) {
    if (!selectedTeacherId || saving) return;
    setSaving(true);
    try {
      const isOnline = locationId === null;
      const existing = rateMap[rateKey(category, locationId)];
      if (existing) {
        const { error } = await supabase
          .from('lesson_rates')
          .update({ rate_per_lesson: value })
          .eq('id', existing.id);
        if (error) { alert(`Update failed: ${error.message}`); return; }
      } else {
        const { error } = await supabase.from('lesson_rates').insert({
          teacher_id: selectedTeacherId,
          location_id: isOnline ? null : locationId,
          category,
          rate_per_lesson: value,
          is_online: isOnline,
          academic_year: year,
        });
        if (error) { alert(`Save failed: ${error.message}`); return; }
      }
      await loadRates();
    } finally {
      setSaving(false);
    }
  }

  // Delete a rate (called when cell is cleared)
  async function deleteCell(category: string, locationId: string | null) {
    const existing = rateMap[rateKey(category, locationId)];
    if (!existing) return;
    const { error } = await supabase.from('lesson_rates').delete().eq('id', existing.id);
    if (error) { alert(`Delete failed: ${error.message}`); return; }
    await loadRates();
  }

  return (
    <div>
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Lesson Rates</h1>
          <p className="text-gray-500 text-sm mt-1">Click any cell to set or edit a rate</p>
        </div>
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy"
        >
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* ── Teacher tabs ── */}
      <div className="flex gap-2 flex-wrap mb-6">
        {teachers.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelectedTeacherId(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              selectedTeacherId === t.id
                ? 'bg-teal text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-teal hover:text-teal'
            }`}
          >
            {t.full_name}
          </button>
        ))}
      </div>

      {/* ── Rate grid ── */}
      {loading ? (
        <p className="text-gray-400 text-center py-12">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Column headers */}
          <div
            className="grid text-xs font-semibold uppercase text-gray-500 bg-gray-50 border-b border-gray-100"
            style={{ gridTemplateColumns: `180px repeat(${locations.length + 1}, 1fr)` }}
          >
            <div className="px-4 py-3">Lesson Type</div>
            {locations.map((loc) => (
              <div key={loc.id} className="px-2 py-3 text-center">{loc.name}</div>
            ))}
            <div className="px-2 py-3 text-center">Online</div>
          </div>

          {/* 1:1 group */}
          <div className="px-4 py-2 bg-gray-50/60 border-b border-gray-100">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">1:1 Lessons</span>
          </div>
          {CATEGORIES.filter((c) => c.group === '1:1').map((cat) => (
            <div
              key={cat.value}
              className="grid border-b border-gray-50 hover:bg-gray-50/40 items-center"
              style={{ gridTemplateColumns: `180px repeat(${locations.length + 1}, 1fr)` }}
            >
              <div className="px-4 py-1 text-sm text-gray-700">{cat.label}</div>
              {locations.map((loc) => (
                <RateCell
                  key={loc.id}
                  rate={rateMap[rateKey(cat.value, loc.id)]}
                  onSave={(v) => saveCell(cat.value, loc.id, v)}
                  onDelete={() => deleteCell(cat.value, loc.id)}
                />
              ))}
              <RateCell
                rate={rateMap[rateKey(cat.value, null)]}
                onSave={(v) => saveCell(cat.value, null, v)}
                onDelete={() => deleteCell(cat.value, null)}
              />
            </div>
          ))}

          {/* Group lessons group */}
          <div className="px-4 py-2 bg-gray-50/60 border-b border-gray-100 border-t border-t-gray-100">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Group Lessons</span>
          </div>
          {CATEGORIES.filter((c) => c.group === 'group').map((cat, idx, arr) => (
            <div
              key={cat.value}
              className={`grid items-center hover:bg-gray-50/40 ${idx < arr.length - 1 ? 'border-b border-gray-50' : ''}`}
              style={{ gridTemplateColumns: `180px repeat(${locations.length + 1}, 1fr)` }}
            >
              <div className="px-4 py-1 text-sm text-gray-700">{cat.label}</div>
              {locations.map((loc) => (
                <RateCell
                  key={loc.id}
                  rate={rateMap[rateKey(cat.value, loc.id)]}
                  onSave={(v) => saveCell(cat.value, loc.id, v)}
                  onDelete={() => deleteCell(cat.value, loc.id)}
                />
              ))}
              <RateCell
                rate={rateMap[rateKey(cat.value, null)]}
                onSave={(v) => saveCell(cat.value, null, v)}
                onDelete={() => deleteCell(cat.value, null)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
