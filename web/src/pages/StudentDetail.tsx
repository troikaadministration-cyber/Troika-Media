import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Calendar, Music, AlertTriangle, CheckCircle, RefreshCw, BookOpen } from 'lucide-react';
import type { Student, StudentStats, Location, Instrument } from '../types';

interface StudentEnrolment {
  id: string;
  academic_year: string;
  total_lessons: number;
  lessons_used: number;
  start_date: string;
  payment_plan: string;
  rate_per_lesson: number;
  total_fee: number;
}

interface LessonRecord {
  id: string;
  lesson_id: string;
  attended: boolean | null;
  absence_category: string | null;
  lesson: {
    id: string; date: string; start_time: string; title: string; status: string;
    teacher: { full_name: string } | null;
    instrument: { name: string; icon: string | null } | null;
  };
}

export function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [student, setStudent] = useState<(Student & { location?: Location; instrument?: Instrument }) | null>(null);
  const [stats, setStats] = useState<StudentStats | null>(null);
  const [lessonRecords, setLessonRecords] = useState<LessonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<StudentEnrolment | null>(null);
  const [attendanceModal, setAttendanceModal] = useState<{ lessonStudentId: string; studentName: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    async function load() {
      setError(null);
      try {
      const currentYear = new Date().getFullYear().toString();
      const [studentRes, statsRes, lessonsRes, enrolmentRes] = await Promise.all([
        supabase.from('students').select('*, location:locations(*), instrument:instruments(*)').eq('id', id).single(),
        supabase.from('student_stats').select('*').eq('student_id', id).single(),
        supabase.from('lesson_students').select(`
          id, lesson_id, attended, absence_category,
          lesson:lessons(id, date, start_time, title, status,
            teacher:profiles!lessons_teacher_id_fkey(full_name),
            instrument:instruments(name, icon))
        `).eq('student_id', id).order('lesson(date)', { ascending: false }).limit(50),
        supabase.from('student_enrolments').select('*').eq('student_id', id).eq('academic_year', currentYear).single(),
      ]);

      if (studentRes.error) throw studentRes.error;
      if (studentRes.data) setStudent(studentRes.data as any);
      if (statsRes.data) setStats(statsRes.data as StudentStats);
      if (lessonsRes.data) setLessonRecords(lessonsRes.data.filter((r: any) => r.lesson) as any);
      if (enrolmentRes.data) setEnrolment(enrolmentRes.data as StudentEnrolment);
      } catch (err: any) {
        setError(err.message || 'Failed to load student');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function markAttendance(lessonStudentId: string, attended: boolean, category?: string) {
    await supabase.from('lesson_students').update({
      attended,
      absence_category: attended ? null : category || null,
    }).eq('id', lessonStudentId);
    setLessonRecords((prev) =>
      prev.map((r) => r.id === lessonStudentId ? { ...r, attended, absence_category: attended ? null : category || null } : r)
    );
    setAttendanceModal(null);
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400">Loading...</p></div>;
  if (error) return (
    <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center justify-between">
      <p className="text-coral text-sm">{error}</p>
      <button onClick={() => window.location.reload()} className="flex items-center gap-1 text-coral text-sm font-medium hover:underline"><RefreshCw size={14} />Retry</button>
    </div>
  );
  if (!student) return <div className="text-center py-12 text-gray-400">Student not found</div>;

  return (
    <div className="space-y-6">
      <button onClick={() => navigate('/students')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-navy">
        <ArrowLeft size={16} /> Back to Students
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-navy">{student.full_name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${student.is_active ? 'bg-teal/10 text-teal' : 'bg-gray-100 text-gray-500'}`}>
                {student.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 flex-wrap">
              {student.instrument && <span>{(student.instrument as any).icon} {(student.instrument as any).name}</span>}
              {student.location && <span>{(student.location as any).name}</span>}
              {student.email && <span>{student.email}</span>}
            </div>
          </div>
          <span className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full">{student.payment_plan}</span>
        </div>
        {student.parent_name && (
          <div className="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-500">
            Parent: <span className="text-navy font-medium">{student.parent_name}</span>
            {student.parent_phone && <span className="ml-3">{student.parent_phone}</span>}
            {student.parent_email && <span className="ml-3">{student.parent_email}</span>}
          </div>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Lessons', value: stats.total_lessons, icon: Calendar, color: 'text-navy' },
            { label: 'Regular', value: stats.regular_lessons, icon: Music, color: 'text-teal' },
            { label: 'Makeup', value: stats.makeup_lessons, icon: CheckCircle, color: 'text-yellow-600' },
            { label: 'Charged Absences', value: stats.charged_absences, icon: AlertTriangle, color: 'text-coral' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4">
              <s.icon size={18} className={`${s.color} mb-2`} />
              <p className="text-2xl font-bold text-navy">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Enrolment Progress */}
      {enrolment && (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={18} className="text-teal" />
            <h2 className="font-semibold text-navy">Enrolment — {enrolment.academic_year}</h2>
          </div>
          <div className="mb-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-500">Lessons Used</span>
              <span className="font-semibold text-navy">{enrolment.lessons_used} / {enrolment.total_lessons}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div
                className="bg-teal rounded-full h-3 transition-all"
                style={{ width: `${Math.min((enrolment.lessons_used / enrolment.total_lessons) * 100, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {enrolment.total_lessons - enrolment.lessons_used} lessons remaining
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400">Rate/Lesson</p>
              <p className="font-semibold text-navy">₹{Number(enrolment.rate_per_lesson).toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Total Fee</p>
              <p className="font-semibold text-navy">₹{Number(enrolment.total_fee).toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Payment Plan</p>
              <p className="font-medium text-gray-700">{enrolment.payment_plan?.replace(/_/g, ' ')}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Start Date</p>
              <p className="font-medium text-gray-700">{new Date(enrolment.start_date + 'T00:00:00').toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Lesson History */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-navy">Lesson History</h2>
        </div>
        {lessonRecords.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No lessons recorded yet</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {lessonRecords.map((r) => (
              <div key={r.id} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-gray-50/50">
                <div className="text-sm text-gray-500 sm:w-24 flex-shrink-0">
                  {new Date(r.lesson.date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-navy">{r.lesson.title}</p>
                    {r.lesson.instrument?.icon && <span className="text-sm">{r.lesson.instrument.icon}</span>}
                  </div>
                  <p className="text-xs text-gray-400">
                    {r.lesson.start_time?.slice(0, 5)} {r.lesson.teacher?.full_name && `- ${r.lesson.teacher.full_name}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {r.attended === true && (
                    <button onClick={() => setAttendanceModal({ lessonStudentId: r.id, studentName: student.full_name })}
                      className="text-xs bg-teal/10 text-teal px-2 py-0.5 rounded-full hover:bg-teal/20">Attended</button>
                  )}
                  {r.attended === false && (
                    <button onClick={() => setAttendanceModal({ lessonStudentId: r.id, studentName: student.full_name })}
                      className={`text-xs px-2 py-0.5 rounded-full hover:opacity-80 ${r.absence_category === 'charged' ? 'bg-coral/10 text-coral' : 'bg-yellow-100 text-yellow-700'}`}>
                      Absent {r.absence_category === 'charged' ? '(charged)' : '(not charged)'}
                    </button>
                  )}
                  {r.attended === null && (
                    <button onClick={() => setAttendanceModal({ lessonStudentId: r.id, studentName: student.full_name })}
                      className="text-xs text-teal hover:underline">Mark attendance</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attendance modal */}
      {attendanceModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-navy">Mark Attendance</h3>
            <p className="text-sm text-gray-500">{attendanceModal.studentName}</p>
            <div className="space-y-2">
              <button onClick={() => markAttendance(attendanceModal.lessonStudentId, true)}
                className="w-full py-2.5 rounded-lg bg-teal text-white text-sm font-medium hover:bg-teal/90">Attended</button>
              <button onClick={() => markAttendance(attendanceModal.lessonStudentId, false, 'not_charged')}
                className="w-full py-2.5 rounded-lg bg-yellow-100 text-yellow-700 text-sm font-medium hover:bg-yellow-200">Absent (Not Charged)</button>
              <button onClick={() => markAttendance(attendanceModal.lessonStudentId, false, 'charged')}
                className="w-full py-2.5 rounded-lg bg-coral/10 text-coral text-sm font-medium hover:bg-coral/20">Absent (Charged)</button>
              <button onClick={() => setAttendanceModal(null)}
                className="w-full py-2.5 rounded-lg border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
