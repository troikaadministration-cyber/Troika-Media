import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ConfirmDialog } from '../components/ConfirmDialog';
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

interface Student { id: string; full_name: string; instrument?: { name: string } | null; }
interface LessonRate { id: string; category: string; rate_per_lesson: number; is_online: boolean; teacher?: { full_name: string } | null; }
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
  const navigate = useNavigate();

  // Form state
  const [form, setForm] = useState({
    student_id: '',
    lesson_rate_id: '',
    payment_plan: '3_instalments',
    start_date: new Date().toISOString().split('T')[0],
    registration_fee: 0,
    academic_year: new Date().getFullYear().toString(),
  });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [enrolRes, studentRes, rateRes] = await Promise.all([
        supabase.from('student_enrolments').select('*, student:students(id, full_name, instrument:instruments(name))').order('created_at', { ascending: false }),
        supabase.from('students').select('id, full_name, instrument:instruments(name)').eq('is_active', true).order('full_name'),
        supabase.from('lesson_rates').select('id, category, rate_per_lesson, is_online, teacher:profiles(full_name)').order('category'),
      ]);
      if (enrolRes.error) throw enrolRes.error;
      setEnrolments((enrolRes.data || []) as any);
      setStudents((studentRes.data || []) as any);
      setRates((rateRes.data || []) as any);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const selectedRate = rates.find(r => r.id === form.lesson_rate_id);
  const totalLessons = form.payment_plan === 'trial' ? 1 : 39;
  const totalFee = selectedRate ? selectedRate.rate_per_lesson * totalLessons : 0;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.student_id || (!form.lesson_rate_id && form.payment_plan !== 'trial')) {
      setError('Please select a student and lesson rate');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Create enrolment
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

      // Auto-generate payment instalments via DB function
      if (form.payment_plan !== 'trial' && enrolment) {
        const { error: genErr } = await supabase.rpc('generate_instalments', {
          p_enrolment_id: enrolment.id,
        });
        if (genErr) throw genErr;
      }

      setModal(false);
      setForm({
        student_id: '', lesson_rate_id: '', payment_plan: '3_instalments',
        start_date: new Date().toISOString().split('T')[0], registration_fee: 0,
        academic_year: new Date().getFullYear().toString(),
      });
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
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-navy text-lg">Enrol Student</h3>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Student</label>
                <select
                  required
                  value={form.student_id}
                  onChange={(e) => setForm({ ...form, student_id: e.target.value })}
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
                <select
                  value={form.lesson_rate_id}
                  onChange={(e) => setForm({ ...form, lesson_rate_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select rate...</option>
                  {rates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.category} — ₹{Number(r.rate_per_lesson).toLocaleString('en-IN')}
                      {r.is_online ? ' (Online)' : ''}
                      {r.teacher ? ` — ${r.teacher.full_name}` : ''}
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
                  <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                  type="submit"
                  disabled={saving || !form.student_id}
                  className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Create Enrolment'}
                </button>
                <button
                  type="button"
                  onClick={() => setModal(false)}
                  className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
