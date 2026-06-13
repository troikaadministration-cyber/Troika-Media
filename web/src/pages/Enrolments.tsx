import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SlotPicker } from '../components/SlotPicker';
import type { SelectedSlot } from '../components/SlotPicker';
import type { Profile, Instrument } from '../types';
import { Plus, X, RefreshCw, BookOpen, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Enrolment {
  id: string;
  student_id: string;
  academic_year: string;
  total_lessons: number;
  lessons_used: number;
  start_date: string;
  payment_plan: string;
  rate_per_lesson: number;
  total_fee: number;
  registration_fee: number;
  lesson_rate_id: string | null;
  student?: { id: string; full_name: string; instrument?: { name: string } | null };
}

interface Student { id: string; full_name: string; location_id: string | null; instrument?: { name: string } | null; }
interface LessonRate { id: string; teacher_id: string | null; category: string; rate_per_lesson: number; is_online: boolean; location_id: string | null; teacher?: { id: string; full_name: string } | null; }
const PLAN_OPTIONS = [
  { value: 'trial', label: 'Trial (no payment)' },
  { value: '1_instalment', label: '1 Instalment' },
  { value: '3_instalments', label: '3 Instalments' },
  { value: '10_instalments', label: '10 Instalments' },
];

export function EnrolmentsPage() {
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [rates, setRates] = useState<LessonRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [manualTeacherId, setManualTeacherId] = useState('');
  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  const navigate = useNavigate();

  // Form state
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

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const selectedRate = rates.find(r => r.id === form.lesson_rate_id);
  const selectedStudent = students.find(s => s.id === form.student_id);
  const filteredRates = selectedStudent?.location_id
    ? rates.filter(r => r.location_id === selectedStudent.location_id || r.location_id === null)
    : rates;
  const hasLocationRates = !!(selectedStudent?.location_id &&
    rates.some(r => r.location_id === selectedStudent.location_id));
  const totalLessons = form.payment_plan === 'trial' ? 1 : 39;
  const totalFee = selectedRate ? selectedRate.rate_per_lesson * totalLessons : 0;
  const teacherId = (selectedRate as any)?.teacher?.id || selectedRate?.teacher_id || manualTeacherId;
  const teacherName = teachers.find(t => t.id === teacherId)?.full_name
    || (selectedRate as any)?.teacher?.full_name
    || '';

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

      // 4. Generate lessons from start_date to end_date, capped at totalLessons
      const startDate = new Date(form.start_date + 'T00:00:00');
      const endDate = new Date(form.end_date + 'T00:00:00');
      let created = 0;
      let skipped = 0;
      const current = new Date(startDate);

      while (current <= endDate && created < totalLessons) {
        if (current.getDay() === templateDayOfWeek) {
          const dateStr = current.toISOString().split('T')[0];

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

  async function handleDelete(id: string) {
    try {
      const { error: err } = await supabase.from('student_enrolments').delete().eq('id', id);
      if (err) throw err;
      setConfirmDelete(null);
      fetchAll();
    } catch (err: any) {
      setError(err.message);
      setConfirmDelete(null);
    }
  }

  // All active students are available (multi-instrument enrolments allowed)
  const availableStudents = students;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Enrolments</h1>
          <p className="text-gray-500 text-sm mt-1">39-lesson plans & payment instalments</p>
        </div>
        <button
          onClick={() => setModal(true)}
          className="flex items-center gap-2 bg-teal text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal/80"
        >
          <Plus size={16} /> Enrol Student
        </button>
      </div>

      {error && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-3 flex items-center justify-between">
          <p className="text-coral text-sm">{error}</p>
          <button onClick={() => setError(null)} className="text-coral text-xs font-medium">Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-12 text-sm">Loading...</div>
      ) : enrolments.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No enrolments yet</p>
          <p className="text-gray-300 text-xs mt-1">Click "Enrol Student" to create the first one</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-100 overflow-hidden">
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
              <tbody className="divide-y divide-gray-50">
                {enrolments.map((e) => {
                  const pct = e.total_lessons > 0 ? Math.round((e.lessons_used / e.total_lessons) * 100) : 0;
                  return (
                    <tr key={e.id} className="hover:bg-gray-50/50">
                      <td className="px-5 py-3">
                        <button onClick={() => navigate(`/students/${e.student_id}`)} className="text-left">
                          <p className="text-sm font-medium text-navy hover:underline">{e.student?.full_name || '-'}</p>
                          {e.student?.instrument && <p className="text-xs text-gray-400">{e.student.instrument.name}</p>}
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
                        <button onClick={() => setConfirmDelete(e.id)} className="text-gray-400 hover:text-coral text-xs">Delete</button>
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
                  className="bg-white rounded-xl border border-gray-100 p-4 cursor-pointer hover:shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-navy text-sm">{e.student?.full_name || '-'}</p>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e.payment_plan?.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                    <span>{e.academic_year} · ₹{Number(e.rate_per_lesson).toLocaleString('en-IN')}/lesson</span>
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
        message="This will delete the enrolment. Payment records won't be deleted."
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

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
                    disabled={saving || !selectedSlot || !teacherId}
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
    </div>
  );
}
