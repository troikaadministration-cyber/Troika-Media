import { MapPin, CheckCircle, XCircle } from 'lucide-react';
import type { StudentLesson } from '../../hooks/useStudentLessons';

// ── Badges ──────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-teal/10 text-teal',
    cancelled: 'bg-gray-100 text-gray-500',
    scheduled: 'bg-coral/10 text-coral',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${map[status] || 'bg-coral/10 text-coral'}`}>
      {status}
    </span>
  );
}

export function AttendanceBadge({ item }: { item: StudentLesson }) {
  if (item.attended === true) {
    return (
      <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-teal/10 text-teal">
        <CheckCircle size={12} /> Attended
      </span>
    );
  }
  if (item.attended === false) {
    return (
      <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
        item.absence_category === 'charged' ? 'bg-coral/10 text-coral' : 'bg-yellow/10 text-yellow-700'
      }`}>
        <XCircle size={12} /> Absent{item.absence_category === 'charged' ? ' (charged)' : ''}
      </span>
    );
  }
  return <span className="px-2.5 py-1 rounded-full text-xs text-gray-400 bg-gray-50">Not recorded</span>;
}

// ── Lesson row (shared by Home, Lessons, Calendar) ───────────────────────

export function LessonRow({
  item,
  variant,
}: {
  item: StudentLesson;
  variant: 'upcoming' | 'past';
}) {
  const l = item.lesson;
  const teacher = (l.teacher as any)?.full_name as string | undefined;
  const location = (l.location as any)?.name as string | undefined;

  return (
    <div className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50/50">
      <div className="flex-shrink-0 w-16 text-center">
        <span className="block text-sm font-semibold text-navy">{l.start_time?.slice(0, 5)}</span>
        <span className="text-[10px] text-gray-400">
          {new Date(l.date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-navy text-sm">{l.title}</p>
          {l.instrument?.icon && <span className="text-base">{l.instrument.icon}</span>}
          {l.lesson_type !== 'regular' && (
            <span className="text-[10px] bg-yellow/10 text-yellow-700 px-2 py-0.5 rounded-full capitalize">
              {l.lesson_type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
          {teacher && <span>{teacher}</span>}
          {location && <span className="flex items-center gap-0.5"><MapPin size={10} />{location}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {variant === 'upcoming' ? <StatusBadge status={l.status} /> : <AttendanceBadge item={item} />}
      </div>
    </div>
  );
}

// ── Misc ─────────────────────────────────────────────────────────────────

export function CenterSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-coral border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
