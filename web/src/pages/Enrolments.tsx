import { toDateStr, parseDateStr } from '../lib/dates';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap, invalidateQueries, errorMessage } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import { useActiveStudentsList, useInstruments, useTeachersList } from '../hooks/useReference';
import { invalidateLessonViews } from '../hooks/useLessons';
import { useToast } from '../contexts/ToastContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { SlotPicker, slotError } from '../components/SlotPicker';
import type { SelectedSlot } from '../components/SlotPicker';
import { Plus, X, BookOpen, ChevronRight, CalendarPlus } from 'lucide-react';
import { RenewalWizard } from '../components/RenewalWizard';
import { useNavigate } from 'react-router-dom';
import { lessonsForPlan } from '../lib/lessonCount';
import { SkeletonList } from '../components/Skeleton';
import { computeDiscount, type DiscountPrimary } from '../lib/fees';

interface Enrolment {
  id: string;
  student_id: string;
  academic_year: string;
  total_lessons: number;
  lessons_used: number;
  payment_plan: string;
  rate_per_lesson: number;
  total_fee: number;
  student: { id: string; full_name: string } | null;
  instrument: { name: string } | null; // the enrolment's own class instrument
}

interface LessonRate {
  id: string;
  teacher_id: string | null;
  category: string;
  rate_per_lesson: number;
  is_online: boolean;
  location_id: string | null;
  academic_year: string | null;
}

interface EnrolResult {
  enrolment_id: string;
  lessons_scheduled: number;
  lessons_expected: number;
  lessons_joined: number;
  lessons_created: number;
  conflicts: number;
  conflict_dates: string[];
}

const ENROLMENT_COLUMNS =
  'id, student_id, academic_year, total_lessons, lessons_used, payment_plan, rate_per_lesson, total_fee, ' +
  'student:students(id, full_name), instrument:instruments(name)';

const PLAN_OPTIONS = [
  { value: 'trial', label: 'Trial (no payment)' },
  { value: '1_instalment', label: '1 Instalment' },
  { value: '3_instalments', label: '3 Instalments' },
  { value: '10_instalments', label: '10 Instalments' },
];

function oneYearFromToday() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return toDateStr(d);
}

function emptyForm() {
  return {
    student_id: '',
    lesson_rate_id: '',
    payment_plan: '3_instalments',
    start_date: toDateStr(new Date()),
    end_date: oneYearFromToday(),
    registration_fee: 0,
    rate_override: 0,
    discount_primary: 'none' as DiscountPrimary,
    discount_special: 0,
    discount_multilesson: false,
  };
}

/** Rates for an academic year; falls back to the latest year that has rates. */
/**
 * The rate card for a year: for each teacher/category/location/online combo,
 * that year's rate, or — if none was set for that year yet — the most recent
 * earlier one. (Previously one new-year rate hid every other rate.)
 */
function ratesForYear(rates: LessonRate[], year: string): { list: LessonRate[]; shownYear: string } {
  const best = new Map<string, LessonRate>();
  for (const r of rates) {
    const y = r.academic_year || year;
    if (y > year) continue;
    const key = [r.teacher_id ?? '', r.category, r.location_id ?? '', r.is_online].join('|');
    const cur = best.get(key);
    if (!cur || (cur.academic_year || year) < y) best.set(key, r);
  }
  const list = [...best.values()];
  const older = list.filter(r => r.academic_year && r.academic_year !== year);
  const shownYear = older.length === 0 ? year : older.reduce((m, r) => (r.academic_year! < m ? r.academic_year! : m), year);
  return { list, shownYear };
}

function fmtShortDate(d: string) {
  return parseDateStr(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Everything an enrolment create/delete touches. */
function invalidateAfterEnrolmentChange() {
  invalidateQueries('enrolments:');
  invalidateQueries('payments');
  invalidateQueries('students:');
  invalidateQueries('teacher-schedule:');
  invalidateLessonViews(); // also dashboard: and reports:
}

export function EnrolmentsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  // ── Data (cached: revisits render instantly) ──
  const enrolmentsQ = useQuery<Enrolment[]>('enrolments:list', () =>
    fetchAll<Enrolment>((from, to) =>
      supabase.from('student_enrolments').select(ENROLMENT_COLUMNS)
        .order('created_at', { ascending: false }).order('id').range(from, to)));
  const ratesQ = useQuery<LessonRate[]>('lesson-rates:enrol-picker', async () =>
    unwrap(await supabase.from('lesson_rates')
      .select('id, teacher_id, category, rate_per_lesson, is_online, location_id, academic_year')
      .order('category'), []) as LessonRate[]);
  const { students } = useActiveStudentsList();
  const { teachers } = useTeachersList(); // approved only
  const { instruments } = useInstruments();
  const enrolments = enrolmentsQ.data ?? [];

  const [modal, setModal] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false); // inline field errors after "Next"
  const [confirmDelete, setConfirmDelete] = useState<Enrolment | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [manualTeacherId, setManualTeacherId] = useState('');
  const [result, setResult] = useState<{ text: string; warning: string | null } | null>(null);
  const [classDone, setClassDone] = useState(false);   // a class was just created; offer "add another"
  const [addedCount, setAddedCount] = useState(0);      // classes created this session
  const [form, setForm] = useState(emptyForm);

  // Only rates of approved teachers (or teacher-less rates) can be picked.
  const rates = useMemo(() => {
    const approved = new Set(teachers.map(t => t.id));
    return (ratesQ.data ?? []).filter(r => !r.teacher_id || approved.has(r.teacher_id));
  }, [ratesQ.data, teachers]);

  // Academic year always follows the start date.
  const academicYear = form.start_date.slice(0, 4);
  const { list: yearRates, shownYear: rateYear } = ratesForYear(rates, academicYear);

  const isTrial = form.payment_plan === 'trial';
  const selectedRate = yearRates.find(r => r.id === form.lesson_rate_id);
  // Per-student rate: defaults to the rate-card value but can be overridden.
  const effectiveRate = form.rate_override || 0;
  const selectedStudent = students.find(s => s.id === form.student_id);
  const instrumentName = (id: string | null | undefined) => instruments.find(i => i.id === id)?.name;
  const filteredRates = selectedStudent?.location_id
    ? yearRates.filter(r => r.location_id === selectedStudent.location_id || r.location_id === null)
    : yearRates;
  const hasLocationRates = !!(selectedStudent?.location_id &&
    yearRates.some(r => r.location_id === selectedStudent.location_id));
  const totalLessons = lessonsForPlan(form.payment_plan, form.start_date);
  const tuition = effectiveRate * totalLessons;
  const discount = computeDiscount(tuition, {
    primary: form.discount_primary,
    plan: form.payment_plan,
    specialAmount: form.discount_special || 0,
    multilesson: form.discount_multilesson,
  });
  const tuitionDiscount = discount.discountAmount;
  // total_fee stores discounted tuition; registration fee is separate.
  const totalFee = discount.discounted;
  const teacherId = selectedRate?.teacher_id || manualTeacherId || '';
  const teacherName = teachers.find(t => t.id === teacherId)?.full_name || '';

  // A slot belongs to one teacher: forget it whenever the teacher changes.
  useEffect(() => { setSelectedSlot(null); }, [teacherId]);

  // Client-side checks mirroring enrol_student (negative values flag immediately).
  const fieldErrors = {
    student: !form.student_id ? 'Please select a student' : null,
    rate: !isTrial && !form.lesson_rate_id ? 'Please select a lesson rate'
      : !isTrial && !(effectiveRate > 0) ? 'Enter a rate greater than ₹0 (or choose the Trial plan)'
      : effectiveRate < 0 ? 'Rate cannot be negative' : null,
    dates: form.end_date <= form.start_date ? 'End date must be after the start date' : null,
    registration: !(form.registration_fee >= 0) ? 'Registration fee cannot be negative' : null,
    discount: form.discount_primary === 'special' && !(form.discount_special >= 0) ? 'Discount cannot be negative' : null,
  };
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);
  const fieldError = (k: keyof typeof fieldErrors) =>
    (showErrors || k === 'registration' || k === 'discount') ? fieldErrors[k] : null;

  function handleStep1Next() {
    setShowErrors(true);
    if (hasFieldErrors) return;
    setFormError(null);
    setStep(2);
  }

  function pickRate(id: string) {
    const picked = yearRates.find(r => r.id === id);
    setForm(f => ({ ...f, lesson_rate_id: id, rate_override: Number(picked?.rate_per_lesson) || 0 }));
    setSelectedSlot(null); // the slot was chosen for the previous rate's teacher
  }

  function changeStartDate(start_date: string) {
    setForm(f => {
      // A new academic year may offer different rates: drop a rate that's no longer listed.
      const stillListed = ratesForYear(rates, start_date.slice(0, 4)).list.some(r => r.id === f.lesson_rate_id);
      return stillListed ? { ...f, start_date } : { ...f, start_date, lesson_rate_id: '', rate_override: 0 };
    });
  }

  // Reset only the class-specific fields, keeping the student, dates and plan, so
  // the coordinator can add another class (e.g. Violin after Guitar) in one pass.
  function resetForNextClass() {
    setStep(1);
    setSelectedSlot(null);
    setManualTeacherId('');
    setResult(null);
    setFormError(null);
    setShowErrors(false);
    setClassDone(false);
    setForm(f => ({
      ...f,
      lesson_rate_id: '',
      rate_override: 0,
      registration_fee: 0,
      discount_primary: 'none',
      discount_special: 0,
      discount_multilesson: false,
    }));
  }

  function closeModal() {
    setModal(false);
    setStep(1);
    setSelectedSlot(null);
    setManualTeacherId('');
    setResult(null);
    setFormError(null);
    setShowErrors(false);
    setClassDone(false);
    setAddedCount(0);
    setForm(emptyForm());
  }

  // One transactional call: enrolment + weekly slot + lessons + instalments.
  async function handleCreate() {
    if (saving) return;
    if (hasFieldErrors) { setStep(1); setShowErrors(true); return; }
    if (!teacherId) { setFormError('Please select a teacher'); return; }
    const slotErr = slotError(selectedSlot);
    if (slotErr || !selectedSlot) { setFormError(slotErr); return; }
    const slot = selectedSlot;

    setSaving(true);
    setFormError(null);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc('enrol_student', {
        p_student_id: form.student_id,
        p_teacher_id: teacherId,
        p_payment_plan: form.payment_plan,
        p_start_date: form.start_date,
        p_end_date: form.end_date,
        p_total_lessons: totalLessons,
        p_rate_per_lesson: effectiveRate,
        p_total_fee: totalFee,
        p_registration_fee: form.registration_fee || 0,
        p_lesson_rate_id: form.lesson_rate_id || null,
        p_academic_year: academicYear,
        p_discount_primary: form.discount_primary,
        p_discount_multilesson: form.discount_multilesson,
        p_discount_value: form.discount_primary === 'special' ? (form.discount_special || 0) : 0,
        p_location_id: selectedStudent?.location_id ?? null,
        ...(slot.mode === 'existing'
          ? { p_template_id: slot.templateId }
          : {
              p_day_of_week: slot.dayOfWeek,
              p_start_time: slot.startTime,
              p_end_time: slot.endTime || null,
              p_instrument_id: slot.instrumentId,
              p_title: slot.title.trim() || null,
            }),
      });
      if (error) throw error;
      const r = data as EnrolResult;

      const name = instrumentName(slot.instrumentId) || 'Class';
      const joined = r.lessons_joined > 0 ? ` (${r.lessons_joined} in an existing class)` : '';
      let warning: string | null = null;
      if (r.lessons_scheduled < r.lessons_expected || r.conflicts > 0) {
        const dates = r.conflict_dates ?? [];
        const shown = dates.slice(0, 6).map(fmtShortDate).join(', ') + (dates.length > 6 ? ` +${dates.length - 6} more` : '');
        warning = (r.lessons_scheduled < r.lessons_expected
            ? `Only ${r.lessons_scheduled} of ${r.lessons_expected} lessons fit before the end date.`
            : `All ${r.lessons_scheduled} lessons scheduled, but some weeks were skipped.`) +
          (r.conflicts > 0
            ? ` ${r.conflicts} week${r.conflicts !== 1 ? 's' : ''} clashed with ${teacherName || 'the teacher'}'s other lessons: ${shown}.`
            : '') +
          ' Add the missing lessons from the Schedule page or extend the end date.';
      }
      setResult({ text: `${name} added — ${r.lessons_scheduled} lesson${r.lessons_scheduled !== 1 ? 's' : ''} scheduled${joined}.`, warning });
      setAddedCount(c => c + 1);
      setClassDone(true); // show the "add another class / done" choice
      invalidateAfterEnrolmentChange();
    } catch (err: unknown) {
      setFormError(errorMessage(err, 'Failed to create enrolment'));
    } finally {
      setSaving(false);
    }
  }

  // delete_enrolment removes unpaid instalments + future lessons; paid history stays.
  async function handleDelete(e: Enrolment) {
    if (deleting) return;
    setDeleting(true);
    const { data, error } = await supabase.rpc('delete_enrolment', { p_enrolment_id: e.id });
    setDeleting(false);
    setConfirmDelete(null);
    if (error) { showToast('error', `Couldn't delete enrolment: ${error.message}`); return; }
    const r = (data ?? {}) as { unpaid_instalments_removed?: number; future_lessons_removed?: number };
    const n = (v: number | undefined, word: string) => `${v ?? 0} ${word}${v === 1 ? '' : 's'}`;
    showToast('success', `Enrolment deleted — removed ${n(r.unpaid_instalments_removed, 'unpaid instalment')} and ${n(r.future_lessons_removed, 'upcoming lesson')}.`);
    invalidateAfterEnrolmentChange();
  }

  // All active students are available (multi-instrument enrolments allowed)
  const availableStudents = students;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Enrolments</h1>
          <p className="text-gray-500 text-sm mt-1">Annual lesson plans & payment instalments</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRenewOpen(true)}
            className="flex items-center gap-2 border border-teal text-teal px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal/5"
          >
            <CalendarPlus size={16} /> <span className="hidden sm:inline">Renew for next year</span><span className="sm:hidden">Renew</span>
          </button>
          <button
            onClick={() => setModal(true)}
            className="flex items-center gap-2 bg-teal text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal/80"
          >
            <Plus size={16} /> Enrol Student
          </button>
        </div>
      </div>

      <RenewalWizard open={renewOpen} onClose={() => setRenewOpen(false)} />

      {enrolmentsQ.error && <ErrorBanner message={enrolmentsQ.error} onRetry={enrolmentsQ.refresh} />}

      {enrolmentsQ.loading ? (
        <SkeletonList rows={5} />
      ) : enrolments.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No enrolments yet</p>
          <p className="text-gray-300 text-xs mt-1">Click "Enrol Student" to create the first one</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-black/5 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/80 text-left text-xs text-gray-500 uppercase">
                  <th className="px-5 py-3 font-medium">Student</th>
                  <th className="px-5 py-3 font-medium">Year</th>
                  <th className="px-5 py-3 font-medium">Rate</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Progress</th>
                  <th className="px-5 py-3 font-medium">Total Fee</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {enrolments.map((e) => {
                  const pct = e.total_lessons > 0 ? Math.round((e.lessons_used / e.total_lessons) * 100) : 0;
                  return (
                    <tr key={e.id} className="hover:bg-gray-50/50">
                      <td className="px-5 py-3">
                        <button onClick={() => navigate(`/students/${e.student_id}`)} className="text-left">
                          <p className="text-sm font-medium text-navy hover:underline">{e.student?.full_name || '-'}</p>
                          {e.instrument && <p className="text-xs text-gray-400">{e.instrument.name}</p>}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500">{e.academic_year}</td>
                      <td className="px-5 py-3 text-sm text-navy font-medium">₹{Number(e.rate_per_lesson).toLocaleString('en-IN')}</td>
                      <td className="px-5 py-3"><span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e.payment_plan?.replace(/_/g, ' ')}</span></td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-gray-100 rounded-full h-2">
                            <div className="bg-teal rounded-full h-2" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{e.lessons_used}/{e.total_lessons}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-navy">₹{Number(e.total_fee).toLocaleString('en-IN')}</td>
                      <td className="px-5 py-3">
                        <button onClick={() => setConfirmDelete(e)} className="text-gray-400 hover:text-coral text-xs">Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {enrolments.map((e) => {
              const pct = e.total_lessons > 0 ? Math.round((e.lessons_used / e.total_lessons) * 100) : 0;
              return (
                <div key={e.id} onClick={() => navigate(`/students/${e.student_id}`)}
                  className="bg-white rounded-xl border border-black/5 p-4 cursor-pointer hover:shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-navy text-sm">{e.student?.full_name || '-'}</p>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e.payment_plan?.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                    <span>{e.instrument ? `${e.instrument.name} · ` : ''}{e.academic_year} · ₹{Number(e.rate_per_lesson).toLocaleString('en-IN')}/lesson</span>
                    <span className="font-semibold text-navy">₹{Number(e.total_fee).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div className="bg-teal rounded-full h-2" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <span className="text-xs text-gray-500">{e.lessons_used}/{e.total_lessons}</span>
                    <ChevronRight size={14} className="text-gray-300" />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Enrolment"
        message={`Delete ${confirmDelete?.student?.full_name || 'this student'}'s ${confirmDelete?.instrument?.name || ''} enrolment? `
          + 'Its unpaid instalments and upcoming lessons will be removed. Paid instalments and past lessons are kept.'}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => { if (!deleting) setConfirmDelete(null); }}
      />

      {/* Create Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-navy text-lg">Enrol Student</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Step {step} of 2 — {step === 1 ? 'Enrolment Details' : 'Assign Schedule Slot'}
                </p>
              </div>
              <button onClick={closeModal} disabled={saving} className="text-gray-400 hover:text-navy disabled:opacity-50"><X size={20} /></button>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-2">
              <div className={`flex-1 h-1 rounded-full ${step >= 1 ? 'bg-teal' : 'bg-gray-200'}`} />
              <div className={`flex-1 h-1 rounded-full ${step >= 2 ? 'bg-teal' : 'bg-gray-200'}`} />
            </div>

            {formError && (
              <div className="bg-coral/10 border border-coral/20 rounded-lg p-3">
                <p className="text-coral text-sm">{formError}</p>
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
                    {availableStudents.map((s) => {
                      const instr = instrumentName(s.instrument_id);
                      return <option key={s.id} value={s.id}>{s.full_name}{instr ? ` (${instr})` : ''}</option>;
                    })}
                  </select>
                  {fieldError('student') && <p className="text-xs text-coral mt-1">{fieldError('student')}</p>}
                  {availableStudents.length === 0 && (
                    <p className="text-xs text-gray-400 mt-1">No active students found</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Lesson Rate</label>
                  {rateYear !== academicYear && (
                    <p className="text-xs text-yellow-600 mb-1">Some rates have no {academicYear} value yet — using the latest earlier rate ({rateYear}).</p>
                  )}
                  {selectedStudent?.location_id && hasLocationRates && (
                    <p className="text-xs text-teal mb-1">Showing rates for this student's location first.</p>
                  )}
                  {selectedStudent?.location_id && !hasLocationRates && (
                    <p className="text-xs text-yellow-600 mb-1">No location-specific rates set — showing all rates.</p>
                  )}
                  <select
                    value={form.lesson_rate_id}
                    onChange={(e) => pickRate(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select rate...</option>
                    {filteredRates.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.category} — ₹{Number(r.rate_per_lesson).toLocaleString('en-IN')}
                        {r.is_online ? ' (Online)' : ''}
                        {r.teacher_id ? ` — ${teachers.find(t => t.id === r.teacher_id)?.full_name ?? ''}` : ''}
                        {r.location_id ? ' ★' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="mt-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Rate per lesson (₹) — editable for this student</label>
                    <input
                      type="number"
                      min={0}
                      value={form.rate_override}
                      onChange={(e) => setForm({ ...form, rate_override: Number(e.target.value) })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      placeholder="0"
                    />
                    {selectedRate && effectiveRate !== Number(selectedRate.rate_per_lesson) && (
                      <p className="text-xs text-yellow-600 mt-1">
                        Overriding rate-card default of ₹{Number(selectedRate.rate_per_lesson).toLocaleString('en-IN')}.
                      </p>
                    )}
                    {fieldError('rate') && <p className="text-xs text-coral mt-1">{fieldError('rate')}</p>}
                  </div>
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
                      readOnly
                      value={academicYear}
                      title="Follows the start date"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={form.start_date}
                      onChange={(e) => changeStartDate(e.target.value)}
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
                {fieldError('dates') && <p className="text-xs text-coral -mt-2">{fieldError('dates')}</p>}

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
                  {fieldError('registration') && <p className="text-xs text-coral mt-1">{fieldError('registration')}</p>}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Discount (optional)</label>
                  <select
                    value={form.discount_primary}
                    onChange={(e) => setForm({ ...form, discount_primary: e.target.value as DiscountPrimary })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="none">No discount</option>
                    <option value="plan">Plan discount (auto)</option>
                    <option value="legacy">Legacy student (25%)</option>
                    <option value="special">Flat ₹ special</option>
                  </select>
                  {form.discount_primary === 'special' && (
                    <input
                      type="number"
                      min={0}
                      value={form.discount_special}
                      onChange={(e) => setForm({ ...form, discount_special: Number(e.target.value) })}
                      className="w-full mt-2 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      placeholder="Flat ₹ amount"
                    />
                  )}
                  {fieldError('discount') && <p className="text-xs text-coral mt-1">{fieldError('discount')}</p>}
                  <label className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={form.discount_multilesson}
                      onChange={(e) => setForm({ ...form, discount_multilesson: e.target.checked })}
                      className="rounded border-gray-300 text-teal focus:ring-teal"
                    />
                    Multi-lesson (+5%)
                  </label>
                </div>

                {/* Fee Summary */}
                {selectedRate && form.payment_plan !== 'trial' && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase">Fee Summary</h4>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">₹{effectiveRate.toLocaleString('en-IN')} × {totalLessons} lessons</span>
                      <span className="font-medium text-navy">₹{tuition.toLocaleString('en-IN')}</span>
                    </div>
                    {tuitionDiscount > 0 && (
                      <div className="flex justify-between text-sm text-teal">
                        <span>Discount{discount.pct > 0 ? ` (${discount.pct}%${discount.flat > 0 ? ' + ₹' + discount.flat.toLocaleString('en-IN') : ''})` : discount.flat > 0 ? ` (₹${discount.flat.toLocaleString('en-IN')})` : ''}</span>
                        <span>−₹{tuitionDiscount.toLocaleString('en-IN')}</span>
                      </div>
                    )}
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
                  {/* Fixed when the chosen rate belongs to a teacher; otherwise pick (and re-pick) here. */}
                  {selectedRate?.teacher_id ? (
                    <div className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-navy font-medium">
                      {teacherName}
                    </div>
                  ) : (
                    <select
                      value={manualTeacherId}
                      onChange={(e) => { setManualTeacherId(e.target.value); setSelectedSlot(null); }}
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
                {teacherId && (
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

                {result && (
                  <div className="rounded-lg p-3 text-sm font-medium bg-teal/10 text-teal">
                    {result.text}
                    {addedCount > 1 && <span className="text-teal/70"> ({addedCount} classes added so far)</span>}
                  </div>
                )}
                {result?.warning && (
                  <div className="rounded-lg p-3 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800">
                    ⚠ {result.warning}
                  </div>
                )}

                {classDone ? (
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={resetForNextClass}
                      className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90"
                    >
                      + Add another class for {selectedStudent?.full_name?.split(' ')[0] || 'this student'}
                    </button>
                    <button
                      type="button"
                      onClick={closeModal}
                      className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => { setStep(1); setFormError(null); setResult(null); }}
                      disabled={saving}
                      className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200 disabled:opacity-50"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={handleCreate}
                      disabled={saving || !teacherId || !!slotError(selectedSlot)}
                      className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
                    >
                      {saving ? 'Creating...' : 'Save & Generate Lessons'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
