import { useEffect, useState } from 'react';
import { MapPin, CheckCircle, XCircle, CalendarX, Hourglass, Ban, X, Users } from 'lucide-react';
import { absenceKey, type StudentLesson, type AbsenceRequest } from '../../hooks/useStudentLessons';
import { useStudentPortal, type Child } from '../../pages/student/StudentPortalContext';
import { useToast } from '../../contexts/ToastContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { ConfirmDialog } from '../ConfirmDialog';

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

// ── Family login: child switcher + name tags ─────────────────────────────

/** "All" + one chip per child. Only rendered for a login with several children. */
export function ChildChips({
  items, selected, onSelect,
}: { items: Child[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-full text-sm font-medium border transition-colors whitespace-nowrap ${
      active ? 'bg-navy text-white border-navy' : 'bg-white text-gray-600 border-gray-200 hover:border-navy/40 hover:text-navy'
    }`;
  return (
    <div className="mb-5 -mx-1 px-1 overflow-x-auto" role="group" aria-label="Show lessons and payments for">
      <div className="flex gap-2 w-max">
        <button type="button" aria-pressed={selected === null} onClick={() => onSelect(null)} className={chip(selected === null)}>
          <Users size={14} /> All
        </button>
        {items.map((c) => (
          <button key={c.id} type="button" aria-pressed={selected === c.id} onClick={() => onSelect(c.id)}
            className={chip(selected === c.id)} title={c.full_name}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Small "whose is this" tag; renders nothing unless several children are shown. */
export function ChildTag({ studentId, onAccent = false }: { studentId: string; onAccent?: boolean }) {
  const { childLabel } = useStudentPortal();
  const name = childLabel(studentId);
  if (!name) return null;
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full ${
      onAccent ? 'bg-white/20 text-white' : 'bg-navy/5 text-navy'
    }`}>
      {name}
    </span>
  );
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
  const teacher = l.teacher?.full_name;
  const location = l.location?.name;

  return (
    <div className="px-4 sm:px-5 py-3 hover:bg-gray-50/50">
    <div className="flex items-center gap-3 sm:gap-4">
      <div className="flex-shrink-0 w-16 text-center">
        <span className="block text-sm font-semibold text-navy">{l.start_time?.slice(0, 5)}</span>
        <span className="text-[10px] text-gray-400">
          {new Date(l.date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <ChildTag studentId={item.student_id} />
          <p className="font-medium text-navy text-sm">{l.title}</p>
          {l.instrument?.icon && <span className="text-base">{l.instrument.icon}</span>}
          {l.lesson_type !== 'regular' && (
            <span className="text-[10px] bg-yellow/10 text-yellow-700 px-2 py-0.5 rounded-full capitalize">
              {l.lesson_type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-0.5 text-xs text-gray-500">
          {teacher && <span>{teacher}</span>}
          {location && <span className="flex items-center gap-0.5"><MapPin size={10} />{location}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {variant === 'upcoming' ? <StatusBadge status={l.status} /> : <AttendanceBadge item={item} />}
      </div>
    </div>
    {variant === 'upcoming' && <AbsenceControls item={item} className="mt-2 ml-[76px] sm:ml-20" />}
    </div>
  );
}

// ── Absence requests ("Can't attend") ───────────────────────────────────

export const NOTICE_RULE = "With less than 24 hours' notice the lesson may still be charged.";
const REASON_MAX = 300;

/** Lesson start as an instant (lesson times are India time). */
export function lessonStartsAt(date: string, time: string): Date {
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+05:30`);
}

function canRequest(item: StudentLesson): boolean {
  return item.lesson.status === 'scheduled' && lessonStartsAt(item.lesson.date, item.lesson.start_time).getTime() > Date.now();
}

/** One-line state of a lesson's absence request. */
export function AbsenceStatusLine({ request, onAccent = false }: { request: AbsenceRequest; onAccent?: boolean }) {
  const base = 'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full';
  if (request.status === 'pending') {
    return (
      <span className={`${base} ${onAccent ? 'bg-white/20 text-white' : 'bg-yellow/10 text-yellow-700'}`}>
        <Hourglass size={12} /> Absence requested — waiting for approval
      </span>
    );
  }
  if (request.status === 'approved') {
    return (
      <span className={`${base} ${onAccent ? 'bg-white/20 text-white' : 'bg-teal/10 text-teal'}`}>
        <CheckCircle size={12} /> Approved: absence ({request.charged ? 'charged' : 'not charged'})
      </span>
    );
  }
  if (request.status === 'declined') {
    return (
      <span className={`${base} ${onAccent ? 'bg-white/20 text-white' : 'bg-coral/10 text-coral'}`}>
        <Ban size={12} /> Absence request declined
      </span>
    );
  }
  return null;
}

/**
 * Request state + "Can't attend" / "Withdraw request" for one upcoming lesson.
 * Renders nothing for lessons that can't take a request and have none.
 */
export function AbsenceControls({
  item, onAccent = false, className = '',
}: { item: StudentLesson; onAccent?: boolean; className?: string }) {
  const { absences, requestAbsence, withdrawAbsence } = useStudentPortal();
  const { showToast } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);

  const request = absences[absenceKey(item.lesson.id, item.student_id)];
  const eligible = canRequest(item);
  const canAskAgain = eligible && (!request || request.status === 'declined');
  if (!request && !eligible) return null;

  const btn = onAccent
    ? 'bg-white text-coral hover:bg-white/90'
    : 'border border-coral/30 text-coral hover:bg-coral/5';
  const linkBtn = onAccent ? 'text-white/90 hover:text-white' : 'text-gray-500 hover:text-navy';

  async function withdraw() {
    if (!request) return;
    setConfirmWithdraw(false);
    setBusy(true);
    try {
      await withdrawAbsence(request.id);
      showToast('success', 'Request withdrawn — see you at the lesson.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : "Couldn't withdraw the request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {request && (
        <div className="flex items-center gap-2 flex-wrap">
          <AbsenceStatusLine request={request} onAccent={onAccent} />
          {request.status === 'pending' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmWithdraw(true)}
              className={`text-xs font-semibold underline underline-offset-2 min-h-[32px] px-1 disabled:opacity-50 ${linkBtn}`}
            >
              {busy ? 'Withdrawing…' : 'Withdraw request'}
            </button>
          )}
        </div>
      )}
      {request?.decision_note && request.status !== 'pending' && (
        <p className={`text-xs ${onAccent ? 'text-white/85' : 'text-gray-500'}`}>Coordinator: {request.decision_note}</p>
      )}
      {canAskAgain && (
        <div>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg px-3.5 min-h-[40px] transition-colors ${btn}`}
          >
            <CalendarX size={15} /> Can&rsquo;t attend
          </button>
        </div>
      )}

      {sheetOpen && (
        <AbsenceSheet
          item={item}
          onClose={() => setSheetOpen(false)}
          onSubmit={async (reason) => {
            const res = await requestAbsence(item.lesson.id, item.student_id, reason);
            setSheetOpen(false);
            showToast('success', res.late_notice
              ? 'Request sent. It was less than 24 hours’ notice, so the lesson may still be charged.'
              : 'Request sent — your coordinator will confirm.');
          }}
        />
      )}
      <ConfirmDialog
        open={confirmWithdraw}
        title="Withdraw your request?"
        message="You'll be expected at this lesson as usual."
        confirmLabel="Withdraw"
        onConfirm={() => { void withdraw(); }}
        onCancel={() => setConfirmWithdraw(false)}
      />
    </div>
  );
}

function AbsenceSheet({
  item, onClose, onSubmit,
}: { item: StudentLesson; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const trapRef = useFocusTrap(true);
  const { isFamily, children } = useStudentPortal();
  const childName = isFamily ? children.find((c) => c.id === item.student_id)?.full_name : undefined;
  const l = item.lesson;
  const startsAt = lessonStartsAt(l.date, l.start_time);
  const late = startsAt.getTime() - Date.now() < 24 * 3600_000;
  const trimmed = reason.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, saving]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) { setError("Please tell us why you can't attend."); return; }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the request. Please try again.");
      setSaving(false);
    }
  }

  const when = startsAt.toLocaleString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center sm:p-4"
      onClick={() => { if (!saving) onClose(); }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="absence-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-black/5 shadow-lg p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[90vh] overflow-y-auto"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-gray-200 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="absence-sheet-title" className="font-semibold text-navy text-lg">
              {childName ? <>{childName} can&rsquo;t attend?</> : <>Can&rsquo;t attend this lesson?</>}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {l.title}{l.teacher?.full_name ? ` · ${l.teacher.full_name}` : ''}
            </p>
            <p className="text-sm font-medium text-navy">{when}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close"
            className="p-2 -m-2 rounded-lg text-gray-400 hover:text-navy disabled:opacity-50">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-navy">Reason</span>
            <textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value.slice(0, REASON_MAX)); setError(null); }}
              maxLength={REASON_MAX}
              rows={3}
              required
              placeholder="e.g. School exam that evening"
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base sm:text-sm text-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral"
            />
            <span className="block text-right text-[11px] text-gray-400">{reason.length}/{REASON_MAX}</span>
          </label>

          <p className={`text-xs rounded-lg px-3 py-2 ${late ? 'bg-coral/10 text-coral font-medium' : 'bg-gray-50 text-gray-600'}`}>
            {late ? "This lesson is less than 24 hours away, so it may still be charged." : NOTICE_RULE}
          </p>
          <p className="text-xs text-gray-500">Your coordinator will approve or decline the request. Until then, please plan to attend.</p>

          {error && <p role="alert" className="text-sm text-coral">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 min-h-[44px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              Keep lesson
            </button>
            <button type="submit" disabled={saving || !trimmed}
              className="flex-1 min-h-[44px] rounded-lg bg-coral text-white text-sm font-semibold hover:bg-coral/90 disabled:opacity-50">
              {saving ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </form>
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
