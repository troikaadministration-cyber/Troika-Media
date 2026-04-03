import React, { useEffect, useState } from 'react';
import { Users, Calendar, Music, CreditCard, TrendingUp, Clock, CalendarOff } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface DashboardStats {
  totalStudents: number;
  activeStudents: number;
  todayLessons: number;
  completedToday: number;
  totalTeachers: number;
  pendingPayments: number;
  pendingReschedule: number;
}

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0, activeStudents: 0, todayLessons: 0,
    completedToday: 0, totalTeachers: 0, pendingPayments: 0, pendingReschedule: 0,
  });
  const [recentLessons, setRecentLessons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    const today = new Date().toISOString().split('T')[0];

    const [studentsRes, teachersRes, todayRes, paymentsRes, recentRes, rescheduleRes] = await Promise.all([
      supabase.from('students').select('id, is_active'),
      supabase.from('profiles').select('id').eq('role', 'teacher'),
      supabase.from('lessons').select('id, status').eq('date', today),
      supabase.from('payment_records').select('id').is('paid_date', null),
      supabase.from('lessons')
        .select('*, teacher:profiles!lessons_teacher_id_fkey(full_name), instrument:instruments(name)')
        .eq('date', today)
        .order('start_time')
        .limit(10),
      supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('pending_reschedule', true),
    ]);

    const students = studentsRes.data || [];
    setStats({
      totalStudents: students.length,
      activeStudents: students.filter((s: any) => s.is_active).length,
      todayLessons: (todayRes.data || []).length,
      completedToday: (todayRes.data || []).filter((l: any) => l.status === 'completed').length,
      totalTeachers: (teachersRes.data || []).length,
      pendingPayments: (paymentsRes.data || []).length,
      pendingReschedule: rescheduleRes.count || 0,
    });
    setRecentLessons(recentRes.data || []);
    setLoading(false);
  }

  const cards = [
    { label: 'Active Students', value: stats.activeStudents, total: stats.totalStudents, icon: Users, color: 'bg-teal', lightBg: 'bg-teal-light' },
    { label: "Today's Lessons", value: stats.completedToday, total: stats.todayLessons, icon: Calendar, color: 'bg-coral', lightBg: 'bg-coral-light' },
    { label: 'Teachers', value: stats.totalTeachers, total: null, icon: Music, color: 'bg-navy', lightBg: 'bg-gray-100' },
    { label: 'Pending Payments', value: stats.pendingPayments, total: null, icon: CreditCard, color: 'bg-amber-500', lightBg: 'bg-amber-50' },
    ...(stats.pendingReschedule > 0 ? [{ label: 'Pending Reschedule', value: stats.pendingReschedule, total: null, icon: CalendarOff, color: 'bg-coral', lightBg: 'bg-coral-light' }] : []),
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Overview of your music school</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-500">{card.label}</span>
              <div className={`w-10 h-10 ${card.lightBg} rounded-lg flex items-center justify-center`}>
                <card.icon size={20} className={card.color === 'bg-navy' ? 'text-navy' : card.color === 'bg-coral' ? 'text-coral' : card.color === 'bg-teal' ? 'text-teal' : 'text-amber-500'} />
              </div>
            </div>
            <p className="text-3xl font-bold text-navy">{card.value}</p>
            {card.total !== null && (
              <p className="text-sm text-gray-400 mt-1">of {card.total} total</p>
            )}
          </div>
        ))}
      </div>

      {/* Today's lessons */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-navy">Today's Schedule</h2>
          <span className="text-sm text-teal font-medium">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </span>
        </div>

        {recentLessons.length === 0 ? (
          <p className="text-gray-400 text-sm py-8 text-center">No lessons scheduled for today</p>
        ) : (
          <div className="space-y-3">
            {recentLessons.map((lesson: any) => (
              <div key={lesson.id} className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 border border-gray-50">
                <div className="text-sm font-semibold text-navy w-14">
                  {lesson.start_time?.slice(0, 5)}
                </div>
                <div className={`w-1.5 h-10 rounded-full ${lesson.status === 'completed' ? 'bg-teal' : 'bg-coral'}`} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-navy">{lesson.title || lesson.instrument?.name + ' Lesson'}</p>
                  <p className="text-xs text-gray-400">{lesson.teacher?.full_name}</p>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  lesson.status === 'completed' ? 'bg-teal-light text-teal' : 'bg-coral-light text-coral'
                }`}>
                  {lesson.status === 'completed' ? 'Completed' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
