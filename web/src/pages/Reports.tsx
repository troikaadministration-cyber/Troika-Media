import { toDateStr } from '../lib/dates';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { BarChart3, IndianRupee, AlertCircle, GraduationCap, Download, RefreshCw, CheckCircle } from 'lucide-react';
import { SkeletonCards, SkeletonList } from '../components/Skeleton';

interface PaymentRow {
  amount: number;
  paid_date: string | null;
  due_date: string;
  student: { id: string; full_name: string } | null;
}
interface EnrolmentRow {
  lessons_used: number;
  total_lessons: number;
  student: { id: string; full_name: string } | null;
}
interface AttendanceRow {
  attended: boolean | null;
  absence_category: string | null;
  student: { id: string; full_name: string } | null;
  lesson: { status: string } | null;
}

interface StudentReport {
  id: string;
  name: string;
  collected: number;
  outstanding: number;
  lessonsUsed: number;
  lessonsTotal: number;
  attended: number;
  absent: number;
  chargedAbsent: number;
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function ReportsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [enrolments, setEnrolments] = useState<EnrolmentRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [payRes, enrRes, attRes] = await Promise.all([
      supabase.from('payment_records').select('amount, paid_date, due_date, student:students(id, full_name)'),
      supabase.from('student_enrolments').select('lessons_used, total_lessons, student:students(id, full_name)'),
      supabase.from('lesson_students').select('attended, absence_category, student:students(id, full_name), lesson:lessons(status)'),
    ]);
    if (payRes.error) setError(payRes.error.message);
    else if (enrRes.error) setError(enrRes.error.message);
    else if (attRes.error) setError(attRes.error.message);
    else {
      setPayments((payRes.data || []) as any);
      setEnrolments((enrRes.data || []) as any);
      setAttendance((attRes.data || []) as any);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = toDateStr(new Date());

  const totals = useMemo(() => {
    let collected = 0, outstanding = 0, overdue = 0;
    for (const p of payments) {
      const amt = Number(p.amount) || 0;
      if (p.paid_date) collected += amt;
      else { outstanding += amt; if (p.due_date < today) overdue += amt; }
    }
    let delivered = 0, total = 0;
    for (const e of enrolments) {
      delivered += Number(e.lessons_used) || 0;
      total += Number(e.total_lessons) || 0;
    }
    let attended = 0, absent = 0;
    for (const a of attendance) {
      if (a.attended === true) attended++;
      else if (a.attended === false) absent++;
    }
    return { collected, outstanding, overdue, delivered, remaining: Math.max(0, total - delivered), total, attended, absent };
  }, [payments, enrolments, attendance, today]);

  const perStudent = useMemo<StudentReport[]>(() => {
    const map = new Map<string, StudentReport>();
    const get = (id: string, name: string) => {
      if (!map.has(id)) map.set(id, { id, name, collected: 0, outstanding: 0, lessonsUsed: 0, lessonsTotal: 0, attended: 0, absent: 0, chargedAbsent: 0 });
      return map.get(id)!;
    };
    for (const p of payments) {
      if (!p.student) continue;
      const r = get(p.student.id, p.student.full_name);
      const amt = Number(p.amount) || 0;
      if (p.paid_date) r.collected += amt; else r.outstanding += amt;
    }
    for (const e of enrolments) {
      if (!e.student) continue;
      const r = get(e.student.id, e.student.full_name);
      r.lessonsUsed += Number(e.lessons_used) || 0;
      r.lessonsTotal += Number(e.total_lessons) || 0;
    }
    for (const a of attendance) {
      if (!a.student) continue;
      const r = get(a.student.id, a.student.full_name);
      if (a.attended === true) r.attended++;
      else if (a.attended === false) {
        r.absent++;
        if (a.absence_category === 'charged') r.chargedAbsent++;
      }
    }
    // Sorted by most lessons attended, so the top of the list is "where most lessons are".
    return [...map.values()].sort((a, b) => b.attended - a.attended || b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  }, [payments, enrolments, attendance]);

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
          <button onClick={load} className="p-2 text-gray-400 hover:text-navy" aria-label="Refresh"><RefreshCw size={18} /></button>
          <button onClick={exportCsv} disabled={perStudent.length === 0}
            className="flex items-center gap-1.5 bg-navy text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-navy/90 disabled:opacity-50">
            <Download size={16} /> Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-coral/10 text-coral rounded-xl p-4 text-sm mb-4">{error}</div>
      )}

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
