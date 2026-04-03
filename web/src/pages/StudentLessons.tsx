import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useStudentLessons } from '../hooks/useStudentLessons';
import { supabase } from '../lib/supabase';
import {
  Calendar, CheckCircle, XCircle, MapPin, UserX, BookOpen,
  CreditCard, Clock, FileText, ChevronLeft, ChevronRight, X, Ban
} from 'lucide-react';

interface Enrolment {
  id: string;
  academic_year: string;
  total_lessons: number;
  lessons_used: number;
  start_date: string;
  payment_plan: string;
  rate_per_lesson: number;
  total_fee: number;
  registration_fee: number;
}

interface Payment {
  id: string;
  plan: string;
  amount: number;
  instalment_number: number;
  due_date: string;
  paid_date: string | null;
  invoice?: { id: string; invoice_number: string } | null;
}

export function StudentLessonsPage() {
  const { profile } = useAuth();
  const [studentId, setStudentId] = useState<string>();
  const [studentNotFound, setStudentNotFound] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activeTab, setActiveTab] = useState<'lessons' | 'calendar' | 'payments'>('lessons');
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  useEffect(() => {
    if (!profile?.id) return;

    async function loadStudentData() {
      const { data: student, error: studentErr } = await supabase
        .from('students')
        .select('id')
        .eq('user_id', profile!.id)
        .maybeSingle();

      if (studentErr) {
        console.error('Student lookup error:', studentErr);
        setStudentNotFound(true);
        setLookupDone(true);
        return;
      }

      if (!student) {
        setStudentNotFound(true);
        setLookupDone(true);
        return;
      }

      setStudentId(student.id);

      const year = new Date().getFullYear().toString();
      const [enrRes, payRes] = await Promise.all([
        supabase
          .from('student_enrolments')
          .select('*')
          .eq('student_id', student.id)
          .eq('academic_year', year),
        supabase
          .from('payment_records')
          .select('*, invoice:invoices(id, invoice_number)')
          .eq('student_id', student.id)
          .order('due_date', { ascending: true }),
      ]);

      if (enrRes.data) setEnrolments(enrRes.data as Enrolment[]);
      if (payRes.data) setPayments(payRes.data as any);

      setLookupDone(true);
    }

    loadStudentData();
  }, [profile?.id]);

  const { upcoming, past, loading, error, totalCompleted, cancelLesson } = useStudentLessons(studentId);
  const [cancelModal, setCancelModal] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  if (!lookupDone) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-coral border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (studentNotFound) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <UserX size={48} className="text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-navy mb-2">Not Enrolled Yet</h2>
        <p className="text-gray-500 text-sm">
          Your coordinator hasn't set up your student profile yet. Please contact them to get started.
        </p>
        <p className="text-gray-400 text-xs mt-4">Signed in as {profile?.email}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-coral border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) return (
    <div className="bg-coral/10 border border-coral/20 rounded-xl p-4">
      <p className="text-coral text-sm">{error}</p>
    </div>
  );

  const totalMissed = past.filter((l) => l.attended === false).length;
  const today = new Date().toISOString().split('T')[0];
  const paidCount = payments.filter(p => p.paid_date).length;
  const overduePayments = payments.filter(p => !p.paid_date && p.due_date < today);
  const nextPayment = payments.find(p => !p.paid_date && p.due_date >= today);
  const primaryEnrolment = enrolments[0] || null;
  const remaining = primaryEnrolment ? primaryEnrolment.total_lessons - primaryEnrolment.lessons_used : 0;

  const statCards = [
    { label: 'Lessons Attended', value: totalCompleted, icon: CheckCircle, iconBg: 'bg-teal/10', iconColor: 'text-teal' },
    { label: 'Lessons Missed', value: totalMissed, icon: XCircle, iconBg: 'bg-coral/10', iconColor: 'text-coral' },
    { label: 'Remaining', value: primaryEnrolment ? `${remaining} of ${primaryEnrolment.total_lessons}` : '-', icon: Calendar, iconBg: 'bg-yellow/10', iconColor: 'text-yellow-700' },
    { label: 'Payments', value: `${paidCount}/${payments.length}`, sub: 'paid', icon: CreditCard, iconBg: 'bg-teal/10', iconColor: 'text-teal' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">My Portal</h1>
        <p className="text-gray-500 text-sm mt-1">Welcome, {profile?.full_name}</p>
      </div>

      {/* Stat cards — matching Dashboard style */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center`}>
                <card.icon size={20} className={card.iconColor} />
              </div>
            </div>
            <p className="text-2xl font-bold text-navy">{card.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Enrolment cards */}
      {enrolments.map((enr) => {
        const enrRemaining = enr.total_lessons - enr.lessons_used;
        return (
          <div key={enr.id} className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-teal/10 flex items-center justify-center">
                <BookOpen size={16} className="text-teal" />
              </div>
              <h2 className="font-semibold text-navy text-sm">Enrolment — {enr.academic_year}</h2>
            </div>
            <div className="mb-3">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-gray-500">Lessons Used</span>
                <span className="font-semibold text-navy">{enr.lessons_used} / {enr.total_lessons}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3">
                <div
                  className="bg-teal rounded-full h-3 transition-all"
                  style={{ width: `${Math.min((enr.lessons_used / enr.total_lessons) * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {enrRemaining} lessons remaining
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-400">Rate/Lesson</p>
                <p className="font-semibold text-navy">₹{Number(enr.rate_per_lesson).toLocaleString('en-IN')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Total Fee</p>
                <p className="font-semibold text-navy">₹{Number(enr.total_fee).toLocaleString('en-IN')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Payment Plan</p>
                <p className="font-medium text-gray-700">{enr.payment_plan?.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Start Date</p>
                <p className="font-medium text-gray-700">{new Date(enr.start_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
            </div>
          </div>
        );
      })}

      {/* Payment alerts */}
      {overduePayments.length > 0 && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-coral/10 flex items-center justify-center flex-shrink-0">
            <CreditCard size={20} className="text-coral" />
          </div>
          <div>
            <p className="text-sm font-medium text-coral">Overdue Payment</p>
            <p className="text-xs text-coral/80">
              ₹{Number(overduePayments[0].amount).toLocaleString('en-IN')} was due on{' '}
              {new Date(overduePayments[0].due_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      )}
      {!overduePayments.length && nextPayment && (
        <div className="bg-yellow/10 border border-yellow/20 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-yellow/10 flex items-center justify-center flex-shrink-0">
            <Clock size={20} className="text-yellow-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-yellow-700">Next Payment</p>
            <p className="text-xs text-yellow-600">
              ₹{Number(nextPayment.amount).toLocaleString('en-IN')} due on{' '}
              {new Date(nextPayment.due_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        <button
          onClick={() => setActiveTab('lessons')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'lessons' ? 'bg-white text-navy shadow-sm' : 'text-gray-500'}`}
        >
          Lessons
        </button>
        <button
          onClick={() => setActiveTab('calendar')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'calendar' ? 'bg-white text-navy shadow-sm' : 'text-gray-500'}`}
        >
          Calendar
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'payments' ? 'bg-white text-navy shadow-sm' : 'text-gray-500'}`}
        >
          Payments
        </button>
      </div>

      {activeTab === 'lessons' && (
        <>
          {/* Upcoming — Dashboard "Today's Schedule" style */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-navy">Upcoming Lessons</h2>
            </div>
            {upcoming.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No upcoming lessons scheduled</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {upcoming.map((item) => (
                  <div key={item.id} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50/50">
                    <div className="flex-shrink-0 w-16 text-center">
                      <span className="text-sm font-semibold text-navy">{item.lesson.start_time?.slice(0, 5)}</span>
                      <p className="text-[10px] text-gray-400">
                        {new Date(item.lesson.date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-navy text-sm">{item.lesson.title}</p>
                        {item.lesson.instrument?.icon && <span className="text-base">{item.lesson.instrument.icon}</span>}
                        {item.lesson.lesson_type !== 'regular' && (
                          <span className="text-[10px] bg-yellow-light text-yellow-700 px-2 py-0.5 rounded-full">{item.lesson.lesson_type}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                        {item.lesson.teacher && <span>{(item.lesson.teacher as any).full_name}</span>}
                        {item.lesson.location && (
                          <span className="flex items-center gap-0.5"><MapPin size={10} />{(item.lesson.location as any).name}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        item.lesson.status === 'completed' ? 'bg-teal/10 text-teal' :
                        item.lesson.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                        'bg-coral/10 text-coral'
                      }`}>
                        {item.lesson.status}
                      </span>
                      {item.lesson.status === 'scheduled' && (
                        <button
                          onClick={() => setCancelModal(item.lesson.id)}
                          className="p-1.5 text-gray-300 hover:text-coral transition-colors"
                          title="Cancel lesson"
                        >
                          <Ban size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Past Lessons */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-navy">Past Lessons</h2>
            </div>
            {past.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No past lessons</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {past.map((item) => (
                  <div key={item.id} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50/50">
                    <div className="flex-shrink-0 w-16 text-center">
                      <span className="text-sm font-semibold text-navy">{item.lesson.start_time?.slice(0, 5)}</span>
                      <p className="text-[10px] text-gray-400">
                        {new Date(item.lesson.date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-navy text-sm">{item.lesson.title}</p>
                        {item.lesson.instrument?.icon && <span className="text-base">{item.lesson.instrument.icon}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                        {item.lesson.teacher && <span>{(item.lesson.teacher as any).full_name}</span>}
                        {item.lesson.location && (
                          <span className="flex items-center gap-0.5"><MapPin size={10} />{(item.lesson.location as any).name}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {item.attended === true && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-teal/10 text-teal">
                          <CheckCircle size={12} />Attended
                        </span>
                      )}
                      {item.attended === false && (
                        <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                          item.absence_category === 'charged' ? 'bg-coral/10 text-coral' : 'bg-yellow/10 text-yellow-700'
                        }`}>
                          <XCircle size={12} />Absent{item.absence_category === 'charged' ? ' (charged)' : ''}
                        </span>
                      )}
                      {item.attended === null && (
                        <span className="px-2.5 py-1 rounded-full text-xs text-gray-400 bg-gray-50">Not recorded</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'calendar' && (() => {
        const allLessons = [...upcoming, ...past];
        const year = calMonth.getFullYear();
        const month = calMonth.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const todayStr = new Date().toISOString().split('T')[0];

        const lessonsByDate: Record<string, typeof allLessons> = {};
        for (const item of allLessons) {
          const d = item.lesson.date;
          if (!lessonsByDate[d]) lessonsByDate[d] = [];
          lessonsByDate[d].push(item);
        }

        const cells: { day: number; dateStr: string }[] = [];
        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          cells.push({ day: d, dateStr });
        }

        return (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <button onClick={() => setCalMonth(new Date(year, month - 1, 1))} className="p-1.5 rounded-lg hover:bg-gray-100">
                <ChevronLeft size={18} className="text-gray-500" />
              </button>
              <h2 className="font-semibold text-navy">
                {calMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </h2>
              <button onClick={() => setCalMonth(new Date(year, month + 1, 1))} className="p-1.5 rounded-lg hover:bg-gray-100">
                <ChevronRight size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="p-4">
              {/* Day headers */}
              <div className="grid grid-cols-7 gap-px mb-1">
                {dayNames.map(d => (
                  <div key={d} className="text-center text-[10px] font-medium text-gray-400 py-1">{d}</div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-px">
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`e${i}`} className="h-12" />
                ))}
                {cells.map(({ day, dateStr }) => {
                  const dayLessons = lessonsByDate[dateStr] || [];
                  const isToday = dateStr === todayStr;
                  const hasLesson = dayLessons.length > 0;
                  const allAttended = hasLesson && dayLessons.every(l => l.attended === true);
                  const anyMissed = hasLesson && dayLessons.some(l => l.attended === false);

                  return (
                    <div
                      key={day}
                      className={`h-12 rounded-lg flex flex-col items-center justify-center relative transition-colors ${
                        isToday ? 'bg-coral/10 ring-1 ring-coral' :
                        hasLesson && dateStr >= todayStr ? 'bg-teal/5' :
                        ''
                      }`}
                    >
                      <span className={`text-xs font-medium ${
                        isToday ? 'text-coral' :
                        hasLesson ? 'text-navy' :
                        'text-gray-400'
                      }`}>{day}</span>
                      {hasLesson && (
                        <div className="flex gap-0.5 mt-0.5">
                          {dayLessons.map((l, i) => (
                            <div
                              key={i}
                              className={`w-1.5 h-1.5 rounded-full ${
                                allAttended ? 'bg-teal' :
                                anyMissed ? 'bg-coral' :
                                l.lesson.status === 'cancelled' ? 'bg-gray-300' :
                                'bg-teal'
                              }`}
                              title={`${l.lesson.start_time?.slice(0, 5)} - ${l.lesson.title}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100 justify-center">
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <div className="w-2 h-2 rounded-full bg-teal" />Attended
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <div className="w-2 h-2 rounded-full bg-coral" />Missed
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <div className="w-2 h-2 rounded-full bg-teal/50" />Upcoming
                </div>
              </div>

              {/* Lessons for this month */}
              {(() => {
                const monthLessons = allLessons
                  .filter(l => l.lesson.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
                  .sort((a, b) => a.lesson.date.localeCompare(b.lesson.date));
                if (monthLessons.length === 0) return (
                  <p className="text-center text-gray-400 text-sm mt-4">No lessons this month</p>
                );
                return (
                  <div className="mt-4 space-y-0 divide-y divide-gray-50">
                    {monthLessons.map(item => (
                      <div key={item.id} className="flex items-center gap-3 py-3">
                        <div className="text-center flex-shrink-0 w-10">
                          <p className="text-xs font-bold text-navy">
                            {new Date(item.lesson.date + 'T00:00:00').getDate()}
                          </p>
                          <p className="text-[10px] text-gray-400">
                            {new Date(item.lesson.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}
                          </p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-navy truncate">{item.lesson.title}</p>
                          <p className="text-[10px] text-gray-500">
                            {item.lesson.start_time?.slice(0, 5)}
                            {item.lesson.teacher && ` · ${(item.lesson.teacher as any).full_name}`}
                            {item.lesson.location && ` · ${(item.lesson.location as any).name}`}
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          {item.attended === true && <CheckCircle size={14} className="text-teal" />}
                          {item.attended === false && <XCircle size={14} className="text-coral" />}
                          {item.attended === null && item.lesson.date >= todayStr && (
                            <Clock size={14} className="text-gray-300" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* Cancel lesson modal */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy text-lg">Cancel Lesson</h3>
              <button onClick={() => { setCancelModal(null); setCancelReason(''); }} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Are you sure you want to cancel this lesson?</p>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Reason (optional)</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none"
                rows={3}
                placeholder="Why are you cancelling?"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  if (cancelModal && profile?.id) {
                    try {
                      await cancelLesson(cancelModal, profile.id, cancelReason || undefined);
                    } catch (err: any) {
                      alert(err.message);
                    }
                  }
                  setCancelModal(null);
                  setCancelReason('');
                }}
                className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90"
              >
                Cancel Lesson
              </button>
              <button
                onClick={() => { setCancelModal(null); setCancelReason(''); }}
                className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
              >
                Keep Lesson
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'payments' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-navy">Payment History</h2>
          </div>
          {payments.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No payments recorded</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {payments.map((p) => {
                const isPaid = !!p.paid_date;
                const isOverdue = !isPaid && p.due_date < today;
                return (
                  <div key={p.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50/50">
                    <div>
                      <p className="text-sm font-medium text-navy">
                        Instalment #{p.instalment_number}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {p.plan?.replace(/_/g, ' ')} · Due{' '}
                        {new Date(p.due_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      {isPaid && p.paid_date && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          Paid {new Date(p.paid_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {p.invoice && (
                            <span className="ml-2 text-teal">
                              <FileText size={10} className="inline" /> {p.invoice.invoice_number}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-navy">₹{Number(p.amount).toLocaleString('en-IN')}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        isPaid ? 'bg-teal/10 text-teal' : isOverdue ? 'bg-coral/10 text-coral' : 'bg-yellow/10 text-yellow-700'
                      }`}>
                        {isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Pending'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
