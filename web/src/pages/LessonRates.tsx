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

// ── Placeholder shells (filled in later tasks) ────────────────────────────────

function TeacherList(_p: {
  teachers: Teacher[];
  rateCounts: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) { return <div className="text-gray-400 text-sm p-4">Teacher list</div>; }

function RateEditor(_p: {
  teacher: Teacher;
  locations: Location[];
  categories: LessonCategory[];
  year: string;
}) { return <div className="text-gray-400 text-sm p-4">Rate editor</div>; }

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
