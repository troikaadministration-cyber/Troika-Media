import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface PendingProfile { id: string; full_name: string; email: string; }

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
interface LessonCategory { id: string; name: string; sort_order: number; }

interface ClassRow {
  teacher_id: string;
  category: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  rate: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PAYMENT_PLANS = [
  { value: 'trial',          label: 'Trial (no payment)' },
  { value: '1_instalment',   label: '1 Instalment' },
  { value: '3_instalments',  label: '3 Instalments' },
  { value: '10_instalments', label: '10 Instalments' },
];

const TOTAL_LESSONS = (plan: string) => plan === 'trial' ? 1 : 39;

function emptyClass(): ClassRow {
  return { teacher_id: '', category: '', day_of_week: '0', start_time: '09:00', end_time: '10:00', rate: '' };
}

function StepBar({ step }: { step: number }) {
  const steps = ['Student Info', 'Payment & Classes'];
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

export function OnboardingWizard({ open, onClose, onComplete, pendingProfile }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [allRates, setAllRates] = useState<LessonRate[]>([]);
  const [categories, setCategories] = useState<LessonCategory[]>([]);


  // Step 1 state
  const [s1, setS1] = useState({
    full_name: pendingProfile?.full_name ?? '',
    phone: '',
    email: pendingProfile?.email ?? '',
    instrument_id: '',
    location_id: '',
  });
  const [studentId, setStudentId] = useState<string | null>(null);

  // Step 2 state (payment + classes combined)
  const [s2, setS2] = useState({
    payment_plan: '3_instalments',
    academic_year: new Date().getFullYear().toString(),
    registration_fee: '0',
  });
  const [classes, setClasses] = useState<ClassRow[]>([emptyClass()]);

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

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from('instruments').select('id, name').order('name'),
      supabase.from('locations').select('id, name').order('name'),
      supabase.from('profiles').select('id, full_name').eq('role', 'teacher').eq('approved', true).order('full_name'),
      supabase.from('lesson_rates').select('id, teacher_id, location_id, category, rate_per_lesson, is_online'),
      supabase.from('lesson_categories').select('*').order('sort_order'),
    ]).then(([iRes, lRes, tRes, rRes, cRes]) => {
      setInstruments(iRes.data ?? []);
      setLocations(lRes.data ?? []);
      setTeachers(tRes.data ?? []);
      setAllRates((rRes.data ?? []) as LessonRate[]);
      setCategories((cRes.data ?? []) as LessonCategory[]);
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;


  // Step 1 → create student + approve profile (parallel)
  async function handleStep1Next() {
    if (!s1.full_name.trim()) { setError('Full name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const { data, error: studentErr } = await supabase.from('students').insert({
        user_id: pendingProfile?.id ?? null,
        full_name: s1.full_name.trim(),
        phone: s1.phone.trim() || null,
        email: s1.email.trim() || null,
        instrument_id: s1.instrument_id || null,
        location_id: s1.location_id || null,
        is_active: true,
        payment_plan: '3_instalments',
      }).select('id').single();
      if (studentErr) throw studentErr;
      // NOTE: profile approval happens only on Confirm & Finish — not here
      setStudentId(data.id);
      setStep(1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Step 2 helpers
  function autoRate(teacherId: string, category: string): string {
    const isOnline = s1.location_id === '';
    const match = allRates.find(r =>
      r.teacher_id === teacherId && r.category === category &&
      (isOnline ? r.is_online : r.location_id === s1.location_id)
    );
    return match ? String(match.rate_per_lesson) : '';
  }

  function updateClass(idx: number, patch: Partial<ClassRow>) {
    setClasses(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      const updated = { ...c, ...patch };
      if (patch.teacher_id !== undefined || patch.category !== undefined) {
        const tId = patch.teacher_id ?? c.teacher_id;
        const cat = patch.category ?? c.category;
        if (tId && cat) updated.rate = autoRate(tId, cat);
      }
      return updated;
    }));
  }

  const totalLessons = TOTAL_LESSONS(s2.payment_plan);
  const totalRatePerLesson = classes.reduce((sum, c) => sum + (parseFloat(c.rate) || 0), 0);
  const regFee = parseFloat(s2.registration_fee) || 0;
  const totalFee = totalRatePerLesson * totalLessons + regFee;

  async function handleConfirm(skip = false) {
    if (!studentId) return;
    setSaving(true);
    setError(null);
    try {
      const ratePerLesson = skip ? 0 : totalRatePerLesson;
      const fee = skip ? 0 : totalFee;

      const { data: enrolment, error: enrolErr } = await supabase.from('student_enrolments').insert({
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
      }).select('id').single();
      if (enrolErr) throw enrolErr;

      if (s2.payment_plan !== 'trial') {
        const { error: genErr } = await supabase.rpc('generate_instalments', { p_enrolment_id: enrolment.id });
        if (genErr) throw genErr;
      }

      if (!skip && classes.length > 0) {
        const instrName = instruments.find(i => i.id === s1.instrument_id)?.name ?? '';
        const validClasses = classes.filter(cls => cls.teacher_id);
        if (validClasses.length > 0) {
          const { error: schedErr } = await supabase.from('teacher_schedule_templates').insert(
            validClasses.map(cls => ({
              teacher_id: cls.teacher_id,
              day_of_week: Number(cls.day_of_week),
              start_time: cls.start_time,
              end_time: cls.end_time || null,
              location_id: s1.location_id || null,
              instrument_id: s1.instrument_id || null,
              title: `${s1.full_name} – ${instrName}`,
              student_ids: [studentId],
              is_active: true,
            }))
          );
          if (schedErr) throw schedErr;
        }
      }

      // Approve the student's profile only after the full wizard is completed
      if (pendingProfile) {
        const { error: approveErr } = await supabase.from('profiles').update({ approved: true }).eq('id', pendingProfile.id);
        if (approveErr) throw approveErr;
      }

      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-navy">
            {pendingProfile ? `Approve & Onboard — ${pendingProfile.full_name || pendingProfile.email}` : 'Add New Student'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy"><X size={20} /></button>
        </div>

        <StepBar step={step} />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600 mb-4">{error}</div>
        )}

        {/* ── STEP 1: Student Info ── */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Full Name <span className="text-coral">*</span></label>
                <input type="text" value={s1.full_name} onChange={e => setS1(p => ({ ...p, full_name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="Student's full name" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Phone</label>
                <input type="tel" value={s1.phone} onChange={e => setS1(p => ({ ...p, phone: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="+91 98765 43210" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
                <input type="email" value={s1.email} onChange={e => setS1(p => ({ ...p, email: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="student@email.com" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Instrument</label>
                <select value={s1.instrument_id} onChange={e => setS1(p => ({ ...p, instrument_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                  <option value="">Select instrument</option>
                  {instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Location</label>
                <select value={s1.location_id} onChange={e => setS1(p => ({ ...p, location_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                  <option value="">Select location</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={handleStep1Next} disabled={saving || !s1.full_name.trim()}
                className="flex items-center gap-2 bg-teal text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                {saving ? 'Saving...' : 'Next: Payment & Classes'} <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Payment + Classes (merged) ── */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Payment section */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Payment Plan</label>
                <select value={s2.payment_plan} onChange={e => setS2(p => ({ ...p, payment_plan: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                  {PAYMENT_PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Academic Year</label>
                <input type="text" value={s2.academic_year} onChange={e => setS2(p => ({ ...p, academic_year: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Registration Fee (₹)</label>
                <input type="number" min={0} value={s2.registration_fee}
                  onChange={e => setS2(p => ({ ...p, registration_fee: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="0" />
              </div>
            </div>

            {/* Class rows */}
            <div className="border-t pt-4">
              <p className="text-xs font-bold text-gray-400 uppercase mb-3">Class Schedule</p>
              <div className="space-y-3">
                {classes.map((cls, idx) => (
                  <div key={idx} className="bg-gray-50 rounded-xl p-4">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Teacher</label>
                        <select value={cls.teacher_id} onChange={e => updateClass(idx, { teacher_id: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none">
                          <option value="">Select teacher</option>
                          {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
                        <select value={cls.category} onChange={e => updateClass(idx, { category: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none">
                          <option value="">Select category</option>
                          {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Day</label>
                        <select value={cls.day_of_week} onChange={e => updateClass(idx, { day_of_week: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none">
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
                        <input type="number" min={0} value={cls.rate} onChange={e => updateClass(idx, { rate: e.target.value })}
                          className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:border-teal focus:outline-none"
                          placeholder="auto" />
                        {cls.rate && <span className="text-xs text-teal font-semibold">₹{Number(cls.rate).toLocaleString('en-IN')}</span>}
                      </div>
                      {classes.length > 1 && (
                        <button onClick={() => setClasses(prev => prev.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-coral"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setClasses(prev => [...prev, emptyClass()])}
                className="flex items-center gap-1 text-sm text-teal font-semibold hover:underline mt-2">
                <Plus size={14} /> Add another class
              </button>
            </div>

            {/* Fee summary */}
            {totalRatePerLesson > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2 text-sm">
                <p className="text-xs font-bold text-gray-500 uppercase">Fee Summary</p>
                <div className="flex justify-between text-gray-600">
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
                <button onClick={() => setStep(0)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-navy"><ChevronLeft size={16} /> Back</button>
                <button onClick={() => handleConfirm(true)} disabled={saving} className="text-sm text-gray-400 hover:text-gray-600 underline">Skip for now</button>
              </div>
              <button onClick={() => handleConfirm(false)} disabled={saving}
                className="bg-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                {saving ? 'Saving...' : 'Confirm & Finish'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
