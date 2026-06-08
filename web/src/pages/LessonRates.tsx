import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Settings, Check, X, Trash2, Plus } from 'lucide-react';
import type { LessonRate, Location } from '../types';

const CURRENT_YEAR = new Date().getFullYear().toString();
const YEARS = [CURRENT_YEAR, (Number(CURRENT_YEAR) - 1).toString()];

// ── Shared types ─────────────────────────────────────────────────────────────

interface Teacher { id: string; full_name: string; }
interface LessonCategory { id: string; name: string; sort_order: number; }
interface Instrument { id: string; name: string; }

function rateKey(category: string, locationId: string | null) {
  return `${category}::${locationId ?? 'online'}`;
}

// ── EditableItem — inline rename + delete for admin lists ─────────────────────

function EditableItem({ name, onRename, onDelete, deleteDisabled }: {
  name: string;
  onRename: (n: string) => Promise<void>;
  onDelete: () => Promise<void>;
  deleteDisabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  async function save() {
    const t = draft.trim();
    if (t && t !== name) await onRename(t);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-4 py-2">
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className="flex-1 text-sm border border-teal rounded-lg px-3 py-1.5 focus:outline-none" />
        <button onClick={save} className="text-teal"><Check size={15} /></button>
        <button onClick={() => setEditing(false)} className="text-gray-400"><X size={15} /></button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 group">
      <button onClick={() => { setDraft(name); setEditing(true); }}
        className="text-sm text-navy hover:underline text-left flex-1">{name}</button>
      <button onClick={onDelete} disabled={deleteDisabled}
        title={deleteDisabled ? 'In use — cannot delete' : 'Delete'}
        className="text-gray-300 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 transition-opacity">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── RateRow — always-visible input with auto-save ─────────────────────────────

function RateRow({ category, rate, onSave, onDelete }: {
  category: string;
  rate: LessonRate | undefined;
  onSave: (value: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [value, setValue] = useState(rate ? String(rate.rate_per_lesson) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const escapeRef = React.useRef(false);
  const savedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  async function commit() {
    if (escapeRef.current) { escapeRef.current = false; return; }
    const trimmed = value.trim();
    setError(null);
    if (trimmed === '') {
      if (rate) {
        setSaving(true);
        try { await onDelete(); } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
        finally { setSaving(false); }
      }
      return;
    }
    const num = parseFloat(trimmed);
    if (isNaN(num) || num <= 0) { setError('Enter a positive number'); return; }
    setSaving(true);
    try {
      await onSave(num);
      setSaved(true);
      savedTimerRef.current = setTimeout(() => setSaved(false), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      escapeRef.current = true;
      setValue(rate ? String(rate.rate_per_lesson) : '');
      setError(null);
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
  }

  return (
    <div className="flex items-start justify-between py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700 pt-1.5">{category}</span>
      <div className="flex flex-col items-end gap-1">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">₹</span>
          <input
            type="number" min={0} value={value}
            onChange={e => { setValue(e.target.value); setError(null); }}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            placeholder="—"
            className={`w-28 pl-6 pr-3 py-1.5 text-sm text-right font-semibold rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-teal/30 ${
              saved
                ? 'border-teal bg-teal/5 text-teal'
                : error
                ? 'border-red-300 bg-red-50'
                : 'border-gray-200 bg-gray-50 hover:border-gray-300 focus:border-teal'
            } ${saving ? 'opacity-60' : ''}`}
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </div>
  );
}

// ── Placeholder shells (filled in later tasks) ────────────────────────────────

function TeacherList({ teachers, rateCounts, selectedId, onSelect }: {
  teachers: Teacher[];
  rateCounts: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="w-44 flex-shrink-0 flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase text-gray-400 tracking-wide px-1 mb-1">Teachers</p>
      {teachers.map(t => {
        const count = rateCounts[t.id] ?? 0;
        const isSelected = t.id === selectedId;
        return (
          <button key={t.id} onClick={() => onSelect(t.id)}
            className={`w-full text-left rounded-xl px-3 py-2.5 border transition-all ${
              isSelected
                ? 'bg-teal/10 border-teal text-navy'
                : 'bg-white border-gray-100 hover:border-gray-200 text-navy'
            }`}>
            <p className="text-sm font-semibold truncate">{t.full_name}</p>
            <p className={`text-xs mt-0.5 font-medium ${
              count === 0 ? 'text-amber-400' : 'text-teal'
            }`}>
              {count === 0 ? '⚠ No rates set' : `${count} rate${count === 1 ? '' : 's'}`}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function RateEditor({ teacher, locations, categories, year }: {
  teacher: Teacher;
  locations: Location[];
  categories: LessonCategory[];
  year: string;
}) {
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    locations[0]?.id ?? null
  );
  const [rateMap, setRateMap] = useState<Record<string, LessonRate>>({});
  const [loading, setLoading] = useState(true);

  const loadRates = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('lesson_rates')
      .select('*')
      .eq('teacher_id', teacher.id)
      .eq('academic_year', year);
    const map: Record<string, LessonRate> = {};
    for (const r of data ?? []) {
      map[rateKey(r.category, r.is_online ? null : r.location_id)] = r as LessonRate;
    }
    setRateMap(map);
    setLoading(false);
  }, [teacher.id, year]);

  useEffect(() => { loadRates(); }, [loadRates]);

  // Reset to first location when teacher changes
  useEffect(() => {
    setSelectedLocationId(locations[0]?.id ?? null);
  }, [teacher.id, locations]);

  async function saveRate(category: string, locationId: string | null, value: number) {
    const isOnline = locationId === null;
    const existing = rateMap[rateKey(category, locationId)];
    if (existing) {
      const { error } = await supabase
        .from('lesson_rates')
        .update({ rate_per_lesson: value })
        .eq('id', existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from('lesson_rates').insert({
        teacher_id: teacher.id,
        location_id: isOnline ? null : locationId,
        category,
        rate_per_lesson: value,
        is_online: isOnline,
        academic_year: year,
      });
      if (error) throw new Error(error.message);
    }
    await loadRates();
  }

  async function deleteRate(category: string, locationId: string | null) {
    const existing = rateMap[rateKey(category, locationId)];
    if (!existing) return;
    const { error } = await supabase
      .from('lesson_rates')
      .delete()
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
    await loadRates();
  }

  const tabs: { id: string | null; label: string }[] = [
    ...locations.map(l => ({ id: l.id, label: l.name })),
    { id: null, label: 'Online' },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-100 flex flex-col h-full">
      {/* Teacher name bar */}
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 rounded-t-xl flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-teal/10 flex items-center justify-center text-teal font-bold text-sm flex-shrink-0">
          {teacher.full_name.charAt(0)}
        </div>
        <h3 className="font-semibold text-navy">{teacher.full_name}</h3>
        <span className="text-xs text-gray-400 ml-1">— {year}</span>
      </div>

      {/* Location tabs */}
      <div className="px-5 pt-4 pb-0 flex gap-2 flex-wrap">
        {tabs.map(tab => (
          <button key={tab.id ?? 'online'} onClick={() => setSelectedLocationId(tab.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              selectedLocationId === tab.id
                ? 'bg-navy text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Rate rows */}
      <div className="px-5 py-3 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
        ) : categories.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No categories yet. Add via Manage.</p>
        ) : (
          categories.map(cat => (
            <RateRow
              key={`${cat.id}::${selectedLocationId ?? 'online'}`}
              category={cat.name}
              rate={rateMap[rateKey(cat.name, selectedLocationId)]}
              onSave={v => saveRate(cat.name, selectedLocationId, v)}
              onDelete={() => deleteRate(cat.name, selectedLocationId)}
            />
          ))
        )}
      </div>

      <p className="px-5 py-2 text-xs text-gray-300 border-t border-gray-50">
        Tab or Enter to save · Escape to cancel · Clear to remove
      </p>
    </div>
  );
}

function AdminModal(_p: {
  open: boolean;
  onClose: () => void;
  locations: Location[];
  instruments: Instrument[];
  categories: LessonCategory[];
  locationsInUse: Set<string>;
  instrumentsInUse: Set<string>;
  categoriesInUse: Set<string>;
  onRefresh: () => void;
}) { return null; }

// ── LessonRatesPage ───────────────────────────────────────────────────────────

export function LessonRatesPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<LessonCategory[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [rateCounts, setRateCounts] = useState<Record<string, number>>({});
  const [year, setYear] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [instrumentsInUse, setInstrumentsInUse] = useState<Set<string>>(new Set());
  const [categoriesInUse, setCategoriesInUse] = useState<Set<string>>(new Set());
  const [locationsInUse, setLocationsInUse] = useState<Set<string>>(new Set());

  const loadMeta = useCallback(async () => {
    setLoading(true);
    const [teachersRes, locationsRes, categoriesRes, instrumentsRes,
      studentsInstrRes, ratesRes, studentsLocRes, lessonsLocRes, rateCountsRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name'),
      supabase.from('locations').select('*').order('name'),
      supabase.from('lesson_categories').select('*').order('sort_order'),
      supabase.from('instruments').select('*').order('name'),
      supabase.from('students').select('instrument_id').not('instrument_id', 'is', null),
      supabase.from('lesson_rates').select('category'),
      supabase.from('students').select('location_id').not('location_id', 'is', null),
      supabase.from('lessons').select('location_id').not('location_id', 'is', null),
      supabase.from('lesson_rates').select('teacher_id').eq('academic_year', year),
    ]);

    const ts = teachersRes.data ?? [];
    setTeachers(ts);
    setLocations(locationsRes.data ?? []);
    setCategories((categoriesRes.data ?? []) as LessonCategory[]);
    setInstruments((instrumentsRes.data ?? []) as Instrument[]);
    setInstrumentsInUse(new Set((studentsInstrRes.data ?? []).map((s: any) => s.instrument_id)));
    setCategoriesInUse(new Set((ratesRes.data ?? []).map((r: any) => r.category)));
    setLocationsInUse(new Set([
      ...(studentsLocRes.data ?? []).map((s: any) => s.location_id),
      ...(lessonsLocRes.data ?? []).map((l: any) => l.location_id),
    ]));

    const counts: Record<string, number> = {};
    for (const r of rateCountsRes.data ?? []) {
      const tid = (r as any).teacher_id;
      if (tid) counts[tid] = (counts[tid] ?? 0) + 1;
    }
    setRateCounts(counts);

    setSelectedTeacherId(prev => prev ?? (ts[0]?.id ?? null));
    setLoading(false);
  }, [year]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  const selectedTeacher = teachers.find(t => t.id === selectedTeacherId) ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-navy">Lesson Rates</h1>
          <p className="text-gray-400 text-sm mt-0.5">Select a teacher, pick a location, set rates</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={year} onChange={e => setYear(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy">
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => setAdminOpen(true)}
            className="flex items-center gap-1.5 text-sm font-semibold text-navy border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">
            <Settings size={15} /> Manage
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <p className="text-gray-400 text-center py-16">Loading…</p>
      ) : teachers.length === 0 ? (
        <p className="text-gray-400 text-center py-16">No teachers yet. Add from the Teachers page first.</p>
      ) : (
        <div className="flex gap-5 flex-1 min-h-0">
          <TeacherList
            teachers={teachers}
            rateCounts={rateCounts}
            selectedId={selectedTeacherId}
            onSelect={setSelectedTeacherId}
          />
          <div className="flex-1 min-w-0">
            {selectedTeacher ? (
              <RateEditor
                teacher={selectedTeacher}
                locations={locations}
                categories={categories}
                year={year}
              />
            ) : (
              <p className="text-gray-400 text-sm">Select a teacher to edit rates.</p>
            )}
          </div>
        </div>
      )}

      <AdminModal
        open={adminOpen}
        onClose={() => { setAdminOpen(false); loadMeta(); }}
        locations={locations}
        instruments={instruments}
        categories={categories}
        locationsInUse={locationsInUse}
        instrumentsInUse={instrumentsInUse}
        categoriesInUse={categoriesInUse}
        onRefresh={loadMeta}
      />
    </div>
  );
}
