import { toDateStr, parseDateStr } from '../lib/dates';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, invalidateQueries, errorMessage } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import { useActiveStudentsList, useInstruments, useTeachersList, useLocationsList } from '../hooks/useReference';
import { invalidateLessonViews } from '../hooks/useLessons';
import { useToast } from '../contexts/ToastContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { useTeacherTemplates, weeklySlotsError, type SelectedSlot } from '../components/SlotPicker';
import { checkWeeklyTime } from '../lib/weeklyClash';
import { Plus, X, BookOpen, ChevronRight, CalendarPlus } from 'lucide-react';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
interface LessonTime { day: number; start: string; end: string }
const DEFAULT_TIMES: LessonTime[] = [{ day: 1, start: '09:00', end: '09:45' }, { day: 4, start: '09:00', end: '09:45' }, { day: 6, start: '09:00', end: '09:45' }];
import { RenewalWizard } from '../components/RenewalWizard';
import { useNavigate } from 'react-router-dom';
import {
  lessonsForClass, lessonsBreakdown, timesPerWeekLabel, normaliseTimesPerWeek, TIMES_PER_WEEK_OPTIONS,
} from '../lib/lessonCount';
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
  extra_template_ids: string[] | null; // 2nd/3rd weekly slots (2×/3× per week)
  student: { id: string; full_name: string } | null;
  instrument: { name: string } | null; // the enrolment's own class instrument
}

interface EnrolResult {
  enrolment_id: string;
  lessons_scheduled: number;
  lessons_expected: number;
  lessons_joined: number;
  lessons_created: number;
  conflicts: number;
  conflict_dates: string[];
  slots?: number;
}

const ENROLMENT_COLUMNS =
  'id, student_id, academic_year, total_lessons, lessons_used, payment_plan, rate_per_lesson, total_fee, extra_template_ids, ' +
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
    payment_plan: '3_instalments',
    start_date: toDateStr(new Date()),
    end_date: oneYearFromToday(),
    registration_fee: 0,
    rate_text: '',        // typed by the coordinator for every enrolment — never pre-filled
    times_per_week: 1,
    teacher_id: '',
    instrument_id: '',
    location_id: '',
    discount_primary: 'none' as DiscountPrimary,
    discount_special: 0,
    discount_multilesson: false,
  };
}

/** 1 + the class's extra weekly slots (2× / 3× per week). */
const timesOf = (e: Pick<Enrolment, 'extra_template_ids'>) => 1 + (e.extra_template_ids?.length ?? 0);

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
  const { students } = useActiveStudentsList();
  const { teachers } = useTeachersList(); // approved only
  const { instruments } = useInstruments();
  const { locations } = useLocationsList();
  const enrolments = enrolmentsQ.data ?? [];

  const [modal, setModal] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false); // inline field errors after "Next"
  const [confirmDelete, setConfirmDelete] = useState<Enrolment | null>(null);
  // Day + start + end for each lesson of the week (2× per week = 2 lines).
  const [times, setTimes] = useState<LessonTime[]>([DEFAULT_TIMES[0]]);
  const [result, setResult] = useState<{ text: string; warning: string | null } | null>(null);
  const [classDone, setClassDone] = useState(false);   // a class was just created; offer "add another"
  const [addedCount, setAddedCount] = useState(0);      // classes created this session
  const [form, setForm] = useState(emptyForm);

  // Academic year always follows the start date.
  const academicYear = form.start_date.slice(0, 4);

  const isTrial = form.payment_plan === 'trial';
  // The coordinator types the rate for every enrolment (no rate card pre-fill).
  const effectiveRate = form.rate_text.trim() === '' ? 0 : Number(form.rate_text);
  const selectedStudent = students.find(s => s.id === form.student_id);
  const instrumentName = (id: string | null | undefined) => instruments.find(i => i.id === id)?.name;
  const timesPerWeek = normaliseTimesPerWeek(form.times_per_week);
  const totalLessons = lessonsForClass(form.payment_plan, form.start_date, timesPerWeek);
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
  const teacherId = form.teacher_id;
  const teacherName = teachers.find(t => t.id === teacherId)?.full_name || '';

  // One line per weekly lesson: grow/shrink with "times per week" (keeping what's typed).
  useEffect(() => {
    setTimes(prev => (prev.length === timesPerWeek ? prev
      : Array.from({ length: timesPerWeek }, (_, i) => prev[i] ?? DEFAULT_TIMES[i])));
  }, [timesPerWeek]);
  const setTimeAt = (i: number, patch: Partial<LessonTime>) =>
    setTimes(prev => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // The teacher's existing weekly classes: a brother/sister's class at the same time is
  // shared (joined); anyone else's overlapping class is a clash that blocks saving.
  const { data: teacherSlots } = useTeacherTemplates(teacherId || null);
  const isFamily = (id: string) => {
    if (!selectedStudent) return false;
    if (id === selectedStudent.id) return true;
    const other = students.find(s => s.id === id);
    if (!other) return false;
    if (selectedStudent.user_id && other.user_id === selectedStudent.user_id) return true;
    const em = (selectedStudent.email ?? '').trim().toLowerCase();
    return !!em && (other.email ?? '').trim().toLowerCase() === em;
  };
  const checks = times.map(x => checkWeeklyTime({
    slots: teacherSlots ?? [], teacherId, teacherName, instrumentId: form.instrument_id || null,
    day: x.day, start: x.start, end: x.end, isFamily,
    nameOf: id => students.find(s => s.id === id)?.full_name,
  }));
  // As SelectedSlots so the shared overlap/same-slot checks apply.
  const asSlots: SelectedSlot[] = times.map((x, i) => (checks[i].join
    ? { mode: 'existing', templateId: checks[i].join!.id, dayOfWeek: x.day, startTime: checks[i].join!.start_time,
        endTime: checks[i].join!.end_time, instrumentId: checks[i].join!.instrument_id, title: checks[i].join!.title }
    : { mode: 'new', dayOfWeek: x.day, startTime: x.start, endTime: x.end, instrumentId: form.instrument_id || null, title: '' }));
  const timesError = (() => {
    for (const x of times) {
      if (!x.start) return 'Choose a start time for every lesson';
      if (x.end && x.end <= x.start) return 'End time must be after the start time';
    }
    return weeklySlotsError(asSlots) ?? checks.find(c => c.clash)?.clash ?? null;
  })();

  // Client-side checks mirroring enrol_student (negative values flag immediately).
  const fieldErrors = {
    student: !form.student_id ? 'Please select a student' : null,
    teacher: !form.teacher_id ? 'Choose the teacher' : null,
    instrument: !form.instrument_id ? 'Choose the instrument' : null,
    rate: !Number.isFinite(effectiveRate) || effectiveRate < 0 ? 'Rate cannot be negative'
      : !isTrial && !(effectiveRate > 0) ? 'Enter the rate per lesson (₹) — or choose the Trial plan'
      : null,
    dates: form.end_date <= form.start_date ? 'End date must be after the start date' : null,
    registration: !(form.registration_fee >= 0) ? 'Registration fee cannot be negative' : null,
    discount: form.discount_primary === 'special' && !(form.discount_special >= 0) ? 'Discount cannot be negative' : null,
  };
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);
  const fieldError = (k: keyof typeof fieldErrors) =>
    (showErrors || k === 'registration' || k === 'discount') ? fieldErrors[k] : null;

  // Reset only the class-specific fields, keeping the student, dates and plan, so
  // the coordinator can add another class (e.g. Violin after Guitar) in one pass.
  function resetForNextClass() {
    setTimes([DEFAULT_TIMES[0]]);
    setResult(null);
    setFormError(null);
    setShowErrors(false);
    setClassDone(false);
    setForm(f => ({
      ...f,
      teacher_id: '',
      instrument_id: '',
      rate_text: '',
      times_per_week: 1,
      registration_fee: 0,
      discount_primary: 'none',
      discount_special: 0,
      discount_multilesson: false,
    }));
  }

  function closeModal() {
    setModal(false);
    setTimes([DEFAULT_TIMES[0]]);
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
    setShowErrors(true);
    if (hasFieldErrors) { setFormError('Fill in the fields marked in red'); return; }
    if (timesError) { setFormError(timesError); return; }
    const main = asSlots[0];
    const instrName = instrumentName(form.instrument_id) ?? '';
    const extras = asSlots.slice(1).map(sl => (sl.mode === 'existing'
      ? { template_id: sl.templateId }
      : { day_of_week: sl.dayOfWeek, start_time: sl.startTime, end_time: sl.endTime || null }));

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
        p_lesson_rate_id: null, // rate is typed per enrolment, not taken from the rate card
        p_academic_year: academicYear,
        p_discount_primary: form.discount_primary,
        p_discount_multilesson: form.discount_multilesson,
        p_discount_value: form.discount_primary === 'special' ? (form.discount_special || 0) : 0,
        p_location_id: form.location_id || selectedStudent?.location_id || null,
        ...(main.mode === 'existing'
          ? { p_template_id: main.templateId }
          : {
              p_day_of_week: main.dayOfWeek,
              p_start_time: main.startTime,
              p_end_time: main.endTime || null,
              p_instrument_id: form.instrument_id,
              p_title: `${selectedStudent?.full_name ?? 'Lesson'}${instrName ? ` – ${instrName}` : ''}`,
            }),
        p_extra_slots: extras, // 2× / 3× per week: the class's other weekly lessons
      });
      if (error) throw error;
      const r = data as EnrolResult;

      const name = instrName || 'Class';
      const joined = r.lessons_joined > 0 ? ` (${r.lessons_joined} in an existing class)` : '';
      let warning: string | null = null;
      if (r.lessons_scheduled < r.lessons_expected || r.conflicts > 0) {
        const dates = r.conflict_dates ?? [];
        const shown = dates.slice(0, 6).map(fmtShortDate).join(', ') + (dates.length > 6 ? ` +${dates.length - 6} more` : '');
        warning = (r.lessons_scheduled < r.lessons_expected
            ? `Only ${r.lessons_scheduled} of ${r.lessons_expected} lessons fit before the end date.`
            : `All ${r.lessons_scheduled} lessons scheduled, but some weeks were skipped.`) +
          (r.conflicts > 0
            ? ` ${r.conflicts} date${r.conflicts !== 1 ? 's' : ''} clashed with ${teacherName || 'the teacher'}'s other lessons: ${shown}.`
            : '') +
          ' Add the missing lessons from the Schedule page or extend the end date.';
      }
      const often = timesPerWeek > 1 ? ` (${timesPerWeekLabel(timesPerWeek)})` : '';
      setResult({ text: `${name}${often} added — ${r.lessons_scheduled} lesson${r.lessons_scheduled !== 1 ? 's' : ''} scheduled${joined}.`, warning });
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
                          {(e.instrument || timesOf(e) > 1) && (
                            <p className="text-xs text-gray-400">
                              {e.instrument?.name}
                              {timesOf(e) > 1 && <span className="ml-1.5 bg-teal/10 text-teal font-semibold px-1.5 py-0.5 rounded">{timesPerWeekLabel(timesOf(e))}</span>}
                            </p>
                          )}
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
                    <span>{e.instrument ? `${e.instrument.name} · ` : ''}{timesOf(e) > 1 ? `${timesPerWeekLabel(timesOf(e))} · ` : ''}{e.academic_year} · ₹{Number(e.rate_per_lesson).toLocaleString('en-IN')}/lesson</span>
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

      {/* Create Modal — everything on one form */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-navy text-lg">Enrol Student</h3>
                <p className="text-xs text-gray-400 mt-0.5">Put an existing student in a class</p>
              </div>
              <button onClick={closeModal} disabled={saving} className="text-gray-400 hover:text-navy disabled:opacity-50"><X size={20} /></button>
            </div>

            {formError && (
              <div className="bg-coral/10 border border-coral/20 rounded-lg p-3">
                <p className="text-coral text-sm">{formError}</p>
              </div>
            )}

            <fieldset disabled={classDone || saving} className="space-y-4">
              {/* Student */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Student <span className="text-coral">*</span></label>
                <select
                  id="enrol-student"
                  value={form.student_id}
                  onChange={(e) => {
                    const st = students.find(s => s.id === e.target.value);
                    setForm(f => ({ ...f, student_id: e.target.value, location_id: st?.location_id ?? f.location_id }));
                  }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">Select student...</option>
                  {availableStudents.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
                {fieldError('student') && <p className="text-xs text-coral mt-1">{fieldError('student')}</p>}
                {availableStudents.length === 0 && <p className="text-xs text-gray-400 mt-1">No active students found</p>}
              </div>

              {/* The class */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-gray-400 uppercase">Class</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="enrol-teacher" className="block text-xs font-medium text-gray-500 mb-1">Teacher <span className="text-coral">*</span></label>
                    <select id="enrol-teacher" value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">Select teacher...</option>
                      {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                    </select>
                    {fieldError('teacher') && <p className="text-xs text-coral mt-1">{fieldError('teacher')}</p>}
                  </div>
                  <div>
                    <label htmlFor="enrol-instrument" className="block text-xs font-medium text-gray-500 mb-1">Instrument <span className="text-coral">*</span></label>
                    <select id="enrol-instrument" value={form.instrument_id} onChange={(e) => setForm({ ...form, instrument_id: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">Select instrument...</option>
                      {instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    {fieldError('instrument') && <p className="text-xs text-coral mt-1">{fieldError('instrument')}</p>}
                  </div>
                  <div>
                    <label htmlFor="enrol-times" className="block text-xs font-medium text-gray-500 mb-1">Times per week</label>
                    <select id="enrol-times" value={timesPerWeek} onChange={(e) => setForm({ ...form, times_per_week: Number(e.target.value) })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                      {TIMES_PER_WEEK_OPTIONS.map(n => <option key={n} value={n}>{n}× per week</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="enrol-location" className="block text-xs font-medium text-gray-500 mb-1">Location</label>
                    <select id="enrol-location" value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">— Select location —</option>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* One line per weekly lesson: Day · Start · End */}
                <div className="space-y-2">
                  <div className="hidden sm:grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-2 text-xs font-medium text-gray-500">
                    <span /><span>Day</span><span>Start</span><span>End</span>
                  </div>
                  {times.map((x, i) => {
                    const mini = 'block sm:hidden text-[11px] font-medium text-gray-500 mb-0.5';
                    const f = 'w-full min-w-0 border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white';
                    return (
                      <div key={i} className="grid grid-cols-2 sm:grid-cols-[4.5rem_1fr_1fr_1fr] gap-2 sm:items-center" data-testid="lesson-time">
                        <span className="col-span-2 sm:col-span-1 text-xs font-semibold text-navy">{timesPerWeek > 1 ? `Lesson ${i + 1}` : 'Weekly'}</span>
                        <label className="col-span-2 sm:col-span-1">
                          <span className={mini}>Day</span>
                          <select aria-label={`Lesson ${i + 1} day`} value={x.day} onChange={(e) => setTimeAt(i, { day: Number(e.target.value) })} className={f}>
                            {DAYS.map((d, k) => <option key={k} value={k}>{d}</option>)}
                          </select>
                        </label>
                        <label>
                          <span className={mini}>Start</span>
                          <input type="time" aria-label={`Lesson ${i + 1} start`} value={x.start} onChange={(e) => setTimeAt(i, { start: e.target.value })} className={f} />
                        </label>
                        <label>
                          <span className={mini}>End</span>
                          <input type="time" aria-label={`Lesson ${i + 1} end`} value={x.end} onChange={(e) => setTimeAt(i, { end: e.target.value })} className={f} />
                        </label>
                      </div>
                    );
                  })}
                  {checks.map((c, i) => c.join && (
                    <p key={`j${i}`} className="text-xs text-teal bg-teal/5 rounded-lg px-3 py-2" data-testid="shared-class">
                      {timesPerWeek > 1 ? `Lesson ${i + 1}: ` : ''}shared with{' '}
                      {(c.join.student_ids ?? []).filter(isFamily).map(id => students.find(s => s.id === id)?.full_name).filter(Boolean).join(', ') || 'a family member'}
                      {' '}(same family) — they sit in the same class. Each child pays for their own place.
                    </p>
                  ))}
                  {form.teacher_id && timesError && <p className="text-xs text-coral" data-testid="slots-error">{timesError}</p>}
                </div>

                <div>
                  <label htmlFor="enrol-rate" className="block text-xs font-medium text-gray-500 mb-1">
                    Rate per lesson (₹){!isTrial && <span className="text-coral"> *</span>}
                  </label>
                  <div className="flex items-center gap-3 flex-wrap">
                    <input id="enrol-rate" type="number" min={0} inputMode="decimal" value={form.rate_text}
                      onChange={(e) => setForm({ ...form, rate_text: e.target.value })}
                      className={`w-32 border rounded-lg px-3 py-2 text-sm bg-white ${fieldError('rate') ? 'border-coral/60' : 'border-gray-200'}`}
                      placeholder="e.g. 1200" />
                    {effectiveRate > 0 && (
                      <span className="text-xs text-teal font-semibold">
                        ₹{effectiveRate.toLocaleString('en-IN')} × {lessonsBreakdown(form.payment_plan, form.start_date, timesPerWeek)}
                      </span>
                    )}
                  </div>
                  {fieldError('rate') && <p className="text-xs text-coral mt-1">{fieldError('rate')}</p>}
                </div>
              </div>

              {/* Plan and dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Payment Plan</label>
                  <select value={form.payment_plan} onChange={(e) => setForm({ ...form, payment_plan: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                    {PLAN_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Registration Fee (₹)</label>
                  <input type="number" min={0} value={form.registration_fee}
                    onChange={(e) => setForm({ ...form, registration_fee: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" placeholder="0" />
                  {fieldError('registration') && <p className="text-xs text-coral mt-1">{fieldError('registration')}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
                </div>
              </div>
              {fieldError('dates') && <p className="text-xs text-coral -mt-2">{fieldError('dates')}</p>}

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Discount (optional)</label>
                <select value={form.discount_primary} onChange={(e) => setForm({ ...form, discount_primary: e.target.value as DiscountPrimary })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="none">No discount</option>
                  <option value="plan">Plan discount (auto)</option>
                  <option value="legacy">Legacy student (25%)</option>
                  <option value="special">Flat ₹ special</option>
                </select>
                {form.discount_primary === 'special' && (
                  <input type="number" min={0} value={form.discount_special}
                    onChange={(e) => setForm({ ...form, discount_special: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white mt-2" placeholder="Flat ₹ amount" />
                )}
                {fieldError('discount') && <p className="text-xs text-coral mt-1">{fieldError('discount')}</p>}
                <label className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                  <input type="checkbox" checked={form.discount_multilesson}
                    onChange={(e) => setForm({ ...form, discount_multilesson: e.target.checked })}
                    className="rounded border-gray-300 text-teal focus:ring-teal" />
                  Multi-lesson (+5%)
                </label>
              </div>
            </fieldset>

            {/* Fee Summary */}
            {!isTrial && effectiveRate > 0 && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-2" data-testid="fee-summary">
                <h4 className="text-xs font-semibold text-gray-500 uppercase">Fee Summary</h4>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">₹{effectiveRate.toLocaleString('en-IN')} × {lessonsBreakdown(form.payment_plan, form.start_date, timesPerWeek)}</span>
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

            {result && (
              <div className="rounded-lg p-3 text-sm font-medium bg-teal/10 text-teal">
                {result.text}
                {addedCount > 1 && <span className="text-teal/70"> ({addedCount} classes added so far)</span>}
              </div>
            )}
            {result?.warning && (
              <div className="rounded-lg p-3 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800">⚠ {result.warning}</div>
            )}

            {classDone ? (
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={resetForNextClass}
                  className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90">
                  + Add another class for {selectedStudent?.full_name?.split(' ')[0] || 'this student'}
                </button>
                <button type="button" onClick={closeModal}
                  className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">
                  Done
                </button>
              </div>
            ) : (
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} disabled={saving}
                  className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200 disabled:opacity-50">
                  Cancel
                </button>
                <button type="button" onClick={handleCreate} disabled={saving}
                  className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save & Schedule Lessons'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
