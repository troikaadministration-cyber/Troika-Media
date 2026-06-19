import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, X, BookOpen, BookmarkPlus, Trash2, Clock, User, CalendarDays, History } from 'lucide-react';

type Tab = 'overview' | 'enrolment' | 'schedule' | 'history';
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
  const [activeTab, setActiveTab] = useState<Tab>('overview');
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

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview',   label: 'Overview',   icon: <User size={14} /> },
    { key: 'enrolment',  label: 'Enrolment',  icon: <BookOpen size={14} /> },
    { key: 'schedule',   label: 'Schedule',   icon: <CalendarDays size={14} /> },
    { key: 'history',    label: 'History',    icon: <History size={14} /> },
  ];

  return (
    <div className="space-y-0">
      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/students')} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-navy">
            <ArrowLeft size={15} /> Students
          </button>
          <span className="text-gray-200">/</span>
          <h1 className="text-lg font-bold text-navy">{student.full_name}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${student.is_active ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'}`}>
            {student.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openEdit} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:border-gray-300 font-medium">Edit</button>
          <button onClick={openReEnrol} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal text-white text-sm font-medium hover:bg-teal/90">
            <BookmarkPlus size={13} /> Re-enrol
          </button>
          <button onClick={toggleActive} className={`px-3 py-1.5 rounded-lg border text-sm font-medium ${
            student.is_active ? 'border-coral/30 text-coral hover:bg-coral/5' : 'border-teal/30 text-teal hover:bg-teal/5'
          }`}>
            {student.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button onClick={() => setDeleteConfirmOpen(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 text-sm font-medium">
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-100 mb-6">
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === key
                ? 'border-coral text-coral'
                : 'border-transparent text-gray-400 hover:text-navy'
            }`}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-2 gap-5">
          {/* Student contact */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-4">Student</p>
            <dl className="space-y-3">
              {[
                { label: 'Full Name', value: student.full_name },
                { label: 'Phone',     value: student.phone },
                { label: 'Email',     value: student.email },
                { label: 'Instrument', value: student.instrument?.name },
                { label: 'Location',  value: student.location?.name },
                { label: 'Plan',      value: student.payment_plan?.replace(/_/g, ' ') },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-3">
                  <dt className="w-24 text-xs text-gray-400 flex-shrink-0 pt-0.5">{label}</dt>
                  <dd className="text-sm text-navy font-medium">{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Parent / Guardian */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-4">Parent / Guardian</p>
            <dl className="space-y-3">
              {[
                { label: 'Name',  value: student.parent_name },
                { label: 'Phone', value: student.parent_phone },
                { label: 'Email', value: student.parent_email },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-3">
                  <dt className="w-24 text-xs text-gray-400 flex-shrink-0 pt-0.5">{label}</dt>
                  <dd className="text-sm text-navy font-medium">{value || '—'}</dd>
                </div>
              ))}
            </dl>
            {student.notes && (
              <div className="mt-5 pt-4 border-t border-gray-50">
                <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-2">Notes</p>
                <p className="text-sm text-gray-600">{student.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Enrolment ── */}
      {activeTab === 'enrolment' && (
        <div className="space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total Lessons', value: stats?.total_lessons || 0,    color: 'text-navy',        bg: 'bg-gray-50' },
              { label: 'Regular',       value: stats?.regular_lessons || 0,  color: 'text-teal',        bg: 'bg-teal/5' },
              { label: 'Makeup',        value: stats?.makeup_lessons || 0,   color: 'text-amber-500',   bg: 'bg-amber-50' },
              { label: 'Charged Abs.',  value: stats?.charged_absences || 0, color: 'text-coral',       bg: 'bg-coral/5' },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`${bg} rounded-xl border border-gray-100 p-5 text-center`}>
                <p className={`text-3xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-gray-400 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Enrolment cards */}
          {enrolments.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-400 text-sm">
              No enrolment for current year.{' '}
              <button onClick={openReEnrol} className="text-teal font-medium hover:underline">Re-enrol now</button>
            </div>
          ) : enrolments.map((enrolment) => {
            const categoryLabel = enrolment.lesson_rate?.category?.replace(/_/g, ' ') || '';
            const pct = Math.min((enrolment.lessons_used / enrolment.total_lessons) * 100, 100);
            return (
              <div key={enrolment.id} className="bg-white rounded-xl border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <BookOpen size={16} className="text-teal" />
                    <h2 className="font-semibold text-navy">Enrolment {enrolment.academic_year}</h2>
                    {categoryLabel && <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{categoryLabel}</span>}
                  </div>
                  <span className="text-sm text-gray-400">{enrolment.total_lessons - enrolment.lessons_used} lessons remaining</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 mb-4">
                  <div className="bg-teal h-2.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">Lessons Used</p>
                    <p className="font-bold text-navy text-lg">{enrolment.lessons_used}<span className="text-sm font-normal text-gray-400">/{enrolment.total_lessons}</span></p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">Rate / Lesson</p>
                    <p className="font-bold text-navy">₹{Number(enrolment.rate_per_lesson).toLocaleString('en-IN')}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">Total Fee</p>
                    <p className="font-bold text-navy">₹{Number(enrolment.total_fee).toLocaleString('en-IN')}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">Payment Plan</p>
                    <p className="font-medium text-gray-700 text-sm">{enrolment.payment_plan?.replace(/_/g, ' ')}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Schedule ── */}
      {activeTab === 'schedule' && (
        <div className="bg-white rounded-xl border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={15} className="text-gray-400" />
              <h2 className="font-semibold text-navy">Weekly Class Schedule</h2>
            </div>
            <button onClick={() => openScheduleEdit(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-coral text-white text-sm font-medium hover:bg-coral/90">
              + Add Class
            </button>
          </div>
          {schedules.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No class slots set up for this student</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Day & Time</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Teacher</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Instrument</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Location</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {schedules.map((s: any) => (
                  <tr key={s.id} className="hover:bg-gray-50/50">
                    <td className="px-6 py-3.5">
                      <p className="font-semibold text-navy">{DAYS[s.day_of_week]}</p>
                      <p className="text-xs text-gray-400">{s.start_time?.slice(0,5)}{s.end_time ? `–${s.end_time.slice(0,5)}` : ''}</p>
                    </td>
                    <td className="px-6 py-3.5 text-navy">{s.teacher?.full_name || '—'}</td>
                    <td className="px-6 py-3.5 text-gray-600">{s.instrument?.name || '—'}</td>
                    <td className="px-6 py-3.5 text-gray-600">{s.location?.name || '—'}</td>
                    <td className="px-6 py-3.5 text-right">
                      <button onClick={() => openScheduleEdit(s)} className="text-xs text-gray-400 hover:text-navy px-2 py-1 rounded hover:bg-gray-100 mr-1">Edit</button>
                      <button onClick={() => deleteSchedule(s.id)} className="text-xs text-coral px-2 py-1 rounded hover:bg-coral/5">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── History ── */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-xl border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-navy">Lesson History</h2>
            <p className="text-xs text-gray-400 mt-0.5">Last 50 lessons</p>
          </div>
          {lessons.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No lessons recorded</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-4" />
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Lesson</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Teacher</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lessons.map((item: any) => (
                  <tr key={item.id} className="hover:bg-gray-50/50">
                    <td className="pl-6 py-3.5">
                      <div className={`w-1.5 h-6 rounded-full ${item.attended === true ? 'bg-teal' : item.attended === false ? 'bg-coral' : 'bg-gray-200'}`} />
                    </td>
                    <td className="px-6 py-3.5 font-medium text-navy">{item.lesson?.title || 'Lesson'}</td>
                    <td className="px-6 py-3.5 text-gray-500">
                      {new Date(item.lesson?.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {item.lesson?.start_time && <span className="ml-1 text-gray-400">{item.lesson.start_time.slice(0, 5)}</span>}
                    </td>
                    <td className="px-6 py-3.5 text-gray-500">{item.lesson?.teacher?.full_name || '—'}</td>
                    <td className="px-6 py-3.5 text-right">
                      {item.attended === true && (
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-teal/10 text-teal">Attended</span>
                      )}
                      {item.attended === false && (
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${item.absence_category === 'charged' ? 'bg-coral/10 text-coral' : 'bg-green-50 text-green-600'}`}>
                          {item.absence_category === 'charged' ? 'Absent · Charged' : 'Absent · Free'}
                        </span>
                      )}
                      {item.attended === null && (
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => markAttended(item.id)} className="text-xs px-2.5 py-1 rounded-full border border-teal/30 text-teal hover:bg-teal/10 font-medium">Present</button>
                          <button onClick={() => setAbsenceModal({ lessonStudentId: item.id, studentName: student.full_name })} className="text-xs px-2.5 py-1 rounded-full border border-coral/30 text-coral hover:bg-coral/10 font-medium">Absent</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

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
