import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap, setQueryData, invalidateQueries } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import { useTeachersList, useLocationsList, useInstruments, invalidateReference } from '../hooks/useReference';
import { useToast } from '../contexts/ToastContext';
import { Settings, Check, X, Trash2, Plus } from 'lucide-react';
import { SkeletonList } from '../components/Skeleton';
import { ErrorBanner } from '../components/ErrorBanner';
import type { LessonRate as LessonRateFull, Location } from '../types';

const CURRENT_YEAR = new Date().getFullYear().toString();
const YEARS = [CURRENT_YEAR, (Number(CURRENT_YEAR) - 1).toString()];

// ── Shared types ─────────────────────────────────────────────────────────────

interface Teacher { id: string; full_name: string; }
interface LessonCategoryRow { id: string; name: string; sort_order: number; }
interface Instrument { id: string; name: string; }
type LessonRate = Omit<LessonRateFull, 'created_at'>;

// All rates (a small table) in one cached query: teacher counts, per-teacher
// editor and "category in use" are all derived from it, so switching teacher
// or year needs no request.
const RATES_KEY = 'lesson-rates:all';
const RATE_COLUMNS = 'id, teacher_id, location_id, category, rate_per_lesson, is_online, academic_year';

/** Other pages (Enrolments' rate picker) cache rates under `lesson-rates:` too. */
function afterRatesChange() {
  invalidateQueries('lesson-rates:enrol-picker');
}

interface Usage { instruments: string[]; locations: string[] }

const count = (v: unknown) => ((v as { count: number }[] | null)?.[0]?.count ?? 0);

/** Which instruments/locations are referenced anywhere (deleting them would cascade or null out data). */
async function fetchUsage(): Promise<Usage> {
  const [instr, locs] = await Promise.all([
    supabase.from('instruments').select(
      'id, students!students_instrument_id_fkey(count), student_instruments(count), student_enrolments(count), lessons(count), teacher_schedule_templates(count)'),
    supabase.from('locations').select(
      'id, students(count), lessons(count), teacher_schedule_templates(count), lesson_rates(count), curriculum_resources(count)'),
  ]);
  const used = (rows: Record<string, unknown>[]) =>
    rows.filter(r => Object.entries(r).some(([k, v]) => k !== 'id' && count(v) > 0)).map(r => r.id as string);
  return {
    instruments: used(unwrap(instr, []) as Record<string, unknown>[]),
    locations: used(unwrap(locs, []) as Record<string, unknown>[]),
  };
}

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
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const t = draft.trim();
    if (t && t !== name) {
      setBusy(true);
      try { await onRename(t); } finally { setBusy(false); }
    }
    setEditing(false);
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-4 py-2">
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className="flex-1 text-sm border border-teal rounded-lg px-3 py-1.5 focus:outline-none" />
        <button onClick={save} disabled={busy} className="text-teal disabled:opacity-50"><Check size={15} /></button>
        <button onClick={() => setEditing(false)} className="text-gray-400"><X size={15} /></button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 group">
      <button onClick={() => { setDraft(name); setEditing(true); }}
        className="text-sm text-navy hover:underline text-left flex-1">{name}</button>
      <button onClick={remove} disabled={deleteDisabled || busy}
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

  // Resync displayed value when server confirms a save (rate prop updates after loadRates)
  useEffect(() => {
    if (!saving) {
      setValue(rate ? String(rate.rate_per_lesson) : '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate?.id, rate?.rate_per_lesson]);

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
                : 'bg-white border-black/5 hover:border-gray-200 text-navy'
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

function RateEditor({ teacher, locations, categories, year, rates }: {
  teacher: Teacher;
  locations: Location[];
  categories: LessonCategoryRow[];
  year: string;
  rates: LessonRate[]; // this teacher's rates for `year`
}) {
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    locations[0]?.id ?? null
  );

  const rateMap = useMemo(() => {
    const map: Record<string, LessonRate> = {};
    for (const r of rates) map[rateKey(r.category, r.is_online ? null : r.location_id)] = r;
    return map;
  }, [rates]);

  // Reset to first location when teacher changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSelectedLocationId(locations[0]?.id ?? null);
  }, [teacher.id]);

  // Writes return the saved row, which goes straight into the cache.
  async function saveRate(category: string, locationId: string | null, value: number) {
    const isOnline = locationId === null;
    const existing = rateMap[rateKey(category, locationId)];
    const res = existing
      ? await supabase.from('lesson_rates').update({ rate_per_lesson: value }).eq('id', existing.id).select(RATE_COLUMNS).single()
      : await supabase.from('lesson_rates').insert({
          teacher_id: teacher.id,
          location_id: isOnline ? null : locationId,
          category,
          rate_per_lesson: value,
          is_online: isOnline,
          academic_year: year,
        }).select(RATE_COLUMNS).single();
    if (res.error) throw new Error(res.error.message);
    const saved = res.data as LessonRate;
    setQueryData<LessonRate[]>(RATES_KEY, prev => [...(prev ?? []).filter(r => r.id !== saved.id), saved]);
    afterRatesChange();
  }

  async function deleteRate(category: string, locationId: string | null) {
    const existing = rateMap[rateKey(category, locationId)];
    if (!existing) return;
    const { error } = await supabase
      .from('lesson_rates')
      .delete()
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
    setQueryData<LessonRate[]>(RATES_KEY, prev => (prev ?? []).filter(r => r.id !== existing.id));
    afterRatesChange();
  }

  const tabs: { id: string | null; label: string }[] = [
    ...locations.map(l => ({ id: l.id, label: l.name })),
    { id: null, label: 'Online' },
  ];

  return (
    <div className="bg-white rounded-xl border border-black/5 flex flex-col h-full">
      {/* Teacher name bar */}
      <div className="px-5 py-3 border-b border-black/5 bg-gray-50 rounded-t-xl flex items-center gap-2">
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
        {categories.length === 0 ? (
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

// ── InstrumentsTab ────────────────────────────────────────────────────────────

function InstrumentsTab({ instruments, inUse, onRefresh }: {
  instruments: Instrument[];
  inUse: Set<string>;
  onRefresh: () => void;
}) {
  const { showToast } = useToast();
  const [adding, setAdding] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function add() {
    const name = adding.trim();
    if (!name) return;
    setAddSaving(true); setAddError(null);
    const { error } = await supabase.from('instruments').insert({ name });
    setAddSaving(false);
    if (error) { setAddError(error.message); return; }
    setAdding('');
    onRefresh();
  }

  async function rename(id: string, name: string) {
    const { error } = await supabase.from('instruments').update({ name }).eq('id', id);
    if (error) { showToast('error', error.message); return; }
    onRefresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('instruments').delete().eq('id', id);
    if (error) { showToast('error', error.message); return; }
    onRefresh();
  }

  return (
    <div>
      {instruments.length === 0 && (
        <p className="text-sm text-gray-400 px-4 py-3">No instruments yet.</p>
      )}
      {instruments.map(i => (
        <EditableItem key={i.id} name={i.name}
          onRename={n => rename(i.id, n)}
          onDelete={() => remove(i.id)}
          deleteDisabled={inUse.has(i.id)} />
      ))}
      <div className="px-4 py-3 border-t border-black/5 flex gap-2">
        <input value={adding} onChange={e => { setAdding(e.target.value); setAddError(null); }}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="New instrument…"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
        <button onClick={add} disabled={addSaving || !adding.trim()}
          className="flex items-center gap-1 text-sm font-semibold text-white bg-teal px-3 py-1.5 rounded-lg hover:bg-teal/90 disabled:opacity-40">
          <Plus size={13} /> {addSaving ? 'Adding…' : 'Add'}
        </button>
      </div>
      {addError && <p className="text-xs text-red-500 px-4 pb-2">{addError}</p>}
    </div>
  );
}

// ── CategoriesTab ─────────────────────────────────────────────────────────────

function CategoriesTab({ categories, inUse, onRefresh }: {
  categories: LessonCategoryRow[];
  inUse: Set<string>;
  onRefresh: () => void;
}) {
  const { showToast } = useToast();
  const [adding, setAdding] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function add() {
    const name = adding.trim();
    if (!name) return;
    setAddSaving(true); setAddError(null);
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0);
    const { error } = await supabase.from('lesson_categories').insert({ name, sort_order: maxOrder + 1 });
    setAddSaving(false);
    if (error) { setAddError(error.message); return; }
    setAdding('');
    onRefresh();
  }

  async function rename(id: string, name: string) {
    const { error } = await supabase.from('lesson_categories').update({ name }).eq('id', id);
    if (error) { showToast('error', error.message); return; }
    onRefresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('lesson_categories').delete().eq('id', id);
    if (error) { showToast('error', error.message); return; }
    onRefresh();
  }

  return (
    <div>
      {categories.length === 0 && (
        <p className="text-sm text-gray-400 px-4 py-3">No categories yet.</p>
      )}
      {categories.map(c => (
        <EditableItem key={c.id} name={c.name}
          onRename={n => rename(c.id, n)}
          onDelete={() => remove(c.id)}
          deleteDisabled={inUse.has(c.name)} />
      ))}
      <div className="px-4 py-3 border-t border-black/5 flex gap-2">
        <input value={adding} onChange={e => { setAdding(e.target.value); setAddError(null); }}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="New category…"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
        <button onClick={add} disabled={addSaving || !adding.trim()}
          className="flex items-center gap-1 text-sm font-semibold text-white bg-teal px-3 py-1.5 rounded-lg hover:bg-teal/90 disabled:opacity-40">
          <Plus size={13} /> {addSaving ? 'Adding…' : 'Add'}
        </button>
      </div>
      {addError && <p className="text-xs text-red-500 px-4 pb-2">{addError}</p>}
    </div>
  );
}

// ── LocationsTab ──────────────────────────────────────────────────────────────

function LocationsTab({ locations, inUse, onRefresh }: {
  locations: Location[];
  inUse: Set<string>;
  onRefresh: () => void;
}) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: '', city: '', address: '', zone: '' });
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { name: string; city: string; address: string; zone: string }>>({});

  async function add() {
    if (!form.name.trim()) return;
    setSaving(true); setAddError(null);
    const { error } = await supabase.from('locations').insert({
      name: form.name.trim(), city: form.city.trim(),
      address: form.address.trim(), zone: form.zone.trim(),
    });
    setSaving(false);
    if (error) { setAddError(error.message); return; }
    setForm({ name: '', city: '', address: '', zone: '' });
    setFormOpen(false);
    onRefresh();
  }

  async function save(id: string) {
    const d = drafts[id];
    if (!d?.name.trim()) return;
    const { error } = await supabase.from('locations').update({
      name: d.name.trim(), city: d.city.trim(),
      address: d.address.trim(), zone: d.zone.trim(),
    }).eq('id', id);
    if (error) { showToast('error', error.message); return; }
    setEditing(null);
    onRefresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('locations').delete().eq('id', id);
    if (error) { showToast('error', error.message); return; }
    onRefresh();
  }

  return (
    <div>
      {locations.length === 0 && (
        <p className="text-sm text-gray-400 px-4 py-3">No locations yet.</p>
      )}
      {locations.map(loc => {
        if (editing === loc.id) {
          const d = drafts[loc.id] ?? { name: loc.name, city: loc.city ?? '', address: loc.address ?? '', zone: loc.zone ?? '' };
          return (
            <div key={loc.id} className="px-4 py-3 border-b border-gray-50 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400 mb-0.5 block">Name *</label>
                  <input autoFocus value={d.name}
                    onChange={e => setDrafts(ds => ({ ...ds, [loc.id]: { ...d, name: e.target.value } }))}
                    className="w-full text-sm border border-teal rounded-lg px-3 py-1.5 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-0.5 block">City</label>
                  <input value={d.city}
                    onChange={e => setDrafts(ds => ({ ...ds, [loc.id]: { ...d, city: e.target.value } }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-0.5 block">Address</label>
                  <input value={d.address}
                    onChange={e => setDrafts(ds => ({ ...ds, [loc.id]: { ...d, address: e.target.value } }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-0.5 block">Zone</label>
                  <input value={d.zone}
                    onChange={e => setDrafts(ds => ({ ...ds, [loc.id]: { ...d, zone: e.target.value } }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => save(loc.id)} disabled={!d.name.trim()}
                  className="flex items-center gap-1 text-sm font-semibold text-white bg-teal px-3 py-1.5 rounded-lg hover:bg-teal/90 disabled:opacity-40">
                  <Check size={13} /> Save
                </button>
                <button onClick={() => setEditing(null)}
                  className="text-sm text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100">Cancel</button>
              </div>
            </div>
          );
        }
        return (
          <div key={loc.id} className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 group">
            <div className="flex-1 min-w-0">
              <button onClick={() => {
                setDrafts(ds => ({ ...ds, [loc.id]: { name: loc.name, city: loc.city ?? '', address: loc.address ?? '', zone: loc.zone ?? '' } }));
                setEditing(loc.id);
              }} className="text-sm font-medium text-navy hover:underline text-left">{loc.name}</button>
              {(loc.city || loc.address) && (
                <p className="text-xs text-gray-400 truncate">
                  {[loc.address, loc.city, loc.zone].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
            <button onClick={() => remove(loc.id)} disabled={inUse.has(loc.id)}
              title={inUse.has(loc.id) ? 'In use — cannot delete' : 'Delete'}
              className="text-gray-300 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 transition-opacity ml-3">
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}

      {!formOpen ? (
        <div className="px-4 py-3 border-t border-black/5">
          <button onClick={() => setFormOpen(true)}
            className="flex items-center gap-1 text-sm font-medium text-teal hover:text-teal/80">
            <Plus size={13} /> Add location
          </button>
        </div>
      ) : (
        <div className="px-4 py-3 border-t border-black/5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400 mb-0.5 block">Name *</label>
              <input autoFocus value={form.name}
                onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setAddError(null); }}
                onKeyDown={e => e.key === 'Enter' && add()}
                placeholder="e.g. Bandra Studio"
                className="w-full text-sm border border-teal rounded-lg px-3 py-1.5 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-0.5 block">City</label>
              <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                placeholder="e.g. Mumbai"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-0.5 block">Address</label>
              <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="Street address"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-0.5 block">Zone</label>
              <input value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                placeholder="e.g. West"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
            </div>
          </div>
          {addError && <p className="text-xs text-red-500">{addError}</p>}
          <div className="flex gap-2">
            <button onClick={add} disabled={saving || !form.name.trim()}
              className="flex items-center gap-1 text-sm font-semibold text-white bg-teal px-3 py-1.5 rounded-lg hover:bg-teal/90 disabled:opacity-40">
              <Plus size={13} /> {saving ? 'Adding…' : 'Add Location'}
            </button>
            <button onClick={() => { setFormOpen(false); setForm({ name: '', city: '', address: '', zone: '' }); setAddError(null); }}
              className="text-sm text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminModal({ open, onClose, locations, instruments, categories,
  locationsInUse, instrumentsInUse, categoriesInUse, onRefresh }: {
  open: boolean;
  onClose: () => void;
  locations: Location[];
  instruments: Instrument[];
  categories: LessonCategoryRow[];
  locationsInUse: Set<string>;
  instrumentsInUse: Set<string>;
  categoriesInUse: Set<string>;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<'locations' | 'instruments' | 'categories'>('locations');

  if (!open) return null;

  const tabs = [
    { key: 'locations' as const, label: 'Locations', count: locations.length },
    { key: 'instruments' as const, label: 'Instruments', count: instruments.length },
    { key: 'categories' as const, label: 'Categories', count: categories.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <h2 className="text-base font-bold text-navy">Manage</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-0 px-5 pt-3 border-b border-black/5">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-teal text-teal'
                  : 'border-transparent text-gray-400 hover:text-navy'
              }`}>
              {t.label}
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${
                tab === t.key ? 'bg-teal/10 text-teal' : 'bg-gray-100 text-gray-400'
              }`}>{t.count}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'locations' && (
            <LocationsTab locations={locations} inUse={locationsInUse} onRefresh={onRefresh} />
          )}
          {tab === 'instruments' && (
            <InstrumentsTab instruments={instruments} inUse={instrumentsInUse} onRefresh={onRefresh} />
          )}
          {tab === 'categories' && (
            <CategoriesTab categories={categories} inUse={categoriesInUse} onRefresh={onRefresh} />
          )}
        </div>

        <div className="px-5 py-3 border-t border-black/5 flex justify-end">
          <button onClick={onClose}
            className="text-sm font-semibold text-white bg-navy px-4 py-2 rounded-lg hover:bg-navy/90">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── LessonRatesPage ───────────────────────────────────────────────────────────

export function LessonRatesPage() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);

  // 2 page queries (rates, categories) + shared cached reference lists.
  const { teachers, loading: teachersLoading, error: teachersError, refresh: refreshTeachers } = useTeachersList();
  const { locations } = useLocationsList();
  const { instruments } = useInstruments();
  const ratesQ = useQuery<LessonRate[]>(RATES_KEY, () =>
    fetchAll<LessonRate>((from, to) =>
      supabase.from('lesson_rates').select(RATE_COLUMNS).order('id').range(from, to)));
  const categoriesQ = useQuery<LessonCategoryRow[]>('lesson-rates:categories', async () =>
    unwrap(await supabase.from('lesson_categories').select('id, name, sort_order').order('sort_order'), []) as LessonCategoryRow[]);
  // Usage counts only matter for the Manage dialog's delete buttons.
  const usageQ = useQuery<Usage>(adminOpen ? 'lesson-rates:usage' : null, fetchUsage);

  const allRates = ratesQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const loading = teachersLoading || ratesQ.loading || categoriesQ.loading;
  const loadError = teachersError || ratesQ.error || categoriesQ.error;

  const yearRates = useMemo(() => allRates.filter(r => r.academic_year === year), [allRates, year]);
  const rateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of yearRates) if (r.teacher_id) counts[r.teacher_id] = (counts[r.teacher_id] ?? 0) + 1;
    return counts;
  }, [yearRates]);
  const categoriesInUse = useMemo(() => new Set(allRates.map(r => r.category)), [allRates]);
  // Until usage has loaded, treat everything as in use (deletes stay disabled).
  const instrumentsInUse = useMemo(() => new Set(usageQ.data?.instruments ?? instruments.map(i => i.id)), [usageQ.data, instruments]);
  const locationsInUse = useMemo(() => new Set(usageQ.data?.locations ?? locations.map(l => l.id)), [usageQ.data, locations]);

  useEffect(() => {
    if (!selectedTeacherId && teachers.length > 0) setSelectedTeacherId(teachers[0].id);
  }, [teachers, selectedTeacherId]);

  function refreshAdmin() {
    invalidateReference('instruments');
    invalidateReference('locations');
    invalidateQueries('lesson-rates:categories');
    invalidateQueries('lesson-rates:usage');
  }

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

      {loadError && <ErrorBanner message={loadError} onRetry={() => { refreshTeachers(); ratesQ.refresh(); categoriesQ.refresh(); }} />}

      {/* Body */}
      {loading ? (
        <SkeletonList rows={5} />
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
                rates={yearRates.filter(r => r.teacher_id === selectedTeacher.id)}
              />
            ) : (
              <p className="text-gray-400 text-sm">Select a teacher to edit rates.</p>
            )}
          </div>
        </div>
      )}

      <AdminModal
        key={adminOpen ? 'open' : 'closed'}
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        locations={locations}
        instruments={instruments}
        categories={categories}
        locationsInUse={locationsInUse}
        instrumentsInUse={instrumentsInUse}
        categoriesInUse={categoriesInUse}
        onRefresh={refreshAdmin}
      />
    </div>
  );
}
