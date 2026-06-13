# Enrolment Schedule Slot Assignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the enrolment creation modal into a 2-step wizard that assigns a student to a teacher schedule template slot and auto-generates lessons, so teachers see new students on their schedule immediately after enrolment.

**Architecture:** New `SlotPicker` component handles slot selection/creation. `Enrolments.tsx` gains wizard step state, `end_date` field, and an updated `handleCreate` that runs enrolment insert → slot assignment → lesson generation in sequence.

**Tech Stack:** React 19, TypeScript, Supabase JS client, Tailwind CSS, Lucide React

---

## File Map

| File | Action |
|------|--------|
| `web/src/components/SlotPicker.tsx` | Create — slot picker UI component |
| `web/src/pages/Enrolments.tsx` | Modify — wizard state, end_date, Step 2 UI, handleCreate |

---

### Task 1: Create `SlotPicker` component

**Files:**
- Create: `web/src/components/SlotPicker.tsx`

- [ ] **Step 1: Create the file with full implementation**

```tsx
// web/src/components/SlotPicker.tsx
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Instrument, TeacherScheduleTemplate } from '../types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type SelectedSlot = {
  mode: 'existing';
  templateId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string | null;
  instrumentId: string | null;
  title: string;
} | {
  mode: 'new';
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  instrumentId: string | null;
  title: string;
};

interface SlotPickerProps {
  teacherId: string;
  instruments: Instrument[];
  value: SelectedSlot | null;
  onChange: (slot: SelectedSlot | null) => void;
}

export function SlotPicker({ teacherId, instruments, value, onChange }: SlotPickerProps) {
  const [templates, setTemplates] = useState<TeacherScheduleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [newSlot, setNewSlot] = useState({
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '10:00',
    instrumentId: '',
    title: '',
  });

  useEffect(() => {
    if (!teacherId) { setTemplates([]); return; }
    setLoading(true);
    supabase
      .from('teacher_schedule_templates')
      .select('*')
      .eq('teacher_id', teacherId)
      .eq('is_active', true)
      .order('day_of_week')
      .order('start_time')
      .then(({ data }) => {
        setTemplates((data as TeacherScheduleTemplate[]) || []);
        setLoading(false);
      });
  }, [teacherId]);

  const isNewSelected = value?.mode === 'new';

  function selectExisting(tpl: TeacherScheduleTemplate) {
    onChange({
      mode: 'existing',
      templateId: tpl.id,
      dayOfWeek: tpl.day_of_week,
      startTime: tpl.start_time,
      endTime: tpl.end_time,
      instrumentId: tpl.instrument_id,
      title: tpl.title,
    });
  }

  function updateNewSlot(patch: Partial<typeof newSlot>) {
    const updated = { ...newSlot, ...patch };
    setNewSlot(updated);
    onChange({
      mode: 'new',
      dayOfWeek: updated.dayOfWeek,
      startTime: updated.startTime,
      endTime: updated.endTime,
      instrumentId: updated.instrumentId || null,
      title: updated.title,
    });
  }

  if (loading) return <p className="text-sm text-gray-400">Loading slots...</p>;

  // Group templates by day for display
  const byDay: Record<number, TeacherScheduleTemplate[]> = {};
  for (const t of templates) {
    if (!byDay[t.day_of_week]) byDay[t.day_of_week] = [];
    byDay[t.day_of_week].push(t);
  }

  return (
    <div className="space-y-2">
      {templates.length === 0 && (
        <p className="text-xs text-gray-400 mb-2">No existing slots for this teacher — create one below.</p>
      )}

      {/* Existing slots */}
      {[1, 2, 3, 4, 5, 6, 0].map((day) => {
        const slots = byDay[day];
        if (!slots) return null;
        return (
          <div key={day}>
            <p className="text-xs font-semibold text-gray-500 mb-1">{DAY_NAMES[day]}</p>
            {slots.map((tpl) => {
              const inst = instruments.find(i => i.id === tpl.instrument_id);
              const isSelected = value?.mode === 'existing' && value.templateId === tpl.id;
              return (
                <label
                  key={tpl.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer mb-1 transition-colors ${
                    isSelected
                      ? 'border-teal bg-teal/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="slot"
                    checked={isSelected}
                    onChange={() => selectExisting(tpl)}
                    className="text-teal"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-navy">
                      {tpl.start_time.slice(0, 5)}
                      {tpl.end_time ? ` – ${tpl.end_time.slice(0, 5)}` : ''}
                    </span>
                    <span className="text-sm text-gray-500 ml-2">{tpl.title || 'Lesson'}</span>
                    {inst && <span className="text-sm ml-1">{inst.icon}</span>}
                  </div>
                </label>
              );
            })}
          </div>
        );
      })}

      {/* Create new slot option */}
      <label
        className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
          isNewSelected ? 'border-coral bg-coral/5' : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <input
          type="radio"
          name="slot"
          checked={isNewSelected}
          onChange={() => updateNewSlot({})}
          className="mt-0.5 text-coral"
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-navy mb-2">+ Create new slot</p>
          {isNewSelected && (
            <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Day</label>
                  <select
                    value={newSlot.dayOfWeek}
                    onChange={(e) => updateNewSlot({ dayOfWeek: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 0].map(d => (
                      <option key={d} value={d}>{DAY_NAMES[d]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Start</label>
                  <input
                    type="time"
                    value={newSlot.startTime}
                    onChange={(e) => updateNewSlot({ startTime: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">End</label>
                  <input
                    type="time"
                    value={newSlot.endTime}
                    onChange={(e) => updateNewSlot({ endTime: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Instrument</label>
                  <select
                    value={newSlot.instrumentId}
                    onChange={(e) => updateNewSlot({ instrumentId: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="">None</option>
                    {instruments.map(i => (
                      <option key={i.id} value={i.id}>{i.icon} {i.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Title</label>
                  <input
                    value={newSlot.title}
                    onChange={(e) => updateNewSlot({ title: e.target.value })}
                    placeholder="e.g. Piano Lesson"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `web/` directory:
```bash
npx tsc --noEmit
```
Expected: no errors related to `SlotPicker.tsx`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SlotPicker.tsx
git commit -m "feat: add SlotPicker component for schedule slot assignment"
```

---

### Task 2: Update `Enrolments.tsx` — interfaces, state, and data fetching

**Files:**
- Modify: `web/src/pages/Enrolments.tsx`

- [ ] **Step 1: Update imports at top of file**

Add `SlotPicker` and `SelectedSlot` to imports. Add `ChevronRight` to lucide imports (already imported — verify it's there; if not, add it).

Replace the existing imports block at the top of `Enrolments.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SlotPicker } from '../components/SlotPicker';
import type { SelectedSlot } from '../components/SlotPicker';
import type { Profile, Instrument } from '../types';
import { Plus, X, RefreshCw, BookOpen, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
```

- [ ] **Step 2: Update the local `LessonRate` interface to include teacher `id`**

Find and replace the local `LessonRate` interface in `Enrolments.tsx`:

Old:
```tsx
interface LessonRate { id: string; category: string; rate_per_lesson: number; is_online: boolean; location_id: string | null; teacher?: { full_name: string } | null; }
```

New:
```tsx
interface LessonRate { id: string; teacher_id: string | null; category: string; rate_per_lesson: number; is_online: boolean; location_id: string | null; teacher?: { id: string; full_name: string } | null; }
```

- [ ] **Step 3: Add new state variables**

After the existing `useState` declarations (after line with `const [confirmDelete, setConfirmDelete] = useState`), add:

```tsx
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [manualTeacherId, setManualTeacherId] = useState('');
  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
```

- [ ] **Step 4: Add `end_date` to form state**

Replace the existing form `useState` initializer:

Old:
```tsx
  const [form, setForm] = useState({
    student_id: '',
    lesson_rate_id: '',
    payment_plan: '3_instalments',
    start_date: new Date().toISOString().split('T')[0],
    registration_fee: 0,
    academic_year: new Date().getFullYear().toString(),
  });
```

New:
```tsx
  const [form, setForm] = useState({
    student_id: '',
    lesson_rate_id: '',
    payment_plan: '3_instalments',
    start_date: new Date().toISOString().split('T')[0],
    end_date: (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      return d.toISOString().split('T')[0];
    })(),
    registration_fee: 0,
    academic_year: new Date().getFullYear().toString(),
  });
```

- [ ] **Step 5: Update `fetchAll` to also fetch teachers and instruments, and include teacher `id` in rates**

Replace the existing `fetchAll` function:

```tsx
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [enrolRes, studentRes, rateRes, teacherRes, instrumentRes] = await Promise.all([
        supabase.from('student_enrolments').select('*, student:students(id, full_name, instrument:instruments(name))').order('created_at', { ascending: false }),
        supabase.from('students').select('id, full_name, location_id, instrument:instruments(name)').eq('is_active', true).order('full_name'),
        supabase.from('lesson_rates').select('id, teacher_id, category, rate_per_lesson, is_online, location_id, teacher:profiles(id, full_name)').order('category'),
        supabase.from('profiles').select('id, full_name, role, email, phone, approved, created_at, updated_at').eq('role', 'teacher').order('full_name'),
        supabase.from('instruments').select('*').order('name'),
      ]);
      if (enrolRes.error) throw enrolRes.error;
      setEnrolments((enrolRes.data || []) as any);
      setStudents((studentRes.data || []) as any);
      setRates((rateRes.data || []) as any);
      setTeachers((teacherRes.data as Profile[]) || []);
      setInstruments((instrumentRes.data || []) as any);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
```

- [ ] **Step 6: Add computed `teacherId` and `teacherName` after existing computed values**

After the line `const totalFee = selectedRate ? selectedRate.rate_per_lesson * totalLessons : 0;`, add:

```tsx
  const teacherId = (selectedRate as any)?.teacher?.id || selectedRate?.teacher_id || manualTeacherId;
  const teacherName = teachers.find(t => t.id === teacherId)?.full_name
    || (selectedRate as any)?.teacher?.full_name
    || '';
  const rateHasNoTeacher = !!form.lesson_rate_id && !teacherId;
```

- [ ] **Step 7: Add Step 1 validation helper and modal close/reset helper**

After the computed values, add:

```tsx
  function handleStep1Next() {
    if (!form.student_id || (!form.lesson_rate_id && form.payment_plan !== 'trial')) {
      setError('Please select a student and lesson rate');
      return;
    }
    if (form.end_date <= form.start_date) {
      setError('End date must be after start date');
      return;
    }
    setError(null);
    setStep(2);
  }

  function closeModal() {
    setModal(false);
    setStep(1);
    setSelectedSlot(null);
    setManualTeacherId('');
    setGenerateResult(null);
    setError(null);
    setForm({
      student_id: '', lesson_rate_id: '', payment_plan: '3_instalments',
      start_date: new Date().toISOString().split('T')[0],
      end_date: (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        return d.toISOString().split('T')[0];
      })(),
      registration_fee: 0,
      academic_year: new Date().getFullYear().toString(),
    });
  }
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no new errors

- [ ] **Step 9: Commit**

```bash
git add web/src/pages/Enrolments.tsx
git commit -m "feat: add wizard state and data fetching to Enrolments"
```

---

### Task 3: Update `Enrolments.tsx` — modal wizard UI

**Files:**
- Modify: `web/src/pages/Enrolments.tsx`

- [ ] **Step 1: Replace the modal JSX**

Find the entire `{/* Create Modal */}` section (from `{modal && (` to its closing `)}`) and replace it with:

```tsx
      {/* Create Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-navy text-lg">Enrol Student</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Step {step} of 2 — {step === 1 ? 'Enrolment Details' : 'Assign Schedule Slot'}
                </p>
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-2">
              <div className={`flex-1 h-1 rounded-full ${step >= 1 ? 'bg-teal' : 'bg-gray-200'}`} />
              <div className={`flex-1 h-1 rounded-full ${step >= 2 ? 'bg-teal' : 'bg-gray-200'}`} />
            </div>

            {error && (
              <div className="bg-coral/10 border border-coral/20 rounded-lg p-3">
                <p className="text-coral text-sm">{error}</p>
              </div>
            )}

            {/* ── STEP 1 ── */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Student</label>
                  <select
                    required
                    value={form.student_id}
                    onChange={(e) => setForm({ ...form, student_id: e.target.value, lesson_rate_id: '' })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select student...</option>
                    {availableStudents.map((s) => (
                      <option key={s.id} value={s.id}>{s.full_name}{s.instrument ? ` (${s.instrument.name})` : ''}</option>
                    ))}
                  </select>
                  {availableStudents.length === 0 && (
                    <p className="text-xs text-gray-400 mt-1">No active students found</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Lesson Rate</label>
                  {selectedStudent?.location_id && hasLocationRates && (
                    <p className="text-xs text-teal mb-1">Showing rates for this student's location first.</p>
                  )}
                  {selectedStudent?.location_id && !hasLocationRates && (
                    <p className="text-xs text-yellow-600 mb-1">No location-specific rates set — showing all rates.</p>
                  )}
                  <select
                    value={form.lesson_rate_id}
                    onChange={(e) => setForm({ ...form, lesson_rate_id: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select rate...</option>
                    {filteredRates.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.category} — ₹{Number(r.rate_per_lesson).toLocaleString('en-IN')}
                        {r.is_online ? ' (Online)' : ''}
                        {r.teacher ? ` — ${r.teacher.full_name}` : ''}
                        {r.location_id ? ' ★' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Payment Plan</label>
                    <select
                      value={form.payment_plan}
                      onChange={(e) => setForm({ ...form, payment_plan: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    >
                      {PLAN_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
                    <input
                      type="text"
                      value={form.academic_year}
                      onChange={(e) => setForm({ ...form, academic_year: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={form.start_date}
                      onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
                    <input
                      type="date"
                      value={form.end_date}
                      onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Registration Fee (₹)</label>
                  <input
                    type="number"
                    value={form.registration_fee}
                    onChange={(e) => setForm({ ...form, registration_fee: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="500"
                    min={0}
                  />
                </div>

                {/* Fee Summary */}
                {selectedRate && form.payment_plan !== 'trial' && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase">Fee Summary</h4>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">₹{Number(selectedRate.rate_per_lesson).toLocaleString('en-IN')} × {totalLessons} lessons</span>
                      <span className="font-medium text-navy">₹{totalFee.toLocaleString('en-IN')}</span>
                    </div>
                    {form.registration_fee > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Registration fee</span>
                        <span className="font-medium text-navy">₹{form.registration_fee.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    <div className="border-t pt-2 flex justify-between text-sm font-bold">
                      <span className="text-navy">Total</span>
                      <span className="text-navy">₹{(totalFee + form.registration_fee).toLocaleString('en-IN')}</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {form.payment_plan === '1_instalment' && '1 payment at start'}
                      {form.payment_plan === '3_instalments' && '3 payments: start, +4 months, +8 months'}
                      {form.payment_plan === '10_instalments' && '10 monthly payments'}
                    </p>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleStep1Next}
                    className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 flex items-center justify-center gap-2"
                  >
                    Next <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2 ── */}
            {step === 2 && (
              <div className="space-y-4">
                {/* Teacher display / picker */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Teacher</label>
                  {teacherId ? (
                    <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-navy font-medium">
                      {teacherName}
                    </div>
                  ) : (
                    <select
                      value={manualTeacherId}
                      onChange={(e) => setManualTeacherId(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Select teacher...</option>
                      {teachers.map(t => (
                        <option key={t.id} value={t.id}>{t.full_name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Slot picker — only show once teacher is known */}
                {(teacherId) && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">Schedule Slot</label>
                    <SlotPicker
                      teacherId={teacherId}
                      instruments={instruments}
                      value={selectedSlot}
                      onChange={setSelectedSlot}
                    />
                  </div>
                )}

                {generateResult && (
                  <div className={`rounded-lg p-3 text-sm font-medium ${
                    generateResult.startsWith('Error') ? 'bg-coral/10 text-coral' : 'bg-teal/10 text-teal'
                  }`}>
                    {generateResult}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setStep(1); setError(null); setGenerateResult(null); }}
                    className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={saving || !selectedSlot || (!teacherId)}
                    className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
                  >
                    {saving ? 'Creating...' : 'Save & Generate Lessons'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Enrolments.tsx
git commit -m "feat: convert enrolment modal to 2-step wizard with slot picker"
```

---

### Task 4: Update `handleCreate` — slot assignment + lesson generation

**Files:**
- Modify: `web/src/pages/Enrolments.tsx`

- [ ] **Step 1: Replace the `handleCreate` function**

Find the existing `handleCreate` function (starts with `async function handleCreate(e: React.FormEvent)`) and replace it entirely:

```tsx
  async function handleCreate() {
    if (!form.student_id || (!form.lesson_rate_id && form.payment_plan !== 'trial')) {
      setError('Please select a student and lesson rate');
      return;
    }
    if (!selectedSlot) {
      setError('Please select or create a schedule slot');
      return;
    }
    const resolvedTeacherId = teacherId;
    if (!resolvedTeacherId) {
      setError('Please select a teacher');
      return;
    }

    setSaving(true);
    setError(null);
    setGenerateResult(null);

    try {
      // 1. Create enrolment
      const { data: enrolment, error: enrolErr } = await supabase
        .from('student_enrolments')
        .insert({
          student_id: form.student_id,
          academic_year: form.academic_year,
          lesson_rate_id: form.lesson_rate_id || null,
          total_lessons: totalLessons,
          lessons_used: 0,
          start_date: form.start_date,
          payment_plan: form.payment_plan,
          rate_per_lesson: selectedRate?.rate_per_lesson || 0,
          total_fee: totalFee,
          registration_fee: form.registration_fee,
        })
        .select()
        .single();

      if (enrolErr) throw enrolErr;

      // 2. Auto-generate payment instalments
      if (form.payment_plan !== 'trial' && enrolment) {
        const { error: genErr } = await supabase.rpc('generate_instalments', {
          p_enrolment_id: enrolment.id,
        });
        if (genErr) throw genErr;
      }

      // 3. Assign student to schedule template slot
      let templateDayOfWeek: number;
      let templateStartTime: string;
      let templateEndTime: string | null;
      let templateInstrumentId: string | null;
      let templateTitle: string;

      if (selectedSlot.mode === 'existing') {
        // Append student to existing template
        const { data: tpl, error: tplErr } = await supabase
          .from('teacher_schedule_templates')
          .select('student_ids')
          .eq('id', selectedSlot.templateId)
          .single();
        if (tplErr) throw tplErr;

        const existingIds: string[] = tpl?.student_ids || [];
        if (!existingIds.includes(form.student_id)) {
          const { error: updateErr } = await supabase
            .from('teacher_schedule_templates')
            .update({ student_ids: [...existingIds, form.student_id] })
            .eq('id', selectedSlot.templateId);
          if (updateErr) throw updateErr;
        }

        templateDayOfWeek = selectedSlot.dayOfWeek;
        templateStartTime = selectedSlot.startTime;
        templateEndTime = selectedSlot.endTime;
        templateInstrumentId = selectedSlot.instrumentId;
        templateTitle = selectedSlot.title;
      } else {
        // Create new template with this student
        const { error: insertErr } = await supabase
          .from('teacher_schedule_templates')
          .insert({
            teacher_id: resolvedTeacherId,
            day_of_week: selectedSlot.dayOfWeek,
            start_time: selectedSlot.startTime,
            end_time: selectedSlot.endTime || null,
            instrument_id: selectedSlot.instrumentId || null,
            title: selectedSlot.title || 'Lesson',
            student_ids: [form.student_id],
          });
        if (insertErr) throw insertErr;

        templateDayOfWeek = selectedSlot.dayOfWeek;
        templateStartTime = selectedSlot.startTime;
        templateEndTime = selectedSlot.endTime || null;
        templateInstrumentId = selectedSlot.instrumentId;
        templateTitle = selectedSlot.title || 'Lesson';
      }

      // 4. Generate lessons from start_date to end_date, cap at totalLessons
      const startDate = new Date(form.start_date + 'T00:00:00');
      const endDate = new Date(form.end_date + 'T00:00:00');
      let created = 0;
      let skipped = 0;
      const current = new Date(startDate);

      while (current <= endDate && created < totalLessons) {
        if (current.getDay() === templateDayOfWeek) {
          const dateStr = current.toISOString().split('T')[0];

          // Skip if lesson already exists at same teacher/date/time
          const { data: existing } = await supabase
            .from('lessons')
            .select('id')
            .eq('teacher_id', resolvedTeacherId)
            .eq('date', dateStr)
            .eq('start_time', templateStartTime)
            .limit(1);

          if (existing && existing.length > 0) {
            skipped++;
          } else {
            const { data: lesson, error: lessonErr } = await supabase
              .from('lessons')
              .insert({
                teacher_id: resolvedTeacherId,
                location_id: null,
                instrument_id: templateInstrumentId || null,
                lesson_type: 'regular',
                date: dateStr,
                start_time: templateStartTime,
                end_time: templateEndTime,
                title: templateTitle,
              })
              .select()
              .single();

            if (!lessonErr && lesson) {
              await supabase.from('lesson_students').insert({
                lesson_id: lesson.id,
                student_id: form.student_id,
              });
              created++;
            } else {
              skipped++;
            }
          }
        }
        current.setDate(current.getDate() + 1);
      }

      const resultMsg = `Enrolment created. ${created} lesson${created !== 1 ? 's' : ''} generated${skipped > 0 ? `, ${skipped} skipped` : ''}.`;
      setGenerateResult(resultMsg);

      // Brief pause so user sees the result, then close
      await new Promise(r => setTimeout(r, 1800));
      closeModal();
      fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to create enrolment');
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Remove the `<form onSubmit={handleCreate}>` wrapper in Step 1 JSX**

In the Step 1 JSX you added in Task 3, the content is inside a `<div className="space-y-4">` (not a `<form>`). Verify no `<form>` tags wrap the Step 1 content — `handleCreate` is now called as a plain function from the button's `onClick`. The original modal had `<form onSubmit={handleCreate}>` — make sure that's gone.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Enrolments.tsx
git commit -m "feat: enrolment handleCreate assigns schedule slot and auto-generates lessons"
```

---

### Task 5: Manual verification

**Files:** None

- [ ] **Step 1: Start the dev server**

From `web/` directory:
```bash
npm run dev
```

- [ ] **Step 2: Test the full happy path**

1. Log in as coordinator
2. Go to Enrolments page
3. Click "New Enrolment"
4. Step 1: pick a student, pick a lesson rate that has a teacher, pick payment plan, set start date and end date (e.g. 3 months out), click Next
5. Step 2: should show teacher name (read-only). If teacher has existing slots, they appear. Pick one OR click "+ Create new slot" and fill in day/time.
6. Click "Save & Generate Lessons"
7. Verify success message shows e.g. "Enrolment created. 12 lessons generated."
8. Go to Teacher Schedule page as that teacher — verify lessons appear on the correct day of week

- [ ] **Step 3: Test edge cases**

1. Lesson rate with no teacher → Step 2 shows teacher dropdown; pick teacher manually; then slot picker loads
2. End date before start date → Step 1 "Next" shows error, does not advance
3. No slot selected → "Save & Generate Lessons" is disabled (greyed out)
4. Trial payment plan → only 1 lesson generated

- [ ] **Step 4: Final commit if any polish fixes were needed**

```bash
git add -p
git commit -m "fix: enrolment wizard polish"
```
