import { toDateStr } from '../lib/dates';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Users, GraduationCap, IndianRupee, AlertCircle, CheckCircle } from 'lucide-react';
import { Skeleton } from '../components/Skeleton';

interface TodayLesson {
  id: string; title: string; start_time: string; end_time: string | null; status: string;
  teacher?: { full_name: string };
  location?: { name: string };
  instrument?: { name: string; icon: string | null };
  students?: { student?: { full_name: string } }[];
}
interface DuePayment {
  amount: number; due_date: string; label: string | null;
  student?: { id: string; full_name: string } | null;
}

const inr = (n: number) => n >= 100000 ? `₹${(n / 100000).toFixed(2)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`;
const initials = (name: string) => name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
const instrumentGlyph = (name?: string) => {
  const n = (name || '').toLowerCase();
  if (n.includes('violin') || n.includes('viola') || n.includes('cello') || n.includes('bass')) return '🎻';
  if (n.includes('piano') || n.includes('key')) return '🎹';
  if (n.includes('guitar') || n.includes('ukulele')) return '🎸';
  if (n.includes('voice') || n.includes('vocal') || n.includes('sing')) return '🎤';
  if (n.includes('drum') || n.includes('percussion')) return '🥁';
  if (n.includes('trumpet') || n.includes('horn') || n.includes('tuba') || n.includes('trombone')) return '🎺';
  return '🎵';
};

/** Tiny area sparkline from a numeric series. */
function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 74},${22 - ((v - min) / span) * 18}`);
  return (
    <svg width="74" height="26" viewBox="0 0 74 26" preserveAspectRatio="none" className="flex-shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="2" points={pts.join(' ')} />
      <polygon fill={color} opacity="0.12" points={`${pts.join(' ')} 74,26 0,26`} />
    </svg>
  );
}

export function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [todayLessons, setTodayLessons] = useState<TodayLesson[]>([]);
  const [weekSeries, setWeekSeries] = useState<number[]>([]);
  const [dues, setDues] = useState<DuePayment[]>([]);
  const [k, setK] = useState({ active: 0, totalStudents: 0, doneToday: 0, totalToday: 0, collected: 0, outstanding: 0, overdue: 0 });
  const navigate = useNavigate();
  const { profile } = useAuth();

  const today = toDateStr(new Date());
  const now = new Date();
  const hr = now.getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.full_name?.split(' ')[0] || '';
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 6);
  const weekAgoStr = toDateStr(weekAgo);

  useEffect(() => {
    Promise.all([
      supabase.from('students').select('id, is_active'),
      supabase.from('lessons').select(`id, title, start_time, end_time, status,
        teacher:profiles!lessons_teacher_id_fkey(full_name), location:locations(name),
        instrument:instruments(name, icon), students:lesson_students(student:students(full_name))`)
        .eq('date', today).order('start_time'),
      supabase.from('payment_records').select('amount, paid_date, due_date, label, student:students(id, full_name)'),
      supabase.from('lessons').select('date').gte('date', weekAgoStr).lte('date', today),
    ]).then(([studentsRes, lessonsRes, payRes, weekRes]) => {
      const students = studentsRes.data || [];
      const lessons = (lessonsRes.data || []) as unknown as TodayLesson[];
      const pays = (payRes.data || []) as any[];

      let collected = 0, outstanding = 0, overdue = 0;
      const unpaid: DuePayment[] = [];
      for (const p of pays) {
        const amt = Number(p.amount) || 0;
        if (p.paid_date) { if (p.paid_date >= monthStart) collected += amt; }
        else { outstanding += amt; if (p.due_date < today) overdue++; unpaid.push(p); }
      }
      unpaid.sort((a, b) => a.due_date.localeCompare(b.due_date));

      // 7-day lesson counts
      const counts: Record<string, number> = {};
      for (const r of (weekRes.data || []) as { date: string }[]) counts[r.date] = (counts[r.date] || 0) + 1;
      const series: number[] = [];
      for (let i = 6; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); series.push(counts[toDateStr(d)] || 0); }

      setTodayLessons(lessons);
      setWeekSeries(series);
      setDues(unpaid.slice(0, 4));
      setK({
        active: students.filter(s => s.is_active).length,
        totalStudents: students.length,
        doneToday: lessons.filter(l => l.status === 'completed').length,
        totalToday: lessons.length,
        collected, outstanding, overdue,
      });
      setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const collectPct = k.collected + k.outstanding > 0 ? Math.round((k.collected / (k.collected + k.outstanding)) * 100) : 0;

  const tiles = [
    { label: 'Active students', value: loading ? '—' : String(k.active), sub: `of ${k.totalStudents} total`, icon: Users, tint: 'bg-teal/10 text-teal', spark: null },
    { label: 'Lessons today', value: loading ? '—' : String(k.totalToday), sub: `${k.doneToday} completed`, icon: GraduationCap, tint: 'bg-teal/10 text-teal', spark: { data: weekSeries, color: 'var(--teal)' } },
    { label: `Collected · ${now.toLocaleDateString('en-IN', { month: 'short' })}`, value: loading ? '—' : inr(k.collected), sub: `${collectPct}% of billed`, icon: IndianRupee, tint: 'bg-teal/10 text-teal', spark: null },
    { label: 'Outstanding dues', value: loading ? '—' : inr(k.outstanding), sub: k.overdue > 0 ? `${k.overdue} overdue` : 'all on track', icon: AlertCircle, tint: 'bg-coral/10 text-coral', spark: null, onClick: () => navigate('/payments') },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy">{greeting}{firstName ? `, ${firstName}` : ''}</h1>
        <p className="text-gray-500 text-sm mt-1">
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          {!loading && ` · ${k.totalToday} lesson${k.totalToday !== 1 ? 's' : ''} today · ${k.doneToday} done`}
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((t) => (
          <div key={t.label} onClick={t.onClick}
            className={`bg-white rounded-2xl border border-black/5 shadow-sm p-4 ${t.onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}>
            <div className={`w-9 h-9 rounded-lg grid place-items-center mb-3 ${t.tint}`}>
              <t.icon size={18} />
            </div>
            <div className="flex items-end justify-between gap-2">
              <p className="text-2xl font-bold text-navy num tracking-tight">{t.value}</p>
              {t.spark && <Spark data={t.spark.data} color={t.spark.color} />}
            </div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 mt-2">{t.label}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Today's schedule */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-black/5 flex items-center justify-between">
            <h2 className="font-semibold text-navy text-sm">Today&rsquo;s schedule</h2>
            <button onClick={() => navigate('/schedule')} className="text-xs font-semibold text-teal hover:underline">Open schedule →</button>
          </div>
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3"><Skeleton className="h-9 w-12 rounded-lg" /><div className="flex-1"><Skeleton className="h-3.5 w-40 mb-2" /><Skeleton className="h-3 w-24" /></div></div>
              ))}
            </div>
          ) : todayLessons.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-12">No lessons scheduled today</p>
          ) : (
            <div className="divide-y divide-black/5">
              {todayLessons.map((l) => {
                const student = l.students?.map(s => s.student?.full_name).filter(Boolean).join(', ');
                return (
                  <div key={l.id} className="grid grid-cols-[46px_1fr_auto] items-center gap-3 px-5 py-3 hover:bg-gray-50/60">
                    <div className="text-xs font-semibold text-gray-600 num">
                      {l.start_time?.slice(0, 5)}
                    </div>
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-8 h-8 rounded-lg grid place-items-center bg-gray-100 border border-black/5 text-sm flex-shrink-0">{l.instrument?.icon || instrumentGlyph(l.instrument?.name)}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-navy truncate">{student || l.title}</p>
                        <p className="text-[11.5px] text-gray-500 truncate">
                          {[l.teacher?.full_name, l.instrument?.name, l.location?.name].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${
                      l.status === 'completed' ? 'bg-teal/10 text-teal'
                        : l.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
                        : 'bg-coral/10 text-coral'
                    }`}>
                      {l.status === 'completed' && <CheckCircle size={11} className="inline mr-1 -mt-px" />}
                      {l.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Needs attention */}
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-black/5 flex items-center justify-between">
            <h2 className="font-semibold text-navy text-sm">Needs attention</h2>
            <button onClick={() => navigate('/payments')} className="text-xs font-semibold text-teal hover:underline">Payments →</button>
          </div>
          {loading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
          ) : dues.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">Nothing outstanding 🎉</p>
          ) : (
            <>
              {dues.map((d, i) => {
                const isOverdue = d.due_date < today;
                return (
                  <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-black/5">
                    <span className={`w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold text-white flex-shrink-0 ${isOverdue ? 'bg-coral' : 'bg-gray-400'}`}>
                      {initials(d.student?.full_name || '?')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-navy truncate">{d.student?.full_name || 'Unknown'}</p>
                      <p className="text-[11px] text-gray-400 truncate">{d.label || 'Instalment'}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[12.5px] font-bold text-navy num">{inr(Number(d.amount))}</p>
                      <p className={`text-[10px] font-medium ${isOverdue ? 'text-coral' : 'text-gray-400'}`}>
                        {isOverdue ? 'overdue' : 'due soon'}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div className="px-5 py-3.5">
                <div className="flex justify-between text-[11.5px] mb-1.5">
                  <span className="text-gray-500">Collected this month</span>
                  <span className="font-semibold text-navy num">{inr(k.collected)}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden border border-black/5">
                  <div className="h-full rounded-full bg-teal" style={{ width: `${collectPct}%` }} />
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">{collectPct}% of billed collected</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
