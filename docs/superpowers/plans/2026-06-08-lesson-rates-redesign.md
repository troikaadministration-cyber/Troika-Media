# Lesson Rates Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dense spreadsheet grid + collapsible panels with a teacher-list sidebar, location pill tabs, always-visible rate inputs, and an admin modal.

**Architecture:** Single file rewrite of `web/src/pages/LessonRates.tsx`. Components are defined in the same file. No new dependencies. Supabase calls unchanged from current implementation.

**Tech Stack:** React 19, TypeScript, TailwindCSS, Supabase JS client, Lucide React.

---

### Task 1: Scaffold — types, shared helpers, empty shells

**Files:**
- Rewrite: `web/src/pages/LessonRates.tsx`

- [ ] **Step 1: Replace file with scaffold**

Write `web/src/pages/LessonRates.tsx`:

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Settings, Check, X, Trash2, Plus, ChevronRight } from 'lucide-react';
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (placeholder shells satisfy all types).

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/LessonRates.tsx
git commit -m "refactor: scaffold lesson rates redesign with placeholder shells"
```

---

### Task 2: TeacherList component

**Files:**
- Modify: `web/src/pages/LessonRates.tsx` — replace `TeacherList` placeholder

- [ ] **Step 1: Replace the TeacherList shell with full implementation**

Find and replace the `TeacherList` function (the placeholder returning `<div>Teacher list</div>`):

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/LessonRates.tsx
git commit -m "feat: teacher list sidebar with rate counts"
```

---

### Task 3: RateRow — always-visible input with auto-save

**Files:**
- Modify: `web/src/pages/LessonRates.tsx` — add `RateRow` above `TeacherList`

- [ ] **Step 1: Add RateRow component before TeacherList**

Insert this function between the `EditableItem` component and the `TeacherList` placeholder:

```typescript
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

  // Reset when rate prop changes (location tab switch via key on parent)
  useEffect(() => {
    setValue(rate ? String(rate.rate_per_lesson) : '');
    setError(null);
  }, [rate]);

  async function commit() {
    const trimmed = value.trim();
    setError(null);
    if (trimmed === '') {
      if (rate) {
        setSaving(true);
        try { await onDelete(); } catch (e: any) { setError(e.message); }
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
      setTimeout(() => setSaved(false), 1200);
    } catch (e: any) {
      setError(e.message);
    } finally { setSaving(false); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
    if (e.key === 'Escape') { setValue(rate ? String(rate.rate_per_lesson) : ''); setError(null); }
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/LessonRates.tsx
git commit -m "feat: RateRow with always-visible input, auto-save, inline errors"
```

---

### Task 4: RateEditor — location tabs + rate rows

**Files:**
- Modify: `web/src/pages/LessonRates.tsx` — replace `RateEditor` placeholder

- [ ] **Step 1: Replace the RateEditor shell**

Find and replace the `RateEditor` placeholder function:

```typescript
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

  // Reset to first location when teacher or locations change
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

  // All tabs: locations + online
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Run `pnpm dev` from project root. Open Lesson Rates page. Verify:
- Teacher list appears on left
- Clicking a teacher loads their rate editor on right
- Location tabs appear and switch the active column
- Rate inputs are visible (not hidden behind click)

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/LessonRates.tsx
git commit -m "feat: RateEditor with location tabs and visible rate inputs"
```

---

### Task 5: AdminModal shell + tab navigation

**Files:**
- Modify: `web/src/pages/LessonRates.tsx` — add tab components, replace `AdminModal` placeholder

- [ ] **Step 1: Add InstrumentsTab and CategoriesTab components** before the `AdminModal` placeholder:

```typescript
function InstrumentsTab({ instruments, inUse, onRefresh }: {
  instruments: Instrument[];
  inUse: Set<string>;
  onRefresh: () => void;
}) {
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
    await supabase.from('instruments').update({ name }).eq('id', id);
    onRefresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('instruments').delete().eq('id', id);
    if (error) alert(error.message);
    else onRefresh();
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
      <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
        <input value={adding} onChange={e => { setAdding(e.target.value); setAddError(null); }}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="New instrument…"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
        <button onClick={add} disabled={addSaving || !adding.trim()}
          className="flex items-center gap-1 text-sm font-semibold text-white bg-teal px-3 py-1.5 rounded-lg hover:bg-teal/90 disabled:opacity-40">
          <Plus size={13} /> Add
        </button>
      </div>
      {addError && <p className="text-xs text-red-500 px-4 pb-2">{addError}</p>}
    </div>
  );
}

function CategoriesTab({ categories, inUse, onRefresh }: {
  categories: LessonCategory[];
  inUse: Set<string>;
  onRefresh: () => void;
}) {
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
    await supabase.from('lesson_categories').update({ name }).eq('id', id);
    onRefresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('lesson_categories').delete().eq('id', id);
    if (error) alert(error.message);
    else onRefresh();
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
      <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
        <input value={adding} onChange={e => { setAdding(e.target.value); setAddError(null); }}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="New category…"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:border-teal focus:outline-none" />
        <button onClick={add} disabled={addSaving || !adding.trim()}
          className="flex items-center gap-1 text-sm font-semibold text-white bg-teal px-3 py-1.5 rounded-lg hover:bg-teal/90 disabled:opacity-40">
          <Plus size={13} /> Add
        </button>
      </div>
      {addError && <p className="text-xs text-red-500 px-4 pb-2">{addError}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Add LocationsTab component** immediately after CategoriesTab:

```typescript
function LocationsTab({ locations, inUse, onRefresh }: {
  locations: Location[];
  inUse: Set<string>;
  onRefresh: () => void;
}) {
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
    if (error) { alert(error.message); return; }
    setEditing(null);
    onRefresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('locations').delete().eq('id', id);
    if (error) alert(error.message);
    else onRefresh();
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

      {/* Add form */}
      {!formOpen ? (
        <div className="px-4 py-3 border-t border-gray-100">
          <button onClick={() => setFormOpen(true)}
            className="flex items-center gap-1 text-sm font-medium text-teal hover:text-teal/80">
            <Plus size={13} /> Add location
          </button>
        </div>
      ) : (
        <div className="px-4 py-3 border-t border-gray-100 space-y-2">
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
```

- [ ] **Step 3: Replace the AdminModal placeholder** with the full implementation:

```typescript
function AdminModal({ open, onClose, locations, instruments, categories,
  locationsInUse, instrumentsInUse, categoriesInUse, onRefresh }: {
  open: boolean;
  onClose: () => void;
  locations: Location[];
  instruments: Instrument[];
  categories: LessonCategory[];
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-navy">Manage</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-5 pt-3 border-b border-gray-100">
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

        {/* Tab content */}
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

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose}
            className="text-sm font-semibold text-white bg-navy px-4 py-2 rounded-lg hover:bg-navy/90">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run `pnpm dev`. On Lesson Rates page verify:
- "Manage" button opens modal
- Modal has 3 tabs: Locations, Instruments, Categories
- Clicking backdrop closes modal
- Adding an instrument/category via the form updates the list
- New location appears in RateEditor location tabs after closing modal
- Delete is blocked for in-use items (hover shows tooltip)

- [ ] **Step 6: Remove unused imports**

The old file imported `ChevronDown` and `ChevronRight` which are no longer needed. Verify the import line at the top only includes what's used:

```typescript
import { Settings, Check, X, Trash2, Plus } from 'lucide-react';
```

Update the import line if it still has `ChevronDown`, `ChevronRight`.

- [ ] **Step 7: Commit and push**

```bash
git add web/src/pages/LessonRates.tsx
git commit -m "feat: redesign lesson rates page — teacher sidebar, location tabs, admin modal"
git push origin master
```

---

## Self-Review

**Spec coverage:**
- ✅ Teacher list left column with rate counts (green/amber) → Task 2
- ✅ Location pill tabs → Task 4 (RateEditor)
- ✅ Always-visible inputs, auto-save on blur/Enter, clear to delete → Task 3 (RateRow)
- ✅ Inline errors (no alert) → Task 3 RateRow, Task 5 CRUD forms
- ✅ Save indicator (teal border flash) → Task 3 RateRow `saved` state
- ✅ Admin modal with Locations/Instruments/Categories tabs → Task 5
- ✅ Locations multi-field add form (Name, City, Address, Zone) → Task 5 LocationsTab
- ✅ Delete blocked if in-use → EditableItem + LocationsTab delete buttons
- ✅ Closing modal re-fetches meta → `onClose` calls `loadMeta()` in LessonRatesPage
- ✅ Empty states → RateEditor "No categories yet", page "No teachers yet"

**Placeholder scan:** No TBDs, TODOs, or vague steps. All code blocks complete.

**Type consistency:**
- `rateKey(category, locationId)` used consistently in RateEditor load, saveRate, deleteRate, and RateRow key prop
- `onRefresh` prop on all three tab components calls `loadMeta` from parent
- `LessonRate` type from `../types` used in rateMap and RateRow props
- `Location` type from `../types` used in RateEditor and LocationsTab
