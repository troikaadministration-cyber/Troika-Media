import { useState } from 'react';
import { MapPin, Ban, CheckCircle, XCircle, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useStudentPortal } from '../../pages/student/StudentPortalContext';
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
  onCancel,
}: {
  item: StudentLesson;
  variant: 'upcoming' | 'past';
  onCancel?: (item: StudentLesson) => void;
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
        {variant === 'upcoming' && l.status === 'scheduled' && onCancel && (
          <button
            onClick={() => onCancel(item)}
            className="p-1.5 text-gray-300 hover:text-coral transition-colors"
            title="Cancel lesson"
          >
            <Ban size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Cancel lesson modal ──────────────────────────────────────────────────

export interface CancelTarget {
  lessonId: string;
  teacherId: string;
  date: string;
  startTime: string;
  studentName: string;
}

export function toCancelTarget(item: StudentLesson, studentName: string): CancelTarget {
  return {
    lessonId: item.lesson.id,
    teacherId: item.lesson.teacher_id,
    date: item.lesson.date,
    startTime: item.lesson.start_time,
    studentName,
  };
}

export function CancelLessonModal({ target, onClose }: { target: CancelTarget | null; onClose: () => void }) {
  const { cancelLesson } = useStudentPortal();
  const { profile } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!target) return null;

  const confirm = async () => {
    if (!profile?.id) return;
    setBusy(true);
    setErr('');
    try {
      await cancelLesson(target.lessonId, profile.id, {
        teacherId: target.teacherId,
        date: target.date,
        startTime: target.startTime,
        studentName: target.studentName,
        reason: reason || undefined,
      });
      setReason('');
      onClose();
    } catch (e: any) {
      setErr(e.message || 'Could not cancel the lesson. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const close = () => { if (!busy) { setReason(''); setErr(''); onClose(); } };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-navy text-lg">Cancel Lesson</h3>
          <button onClick={close} className="text-gray-400 hover:text-navy"><X size={20} /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Are you sure you want to cancel this lesson? Your teacher will be notified.</p>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">Reason (optional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral"
            rows={3}
            placeholder="Why are you cancelling?"
          />
        </div>
        {err && <p className="text-coral text-sm mb-3">{err}</p>}
        <div className="flex gap-3">
          <button
            onClick={confirm}
            disabled={busy}
            className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90 disabled:opacity-50"
          >
            {busy ? 'Cancelling…' : 'Cancel Lesson'}
          </button>
          <button
            onClick={close}
            disabled={busy}
            className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200 disabled:opacity-50"
          >
            Keep Lesson
          </button>
        </div>
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
