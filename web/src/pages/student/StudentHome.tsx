import { toDateStr } from '../../lib/dates';
import { Link } from 'react-router-dom';
import {
  Calendar, CreditCard, Music, MapPin, ChevronRight,
  CheckCircle, XCircle, CalendarClock, Sparkles, AlertCircle, Clock,
} from 'lucide-react';
import { useStudentPortal } from './StudentPortalContext';
import { Skeleton } from '../../components/Skeleton';
import { ErrorBanner } from '../../components/ErrorBanner';
import { AbsenceControls } from '../../components/student/shared';
import type { StudentLesson } from '../../hooks/useStudentLessons';
import type { Child, Enrolment } from './StudentPortalContext';
import { greeting, firstName, fmtDate, fmtTime, fmtMoney } from './format';

export function StudentHome() {
  const {
    upcoming, totalCompleted, totalMissed, enrolments, payments, studentName,
    loadingLessons, lessonsError, refresh, children, isFamily, selectedChildId, childLabel,
  } = useStudentPortal();
  // Family login showing "All": one card per child instead of one hero.
  const familyAll = isFamily && !selectedChildId;
  const selectedChild = isFamily ? children.find((c) => c.id === selectedChildId) : undefined;
  const forChild = (studentId: string) => {
    const name = childLabel(studentId);
    return name ? ` for ${name}` : '';
  };

  const next = upcoming.find((i) => i.lesson.status !== 'cancelled') || null;
  const nextTeacher = next ? next.lesson.teacher?.full_name : undefined;
  const nextLocation = next ? next.lesson.location?.name : undefined;

  // Across all of the student's classes (one enrolment per class).
  const remaining = enrolments.length
    ? enrolments.reduce((sum, e) => sum + Math.max(0, e.total_lessons - e.lessons_used), 0)
    : null;

  const today = toDateStr(new Date());
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

      {lessonsError && <ErrorBanner message={lessonsError} onRetry={() => { void refresh(); }} />}

      {/* Next lesson hero */}
      {loadingLessons ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : familyAll ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {children.map((c) => (
            <ChildCard key={c.id} child={c} upcoming={upcoming} enrolments={enrolments} />
          ))}
        </div>
      ) : next ? (
        <div className="rounded-2xl bg-gradient-to-br from-coral to-[#ef7a64] text-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-white/85 text-sm font-medium mb-3">
            <CalendarClock size={16} /> {selectedChild ? `${selectedChild.label}'s next lesson` : 'Your next lesson'}
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
          </div>
          <AbsenceControls item={next} onAccent className="mt-4" />
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
              {fmtMoney(overdue[0].amount)}{forChild(overdue[0].student_id)} was due on {fmtDate(overdue[0].due_date, { month: 'short', day: 'numeric' })}
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
              {fmtMoney(nextPay.amount)}{forChild(nextPay.student_id)} due on {fmtDate(nextPay.due_date, { month: 'short', day: 'numeric' })}
            </p>
          </div>
          <ChevronRight size={18} className="text-yellow-600/60 flex-shrink-0" />
        </Link>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-black/5 p-4 sm:p-5">
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
    </div>
  );
}

/** Family "All" view: one child's next lesson and lessons left. */
function ChildCard({
  child, upcoming, enrolments,
}: { child: Child; upcoming: StudentLesson[]; enrolments: Enrolment[] }) {
  const next = upcoming.find((i) => i.student_id === child.id && i.lesson.status !== 'cancelled') || null;
  const mine = enrolments.filter((e) => e.student_id === child.id);
  const left = mine.length ? mine.reduce((sum, e) => sum + Math.max(0, e.total_lessons - e.lessons_used), 0) : null;
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-navy text-lg truncate" title={child.full_name}>{child.full_name}</p>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-yellow/10 text-yellow-700 whitespace-nowrap">
          {left === null ? 'No enrolment' : `${left} lesson${left === 1 ? '' : 's'} left`}
        </span>
      </div>
      {next ? (
        <div>
          <p className="text-xs font-medium text-gray-400 flex items-center gap-1.5"><CalendarClock size={13} /> Next lesson</p>
          <p className="text-navy font-semibold mt-1">
            {fmtDate(next.lesson.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtTime(next.lesson.start_time)}
          </p>
          <div className="flex items-center gap-x-3 gap-y-0.5 mt-0.5 text-sm text-gray-500 flex-wrap">
            <span className="flex items-center gap-1.5">
              {next.lesson.instrument?.icon && <span className="text-base">{next.lesson.instrument.icon}</span>}
              {next.lesson.title}
            </span>
            {next.lesson.teacher?.full_name && <span>· {next.lesson.teacher.full_name}</span>}
            {next.lesson.location?.name && (
              <span className="flex items-center gap-1"><MapPin size={12} />{next.lesson.location.name}</span>
            )}
          </div>
          <AbsenceControls item={next} className="mt-3" />
        </div>
      ) : (
        <p className="text-sm text-gray-500">No upcoming lessons scheduled.</p>
      )}
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
      className="bg-white rounded-xl border border-black/5 p-4 flex items-center gap-3 hover:shadow-sm hover:border-coral/30 transition-all group"
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
