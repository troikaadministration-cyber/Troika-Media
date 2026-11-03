import { toDateStr } from '../lib/dates';
import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../lib/fetchAll';
import { lessonsForClass, lessonsBreakdown, normaliseTimesPerWeek, TIMES_PER_WEEK_OPTIONS } from '../lib/lessonCount';
import { weeklySlotsError, type SelectedSlot } from './SlotPicker';
import { computeDiscount, type DiscountPrimary } from '../lib/fees';
import { useToast } from '../contexts/ToastContext';
import { invalidateQueries } from '../lib/queryCache';
import { invalidateLessonViews } from '../hooks/useLessons';

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
interface ExistingSlot { id: string; teacher_id: string; day_of_week: number; start_time: string; end_time: string | null; instrument_id: string | null; title: string; student_ids: string[] | null; }
interface SlotStudent { id: string; full_name: string; user_id: string | null; email: string | null; }

/** A 2nd/3rd weekly lesson of the same class (same teacher, instrument, location). */
interface ExtraTime { day_of_week: string; start_time: string; end_time: string; }

interface ClassRow {
  teacher_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  rate: string;            // typed by the coordinator — never pre-filled
  instrument_id: string;
  location_id: string; // where this class happens (any location, incl. Online)
  times_per_week: number;  // 1, 2 or 3
  extra: ExtraTime[];      // times_per_week − 1 entries
}

// 0 = Sunday … 6 = Saturday, matching JS getDay()/getUTCDay() and the rest of the app.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ALLOWED_INSTRUMENTS = ['Cello', 'Piano', 'Voice', 'Guitar', 'Violin', 'Viola', 'IGCSE Music', 'Music Theory'];

const PAYMENT_PLANS = [
  { value: 'trial',          label: 'Trial (no payment)' },
  { value: '1_instalment',   label: '1 Instalment' },
  { value: '3_instalments',  label: '3 Instalments' },
  { value: '10_instalments', label: '10 Instalments' },
];


function emptyClass(): ClassRow {
  return { teacher_id: '', day_of_week: '1', start_time: '09:00', end_time: '09:45', rate: '', instrument_id: '', location_id: '', times_per_week: 1, extra: [] };
}

/** Grow/shrink the extra weekly lessons; a new one defaults to 3 days after the previous, same time. */
function withTimesPerWeek(c: ClassRow, times: number): ClassRow {
  const t = normaliseTimesPerWeek(times);
  const extra = c.extra.slice(0, t - 1);
  while (extra.length < t - 1) {
    const prevDay = Number(extra.length ? extra[extra.length - 1].day_of_week : c.day_of_week);
    extra.push({ day_of_week: String((prevDay + 3) % 7), start_time: c.start_time, end_time: c.end_time });
  }
  return { ...c, times_per_week: t, extra };
}

/** All weekly lessons of a class, as slots (for the shared overlap/validity checks). */
function classSlots(c: ClassRow): SelectedSlot[] {
  return [{ day_of_week: c.day_of_week, start_time: c.start_time, end_time: c.end_time }, ...c.extra].map(x => ({
    mode: 'new' as const, dayOfWeek: Number(x.day_of_week), startTime: x.start_time, endTime: x.end_time,
    instrumentId: c.instrument_id || 'any', title: '',
  }));
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
  // Teachers' existing weekly classes: a new class at the same teacher + day + start
  // time JOINS that class (e.g. two siblings sharing a lesson; each pays separately).
  const [slots, setSlots] = useState<ExistingSlot[]>([]);
  const [slotStudents, setSlotStudents] = useState<Record<string, SlotStudent>>({});

  // Step 1 state
  const [s1, setS1] = useState({
    full_name: pendingProfile?.full_name ?? '',
    phone: '',
    email: pendingProfile?.email ?? '',
    location_id: '',
    address: '',
  });
  const [studentId, setStudentId] = useState<string | null>(null);

  // Step 2 state (payment + classes combined)
  const [s2, setS2] = useState({
    payment_plan: '3_instalments',
    academic_year: new Date().getFullYear().toString(),
    registration_fee: '0',
    discount_primary: 'none' as DiscountPrimary,
    discount_special: '0',
    discount_multilesson: false,
  });
  const [classes, setClasses] = useState<ClassRow[]>([emptyClass()]);
  const [savedClasses, setSavedClasses] = useState<number[]>([]);
  // Family mode: adding a sibling to a parent's (already approved) login — one email, several children.
  const [familyLoginId, setFamilyLoginId] = useState<string | null>(null);
  // Final step (opened from a pending profile): who was just set up on this login.
  const [doneNames, setDoneNames] = useState<string[]>([]);
  const { showToast } = useToast();

  useEffect(() => {
    if (open) {
      setStep(0);
      setError(null);
      setStudentId(null);
      setFamilyLoginId(null);
      setDoneNames([]);
      setS1({ full_name: pendingProfile?.full_name ?? '', phone: '', email: pendingProfile?.email ?? '', location_id: '', address: '' });
      setS2({ payment_plan: '3_instalments', academic_year: new Date().getFullYear().toString(), registration_fee: '0', discount_primary: 'none', discount_special: '0', discount_multilesson: false });
      setClasses([emptyClass()]);
      setSavedClasses([]);
    }
  }, [open, pendingProfile]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from('instruments').select('id, name').order('name'),
      supabase.from('locations').select('id, name').order('name'),
      supabase.from('profiles').select('id, full_name').eq('role', 'teacher').eq('approved', true).order('full_name'),
    ]).then(([iRes, lRes, tRes]) => {
      setInstruments(iRes.data ?? []);
      setLocations(lRes.data ?? []);
      setTeachers(tRes.data ?? []);
    });
    void loadSlots();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSlots() {
    const { data } = await supabase.from('teacher_schedule_templates')
      .select('id, teacher_id, day_of_week, start_time, end_time, instrument_id, title, student_ids')
      .eq('is_active', true);
    setSlots((data ?? []) as ExistingSlot[]);
    try {
      const rows = await fetchAll<SlotStudent>((from, to) =>
        supabase.from('students').select('id, full_name, user_id, email').order('id').range(from, to));
      setSlotStudents(Object.fromEntries(rows.map(r => [r.id, r])));
    } catch { /* names are only for messages */ }
  }

  if (!open) return null;

  // "Add another child to this login": a NEW student on the same login. Same email,
  // phone, location (and address); the coordinator types the child's name.
  function startSibling() {
    if (!pendingProfile) return;
    setFamilyLoginId(pendingProfile.id);
    setStudentId(null);
    setS1(prev => ({ ...prev, full_name: '' }));
    setS2({ payment_plan: '3_instalments', academic_year: new Date().getFullYear().toString(), registration_fee: '0', discount_primary: 'none', discount_special: '0', discount_multilesson: false });
    setClasses([emptyClass()]);
    setSavedClasses([]);
    setError(null);
    setStep(0);
    void loadSlots(); // the first child's new class can now be shared
  }

  // Step 1 → validate only, no DB writes
  function handleStep1Next() {
    if (!s1.full_name.trim()) { setError("Enter the child's (student's) full name"); return; }
    setError(null);
    // Classes default to the student's location (each can be changed).
    setClasses(prev => prev.map(c => c.location_id ? c : { ...c, location_id: s1.location_id }));
    setStep(1);
  }

  // Step 2 helpers. The rate is always typed by the coordinator (no auto-fill).
  function updateClass(idx: number, patch: Partial<ClassRow>) {
    setClasses(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function updateExtra(idx: number, k: number, patch: Partial<ExtraTime>) {
    setClasses(prev => prev.map((c, i) => (i === idx
      ? { ...c, extra: c.extra.map((x, j) => (j === k ? { ...x, ...patch } : x)) } : c)));
  }

  // Is this student in the same family as the child being added (same login or same email)?
  function isFamily(id: string): boolean {
    if (studentId && id === studentId) return true;
    const st = slotStudents[id];
    if (!st) return false;
    const login = familyLoginId ?? pendingProfile?.id ?? null;
    if (login && st.user_id === login) return true;
    const email = s1.email.trim().toLowerCase();
    return !!email && (st.email ?? '').trim().toLowerCase() === email;
  }
  const toMin = (s: string) => { const [h, m] = s.slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); };

  /**
   * The teacher's existing weekly classes at this day/time.
   *  - join: same start time, same instrument, and a brother/sister is in it → share that class.
   *  - clash: any other overlap with a class that has students → must pick another time.
   */
  function slotCheck(c: ClassRow, day: string, start: string, end: string): { join: ExistingSlot | null; clash: string | null } {
    if (!c.teacher_id || !start) return { join: null, clash: null };
    const s = toMin(start), e = end ? toMin(end) : s + 45;
    for (const sl of slots) {
      if (sl.teacher_id !== c.teacher_id || String(sl.day_of_week) !== day || !(sl.student_ids?.length)) continue;
      const ss = toMin(sl.start_time), se = sl.end_time ? toMin(sl.end_time) : ss + 45;
      if (!(s < se && ss < e)) continue;
      const names = (sl.student_ids ?? []).map(id => slotStudents[id]?.full_name).filter(Boolean) as string[];
      const sameFamily = (sl.student_ids ?? []).some(isFamily);
      const sameInstrument = !c.instrument_id || !sl.instrument_id || sl.instrument_id === c.instrument_id;
      if (sameFamily && ss === s && sameInstrument) return { join: sl, clash: null };
      const who = names.length ? names.join(', ') : sl.title || 'another student';
      const teacher = teachers.find(t => t.id === c.teacher_id)?.full_name ?? 'This teacher';
      return {
        join: null,
        clash: `Clash: ${teacher} already teaches ${who} on ${DAYS[Number(day)]} ${sl.start_time.slice(0, 5)}–${(sl.end_time ?? '').slice(0, 5) || '?'}. Choose a different day or time.`,
      };
    }
    return { join: null, clash: null };
  }
  const occurrences = (c: ClassRow) => [{ day_of_week: c.day_of_week, start_time: c.start_time, end_time: c.end_time }, ...c.extra];
  function sharedSlot(c: ClassRow, day: string, start: string): ExistingSlot | null {
    const o = occurrences(c).find(x => x.day_of_week === day && x.start_time === start);
    return slotCheck(c, day, start, o?.end_time ?? '').join;
  }

  const enrolStartDate = toDateStr(new Date());
  const isTrial = s2.payment_plan === 'trial';
  const rateOf = (c: ClassRow) => parseFloat(c.rate) || 0;
  const lessonsOf = (c: ClassRow) => lessonsForClass(s2.payment_plan, enrolStartDate, c.times_per_week);
  const classTuition = (c: ClassRow) => rateOf(c) * lessonsOf(c);
  // What's missing for each class (shown inline; Confirm stays disabled until none).
  const classErrors = classes.map(c => {
    if (!c.teacher_id) return 'Choose a teacher';
    if (!(rateOf(c) >= 0)) return 'Rate cannot be negative';
    if (!isTrial && !(rateOf(c) > 0)) return 'Enter the rate per lesson';
    const overlap = weeklySlotsError(classSlots(c));
    if (overlap) return overlap;
    for (const o of occurrences(c)) {
      const { clash } = slotCheck(c, o.day_of_week, o.start_time, o.end_time);
      if (clash) return clash;
    }
    return null;
  });
  const regFee = parseFloat(s2.registration_fee) || 0;
  const tuition = classes.reduce((sum, c) => sum + classTuition(c), 0);
  const discount = computeDiscount(tuition, {
    primary: s2.discount_primary,
    plan: s2.payment_plan,
    specialAmount: parseFloat(s2.discount_special) || 0,
    multilesson: s2.discount_multilesson,
  });
  const discountedTuition = discount.discounted;
  const tuitionDiscount = discount.discountAmount;
  const totalFee = discountedTuition + regFee;
  // Gate: every class needs a teacher, a typed rate (unless Trial) and valid weekly times.
  const canConfirm = classes.length > 0 && classErrors.every(e => !e);
  const confirmBlockedReason = classErrors.map((e, i) => (e ? (classes.length > 1 ? `Class ${i + 1}: ${e}` : e) : null)).find(Boolean) ?? null;

  // Saves the student, then enrols each class with ONE database call per class
  // (enrol_student: enrolment + weekly slot + lessons + instalments, all or
  // nothing). Classes already saved are remembered, so retrying after an
  // error never duplicates them.
  async function handleConfirm(skip = false) {
    setSaving(true);
    setError(null);
    try {
      // 1. Create or update the student record (deferred from Step 1)
      let resolvedStudentId = studentId;
      if (!resolvedStudentId) {
        let existingId: string | null = null;
        if (pendingProfile && !familyLoginId) {
          // First child: sign-up already linked a students row to this login. Reuse it only
          // when exactly one not-yet-enrolled row exists (a login can hold several children).
          const { data: rows, error: findErr } = await supabase
            .from('students').select('id, created_at, student_enrolments(count)')
            .eq('user_id', pendingProfile.id).order('created_at').limit(50);
          if (findErr) throw findErr;
          const unenrolled = (rows ?? []).filter((r: { student_enrolments?: { count: number }[] }) =>
            !(r.student_enrolments?.[0]?.count));
          if (unenrolled.length === 1) existingId = unenrolled[0].id;
        }
        // Sibling mode never reuses a row: always a new student on the same login.
        // Only send fields that were filled in, so existing details aren't wiped.
        const fields: Record<string, unknown> = { full_name: s1.full_name.trim() };
        if (s1.phone.trim()) fields.phone = s1.phone.trim();
        if (s1.email.trim()) fields.email = s1.email.trim();
        if (s1.location_id) fields.location_id = s1.location_id;
        if (s1.address.trim()) fields.address = s1.address.trim();

        if (existingId) {
          const { data, error: updateErr } = await supabase.from('students')
            .update(fields).eq('id', existingId).select('id').single();
          if (updateErr) throw updateErr;
          resolvedStudentId = data.id;
        } else {
          const { data, error: studentErr } = await supabase.from('students').insert({
            ...fields,
            user_id: familyLoginId ?? pendingProfile?.id ?? null,
            is_active: true,
            payment_plan: s2.payment_plan,
          }).select('id').single();
          if (studentErr) throw studentErr;
          resolvedStudentId = data.id;
        }
        setStudentId(resolvedStudentId);
      }

      // 2. Enrol each class ("Skip for now" saves the student only — no ₹0 bills).
      const warnings: string[] = [];
      if (!skip) {
        const blocked = classErrors.findIndex(Boolean);
        if (blocked >= 0) throw new Error(`Class ${blocked + 1}: ${classErrors[blocked]}`);

        const endDate = (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return toDateStr(d); })();
        // Split the discounted tuition across classes in proportion to each class's tuition
        // (computed for all classes up front, so a retry after a partial save bills the same).
        let feeAllocated = 0;
        const shares = classes.map((cls, n) => {
          const share = n === classes.length - 1
            ? Math.round((discountedTuition - feeAllocated) * 100) / 100
            : Math.round((tuition > 0 ? discountedTuition * classTuition(cls) / tuition : 0) * 100) / 100;
          feeAllocated += share;
          return share;
        });

        for (let n = 0; n < classes.length; n++) {
          const cls = classes[n];
          const idx = n;
          if (savedClasses.includes(idx)) continue;
          const share = shares[n];
          const instrName = instruments.find(i => i.id === cls.instrument_id)?.name ?? '';

          const { data: result, error: enrolErr } = await supabase.rpc('enrol_student', {
            p_student_id: resolvedStudentId,
            p_teacher_id: cls.teacher_id,
            p_payment_plan: s2.payment_plan,
            p_start_date: enrolStartDate,
            p_end_date: endDate,
            p_total_lessons: lessonsOf(cls),
            p_rate_per_lesson: rateOf(cls),
            p_total_fee: share,
            // Registration fee and a flat special discount are recorded once, on the first class.
            p_registration_fee: n === 0 ? regFee : 0,
            p_academic_year: enrolStartDate.slice(0, 4),
            p_discount_primary: s2.discount_primary,
            p_discount_multilesson: s2.discount_multilesson,
            p_discount_value: n === 0 && s2.discount_primary === 'special' ? (parseFloat(s2.discount_special) || 0) : 0,
            // Same teacher + day + time as an existing class → join it (shared class).
            p_template_id: sharedSlot(cls, cls.day_of_week, cls.start_time)?.id ?? null,
            p_day_of_week: Number(cls.day_of_week),
            p_start_time: cls.start_time,
            p_end_time: cls.end_time || null,
            p_instrument_id: cls.instrument_id || null,
            p_title: `${s1.full_name.trim()}${instrName ? ` – ${instrName}` : ''}`,
            p_location_id: cls.location_id || s1.location_id || null,
            // 2× / 3× per week: the class's other weekly lessons (one enrolment, one instalment schedule).
            p_extra_slots: cls.extra.map(x => {
              const shared = sharedSlot(cls, x.day_of_week, x.start_time);
              return shared ? { template_id: shared.id }
                : { day_of_week: Number(x.day_of_week), start_time: x.start_time, end_time: x.end_time || null };
            }),
          });
          if (enrolErr) throw new Error(`${instrName || 'Class'}: ${enrolErr.message}`);
          setSavedClasses(prev => [...prev, idx]);
          const r = result as { lessons_scheduled: number; lessons_expected: number; conflicts: number; conflict_dates?: string[] };
          if (r.lessons_scheduled < r.lessons_expected || r.conflicts > 0) {
            const dates = (r.conflict_dates ?? []).slice(0, 4).join(', ');
            warnings.push(`${instrName || 'Class'}: ${r.lessons_scheduled} of ${r.lessons_expected} lessons scheduled` +
              (r.conflicts ? ` — ${r.conflicts} date(s) clashed with the teacher's other lessons and were skipped (${dates}${(r.conflict_dates?.length ?? 0) > 4 ? '…' : ''}). Check the schedule.` : ''));
          }
        }
      }

      // 3. Approve the student's profile only after everything above succeeded
      //    (a sibling's login is already approved).
      if (pendingProfile && !familyLoginId) {
        const { error: approveErr } = await supabase.from('profiles').update({ approved: true }).eq('id', pendingProfile.id);
        if (approveErr) throw approveErr;
      }

      invalidateQueries('students:');
      invalidateQueries('ref:students');
      invalidateQueries('enrolments');
      invalidateQueries('payments');
      invalidateLessonViews();
      if (warnings.length) showToast('error', warnings.join(' · '));
      else showToast('success', skip ? 'Student saved.' : 'Student enrolled.');
      if (pendingProfile) {
        // Parent's login: offer to add a sibling before closing.
        setDoneNames(prev => [...prev, s1.full_name.trim()]);
        setStep(2);
      } else {
        onComplete();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-navy">
            {familyLoginId && pendingProfile ? `Add another child — ${pendingProfile.email}`
              : pendingProfile ? `Approve & Onboard — ${pendingProfile.full_name || pendingProfile.email}` : 'Add New Student'}
          </h2>
          {/* After the final step, closing = done (lists refresh). */}
          <button onClick={step === 2 ? onComplete : onClose} aria-label="Close" className="text-gray-400 hover:text-navy"><X size={20} /></button>
        </div>

        <StepBar step={step} />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600 mb-4">{error}</div>
        )}

        {/* ── STEP 1: Student Info ── */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="student-name" className="block text-xs font-semibold text-gray-500 mb-1">
                  {pendingProfile ? "Child's (student's) full name" : "Student's full name"} <span className="text-coral">*</span>
                </label>
                <input id="student-name" type="text" value={s1.full_name} onChange={e => setS1(p => ({ ...p, full_name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder={pendingProfile ? "The child's name (the student taking lessons)" : "Student's full name"} />
                {pendingProfile && (
                  <p className="text-xs text-gray-500 mt-1" data-testid="child-name-hint">
                    {familyLoginId
                      ? <>A new child on the login <span className="font-medium text-navy">{pendingProfile.email}</span> — type this child's name.</>
                      : <>Signed up as “{pendingProfile.full_name || pendingProfile.email}” ({pendingProfile.email}) — that may be the parent.
                          Enter the name of the child taking lessons. More children can be added to this login at the end.</>}
                  </p>
                )}
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
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Location</label>
                <select value={s1.location_id} onChange={e => setS1(p => ({ ...p, location_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none bg-white">
                  <option value="">— Select location —</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Address</label>
                <input type="text" value={s1.address} onChange={e => setS1(p => ({ ...p, address: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="Full address (e.g. Flat 3, Empire Building, Mumbai 400001)" />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={handleStep1Next} disabled={!s1.full_name.trim()}
                className="flex items-center gap-2 bg-teal text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                Next: Payment & Classes <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── FINAL (from a pending profile): done, or add a sibling to the same login ── */}
        {step === 2 && pendingProfile && (
          <div className="space-y-4" data-testid="onboarding-done">
            <div className="bg-teal/10 rounded-xl p-4 text-sm text-navy">
              <p className="font-semibold">Set up on the login {pendingProfile.email}:</p>
              <ul className="list-disc pl-5 mt-1">
                {doneNames.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={startSibling}
                className="flex-1 flex items-center justify-center gap-2 border border-teal text-teal px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/5">
                <Plus size={16} /> Add another child to this login ({pendingProfile.email})
              </button>
              <button onClick={onComplete}
                className="flex-1 bg-teal text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90">
                Done
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
                {/* The session year follows the start date (lesson counts are per calendar year). */}
                <input type="text" value={enrolStartDate.slice(0, 4)} readOnly
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Registration Fee (₹)</label>
                <input type="number" min={0} value={s2.registration_fee}
                  onChange={e => setS2(p => ({ ...p, registration_fee: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="0" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Discount (optional)</label>
                <select value={s2.discount_primary}
                  onChange={e => setS2(p => ({ ...p, discount_primary: e.target.value as DiscountPrimary }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none">
                  <option value="none">No discount</option>
                  <option value="plan">Plan discount (auto)</option>
                  <option value="legacy">Legacy student (25%)</option>
                  <option value="special">Flat ₹ special</option>
                </select>
                {s2.discount_primary === 'special' && (
                  <input type="number" min={0} value={s2.discount_special}
                    onChange={e => setS2(p => ({ ...p, discount_special: e.target.value }))}
                    className="w-full mt-2 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                    placeholder="Flat ₹ amount" />
                )}
                <label className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                  <input type="checkbox" checked={s2.discount_multilesson}
                    onChange={e => setS2(p => ({ ...p, discount_multilesson: e.target.checked }))}
                    className="rounded border-gray-300 text-teal focus:ring-teal" />
                  Multi-lesson (+5%)
                </label>
              </div>
            </div>

            {/* Class rows */}
            <div className="border-t pt-4">
              <p className="text-xs font-bold text-gray-400 uppercase mb-3">Class Schedule</p>
              <div className="space-y-3">
                {classes.map((cls, idx) => (
                  <div key={idx} className="bg-gray-50 rounded-xl p-4" data-testid="class-row">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Teacher <span className="text-coral">*</span></label>
                        <select value={cls.teacher_id} onChange={e => updateClass(idx, { teacher_id: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none">
                          <option value="">Select teacher</option>
                          {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Instrument</label>
                        <select value={cls.instrument_id} onChange={e => updateClass(idx, { instrument_id: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none">
                          <option value="">Select instrument</option>
                          {instruments.filter(i => ALLOWED_INSTRUMENTS.includes(i.name)).map(i => (
                            <option key={i.id} value={i.id}>{i.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Times per week</label>
                        <select value={cls.times_per_week} aria-label="Times per week"
                          onChange={e => setClasses(prev => prev.map((c, i) => (i === idx ? withTimesPerWeek(c, Number(e.target.value)) : c)))}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none">
                          {TIMES_PER_WEEK_OPTIONS.map(t => <option key={t} value={t}>{t}× per week</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Location</label>
                        <select value={cls.location_id} onChange={e => updateClass(idx, { location_id: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:border-teal focus:outline-none">
                          <option value="">— Select location —</option>
                          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </div>
                    </div>
                    {/* One line per weekly lesson: Day · Start · End. */}
                    <div className="space-y-2">
                      <div className="hidden sm:grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-2 text-xs font-semibold text-gray-500">
                        <span />
                        <span>Day</span>
                        <span>Start</span>
                        <span>End</span>
                      </div>
                      {[{ day_of_week: cls.day_of_week, start_time: cls.start_time, end_time: cls.end_time }, ...cls.extra].map((x, k) => {
                        const set = (patch: { day_of_week?: string; start_time?: string; end_time?: string }) =>
                          (k === 0 ? updateClass(idx, patch) : updateExtra(idx, k - 1, patch));
                        const field = 'w-full min-w-0 border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:border-teal focus:outline-none';
                        const mini = 'block sm:hidden text-[11px] font-semibold text-gray-500 mb-0.5';
                        return (
                          <div key={k} className="grid grid-cols-2 sm:grid-cols-[4.5rem_1fr_1fr_1fr] gap-2 sm:items-center">
                            <span className="col-span-2 sm:col-span-1 text-xs font-semibold text-navy">{cls.times_per_week > 1 ? `Lesson ${k + 1}` : 'Weekly'}</span>
                            <label className="col-span-2 sm:col-span-1">
                              <span className={mini}>Day</span>
                              <select value={x.day_of_week} onChange={e => set({ day_of_week: e.target.value })}
                                aria-label={`Lesson ${k + 1} day`} className={field}>
                                {DAYS.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
                              </select>
                            </label>
                            <label>
                              <span className={mini}>Start</span>
                              <input type="time" value={x.start_time} onChange={e => set({ start_time: e.target.value })}
                                aria-label={`Lesson ${k + 1} start`} className={field} />
                            </label>
                            <label>
                              <span className={mini}>End</span>
                              <input type="time" value={x.end_time} onChange={e => set({ end_time: e.target.value })}
                                aria-label={`Lesson ${k + 1} end`} className={field} />
                            </label>
                          </div>
                        );
                      })}
                      {[{ day_of_week: cls.day_of_week, start_time: cls.start_time }, ...cls.extra].map((x, k) => {
                        const shared = sharedSlot(cls, x.day_of_week, x.start_time);
                        if (!shared) return null;
                        return (
                          <p key={`shared-${k}`} className="text-xs text-teal bg-teal/5 rounded-lg px-3 py-2" data-testid="shared-class">
                            {cls.times_per_week > 1 ? `Lesson ${k + 1}: ` : ''}shared with{' '}
                            {(shared.student_ids ?? []).filter(isFamily).map(id => slotStudents[id]?.full_name).filter(Boolean).join(', ') || 'a family member'}
                            {' '}(same family) — they sit in the same class. Each child pays for their own place.
                          </p>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <label className="text-xs font-semibold text-gray-500" htmlFor={`rate-${idx}`}>
                          Rate per lesson (₹){!isTrial && <span className="text-coral"> *</span>}
                        </label>
                        <input id={`rate-${idx}`} type="number" min={0} inputMode="decimal" value={cls.rate}
                          onChange={e => updateClass(idx, { rate: e.target.value })}
                          className={`w-28 border rounded-lg px-2 py-1.5 text-sm bg-white focus:border-teal focus:outline-none ${
                            !isTrial && !(rateOf(cls) > 0) ? 'border-coral/50' : 'border-gray-200'}`}
                          placeholder="e.g. 1200" />
                        {rateOf(cls) > 0 && (
                          <span className="text-xs text-teal font-semibold">
                            ₹{rateOf(cls).toLocaleString('en-IN')} × {lessonsBreakdown(s2.payment_plan, enrolStartDate, cls.times_per_week)}
                          </span>
                        )}
                      </div>
                      {classes.length > 1 && (
                        <button onClick={() => setClasses(prev => prev.filter((_, i) => i !== idx))} aria-label="Remove class" className="text-gray-400 hover:text-coral"><Trash2 size={14} /></button>
                      )}
                    </div>
                    {classErrors[idx] && <p className="text-xs text-coral mt-2" data-testid="class-error">{classErrors[idx]}</p>}
                  </div>
                ))}
              </div>
              <button onClick={() => setClasses(prev => [...prev, { ...emptyClass(), location_id: s1.location_id }])}
                className="flex items-center gap-1 text-sm text-teal font-semibold hover:underline mt-2">
                <Plus size={14} /> Add another class
              </button>
            </div>

            {/* Fee summary */}
            {tuition > 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2 text-sm" data-testid="fee-summary">
                <p className="text-xs font-bold text-gray-500 uppercase">Fee Summary</p>
                {classes.map((c, i) => rateOf(c) > 0 && (
                  <div key={i} className="flex justify-between text-gray-600">
                    <span>
                      {classes.length > 1 && <span className="text-gray-400">{instruments.find(x => x.id === c.instrument_id)?.name || `Class ${i + 1}`}: </span>}
                      ₹{rateOf(c).toLocaleString('en-IN')} × {lessonsBreakdown(s2.payment_plan, enrolStartDate, c.times_per_week)}
                    </span>
                    <span>₹{classTuition(c).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {tuitionDiscount > 0 && (
                  <div className="flex justify-between text-teal">
                    <span>Discount{discount.pct > 0 ? ` (${discount.pct}%${discount.flat > 0 ? ' + ₹' + discount.flat.toLocaleString('en-IN') : ''})` : discount.flat > 0 ? ` (₹${discount.flat.toLocaleString('en-IN')})` : ''}</span>
                    <span>−₹{tuitionDiscount.toLocaleString('en-IN')}</span>
                  </div>
                )}
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
              {!canConfirm && confirmBlockedReason && (
                <span className="text-xs text-coral ml-auto mr-3 text-right">{confirmBlockedReason}</span>
              )}
              <button onClick={() => handleConfirm(false)} disabled={saving || !canConfirm}
                title={!canConfirm ? (confirmBlockedReason ?? 'Enter the rate to confirm') : undefined}
                className="bg-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? 'Saving...' : 'Confirm & Finish'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
