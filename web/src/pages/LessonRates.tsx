import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ChevronDown, ChevronRight, Trash2, Plus, Check, X } from 'lucide-react';
import type { LessonRate, Location } from '../types';

const CURRENT_YEAR = new Date().getFullYear().toString();
const YEARS = [CURRENT_YEAR, (Number(CURRENT_YEAR) - 1).toString()];

const ALLOWED_INSTRUMENTS = ['Cello', 'Piano', 'Voice', 'Guitar', 'Violin', 'Viola', 'IGCSE Music', 'Music Theory'];

interface Teacher { id: string; full_name: string; }
interface LessonCategory { id: string; name: string; sort_order: number; }
interface Instrument { id: string; name: string; }

function rateKey(category: string, locationId: string | null) {
  return `${category}::${locationId ?? 'online'}`;
}

// ── RateCell ─────────────────────────────────────────────────────────────────

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
    if (trimmed === '') { await onDelete(); }
    else {
      const num = parseFloat(trimmed);
      if (!isNaN(num) && num > 0) await onSave(num);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { setEditing(false); }
  }

  if (editing) {
    return (
      <div className="px-2 py-1.5">
        <input ref={inputRef} autoFocus type="number" min={0} value={inputVal}
          onChange={(e) => setInputVal(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
          className="w-full border border-teal rounded-lg px-2 py-1.5 text-sm font-semibold text-navy text-center focus:outline-none focus:ring-2 focus:ring-teal/40"
          placeholder="e.g. 1750" />
      </div>
    );
  }

  if (rate) {
    return (
      <div onClick={startEdit}
        className="mx-2 my-1.5 rounded-lg px-2 py-1.5 text-sm font-bold text-center cursor-pointer select-none"
        style={{ background: '#ecfdf5', border: '1.5px solid #6ee7b7', color: '#065f46' }}>
        ₹{Number(rate.rate_per_lesson).toLocaleString('en-IN')}
      </div>
    );
  }

  return (
    <div onClick={startEdit}
      className="mx-2 my-1.5 rounded-lg px-2 py-1.5 text-xs text-center cursor-pointer select-none text-gray-400"
      style={{ border: '1.5px dashed #cbd5e1', background: '#fafafa' }}>
      + Set rate
    </div>
  );
}

// ── InlineAdder: shared "type and press enter to add" row ────────────────────

function InlineAdder({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    await onAdd(trimmed);
    setValue('');
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-100">
      <input value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder={placeholder}
        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
      <button onClick={submit} disabled={saving || !value.trim()}
        className="flex items-center gap-1 text-sm font-semibold text-white bg-teal px-3 py-1.5 rounded-lg hover:bg-teal/90 disabled:opacity-40">
        <Plus size={14} /> Add
      </button>
    </div>
  );
}

// ── EditableRow: name with inline rename + delete ────────────────────────────

function EditableRow({ name, onRename, onDelete, deleteDisabled }: {
  name: string;
  onRename: (newName: string) => Promise<void>;
  onDelete: () => Promise<void>;
  deleteDisabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  async function save() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) await onRename(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-4 py-2">
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className="flex-1 text-sm border border-teal rounded-lg px-3 py-1.5 focus:outline-none" />
        <button onClick={save} className="text-teal hover:text-teal/70"><Check size={16} /></button>
        <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-navy"><X size={16} /></button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 group">
      <button onClick={() => { setDraft(name); setEditing(true); }}
        className="text-sm text-navy hover:underline text-left flex-1">{name}</button>
      <button onClick={onDelete} disabled={deleteDisabled}
        title={deleteDisabled ? 'In use — cannot delete' : 'Delete'}
        className="text-gray-300 hover:text-coral disabled:opacity-30 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 transition-opacity">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ── AdminPanel: collapsible panel wrapper ────────────────────────────────────

function AdminPanel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-4">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          <span className="text-sm font-semibold text-navy">{title}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
        </div>
      </button>
      {open && <div className="border-t border-gray-100">{children}</div>}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function LessonRatesPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<LessonCategory[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [rateMap, setRateMap] = useState<Record<string, LessonRate>>({});
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Track which instruments/categories are in use (to disable delete)
  const [instrumentsInUse, setInstrumentsInUse] = useState<Set<string>>(new Set());
  const [categoriesInUse, setCategoriesInUse] = useState<Set<string>>(new Set());

  async function loadMeta() {
    const [teachersRes, locationsRes, categoriesRes, instrumentsRes, studentsRes, ratesRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name'),
      supabase.from('locations').select('*').order('name'),
      supabase.from('lesson_categories').select('*').order('sort_order'),
      supabase.from('instruments').select('*').order('name'),
      supabase.from('students').select('instrument_id').not('instrument_id', 'is', null),
      supabase.from('lesson_rates').select('category'),
    ]);
    const ts = teachersRes.data ?? [];
    setTeachers(ts);
    setLocations(locationsRes.data ?? []);
    setCategories((categoriesRes.data ?? []) as LessonCategory[]);
    setInstruments((instrumentsRes.data ?? []) as Instrument[]);
    if (ts.length > 0) setSelectedTeacherId(prev => prev ?? ts[0].id);
    setInstrumentsInUse(new Set((studentsRes.data ?? []).map((s: any) => s.instrument_id)));
    setCategoriesInUse(new Set((ratesRes.data ?? []).map((r: any) => r.category)));
  }

  useEffect(() => { loadMeta(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRates = useCallback(async () => {
    if (!selectedTeacherId) return;
    setLoading(true);
    const { data } = await supabase
      .from('lesson_rates').select('*')
      .eq('teacher_id', selectedTeacherId).eq('academic_year', year);
    const map: Record<string, LessonRate> = {};
    for (const r of data ?? []) {
      map[rateKey(r.category, r.is_online ? null : r.location_id)] = r as LessonRate;
    }
    setRateMap(map);
    setLoading(false);
  }, [selectedTeacherId, year]);

  useEffect(() => { loadRates(); }, [loadRates]);

  async function saveCell(category: string, locationId: string | null, value: number) {
    if (!selectedTeacherId || saving) return;
    setSaving(true);
    try {
      const isOnline = locationId === null;
      const existing = rateMap[rateKey(category, locationId)];
      if (existing) {
        await supabase.from('lesson_rates').update({ rate_per_lesson: value }).eq('id', existing.id);
      } else {
        await supabase.from('lesson_rates').insert({
          teacher_id: selectedTeacherId, location_id: isOnline ? null : locationId,
          category, rate_per_lesson: value, is_online: isOnline, academic_year: year,
        });
      }
      await loadRates();
    } finally { setSaving(false); }
  }

  async function deleteCell(category: string, locationId: string | null) {
    const existing = rateMap[rateKey(category, locationId)];
    if (!existing) return;
    await supabase.from('lesson_rates').delete().eq('id', existing.id);
    await loadRates();
  }

  // ── Instrument CRUD ──────────────────────────────────────────────────────

  async function addInstrument(name: string) {
    const { error } = await supabase.from('instruments').insert({ name });
    if (error) { alert(error.message); return; }
    await loadMeta();
  }

  async function renameInstrument(id: string, name: string) {
    await supabase.from('instruments').update({ name }).eq('id', id);
    await loadMeta();
  }

  async function deleteInstrument(id: string) {
    const { error } = await supabase.from('instruments').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    await loadMeta();
  }

  // ── Category CRUD ────────────────────────────────────────────────────────

  async function addCategory(name: string) {
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0);
    const { error } = await supabase.from('lesson_categories').insert({ name, sort_order: maxOrder + 1 });
    if (error) { alert(error.message); return; }
    await loadMeta();
  }

  async function renameCategory(id: string, name: string) {
    await supabase.from('lesson_categories').update({ name }).eq('id', id);
    await loadMeta();
  }

  async function deleteCategory(id: string) {
    const { error } = await supabase.from('lesson_categories').delete().eq('id', id);
    if (error) { alert(error.message); return; }
    await loadMeta();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Lesson Rates</h1>
          <p className="text-gray-500 text-sm mt-1">Click any cell to set or edit a rate</p>
        </div>
        <select value={year} onChange={(e) => setYear(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-navy">
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Instruments admin panel */}
      {(() => {
        const allowedInstruments = instruments.filter(i => ALLOWED_INSTRUMENTS.includes(i.name));
        const missingInstruments = ALLOWED_INSTRUMENTS.filter(name => !instruments.some(i => i.name === name));
        return (
          <AdminPanel title="Instruments" count={allowedInstruments.length}>
            {allowedInstruments.map(inst => (
              <EditableRow key={inst.id} name={inst.name}
                onRename={name => renameInstrument(inst.id, name)}
                onDelete={() => deleteInstrument(inst.id)}
                deleteDisabled={instrumentsInUse.has(inst.id)} />
            ))}
            {missingInstruments.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-100">
                <select
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none mr-2"
                  defaultValue=""
                  onChange={async e => { if (e.target.value) { await addInstrument(e.target.value); e.target.value = ''; } }}>
                  <option value="">+ Add missing instrument…</option>
                  {missingInstruments.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
            )}
          </AdminPanel>
        );
      })()}

      {/* Lesson categories admin panel */}
      <AdminPanel title="Lesson Categories" count={categories.length}>
        {categories.map(cat => (
          <EditableRow key={cat.id} name={cat.name}
            onRename={name => renameCategory(cat.id, name)}
            onDelete={() => deleteCategory(cat.id)}
            deleteDisabled={categoriesInUse.has(cat.name)} />
        ))}
        <InlineAdder placeholder="New category name..." onAdd={addCategory} />
      </AdminPanel>

      {/* Teacher tabs */}
      <div className="flex gap-2 flex-wrap mb-6">
        {teachers.map((t) => (
          <button key={t.id} onClick={() => setSelectedTeacherId(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              selectedTeacherId === t.id
                ? 'bg-teal text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-teal hover:text-teal'
            }`}>
            {t.full_name}
          </button>
        ))}
      </div>

      {/* Rate grid — rows come from lesson_categories */}
      {loading ? (
        <p className="text-gray-400 text-center py-12">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="grid text-xs font-semibold uppercase text-gray-500 bg-gray-50 border-b border-gray-100"
            style={{ gridTemplateColumns: `200px repeat(${locations.length + 1}, 1fr)` }}>
            <div className="px-4 py-3">Lesson Type</div>
            {locations.map((loc) => (
              <div key={loc.id} className="px-2 py-3 text-center">{loc.name}</div>
            ))}
            <div className="px-2 py-3 text-center">Online</div>
          </div>

          {categories.map((cat, idx, arr) => (
            <div key={cat.id}
              className={`grid items-center hover:bg-gray-50/40 ${idx < arr.length - 1 ? 'border-b border-gray-50' : ''}`}
              style={{ gridTemplateColumns: `200px repeat(${locations.length + 1}, 1fr)` }}>
              <div className="px-4 py-1 text-sm text-gray-700">{cat.name}</div>
              {locations.map((loc) => (
                <RateCell key={loc.id}
                  rate={rateMap[rateKey(cat.name, loc.id)]}
                  onSave={(v) => saveCell(cat.name, loc.id, v)}
                  onDelete={() => deleteCell(cat.name, loc.id)} />
              ))}
              <RateCell
                rate={rateMap[rateKey(cat.name, null)]}
                onSave={(v) => saveCell(cat.name, null, v)}
                onDelete={() => deleteCell(cat.name, null)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
