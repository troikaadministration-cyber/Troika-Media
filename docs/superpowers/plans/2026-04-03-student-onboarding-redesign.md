# Student Onboarding Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 3-step onboarding wizard that takes a student from sign-up (or admin entry) through enrolment and class assignment in one guided flow, plus a pending approval banner on the Students page, and a redesigned Student Detail page with inline editing.

**Architecture:** A new `OnboardingWizard` component handles all wizard state locally across 3 steps, writing to the DB only at step boundaries (profile approval + student insert at step 1, enrolment + schedule templates at step 3 confirm). `Students.tsx` gains a pending-profiles banner and wires the "Add Student" button to the wizard. `StudentDetail.tsx` gains info tiles, an Edit modal, and a Deactivate/Activate toggle.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Supabase JS client (`@supabase/supabase-js`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `admin/src/components/OnboardingWizard.tsx` | Create | 3-step wizard: student info → payment plan → classes + fee |
| `admin/src/pages/Students.tsx` | Modify | Pending banner, wire Add Student, redesigned table columns |
| `admin/src/pages/StudentDetail.tsx` | Modify | Info tiles, Edit modal, Deactivate/Activate button |

---

### Task 1: OnboardingWizard — skeleton, types, and Step 1 UI

**Files:**
- Create: `admin/src/components/OnboardingWizard.tsx`

- [ ] **Step 1: Create the file with all types and Step 1 form**

Create `admin/src/components/OnboardingWizard.tsx` with the full contents below:

```tsx
import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

interface PendingProfile {
  id: string;
  full_name: string;
  email: string;
}

export interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  pendingProfile?: PendingProfile | null;
}

interface Instrument { id: string; name: string; }
interface Location { id: string; name: string; }
interface Teacher { id: string; full_name: string; }
interface LessonRate { id: string; teacher_id: string | null; location_id: string | null; category: string; rate_per_lesson: number; is_online: boolean; }

interface ClassRow {
  teacher_id: string;
  category: string;
  day_of_week: string; // '0'–'5' (Mon–Sat)
  start_time: string;
  end_time: string;
  rate: string; // string for input, parsed on save
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CATEGORIES: { value: string; label: string }[] = [
  { value: '1:1_instrumental', label: '1:1 Instrumental' },
  { value: '1:1_theory',       label: '1:1 Theory' },
  { value: '1:1_vocals',       label: '1:1 Vocals' },
  { value: 'group_strings',    label: 'Group: Strings' },
  { value: 'group_guitar',     label: 'Group: Guitar' },
  { value: 'group_vocals',     label: 'Group: Vocals' },
  { value: 'group_theory',     label: 'Group: Theory' },
];

const PAYMENT_PLANS = [
  { value: 'trial',          label: 'Trial (no payment)' },
  { value: '1_instalment',   label: '1 Instalment' },
  { value: '3_instalments',  label: '3 Instalments' },
  { value: '10_instalments', label: '10 Instalments' },
];

const TOTAL_LESSONS = (plan: string) => plan === 'trial' ? 1 : 39;

function emptyClass(): ClassRow {
  return { teacher_id: '', category: '1:1_instrumental', day_of_week: '0', start_time: '09:00', end_time: '10:00', rate: '' };
}

// ── Step indicator ───────────────────────────────────────────────────────────

function StepBar({ step }: { step: number }) {
  const steps = ['Student Info', 'Payment Plan', 'Classes & Fee'];
  return (
    <div className="flex items-center mb-6">
      {steps.map((label, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mb-1 ${
              i < step ? 'bg-teal text-white' : i === step ? 'bg-teal text-white ring-2 ring-teal/30' : 'bg-gray-200 text-gray-400'
            }`}>
              {i < step ? '✓' : i + 1}
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${i <= step ? 'text-teal' : 'text-gray-400'}`}>{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-4 ${i < step ? 'bg-teal' : 'bg-gray-200'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function OnboardingWizard({ open, onClose, onComplete, pendingProfile }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Meta
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [allRates, setAllRates] = useState<LessonRate[]>([]);

  // Step 1 state
  const [s1, setS1] = useState({
    full_name: pendingProfile?.full_name ?? '',
    phone: '',
    email: pendingProfile?.email ?? '',
    instrument_id: '',
    location_id: '',
  });
  const [studentId, setStudentId] = useState<string | null>(null);

  // Step 2 state
  const [s2, setS2] = useState({
    payment_plan: '3_instalments',
    academic_year: new Date().getFullYear().toString(),
    registration_fee: '0',
  });

  // Step 3 state
  const [classes, setClasses] = useState<ClassRow[]>([emptyClass()]);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setStep(0);
      setError(null);
      setStudentId(null);
      setS1({ full_name: pendingProfile?.full_name ?? '', phone: '', email: pendingProfile?.email ?? '', instrument_id: '', location_id: '' });
      setS2({ payment_plan: '3_instalments', academic_year: new Date().getFullYear().toString(), registration_fee: '0' });
      setClasses([emptyClass()]);
    }
  }, [open, pendingProfile]);

  // Load meta on mount
  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from('instruments').select('id, name').order('name'),
      supabase.from('locations').select('id, name').order('name'),
      supabase.from('profiles').select('id, full_name').eq('role', 'teacher').order('full_name'),
      supabase.from('lesson_rates').select('id, teacher_id, location_id, category, rate_per_lesson, is_online'),
    ]).then(([iRes, lRes, tRes, rRes]) => {
      setInstruments(iRes.data ?? []);
      setLocations(lRes.data ?? []);
      setTeachers(tRes.data ?? []);
      setAllRates((rRes.data ?? []) as LessonRate[]);
    });
  }, [open]);

  if (!open) return null;

  // ── Step 1 handlers ────────────────────────────────────────────────────────

  async function handleStep1Next() {
    if (!s1.full_name.trim()) { setError('Full name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      // Approve pending profile if applicable
      if (pendingProfile) {
        const { error: approveErr } = await supabase
          .from('profiles')
          .update({ approved: true })
          .eq('id', pendingProfile.id);
        if (approveErr) throw approveErr;
      }
      // Create student record
      const { data, error: studentErr } = await supabase
        .from('students')
        .insert({
          user_id: pendingProfile?.id ?? null,
          full_name: s1.full_name.trim(),
          phone: s1.phone.trim() || null,
          email: s1.email.trim() || null,
          instrument_id: s1.instrument_id || null,
          location_id: s1.location_id || null,
          is_active: true,
          payment_plan: '3_instalments',
        })
        .select('id')
        .single();
      if (studentErr) throw studentErr;
      setStudentId(data.id);
      setStep(1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Step 2 handlers ────────────────────────────────────────────────────────

  function handleStep2Next() {
    setStep(2);
  }

  // ── Step 3 helpers ─────────────────────────────────────────────────────────

  function autoRate(teacherId: string, category: string): string {
    const isOnline = s1.location_id === '';
    const match = allRates.find(r =>
      r.teacher_id === teacherId &&
      r.category === category &&
      (isOnline ? r.is_online : r.location_id === s1.location_id)
    );
    return match ? String(match.rate_per_lesson) : '';
  }

  function updateClass(idx: number, patch: Partial<ClassRow>) {
    setClasses(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      const updated = { ...c, ...patch };
      // Auto-fill rate when teacher or category changes
      if ((patch.teacher_id !== undefined || patch.category !== undefined)) {
        const tId = patch.teacher_id ?? c.teacher_id;
        const cat = patch.category ?? c.category;
        if (tId) updated.rate = autoRate(tId, cat);
      }
      return updated;
    }));
  }

  function addClass() {
    setClasses(prev => [...prev, emptyClass()]);
  }

  function removeClass(idx: number) {
    setClasses(prev => prev.filter((_, i) => i !== idx));
  }

  const totalLessons = TOTAL_LESSONS(s2.payment_plan);
  const totalRatePerLesson = classes.reduce((sum, c) => sum + (parseFloat(c.rate) || 0), 0);
  const regFee = parseFloat(s2.registration_fee) || 0;
  const totalFee = totalRatePerLesson * totalLessons + regFee;

  // ── Step 3 confirm ─────────────────────────────────────────────────────────

  async function handleConfirm(skip = false) {
    if (!studentId) return;
    setSaving(true);
    setError(null);
    try {
      const ratePerLesson = skip ? 0 : totalRatePerLesson;
      const fee = skip ? 0 : totalFee;

      // Create enrolment
      const { data: enrolment, error: enrolErr } = await supabase
        .from('student_enrolments')
        .insert({
          student_id: studentId,
          academic_year: s2.academic_year,
          lesson_rate_id: null,
          total_lessons: totalLessons,
          lessons_used: 0,
          start_date: new Date().toISOString().split('T')[0],
          payment_plan: s2.payment_plan,
          rate_per_lesson: ratePerLesson,
          total_fee: fee,
          registration_fee: regFee,
        })
        .select('id')
        .single();
      if (enrolErr) throw enrolErr;

      // Generate instalments
      if (s2.payment_plan !== 'trial') {
        const { error: genErr } = await supabase.rpc('generate_instalments', { p_enrolment_id: enrolment.id });
        if (genErr) throw genErr;
      }

      // Create schedule templates (skip if no classes or skip=true)
      if (!skip && classes.length > 0) {
        for (const cls of classes) {
          if (!cls.teacher_id) continue;
          const instrName = instruments.find(i => i.id === s1.instrument_id)?.name ?? '';
          await supabase.from('teacher_schedule_templates').insert({
            teacher_id: cls.teacher_id,
            day_of_week: Number(cls.day_of_week),
            start_time: cls.start_time,
            end_time: cls.end_time || null,
            location_id: s1.location_id || null,
            instrument_id: s1.instrument_id || null,
            title: `${s1.full_name} – ${instrName}`,
            student_ids: [studentId],
            is_active: true,
          });
        }
      }

      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-navy">
            {pendingProfile ? `Approve & Onboard — ${pendingProfile.full_name}` : 'Add New Student'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy"><X size={20} /></button>
        </div>

        <StepBar step={step} />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600 mb-4">{error}</div>
        )}

        {/* ── STEP 1 ── */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Full Name <span className="text-coral">*</span></label>
                <input
                  type="text"
                  value={s1.full_name}
                  onChange={e => setS1(p => ({ ...p, full_name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="Student's full name"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Phone</label>
                <input
                  type="tel"
                  value={s1.phone}
                  onChange={e => setS1(p => ({ ...p, phone: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="+91 98765 43210"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  value={s1.email}
                  onChange={e => setS1(p => ({ ...p, email: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="student@email.com"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Instrument</label>
                <select
                  value={s1.instrument_id}
                  onChange={e => setS1(p => ({ ...p, instrument_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                >
                  <option value="">Select instrument</option>
                  {instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Location</label>
                <select
                  value={s1.location_id}
                  onChange={e => setS1(p => ({ ...p, location_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                >
                  <option value="">Select location</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={handleStep1Next}
                disabled={saving || !s1.full_name.trim()}
                className="flex items-center gap-2 bg-teal text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Next: Payment Plan'} <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2 ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Payment Plan</label>
                <select
                  value={s2.payment_plan}
                  onChange={e => setS2(p => ({ ...p, payment_plan: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                >
                  {PAYMENT_PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Academic Year</label>
                <input
                  type="text"
                  value={s2.academic_year}
                  onChange={e => setS2(p => ({ ...p, academic_year: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Registration Fee (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={s2.registration_fee}
                  onChange={e => setS2(p => ({ ...p, registration_fee: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-500">
              Fee total will be calculated in the next step once classes are assigned.
            </div>
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(0)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-navy"><ChevronLeft size={16} /> Back</button>
              <button
                onClick={handleStep2Next}
                className="flex items-center gap-2 bg-teal text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90"
              >
                Next: Classes & Fee <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3 ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-3">
              {classes.map((cls, idx) => (
                <div key={idx} className="bg-gray-50 rounded-xl p-4">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Teacher</label>
                      <select
                        value={cls.teacher_id}
                        onChange={e => updateClass(idx, { teacher_id: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none"
                      >
                        <option value="">Select teacher</option>
                        {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
                      <select
                        value={cls.category}
                        onChange={e => updateClass(idx, { category: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none"
                      >
                        {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Day</label>
                      <select
                        value={cls.day_of_week}
                        onChange={e => updateClass(idx, { day_of_week: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none"
                      >
                        {DAYS.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Start</label>
                        <input type="time" value={cls.start_time} onChange={e => updateClass(idx, { start_time: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:border-teal focus:outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">End</label>
                        <input type="time" value={cls.end_time} onChange={e => updateClass(idx, { end_time: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:border-teal focus:outline-none" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-gray-500">Rate per lesson (₹)</label>
                      <input
                        type="number"
                        min={0}
                        value={cls.rate}
                        onChange={e => updateClass(idx, { rate: e.target.value })}
                        className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:border-teal focus:outline-none"
                        placeholder="auto"
                      />
                      {cls.rate && <span className="text-xs text-teal font-semibold">₹{Number(cls.rate).toLocaleString('en-IN')}</span>}
                    </div>
                    {classes.length > 1 && (
                      <button onClick={() => removeClass(idx)} className="text-gray-400 hover:text-coral"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button onClick={addClass} className="flex items-center gap-1 text-sm text-teal font-semibold hover:underline">
              <Plus size={14} /> Add another class
            </button>

            {/* Fee summary */}
            {totalRatePerLesson > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2 text-sm">
                <p className="text-xs font-bold text-gray-500 uppercase">Fee Summary</p>
                {classes.map((cls, i) => (
                  cls.rate ? (
                    <div key={i} className="flex justify-between text-gray-600">
                      <span>{CATEGORIES.find(c => c.value === cls.category)?.label} — {teachers.find(t => t.id === cls.teacher_id)?.full_name || '—'}</span>
                      <span>₹{Number(cls.rate).toLocaleString('en-IN')}</span>
                    </div>
                  ) : null
                ))}
                <div className="flex justify-between text-gray-600 border-t pt-2">
                  <span>₹{totalRatePerLesson.toLocaleString('en-IN')} × {totalLessons} lessons</span>
                  <span>₹{(totalRatePerLesson * totalLessons).toLocaleString('en-IN')}</span>
                </div>
                {regFee > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Registration fee</span>
                    <span>₹{regFee.toLocaleString('en-IN')}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-navy border-t pt-2">
                  <span>Total</span>
                  <span>₹{totalFee.toLocaleString('en-IN')}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-4">
                <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-navy"><ChevronLeft size={16} /> Back</button>
                <button onClick={() => handleConfirm(true)} disabled={saving} className="text-sm text-gray-400 hover:text-gray-600 underline">
                  Skip for now
                </button>
              </div>
              <button
                onClick={() => handleConfirm(false)}
                disabled={saving}
                className="bg-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Confirm & Finish'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "C:/Users/Admin/Pictures/music"
pnpm --filter admin build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Admin/Pictures/music"
git add admin/src/components/OnboardingWizard.tsx
git commit -m "feat: OnboardingWizard 3-step student onboarding component"
```

---

### Task 2: Students.tsx — pending banner + wire Add Student + redesigned table

**Files:**
- Modify: `admin/src/pages/Students.tsx`

- [ ] **Step 1: Replace the full file contents**

Replace everything in `admin/src/pages/Students.tsx` with:

```tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserCheck, UserX } from 'lucide-react';
import { useStudents } from '../hooks/useStudents';
import { supabase } from '../lib/supabase';
import type { Instrument, Location } from '@troika/shared';
import { OnboardingWizard } from '../components/OnboardingWizard';

interface PendingProfile { id: string; full_name: string; email: string; }

export function StudentsPage() {
  const [search, setSearch] = useState('');
  const [instrumentFilter, setInstrumentFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const navigate = useNavigate();

  // Pending approvals
  const [pendingProfiles, setPendingProfiles] = useState<PendingProfile[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardProfile, setWizardProfile] = useState<PendingProfile | null>(null);

  const { students, loading, refresh } = useStudents({
    instrumentId: instrumentFilter || undefined,
    isActive: activeFilter,
  });

  useEffect(() => {
    supabase.from('instruments').select('*').then(({ data }) => setInstruments(data || []));
    supabase.from('locations').select('*').then(({ data }) => setLocations(data || []));
    fetchPending();
  }, []);

  async function fetchPending() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'student')
      .is('approved', null);
    setPendingProfiles((data || []) as PendingProfile[]);
  }

  function openWizard(profile: PendingProfile | null) {
    setWizardProfile(profile);
    setWizardOpen(true);
  }

  function handleWizardComplete() {
    setWizardOpen(false);
    setWizardProfile(null);
    fetchPending();
    refresh();
  }

  const filtered = students.filter((s: any) =>
    s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase())
  );

  const pendingPreview = pendingProfiles.slice(0, 3).map(p => p.full_name).join(', ') +
    (pendingProfiles.length > 3 ? ` + ${pendingProfiles.length - 3} more` : '');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Students</h1>
          <p className="text-gray-500 text-sm mt-1">{students.length} total students</p>
        </div>
        <button
          onClick={() => openWizard(null)}
          className="flex items-center gap-2 bg-coral text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90"
        >
          + Add Student
        </button>
      </div>

      {/* Pending approval banner */}
      {pendingProfiles.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-400 text-white rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
              {pendingProfiles.length}
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {pendingProfiles.length} student{pendingProfiles.length > 1 ? 's' : ''} waiting for approval
              </p>
              <p className="text-xs text-amber-600 mt-0.5">{pendingPreview}</p>
            </div>
          </div>
          <button
            onClick={() => openWizard(pendingProfiles[0])}
            className="bg-amber-400 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-500 whitespace-nowrap flex-shrink-0"
          >
            Review →
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search students..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <select
            value={instrumentFilter}
            onChange={(e) => setInstrumentFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All Instruments</option>
            {instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <button onClick={() => setActiveFilter(undefined)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${activeFilter === undefined ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600'}`}>All</button>
            <button onClick={() => setActiveFilter(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${activeFilter === true ? 'bg-teal text-white' : 'bg-gray-100 text-gray-600'}`}>Active</button>
            <button onClick={() => setActiveFilter(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${activeFilter === false ? 'bg-coral text-white' : 'bg-gray-100 text-gray-600'}`}>Inactive</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Student</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Instrument · Location</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Contact</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={4} className="text-center text-gray-400 py-12">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-gray-400 py-12">No students found</td></tr>
            ) : (
              filtered.map((student: any) => (
                <tr
                  key={student.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/students/${student.id}`)}
                >
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-navy text-sm">{student.full_name}</p>
                    <p className="text-xs text-gray-400">{student.email || ''}</p>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-600">
                    {[student.instrument?.name, student.location?.name].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-600">{student.phone || '—'}</td>
                  <td className="px-5 py-3.5">
                    {student.is_active ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal bg-teal-light px-2.5 py-1 rounded-full">
                        <UserCheck size={12} /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                        <UserX size={12} /> Inactive
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <OnboardingWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); setWizardProfile(null); }}
        onComplete={handleWizardComplete}
        pendingProfile={wizardProfile}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "C:/Users/Admin/Pictures/music"
pnpm --filter admin build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 3: Manually verify**

```bash
pnpm --filter admin dev
```

Open http://localhost:5173/students. Verify:
- "Add Student" button opens the wizard modal
- If any profiles with `approved = null` exist in the DB, the amber banner appears
- Table shows 4 columns: Student, Instrument·Location, Contact, Status
- Row click navigates to student detail

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/Students.tsx
git commit -m "feat: students page — pending approval banner, Add Student wizard, redesigned table"
```

---

### Task 3: StudentDetail.tsx — info tiles, Edit modal, Deactivate/Activate

**Files:**
- Modify: `admin/src/pages/StudentDetail.tsx`

- [ ] **Step 1: Replace the full file**

Replace all contents of `admin/src/pages/StudentDetail.tsx` with:

```tsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, AlertTriangle, CheckCircle, Music, X, BookOpen } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Student, StudentStats, AbsenceCategory, StudentEnrolment } from '@troika/shared';

interface Instrument { id: string; name: string; }
interface Location { id: string; name: string; }

const PAYMENT_PLANS = [
  { value: 'trial',          label: 'Trial' },
  { value: '1_instalment',   label: '1 Instalment' },
  { value: '3_instalments',  label: '3 Instalments' },
  { value: '10_instalments', label: '10 Instalments' },
];

export function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [student, setStudent] = useState<any>(null);
  const [stats, setStats] = useState<StudentStats | null>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolments, setEnrolments] = useState<(StudentEnrolment & { lesson_rate?: { category: string } | null })[]>([]);

  // Absence modal
  const [absenceModal, setAbsenceModal] = useState<{ lessonStudentId: string; studentName: string } | null>(null);
  const [absenceCategory, setAbsenceCategory] = useState<AbsenceCategory>('charged');

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [editForm, setEditForm] = useState<any>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchData();
    supabase.from('instruments').select('id, name').order('name').then(({ data }) => setInstruments(data || []));
    supabase.from('locations').select('id, name').order('name').then(({ data }) => setLocations(data || []));
  }, [id]);

  function fetchData() {
    if (!id) return;
    setLoading(true);
    const currentYear = new Date().getFullYear().toString();
    Promise.all([
      supabase.from('students').select('*, location:locations(*), instrument:instruments(*)').eq('id', id).single(),
      supabase.from('student_stats').select('*').eq('student_id', id).single(),
      supabase.from('lesson_students')
        .select('*, lesson:lessons(*, teacher:profiles!lessons_teacher_id_fkey(full_name), instrument:instruments(name))')
        .eq('student_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('student_enrolments').select('*, lesson_rate:lesson_rates(category)').eq('student_id', id).eq('academic_year', currentYear),
    ]).then(([studentRes, statsRes, lessonsRes, enrolmentRes]) => {
      setStudent(studentRes.data);
      setStats(statsRes.data as StudentStats);
      setLessons((lessonsRes.data || []).filter((l: any) => l.lesson));
      if (enrolmentRes.data) setEnrolments(enrolmentRes.data as any);
      setLoading(false);
    });
  }

  async function markAbsence() {
    if (!absenceModal) return;
    const { error } = await supabase
      .from('lesson_students')
      .update({ attended: false, absence_category: absenceCategory })
      .eq('id', absenceModal.lessonStudentId);
    if (error) { alert(error.message); return; }
    setAbsenceModal(null);
    fetchData();
  }

  async function markAttended(lessonStudentId: string) {
    await supabase.from('lesson_students').update({ attended: true, absence_category: null }).eq('id', lessonStudentId);
    fetchData();
  }

  async function toggleActive() {
    if (!student) return;
    const next = !student.is_active;
    const msg = next ? 'Reactivate this student?' : 'Deactivate this student?';
    if (!confirm(msg)) return;
    await supabase.from('students').update({ is_active: next }).eq('id', id!);
    fetchData();
  }

  function openEdit() {
    setEditForm({
      full_name: student.full_name || '',
      phone: student.phone || '',
      email: student.email || '',
      instrument_id: student.instrument_id || '',
      location_id: student.location_id || '',
      payment_plan: student.payment_plan || '3_instalments',
      parent_name: student.parent_name || '',
      parent_phone: student.parent_phone || '',
      parent_email: student.parent_email || '',
      notes: student.notes || '',
    });
    setEditError(null);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editForm.full_name?.trim()) { setEditError('Full name is required'); return; }
    setEditSaving(true);
    setEditError(null);
    const { error } = await supabase.from('students').update({
      full_name: editForm.full_name.trim(),
      phone: editForm.phone.trim() || null,
      email: editForm.email.trim() || null,
      instrument_id: editForm.instrument_id || null,
      location_id: editForm.location_id || null,
      payment_plan: editForm.payment_plan,
      parent_name: editForm.parent_name.trim() || null,
      parent_phone: editForm.parent_phone.trim() || null,
      parent_email: editForm.parent_email.trim() || null,
      notes: editForm.notes.trim() || null,
    }).eq('id', id!);
    setEditSaving(false);
    if (error) { setEditError(error.message); return; }
    setEditOpen(false);
    fetchData();
  }

  if (loading) return <p className="text-center text-gray-400 py-12">Loading...</p>;
  if (!student) return <p className="text-center text-gray-400 py-12">Student not found</p>;

  const statCards = [
    { label: 'Total Lessons', value: stats?.total_lessons || 0, icon: Calendar, color: 'text-navy', bg: 'bg-gray-100' },
    { label: 'Regular', value: stats?.regular_lessons || 0, icon: CheckCircle, color: 'text-teal', bg: 'bg-teal-light' },
    { label: 'Makeup', value: stats?.makeup_lessons || 0, icon: Music, color: 'text-amber-500', bg: 'bg-amber-50' },
    { label: 'Charged Absences', value: stats?.charged_absences || 0, icon: AlertTriangle, color: 'text-coral', bg: 'bg-coral-light' },
  ];

  const infoTiles = [
    { label: 'Phone',        value: student.phone },
    { label: 'Email',        value: student.email },
    { label: 'Payment Plan', value: student.payment_plan?.replace(/_/g, ' ') },
    { label: 'Parent',       value: student.parent_name },
    { label: 'Parent Phone', value: student.parent_phone },
    { label: 'Parent Email', value: student.parent_email },
  ];

  return (
    <div>
      <button onClick={() => navigate('/students')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-navy mb-4">
        <ArrowLeft size={16} /> Back to Students
      </button>

      {/* Profile card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-navy">{student.full_name}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {student.instrument?.name || ''}{student.location?.name ? ` · ${student.location.name}` : ''} ·{' '}
              <span className={student.is_active ? 'text-teal font-semibold' : 'text-coral font-semibold'}>
                {student.is_active ? 'Active' : 'Inactive'}
              </span>
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={openEdit} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:border-navy hover:text-navy font-medium">
              Edit
            </button>
            <button
              onClick={toggleActive}
              className={`border rounded-lg px-3 py-1.5 text-sm font-medium ${
                student.is_active
                  ? 'border-coral/30 text-coral hover:bg-coral-light'
                  : 'border-teal/30 text-teal hover:bg-teal-light'
              }`}
            >
              {student.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>

        {/* Info tiles */}
        <div className="grid grid-cols-3 gap-3">
          {infoTiles.map((tile) => (
            <div key={tile.label} className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{tile.label}</p>
              <p className="text-sm text-navy font-medium">{tile.value || '—'}</p>
            </div>
          ))}
          {student.notes && (
            <div className="col-span-3 bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-gray-700">{student.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className={`w-9 h-9 ${card.bg} rounded-lg flex items-center justify-center mb-2`}>
              <card.icon size={18} className={card.color} />
            </div>
            <p className="text-2xl font-bold text-navy">{card.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Enrolment */}
      {enrolments.map((enrolment) => {
        const categoryLabel = enrolment.lesson_rate?.category?.replace(/_/g, ' ') || '';
        return (
          <div key={enrolment.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={18} className="text-teal" />
              <h2 className="font-semibold text-navy">
                Enrolment — {enrolment.academic_year}
                {categoryLabel && <span className="text-gray-400 font-normal ml-2">({categoryLabel})</span>}
              </h2>
            </div>
            <div className="mb-3">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-500">Lessons Used</span>
                <span className="font-semibold text-navy">{enrolment.lessons_used} / {enrolment.total_lessons}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3">
                <div className="bg-teal rounded-full h-3 transition-all"
                  style={{ width: `${Math.min((enrolment.lessons_used / enrolment.total_lessons) * 100, 100)}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-1">{enrolment.total_lessons - enrolment.lessons_used} lessons remaining</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-gray-400">Rate/Lesson</p><p className="font-semibold text-navy">₹{Number(enrolment.rate_per_lesson).toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-gray-400">Total Fee</p><p className="font-semibold text-navy">₹{Number(enrolment.total_fee).toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-gray-400">Payment Plan</p><p className="font-medium text-gray-700">{enrolment.payment_plan?.replace(/_/g, ' ')}</p></div>
              <div><p className="text-xs text-gray-400">Start Date</p><p className="font-medium text-gray-700">{new Date(enrolment.start_date).toLocaleDateString()}</p></div>
            </div>
          </div>
        );
      })}

      {/* Lesson History */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100"><h2 className="font-semibold text-navy">Lesson History</h2></div>
        <div className="divide-y divide-gray-50">
          {lessons.map((item: any) => (
            <div key={item.id} className="p-4 flex items-center gap-4">
              <div className={`w-1.5 h-10 rounded-full ${item.attended === true ? 'bg-teal' : item.attended === false ? 'bg-coral' : 'bg-gray-300'}`} />
              <div className="flex-1">
                <p className="text-sm font-medium text-navy">{item.lesson?.title || 'Lesson'}</p>
                <p className="text-xs text-gray-400">
                  {new Date(item.lesson?.date).toLocaleDateString()} · {item.lesson?.start_time?.slice(0, 5)} · {item.lesson?.teacher?.full_name}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {item.attended === true && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-light text-teal">Attended</span>}
                {item.attended === false && (
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${item.absence_category === 'charged' ? 'bg-coral-light text-coral' : 'bg-green-50 text-green-600'}`}>
                    {item.absence_category === 'charged' ? 'Absent (Charged)' : 'Absent (Not Charged)'}
                  </span>
                )}
                {item.attended === null && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => markAttended(item.id)} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-teal text-white hover:bg-teal/80">Attended</button>
                    <button onClick={() => setAbsenceModal({ lessonStudentId: item.id, studentName: student.full_name })} className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-coral text-white hover:bg-coral/80">Absent</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {lessons.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No lessons recorded</p>}
        </div>
      </div>

      {/* Absence modal */}
      {absenceModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-navy">Mark Absence</h3>
              <button onClick={() => setAbsenceModal(null)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Marking <span className="font-medium text-navy">{absenceModal.studentName}</span> as absent.</p>
            <div className="space-y-3 mb-6">
              {(['charged', 'not_charged'] as AbsenceCategory[]).map((cat) => (
                <label key={cat} className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${absenceCategory === cat ? (cat === 'charged' ? 'border-coral bg-coral-light' : 'border-teal bg-teal-light') : 'border-gray-200'}`}>
                  <input type="radio" name="absence" value={cat} checked={absenceCategory === cat} onChange={() => setAbsenceCategory(cat)} className={cat === 'charged' ? 'accent-coral' : 'accent-teal'} />
                  <div>
                    <p className="text-sm font-semibold text-navy">{cat === 'charged' ? 'Charged' : 'Not Charged'}</p>
                    <p className="text-xs text-gray-500">{cat === 'charged' ? 'Student will be charged for this missed lesson' : 'No charge (e.g. teacher cancellation)'}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={markAbsence} className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90">Confirm Absence</button>
              <button onClick={() => setAbsenceModal(null)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy text-lg">Edit Student</h3>
              <button onClick={() => setEditOpen(false)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            {editError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600 mb-4">{editError}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Full Name <span className="text-coral">*</span></label>
                <input type="text" value={editForm.full_name} onChange={e => setEditForm((p: any) => ({ ...p, full_name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Phone</label>
                  <input type="tel" value={editForm.phone} onChange={e => setEditForm((p: any) => ({ ...p, phone: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
                  <input type="email" value={editForm.email} onChange={e => setEditForm((p: any) => ({ ...p, email: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Instrument</label>
                  <select value={editForm.instrument_id} onChange={e => setEditForm((p: any) => ({ ...p, instrument_id: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                    <option value="">None</option>
                    {instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Location</label>
                  <select value={editForm.location_id} onChange={e => setEditForm((p: any) => ({ ...p, location_id: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                    <option value="">None</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Payment Plan</label>
                <select value={editForm.payment_plan} onChange={e => setEditForm((p: any) => ({ ...p, payment_plan: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                  {PAYMENT_PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Parent / Guardian</p>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Parent Name</label>
                    <input type="text" value={editForm.parent_name} onChange={e => setEditForm((p: any) => ({ ...p, parent_name: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Parent Phone</label>
                      <input type="tel" value={editForm.parent_phone} onChange={e => setEditForm((p: any) => ({ ...p, parent_phone: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Parent Email</label>
                      <input type="email" value={editForm.parent_email} onChange={e => setEditForm((p: any) => ({ ...p, parent_email: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Notes</label>
                <textarea rows={3} value={editForm.notes} onChange={e => setEditForm((p: any) => ({ ...p, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <button onClick={saveEdit} disabled={editSaving}
                className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setEditOpen(false)}
                className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "C:/Users/Admin/Pictures/music"
pnpm --filter admin build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 3: Manually verify**

```bash
pnpm --filter admin dev
```

Open a student detail page. Verify:
- Info tiles show phone, email, payment plan, parent name/phone/email, notes — all showing `—` for empty fields
- Edit button opens modal with all fields pre-filled
- Save updates the student and refreshes the page
- Deactivate/Activate toggles `is_active` after confirm dialog

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/StudentDetail.tsx
git commit -m "feat: student detail — info tiles, edit modal, deactivate/activate toggle"
```
