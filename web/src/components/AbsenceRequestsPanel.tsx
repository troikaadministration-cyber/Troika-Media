import { useState } from 'react';
import { CalendarX, ChevronDown, ChevronRight, Clock, Check, X } from 'lucide-react';
import { useAbsenceRequests, type CoordAbsenceRequest } from '../hooks/useAbsenceRequests';
import { useToast } from '../contexts/ToastContext';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { fmtTime } from '../pages/student/format';

const fmtDay = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

const fmtAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins || 1} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

function lessonLine(r: CoordAbsenceRequest) {
  const l = r.lesson;
  if (!l) return 'Lesson removed';
  return [`${fmtDay(l.date)}, ${fmtTime(l.start_time)}`, l.teacher?.full_name, l.title].filter(Boolean).join(' · ');
}

/** Coordinator dashboard card: approve / decline students' "can't attend" requests. */
export function AbsenceRequestsPanel() {
  const { pending, recent, loading, error, refresh, decide } = useAbsenceRequests();
  const [showRecent, setShowRecent] = useState(false);

  return (
    <section aria-labelledby="absence-requests-title" className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-black/5 flex items-center justify-between gap-3">
        <h2 id="absence-requests-title" className="font-semibold text-navy text-sm flex items-center gap-2">
          <CalendarX size={16} className="text-coral" />
          Absence requests
          {pending.length > 0 && (
            <span className="text-[11px] font-bold bg-coral text-white rounded-full px-2 py-0.5 num">{pending.length}</span>
          )}
        </h2>
        {!loading && pending.length === 0 && <span className="text-xs text-gray-400">None waiting</span>}
      </div>

      {error && <div className="p-4"><ErrorBanner message={error} onRetry={() => { void refresh(); }} /></div>}

      {loading ? (
        <div className="p-4 space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : pending.length > 0 ? (
        <ul className="divide-y divide-black/5">
          {pending.map((r) => <PendingRow key={r.id} r={r} decide={decide} />)}
        </ul>
      ) : null}

      {recent.length > 0 && (
        <div className="border-t border-black/5">
          <button
            type="button"
            onClick={() => setShowRecent((v) => !v)}
            aria-expanded={showRecent}
            className="w-full flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-gray-500 hover:text-navy"
          >
            {showRecent ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Recent decisions ({recent.length})
          </button>
          {showRecent && (
            <ul className="divide-y divide-black/5 border-t border-black/5">
              {recent.map((r) => (
                <li key={r.id} className="px-5 py-2.5 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-navy truncate">{r.student?.full_name || 'Student'}</p>
                    <p className="text-[11.5px] text-gray-500 truncate">{lessonLine(r)}</p>
                    <p className="text-[11.5px] text-gray-400 truncate">&ldquo;{r.reason}&rdquo;{r.decision_note ? ` — Note: ${r.decision_note}` : ''}</p>
                  </div>
                  <DecisionPill r={r} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function DecisionPill({ r }: { r: CoordAbsenceRequest }) {
  const map: Record<string, [string, string]> = {
    approved: [`Approved · ${r.charged ? 'charged' : 'not charged'}`, 'bg-teal/10 text-teal'],
    declined: ['Declined', 'bg-coral/10 text-coral'],
    withdrawn: ['Withdrawn', 'bg-gray-100 text-gray-500'],
  };
  const [label, cls] = map[r.status] ?? [r.status, 'bg-gray-100 text-gray-500'];
  return <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0 ${cls}`}>{label}</span>;
}

function PendingRow({
  r, decide,
}: {
  r: CoordAbsenceRequest;
  decide: (id: string, approve: boolean, charged: boolean | null, note: string | null) => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [charged, setCharged] = useState(r.late_notice);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'decline'>(null);

  const nStudents = r.lesson?.students?.[0]?.count ?? 0;
  const solo = nStudents <= 1;
  const lessonCancelled = r.lesson?.status === 'cancelled';
  const name = r.student?.full_name || 'Student';

  async function run(approve: boolean) {
    setBusy(approve ? 'approve' : 'decline');
    try {
      await decide(r.id, approve, approve ? charged : null, note.trim() || null);
      showToast('success', approve
        ? `Approved — ${name} marked absent (${charged ? 'charged' : 'not charged'})${solo ? '; lesson cancelled' : ''}.`
        : `Declined — ${name} has been told to attend.`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Could not save the decision');
      setBusy(null);
    }
  }

  const effect = lessonCancelled
    ? 'This lesson is already cancelled — decline to close the request.'
    : solo
      ? `Approving cancels this 1:1 lesson${charged ? ' (no reschedule).' : ' and adds it to the reschedule queue.'}`
      : `Group class (${nStudents} students) — it goes ahead for the others.`;

  return (
    <li className="px-5 py-4 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-navy">{name}</p>
            {r.late_notice && (
              <span className="text-[10.5px] font-semibold uppercase tracking-wide bg-coral/10 text-coral px-2 py-0.5 rounded-full">
                Late notice
              </span>
            )}
            <span className="text-[10.5px] font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {solo ? '1:1' : `Group · ${nStudents}`}
            </span>
          </div>
          <p className="text-[12px] text-gray-500 mt-0.5 flex items-center gap-1">
            <Clock size={12} className="flex-shrink-0" /> <span className="truncate">{lessonLine(r)}</span>
          </p>
        </div>
        <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">{fmtAgo(r.created_at)}</span>
      </div>

      <p className="text-sm text-navy bg-gray-50 rounded-lg px-3 py-2 break-words">&ldquo;{r.reason}&rdquo;</p>

      {declining ? (
        <div className="space-y-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 300))}
            maxLength={300}
            placeholder="Note to the student (optional)"
            aria-label="Note to the student (optional)"
            autoFocus
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-coral/30"
          />
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => { setDeclining(false); setNote(''); }}
              className="flex-1 sm:flex-none px-4 min-h-[38px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              Back
            </button>
            <button type="button" disabled={!!busy} onClick={() => { void run(false); }}
              className="flex-1 sm:flex-none px-4 min-h-[38px] rounded-lg bg-coral text-white text-sm font-semibold hover:bg-coral/90 disabled:opacity-50">
              {busy === 'decline' ? 'Declining…' : 'Confirm decline'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <div role="radiogroup" aria-label="Charge for this lesson?" className="inline-flex bg-gray-100 rounded-lg p-0.5">
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={charged === v}
                  disabled={lessonCancelled}
                  onClick={() => setCharged(v)}
                  className={`px-3 min-h-[34px] text-xs font-semibold rounded-md transition-colors disabled:opacity-50 ${
                    charged === v ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-navy'
                  }`}
                >
                  {v ? 'Charged' : 'Not charged'}
                </button>
              ))}
            </div>
            <div className="flex gap-2 ml-auto">
              <button type="button" disabled={!!busy} onClick={() => setDeclining(true)}
                className="inline-flex items-center gap-1 px-3.5 min-h-[36px] rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                <X size={14} /> Decline
              </button>
              <button type="button" disabled={!!busy || lessonCancelled} onClick={() => { void run(true); }}
                className="inline-flex items-center gap-1 px-3.5 min-h-[36px] rounded-lg bg-teal text-white text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                <Check size={14} /> {busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </div>
          <p className="text-[11.5px] text-gray-400">{effect}</p>
        </>
      )}
    </li>
  );
}
