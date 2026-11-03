import { toDateStr } from '../lib/dates';
import { useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { BarChart3, IndianRupee, AlertCircle, GraduationCap, Download, RefreshCw, CheckCircle } from 'lucide-react';
import { SkeletonCards, SkeletonList } from '../components/Skeleton';
import { useQuery, unwrap } from '../lib/queryCache';
import { ErrorBanner } from '../components/ErrorBanner';

interface SummaryRow {
  student_id: string;
  full_name: string;
  collected: number | string;
  outstanding: number | string;
  overdue: number | string;
  lessons_used: number | string;
  lessons_total: number | string;
  attended: number | string;
  absent: number | string;
  charged_absent: number | string;
}

interface StudentReport {
  id: string;
  name: string;
  collected: number;
  outstanding: number;
  overdue: number;
  lessonsUsed: number;
  lessonsTotal: number;
  attended: number;
  absent: number;
  chargedAbsent: number;
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function ReportsPage() {
  const today = toDateStr(new Date());

  // All aggregation happens in the database (reports_summary): one row per student.
  const { data: rows, loading, error, fetching, refresh } = useQuery<SummaryRow[]>(`reports:${today}`, async () => {
    const res = await supabase.rpc('reports_summary', { p_today: today });
    return unwrap(res, []) as SummaryRow[];
  });

  const perStudent = useMemo<StudentReport[]>(() => {
    const list = (rows || []).map((r) => ({
      id: r.student_id,
      name: r.full_name,
      collected: Number(r.collected) || 0,
      outstanding: Number(r.outstanding) || 0,
      overdue: Number(r.overdue) || 0,
      lessonsUsed: Number(r.lessons_used) || 0,
      lessonsTotal: Number(r.lessons_total) || 0,
      attended: Number(r.attended) || 0,
      absent: Number(r.absent) || 0,
      chargedAbsent: Number(r.charged_absent) || 0,
    }));
    // Sorted by most lessons attended, so the top of the list is "where most lessons are".
    return list.sort((a, b) => b.attended - a.attended || b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  }, [rows]);

  const totals = useMemo(() => {
    const t = { collected: 0, outstanding: 0, overdue: 0, delivered: 0, total: 0, attended: 0, absent: 0 };
    for (const r of perStudent) {
      t.collected += r.collected;
      t.outstanding += r.outstanding;
      t.overdue += r.overdue;
      t.delivered += r.lessonsUsed;
      t.total += r.lessonsTotal;
      t.attended += r.attended;
      t.absent += r.absent;
    }
    return { ...t, remaining: Math.max(0, t.total - t.delivered) };
  }, [perStudent]);

  function exportCsv() {
    const header = [
      'Student',
      'Lessons attended', 'Absences', 'Charged absences',
      'Lessons delivered', 'Lessons remaining', 'Lessons total',
      'Collected (INR)', 'Outstanding (INR)',
    ];
    const rows = perStudent.map(r => [
      r.name,
      r.attended,
      r.absent,
      r.chargedAbsent,
      r.lessonsUsed,
      Math.max(0, r.lessonsTotal - r.lessonsUsed),
      r.lessonsTotal,
      Math.round(r.collected),
      Math.round(r.outstanding),
    ]);
    // Totals row so the sheet answers "total lessons studied / total absences" at a glance.
    const totalRow = [
      'TOTAL',
      perStudent.reduce((s, r) => s + r.attended, 0),
      perStudent.reduce((s, r) => s + r.absent, 0),
      perStudent.reduce((s, r) => s + r.chargedAbsent, 0),
      perStudent.reduce((s, r) => s + r.lessonsUsed, 0),
      perStudent.reduce((s, r) => s + Math.max(0, r.lessonsTotal - r.lessonsUsed), 0),
      perStudent.reduce((s, r) => s + r.lessonsTotal, 0),
      Math.round(perStudent.reduce((s, r) => s + r.collected, 0)),
      Math.round(perStudent.reduce((s, r) => s + r.outstanding, 0)),
    ];
    const escape = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows, totalRow].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `troika-report-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cards = [
    { label: 'Revenue collected', value: inr(totals.collected), sub: totals.outstanding > 0 ? `${inr(totals.outstanding)} outstanding` : undefined, icon: IndianRupee, color: 'text-teal', bg: 'bg-teal/10' },
    { label: 'Lessons delivered', value: `${totals.delivered} / ${totals.total}`, sub: `${totals.remaining} remaining`, icon: GraduationCap, color: 'text-navy', bg: 'bg-gray-100' },
    { label: 'Lessons attended', value: `${totals.attended}`, sub: 'across all students', icon: CheckCircle, color: 'text-teal', bg: 'bg-teal/10' },
    { label: 'Absences', value: `${totals.absent}`, sub: undefined, icon: AlertCircle, color: 'text-coral', bg: 'bg-coral/10' },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
            <BarChart3 size={22} className="text-teal" /> Reports
          </h1>
          <p className="text-gray-500 text-sm mt-1">Dues, lessons delivered vs remaining, and revenue collected</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refresh()} className="p-2 text-gray-400 hover:text-navy" aria-label="Refresh"><RefreshCw size={18} className={fetching ? 'animate-spin' : ''} /></button>
          <button onClick={exportCsv} disabled={perStudent.length === 0}
            className="flex items-center gap-1.5 bg-navy text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-navy/90 disabled:opacity-50">
            <Download size={16} /> Export CSV
          </button>
        </div>
      </div>

      {error && <div className="mb-4"><ErrorBanner message={error} onRetry={refresh} /></div>}

      {loading ? (
        <>
          <SkeletonCards count={4} className="grid-cols-2 lg:grid-cols-4 mb-6" />
          <SkeletonList rows={5} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {cards.map((c) => (
              <div key={c.label} className="bg-white rounded-2xl border border-black/5 p-5">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 ${c.bg}`}>
                  <c.icon size={20} className={c.color} />
                </div>
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{c.label}</p>
                <p className="text-2xl font-bold text-navy mt-1">{c.value}</p>
                {c.sub && <p className="text-xs text-gray-400 mt-0.5">{c.sub}</p>}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
            <div className="px-5 py-3 border-b border-black/5">
              <h2 className="font-semibold text-navy text-sm">Per-student breakdown</h2>
            </div>
            {perStudent.length === 0 ? (
              <p className="text-center text-gray-400 py-12 text-sm">No data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="text-left px-5 py-2.5 font-medium">Student</th>
                      <th className="text-right px-5 py-2.5 font-medium">Attended</th>
                      <th className="text-right px-5 py-2.5 font-medium">Absences</th>
                      <th className="text-left px-5 py-2.5 font-medium">Lessons</th>
                      <th className="text-right px-5 py-2.5 font-medium">Collected</th>
                      <th className="text-right px-5 py-2.5 font-medium">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {perStudent.map((r) => (
                      <tr key={r.id}>
                        <td className="px-5 py-2.5 font-medium text-navy">{r.name}</td>
                        <td className="px-5 py-2.5 text-right text-teal font-medium">{r.attended}</td>
                        <td className="px-5 py-2.5 text-right">
                          <span className={r.absent > 0 ? 'text-coral font-medium' : 'text-gray-300'}>{r.absent}</span>
                          {r.chargedAbsent > 0 && <span className="text-gray-400 text-xs"> ({r.chargedAbsent} charged)</span>}
                        </td>
                        <td className="px-5 py-2.5 text-gray-500">
                          {r.lessonsUsed} / {r.lessonsTotal}
                          <span className="text-gray-300"> · {Math.max(0, r.lessonsTotal - r.lessonsUsed)} left</span>
                        </td>
                        <td className="px-5 py-2.5 text-right text-teal font-medium">{inr(r.collected)}</td>
                        <td className={`px-5 py-2.5 text-right font-medium ${r.outstanding > 0 ? 'text-coral' : 'text-gray-300'}`}>{inr(r.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
