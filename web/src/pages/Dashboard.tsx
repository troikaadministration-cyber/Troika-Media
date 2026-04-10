import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Users, Calendar, GraduationCap, CreditCard, Clock, MapPin, CheckCircle, RefreshCw } from 'lucide-react';

interface DashboardStats {
  activeStudents: number;
  totalStudents: number;
  completedToday: number;
  totalToday: number;
  totalTeachers: number;
  pendingPayments: number;
}

interface TodayLesson {
  id: string;
  title: string;
  start_time: string;
  status: string;
  teacher?: { full_name: string };
  location?: { name: string };
  instrument?: { name: string; icon: string | null };
  students?: { student?: { full_name: string } }[];
}

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [todayLessons, setTodayLessons] = useState<TodayLesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    // Fast: counts only — no row data fetched
    Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('students').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'teacher').eq('approved', true),
      supabase.from('payment_records').select('*', { count: 'exact', head: true }).is('paid_date', null),
    ]).then(([activeRes, totalRes, teachersRes, paymentsRes]) => {
      setStats({
        activeStudents: activeRes.count || 0,
        totalStudents: totalRes.count || 0,
        completedToday: 0,
        totalToday: 0,
        totalTeachers: teachersRes.count || 0,
        pendingPayments: paymentsRes.count || 0,
      });
    });

    // Slower: full join query for today's lessons
    supabase.from('lessons').select(`
      id, title, start_time, status,
      teacher:profiles!lessons_teacher_id_fkey(full_name),
      location:locations(name),
      instrument:instruments(name, icon),
      students:lesson_students(student:students(full_name))
    `).eq('date', today).order('start_time')
      .then(({ data, error: err }) => {
        if (err) { setError(err.message); return; }
        const lessons = (data || []) as unknown as TodayLesson[];
        setTodayLessons(lessons);
        setStats(prev => prev ? {
          ...prev,
          completedToday: lessons.filter(l => l.status === 'completed').length,
          totalToday: lessons.length,
        } : prev);
      })
      .finally(() => setLessonsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statCards = [
    { label: 'Active Students', value: stats ? stats.activeStudents : '—', sub: stats ? `of ${stats.totalStudents}` : '', icon: Users, color: 'bg-teal-light text-teal', iconBg: 'bg-teal/10' },
    { label: "Today's Lessons", value: stats ? `${stats.completedToday}/${stats.totalToday}` : '—', sub: 'completed', icon: Calendar, color: 'bg-coral-light text-coral', iconBg: 'bg-coral/10' },
    { label: 'Teachers', value: stats ? stats.totalTeachers : '—', sub: 'active', icon: GraduationCap, color: 'bg-yellow-light text-yellow-700', iconBg: 'bg-yellow/10' },
    { label: 'Pending Payments', value: stats ? stats.pendingPayments : '—', sub: 'unpaid', icon: CreditCard, color: 'bg-coral-light text-coral', iconBg: 'bg-coral/10', onClick: () => navigate('/payments') },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Overview of your music school</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            onClick={card.onClick}
            className={`bg-white rounded-xl border border-gray-100 p-4 sm:p-5 ${card.onClick ? 'cursor-pointer hover:shadow-md' : ''} transition-shadow`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center`}>
                <card.icon size={20} className={card.color.split(' ')[1]} />
              </div>
            </div>
            <p className="text-2xl font-bold text-navy">{card.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-4">
          <p className="text-coral text-sm">{error}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-navy">Today's Schedule</h2>
          <button onClick={() => navigate('/schedule')} className="text-sm text-teal hover:underline">View all</button>
        </div>
        {lessonsLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading lessons...</div>
        ) : todayLessons.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No lessons scheduled for today</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {todayLessons.map((lesson) => (
              <div key={lesson.id} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50/50">
                <div className="flex-shrink-0 w-16 text-center">
                  <span className="text-sm font-semibold text-navy">{lesson.start_time?.slice(0, 5)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-navy text-sm">{lesson.title}</p>
                    {lesson.instrument?.icon && <span className="text-base">{lesson.instrument.icon}</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                    {lesson.teacher?.full_name && <span>{lesson.teacher.full_name}</span>}
                    {lesson.location?.name && (
                      <span className="flex items-center gap-0.5"><MapPin size={10} />{lesson.location.name}</span>
                    )}
                    {lesson.students && lesson.students.length > 0 && (
                      <span>{lesson.students.map((s) => s.student?.full_name).filter(Boolean).join(', ')}</span>
                    )}
                  </div>
                </div>
                <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
                  lesson.status === 'completed' ? 'bg-teal/10 text-teal' :
                  lesson.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                  'bg-coral/10 text-coral'
                }`}>
                  {lesson.status === 'completed' && <CheckCircle size={12} className="inline mr-1" />}
                  {lesson.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
