import { useMemo, useState } from 'react';
import { X, Users, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { errorMessage } from '../lib/queryCache';
import { invalidateLessonViews } from '../hooks/useLessons';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useToast } from '../contexts/ToastContext';
import type { Profile } from '../types';
import {
  useDayLessons, useEscape, clashesFor, lessonRange, describeLesson, dateLabel, reassignLessons,
  type DayLesson,
} from './ChangeTeacherModal';

interface Props {
  /** Approved teachers. */
  teachers: Profile[];
  defaultDate: string;
  defaultTeacherId?: string;
  onClose: () => void;
}

interface Report {
  moved: number;
  skipped: { lesson: DayLesson | undefined; reason: string }[];
}

/**
 * "Cover a teacher": give all of an absent teacher's scheduled lessons on one
 * day to a substitute (or a different substitute per lesson). Lessons that
 * clash with the substitute's own lessons are skipped and reported.
 */
export function CoverTeacherModal({ teachers, defaultDate, defaultTeacherId = '', onClose }: Props) {
  const { showToast } = useToast();
  const trapRef = useFocusTrap(true);
  useEscape(onClose);

  const [absentId, setAbsentId] = useState(defaultTeacherId);
  const [date, setDate] = useState(defaultDate);
  const [subAll, setSubAll] = useState('');
  const [perLesson, setPerLesson] = useState<Record<string, string>>({}); // lessonId → teacherId ('' = same as all)
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const { dayLessons, loading, error: loadError } = useDayLessons(date || null);

  const absentLessons = useMemo(
    () => dayLessons.filter((l) => l.teacher_id === absentId && l.status === 'scheduled'),
    [dayLessons, absentId],
  );
  const subOptions = useMemo(() => teachers.filter((t) => t.id !== absentId), [teachers, absentId]);
  const nameOf = (id: string) => teachers.find((t) => t.id === id)?.full_name ?? 'Teacher';

  // Who each included lesson goes to, and whether it would clash (taking into
  // account lessons earlier in this same batch going to the same substitute).
  const plan = useMemo(() => {
    const taken: Record<string, [number, number][]> = {};
    return absentLessons.map((l) => {
      const include = !excluded.has(l.id);
      const subId = perLesson[l.id] || subAll;
      if (!include || !subId) return { lesson: l, include, subId, clash: null as string | null };
      const [s, e] = lessonRange(l);
      const existing = clashesFor(dayLessons, subId, s, e, [l.id]);
      const inBatch = (taken[subId] ?? []).some(([bs, be]) => bs < e && be > s);
      const clash = existing.length
        ? `${nameOf(subId)} is busy: ${existing.map(describeLesson).join(', ')}`
        : inBatch ? `Overlaps another lesson you're giving to ${nameOf(subId)}` : null;
      if (!clash) (taken[subId] ??= []).push([s, e]);
      return { lesson: l, include, subId, clash };
    });
  }, [absentLessons, dayLessons, excluded, perLesson, subAll, teachers]);

  // For the "everyone" picker: how many of the day's lessons each teacher can take.
  const subSummary = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of subOptions) {
      out[t.id] = absentLessons.filter((l) => {
        const [s, e] = lessonRange(l);
        return clashesFor(dayLessons, t.id, s, e, [l.id]).length > 0;
      }).length;
    }
    return out;
  }, [subOptions, absentLessons, dayLessons]);

  const toApply = plan.filter((p) => p.include && p.subId);
  const clashCount = toApply.filter((p) => p.clash).length;
  const missingSub = plan.some((p) => p.include && !p.subId);

  function resetSelection() {
    setPerLesson({});
    setExcluded(new Set());
    setReport(null);
    setError(null);
  }

  async function handleApply() {
    if (toApply.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // One call (one transaction) per substitute.
      const groups = new Map<string, string[]>();
      for (const p of toApply) groups.set(p.subId, [...(groups.get(p.subId) ?? []), p.lesson.id]);
      let moved = 0;
      const skipped: Report['skipped'] = [];
      for (const [subId, ids] of groups) {
        const res = await reassignLessons(ids, subId, null, reason);
        moved += res.moved;
        for (const s of res.skipped) skipped.push({ lesson: absentLessons.find((l) => l.id === s.lesson_id), reason: s.reason });
      }
      setReport({ moved, skipped });
      showToast(moved > 0 ? 'success' : 'error',
        `${moved} lesson${moved === 1 ? '' : 's'} reassigned${skipped.length ? `, ${skipped.length} skipped` : ''}.`);
      setPerLesson({});
      setExcluded(new Set());
      await invalidateLessonViews();
    } catch (e) {
      setError(errorMessage(e, 'Could not reassign the lessons'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cover-teacher-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-5 pb-3">
          <h3 id="cover-teacher-title" className="text-lg font-bold text-navy flex items-center gap-2">
            <Users size={20} className="text-coral" /> Cover a teacher
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-navy"><X size={20} /></button>
        </div>

        <div className="px-5 overflow-y-auto space-y-4 pb-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="cv-absent" className="block text-xs font-medium text-gray-500 mb-1">Teacher who is away</label>
              <select
                id="cv-absent"
                value={absentId}
                onChange={(e) => { setAbsentId(e.target.value); if (subAll === e.target.value) setSubAll(''); resetSelection(); }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select teacher</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cv-date" className="block text-xs font-medium text-gray-500 mb-1">Date</label>
              <input
                id="cv-date"
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); resetSelection(); }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {report && (
            <div className="rounded-lg border border-black/5 bg-gray-50 p-3 text-sm space-y-1.5" role="status">
              <p className="font-semibold text-navy flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-teal" /> {report.moved} lesson{report.moved === 1 ? '' : 's'} reassigned
              </p>
              {report.skipped.length > 0 && (
                <>
                  <p className="text-coral font-medium">{report.skipped.length} skipped:</p>
                  <ul className="space-y-0.5 text-xs text-gray-600">
                    {report.skipped.map((s, i) => (
                      <li key={i}>
                        <span className="font-medium text-navy">{s.lesson ? describeLesson(s.lesson) : 'Lesson'}</span> — {s.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {!absentId ? (
            <p className="text-sm text-gray-400 text-center py-6">Choose the teacher who can't come in.</p>
          ) : loading ? (
            <p className="text-sm text-gray-400 text-center py-6">Loading lessons…</p>
          ) : loadError ? (
            <p className="text-sm text-coral">{loadError}</p>
          ) : absentLessons.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              {nameOf(absentId)} has no scheduled lessons on {dateLabel(date)}.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cv-sub" className="block text-xs font-medium text-gray-500 mb-1">Substitute for all lessons</label>
                  <select
                    id="cv-sub"
                    value={subAll}
                    onChange={(e) => setSubAll(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select substitute</option>
                    {subOptions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name} — {subSummary[t.id] ? `busy for ${subSummary[t.id]} of ${absentLessons.length}` : 'free for all'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cv-reason" className="block text-xs font-medium text-gray-500 mb-1">Reason (optional)</label>
                  <input
                    id="cv-reason"
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. On leave"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">
                  {nameOf(absentId)}'s lessons on {dateLabel(date)} ({absentLessons.length})
                </p>
                <ul className="space-y-1.5">
                  {plan.map(({ lesson: l, include, subId, clash }) => {
                    const names = l.students.map((s) => s.student?.full_name).filter(Boolean).join(', ');
                    return (
                      <li key={l.id} className={`rounded-lg border p-2.5 text-sm ${!include ? 'border-black/5 opacity-60' : clash ? 'border-amber-300 bg-amber-50/50' : 'border-black/10'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <label className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={include}
                              onChange={() => setExcluded((prev) => {
                                const next = new Set(prev);
                                if (next.has(l.id)) next.delete(l.id); else next.add(l.id);
                                return next;
                              })}
                              className="accent-teal mt-1"
                              aria-label={`Include ${describeLesson(l)}`}
                            />
                            <span className="min-w-0">
                              <span className="font-medium text-navy">{describeLesson(l)}</span>
                              {names && <span className="block text-xs text-gray-400 truncate">{names}</span>}
                            </span>
                          </label>
                          <select
                            value={perLesson[l.id] ?? ''}
                            onChange={(e) => setPerLesson((prev) => ({ ...prev, [l.id]: e.target.value }))}
                            disabled={!include}
                            aria-label={`Substitute for ${describeLesson(l)}`}
                            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs sm:w-48"
                          >
                            <option value="">{subAll ? `Same (${nameOf(subAll)})` : 'Same as above'}</option>
                            {subOptions.map((t) => {
                              const [s, e] = lessonRange(l);
                              const busy = clashesFor(dayLessons, t.id, s, e, [l.id]).length > 0;
                              return <option key={t.id} value={t.id}>{t.full_name}{busy ? ' (busy)' : ''}</option>;
                            })}
                          </select>
                        </div>
                        {include && clash && (
                          <p className="text-xs text-amber-700 mt-1.5 flex items-start gap-1">
                            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" /> {clash} — will be skipped
                          </p>
                        )}
                        {include && !subId && (
                          <p className="text-xs text-gray-400 mt-1.5">Choose a substitute</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-coral flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}</p>
          )}
        </div>

        <div className="p-5 pt-3 border-t border-black/5 space-y-2">
          {toApply.length > 0 && (
            <p className="text-xs text-gray-500">
              {toApply.length - clashCount} lesson{toApply.length - clashCount === 1 ? '' : 's'} will move
              {clashCount > 0 && <span className="text-amber-700">, {clashCount} clash{clashCount === 1 ? '' : 'es'} will be skipped</span>}
              {missingSub && <span>, some lessons have no substitute yet</span>}
              . Teachers and students are notified in the app.
            </p>
          )}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">
              {report ? 'Done' : 'Cancel'}
            </button>
            <button
              onClick={handleApply}
              disabled={toApply.length === 0 || saving}
              className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90 disabled:opacity-50"
            >
              {saving ? 'Applying…' : toApply.length ? `Reassign ${toApply.length} lesson${toApply.length === 1 ? '' : 's'}` : 'Reassign lessons'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
