import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, AlertTriangle, CheckCircle, Music, X, BookOpen, BookmarkPlus, Trash2, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Student, StudentStats, AbsenceCategory, StudentEnrolment } from '../types';

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

  // Re-enrol modal
  const [reEnrolOpen, setReEnrolOpen] = useState(false);
  const [rates, setRates] = useState<{ id: string; category: string; rate_per_lesson: number; is_online: boolean }[]>([]);
  const [reEnrolForm, setReEnrolForm] = useState({
    academic_year: new Date().getFullYear().toString(),
    payment_plan: '3_instalments',
    lesson_rate_id: '',
    registration_fee: 0,
  });
  const [reEnrolSaving, setReEnrolSaving] = useState(false);
  const [reEnrolError, setReEnrolError] = useState<string | null>(null);

  // Delete confirm
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Schedule templates
  const [schedules, setSchedules] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>([]);
  const [scheduleEditOpen, setScheduleEditOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<any | null>(null);
  const [scheduleForm, setScheduleForm] = useState<any>({});
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // Multiple instruments
  const [studentInstruments, setStudentInstruments] = useState<string[]>([]);

  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  useEffect(() => {
    if (!id) return;
    fetchData();
    supabase.from('instruments').select('id, name').order('name').then(({ data }) => setInstruments(data || []));
    supabase.from('locations').select('id, name').order('name').then(({ data }) => setLocations(data || []));
    supabase.from('profiles').select('id, full_name').eq('role', 'teacher').eq('approved', true).order('full_name').then(({ data }) => setTeachers(data || []));
    fetchSchedules();
    fetchStudentInstruments();
  }, [id]);

  function fetchSchedules() {
    if (!id) return;
    supabase.from('teacher_schedule_templates')
      .select('*, teacher:profiles!teacher_schedule_templates_teacher_id_fkey(full_name), instrument:instruments(name), location:locations(name)')
      .contains('student_ids', [id])
      .order('day_of_week').order('start_time')
      .then(({ data }) => setSchedules(data || []));
  }

  function fetchStudentInstruments() {
    if (!id) return;
    supabase.from('student_instruments').select('instrument_id').eq('student_id', id)
      .then(({ data }) => setStudentInstruments((data || []).map((r: any) => r.instrument_id)));
  }

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

  function openReEnrol() {
    setReEnrolForm({
      academic_year: new Date().getFullYear().toString(),
      payment_plan: '3_instalments',
      lesson_rate_id: '',
      registration_fee: 0,
    });
    setReEnrolError(null);
    setReEnrolOpen(true);
    supabase.from('lesson_rates').select('id, category, rate_per_lesson, is_online').order('category')
      .then(({ data }) => setRates((data || []) as any));
  }

  async function handleReEnrol() {
    setReEnrolSaving(true);
    setReEnrolError(null);
    try {
      const selectedRate = rates.find(r => r.id === reEnrolForm.lesson_rate_id);
      const totalLessons = reEnrolForm.payment_plan === 'trial' ? 1 : 39;
      const totalFee = selectedRate ? selectedRate.rate_per_lesson * totalLessons : 0;

      const { data: enrolment, error: enrolErr } = await supabase.from('student_enrolments').insert({
        student_id: id,
        academic_year: reEnrolForm.academic_year,
        lesson_rate_id: reEnrolForm.lesson_rate_id || null,
        total_lessons: totalLessons,
        lessons_used: 0,
        start_date: new Date().toISOString().split('T')[0],
        payment_plan: reEnrolForm.payment_plan,
        rate_per_lesson: selectedRate?.rate_per_lesson || 0,
        total_fee: totalFee,
        registration_fee: reEnrolForm.registration_fee,
      }).select('id').single();
      if (enrolErr) throw enrolErr;

      if (reEnrolForm.payment_plan !== 'trial' && enrolment) {
        const { error: genErr } = await supabase.rpc('generate_instalments', { p_enrolment_id: enrolment.id });
        if (genErr) throw genErr;
      }

      setReEnrolOpen(false);
      fetchData();
    } catch (err: any) {
      setReEnrolError(err.message);
    } finally {
      setReEnrolSaving(false);
    }
  }

  async function handleDelete() {
    const { error } = await supabase.from('students').delete().eq('id', id!);
    if (error) { alert(error.message); return; }
    navigate('/students');
  }

  function openScheduleEdit(sched: any | null) {
    setEditingSchedule(sched);
    setScheduleForm(sched ? {
      teacher_id: sched.teacher_id,
      day_of_week: sched.day_of_week,
      start_time: sched.start_time,
      end_time: sched.end_time || '',
      instrument_id: sched.instrument_id || '',
      location_id: sched.location_id || '',
    } : {
      teacher_id: '',
      day_of_week: 1,
      start_time: '09:00',
      end_time: '10:00',
      instrument_id: '',
      location_id: student?.location_id || '',
    });
    setScheduleEditOpen(true);
  }

  async function saveSchedule() {
    setScheduleSaving(true);
    try {
      const payload = {
        teacher_id: scheduleForm.teacher_id,
        day_of_week: Number(scheduleForm.day_of_week),
        start_time: scheduleForm.start_time,
        end_time: scheduleForm.end_time || null,
        instrument_id: scheduleForm.instrument_id || null,
        location_id: scheduleForm.location_id || null,
        title: `${student.full_name} – ${instruments.find(i => i.id === scheduleForm.instrument_id)?.name ?? ''}`,
        student_ids: [id],
        is_active: true,
      };
      if (editingSchedule) {
        await supabase.from('teacher_schedule_templates').update(payload).eq('id', editingSchedule.id);
      } else {
        await supabase.from('teacher_schedule_templates').insert(payload);
      }
      setScheduleEditOpen(false);
      fetchSchedules();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setScheduleSaving(false);
    }
  }

  async function deleteSchedule(schedId: string) {
    if (!confirm('Remove this class slot?')) return;
    await supabase.from('teacher_schedule_templates').delete().eq('id', schedId);
    fetchSchedules();
  }

  async function toggleStudentInstrument(instrId: string) {
    if (studentInstruments.includes(instrId)) {
      await supabase.from('student_instruments').delete().eq('student_id', id!).eq('instrument_id', instrId);
    } else {
      await supabase.from('student_instruments').insert({ student_id: id, instrument_id: instrId });
    }
    fetchStudentInstruments();
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
          <div className="flex gap-2 flex-shrink-0 flex-wrap">
            <button onClick={openEdit} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:border-navy hover:text-navy font-medium">
              Edit
            </button>
            <button onClick={openReEnrol}
              className="flex items-center gap-1.5 border border-teal/30 text-teal rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-teal-light">
              <BookmarkPlus size={14} /> Re-enrol
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
            <button onClick={() => setDeleteConfirmOpen(true)}
              className="flex items-center gap-1.5 border border-red-200 text-red-500 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-red-50">
              <Trash2 size={14} /> Delete
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

      {/* Class Schedule */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-teal" />
            <h2 className="font-semibold text-navy">Class Schedule</h2>
          </div>
          <button onClick={() => openScheduleEdit(null)}
            className="text-xs font-semibold text-teal border border-teal/30 px-3 py-1.5 rounded-lg hover:bg-teal-light">
            + Add Class
          </button>
        </div>
        {schedules.length === 0 ? (
          <p className="text-center text-gray-400 py-6 text-sm">No class slots set up</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {schedules.map((s: any) => (
              <div key={s.id} className="flex items-center gap-4 px-4 py-3">
                <div className="w-20 text-center flex-shrink-0">
                  <p className="text-xs font-bold text-navy">{DAYS[s.day_of_week]}</p>
                  <p className="text-xs text-gray-400">{s.start_time?.slice(0,5)}{s.end_time ? `–${s.end_time.slice(0,5)}` : ''}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-navy truncate">{s.teacher?.full_name || '—'}</p>
                  <p className="text-xs text-gray-400">{[s.instrument?.name, s.location?.name].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => openScheduleEdit(s)} className="text-xs text-gray-400 hover:text-navy px-2 py-1 rounded hover:bg-gray-100">Edit</button>
                  <button onClick={() => deleteSchedule(s.id)} className="text-xs text-coral hover:text-coral/70 px-2 py-1 rounded hover:bg-coral-light">Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 mb-2">Instruments / Subjects</label>
                  <div className="flex flex-wrap gap-2">
                    {instruments.map(i => (
                      <button key={i.id} type="button"
                        onClick={() => toggleStudentInstrument(i.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          studentInstruments.includes(i.id)
                            ? 'bg-teal text-white border-teal'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-teal'
                        }`}>
                        {i.name}
                      </button>
                    ))}
                  </div>
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

      {/* Re-enrol modal */}
      {reEnrolOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-navy text-lg">Re-enrol — {student.full_name}</h3>
              <button onClick={() => setReEnrolOpen(false)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            {reEnrolError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">{reEnrolError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Academic Year</label>
                <input type="text" value={reEnrolForm.academic_year}
                  onChange={e => setReEnrolForm(p => ({ ...p, academic_year: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Payment Plan</label>
                <select value={reEnrolForm.payment_plan}
                  onChange={e => setReEnrolForm(p => ({ ...p, payment_plan: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                  {PAYMENT_PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Lesson Rate</label>
                <select value={reEnrolForm.lesson_rate_id}
                  onChange={e => setReEnrolForm(p => ({ ...p, lesson_rate_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                  <option value="">Select rate...</option>
                  {rates.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.category} — ₹{Number(r.rate_per_lesson).toLocaleString('en-IN')}{r.is_online ? ' (Online)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Registration Fee (₹)</label>
                <input type="number" min={0} value={reEnrolForm.registration_fee}
                  onChange={e => setReEnrolForm(p => ({ ...p, registration_fee: Number(e.target.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="0" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={handleReEnrol} disabled={reEnrolSaving}
                className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                {reEnrolSaving ? 'Saving...' : 'Create Enrolment'}
              </button>
              <button onClick={() => setReEnrolOpen(false)}
                className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule edit modal */}
      {scheduleEditOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-navy text-lg">{editingSchedule ? 'Edit Class' : 'Add Class'}</h3>
              <button onClick={() => setScheduleEditOpen(false)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Teacher</label>
                <select value={scheduleForm.teacher_id} onChange={e => setScheduleForm((p: any) => ({ ...p, teacher_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                  <option value="">Select teacher</option>
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Day</label>
                <select value={scheduleForm.day_of_week} onChange={e => setScheduleForm((p: any) => ({ ...p, day_of_week: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Instrument</label>
                <select value={scheduleForm.instrument_id} onChange={e => setScheduleForm((p: any) => ({ ...p, instrument_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                  <option value="">None</option>
                  {instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Start Time</label>
                <input type="time" value={scheduleForm.start_time} onChange={e => setScheduleForm((p: any) => ({ ...p, start_time: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">End Time</label>
                <input type="time" value={scheduleForm.end_time} onChange={e => setScheduleForm((p: any) => ({ ...p, end_time: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Location</label>
                <select value={scheduleForm.location_id} onChange={e => setScheduleForm((p: any) => ({ ...p, location_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none">
                  <option value="">None</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={saveSchedule} disabled={scheduleSaving || !scheduleForm.teacher_id}
                className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                {scheduleSaving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setScheduleEditOpen(false)}
                className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete Student"
        message={`This will permanently delete ${student.full_name} and all their lesson and payment records. This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}
