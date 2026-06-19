import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, CreditCard, Music, MapPin, ChevronRight,
  CheckCircle, XCircle, CalendarClock, Ban, Sparkles, AlertCircle, Clock,
} from 'lucide-react';
import { useStudentPortal } from './StudentPortalContext';
import { CancelLessonModal, toCancelTarget, type CancelTarget } from '../../components/student/shared';
import { greeting, firstName, fmtDate, fmtTime, fmtMoney } from './format';

export function StudentHome() {
  const { upcoming, past, totalCompleted, enrolments, payments, studentName } = useStudentPortal();
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);

  const next = upcoming.find((i) => i.lesson.status !== 'cancelled') || null;
  const nextTeacher = next ? ((next.lesson.teacher as any)?.full_name as string | undefined) : undefined;
  const nextLocation = next ? ((next.lesson.location as any)?.name as string | undefined) : undefined;

  const totalMissed = past.filter((l) => l.attended === false).length;
  const primary = enrolments[0] || null;
  const remaining = primary ? primary.total_lessons - primary.lessons_used : null;

  const today = new Date().toISOString().split('T')[0];
  const paidCount = payments.filter((p) => p.paid_date).length;
  const overdue = payments.filter((p) => !p.paid_date && p.due_date < today);
  const nextPay = payments.find((p) => !p.paid_date && p.due_date >= today);

  const stats = [
    { label: 'Lessons Attended', value: totalCompleted, icon: CheckCircle, bg: 'bg-teal/10', color: 'text-teal' },
    { label: 'Lessons Missed', value: totalMissed, icon: XCircle, bg: 'bg-coral/10', color: 'text-coral' },
    { label: 'Lessons Left', value: remaining ?? '—', icon: Calendar, bg: 'bg-yellow/10', color: 'text-yellow-700' },
    { label: 'Payments Paid', value: `${paidCount}/${payments.length}`, icon: CreditCard, bg: 'bg-teal/10', color: 'text-teal' },
  ];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-navy">{greeting()}, {firstName(studentName)} 👋</h1>
        <p className="text-gray-500 text-sm mt-1">Here's everything in one place.</p>
      </div>

      {/* Next lesson hero */}
      {next ? (
        <div className="rounded-2xl bg-gradient-to-br from-coral to-[#ef7a64] text-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-white/85 text-sm font-medium mb-3">
            <CalendarClock size={16} /> Your next lesson
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-tight">
                {fmtDate(next.lesson.date, { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <p className="text-white/90 mt-1 flex items-center gap-1.5">
                <Clock size={15} /> {fmtTime(next.lesson.start_time)}
              </p>
              <div className="flex items-center gap-3 mt-3 text-sm text-white/90 flex-wrap">
                <span className="flex items-center gap-1.5">
                  {next.lesson.instrument?.icon && <span className="text-base">{next.lesson.instrument.icon}</span>}
                  {next.lesson.title}
                </span>
                {nextTeacher && <span>· {nextTeacher}</span>}
                {nextLocation && <span className="flex items-center gap-1"><MapPin size={13} />{nextLocation}</span>}
              </div>
            </div>
            {next.lesson.status === 'scheduled' && (
              <button
                onClick={() => setCancelTarget(toCancelTarget(next, studentName))}
                className="flex items-center gap-1.5 text-xs font-medium bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
              >
                <Ban size={13} /> Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-teal/10 flex items-center justify-center mx-auto mb-3">
            <Sparkles size={22} className="text-teal" />
          </div>
          <p className="font-semibold text-navy">You're all caught up 🎵</p>
          <p className="text-gray-500 text-sm mt-1">No upcoming lessons scheduled. Check back soon!</p>
        </div>
      )}

      {/* Payment alert */}
      {overdue.length > 0 ? (
        <Link
          to="/payments"
          className="flex items-center gap-3 bg-coral/10 border border-coral/20 rounded-xl p-4 hover:bg-coral/15 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-coral/10 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={20} className="text-coral" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-coral">Payment overdue</p>
            <p className="text-xs text-coral/80">
              {fmtMoney(overdue[0].amount)} was due on {fmtDate(overdue[0].due_date, { month: 'short', day: 'numeric' })}
            </p>
          </div>
          <ChevronRight size={18} className="text-coral/60 flex-shrink-0" />
        </Link>
      ) : nextPay ? (
        <Link
          to="/payments"
          className="flex items-center gap-3 bg-yellow/10 border border-yellow/20 rounded-xl p-4 hover:bg-yellow/15 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-yellow/10 flex items-center justify-center flex-shrink-0">
            <Clock size={20} className="text-yellow-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-yellow-700">Next payment</p>
            <p className="text-xs text-yellow-600">
              {fmtMoney(nextPay.amount)} due on {fmtDate(nextPay.due_date, { month: 'short', day: 'numeric' })}
            </p>
          </div>
          <ChevronRight size={18} className="text-yellow-600/60 flex-shrink-0" />
        </Link>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>
              <s.icon size={20} className={s.color} />
            </div>
            <p className="text-2xl font-bold text-navy">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Explore</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <QuickLink to="/lessons" icon={Music} title="My Lessons" desc="Upcoming & past" />
          <QuickLink to="/calendar" icon={Calendar} title="Calendar" desc="Month at a glance" />
          <QuickLink to="/payments" icon={CreditCard} title="Payments" desc="Fees & invoices" />
        </div>
      </div>

      <CancelLessonModal target={cancelTarget} onClose={() => setCancelTarget(null)} />
    </div>
  );
}

function QuickLink({
  to, icon: Icon, title, desc,
}: {
  to: string;
  icon: typeof Music;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3 hover:shadow-sm hover:border-coral/30 transition-all group"
    >
      <div className="w-10 h-10 rounded-lg bg-coral/10 flex items-center justify-center flex-shrink-0">
        <Icon size={20} className="text-coral" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-navy text-sm">{title}</p>
        <p className="text-xs text-gray-500">{desc}</p>
      </div>
      <ChevronRight size={18} className="text-gray-300 group-hover:text-coral transition-colors" />
    </Link>
  );
}
