import { useEffect, useMemo, useState } from 'react';
import { X, UserCog, Check, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap, errorMessage } from '../lib/queryCache';
import { invalidateLessonViews } from '../hooks/useLessons';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useToast } from '../contexts/ToastContext';
import type { Profile } from '../types';

// ── Shared helpers (also used by CoverTeacherModal) ──────────────────────────

export interface DayLesson {
  id: string;
  teacher_id: string;
  date: string;
  start_time: string;
  end_time: string | null;
  title: string;
  status: string;
  students: { student: { full_name: string } | null }[];
}

export interface ReassignResult {
  moved: number;
  skipped: { lesson_id: string; reason: string }[];
}

/** Lessons without an end time count as 45 minutes (same rule as the database). */
export const DEFAULT_LESSON_MIN = 45;

export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function fmtMin(min: number): string {
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function lessonRange(l: { start_time: string; end_time: string | null }): [number, number] {
  const s = toMin(l.start_time);
  return [s, l.end_time ? toMin(l.end_time) : s + DEFAULT_LESSON_MIN];
}

/** A teacher's non-cancelled lessons that overlap [start, end), ignoring `excludeIds`. */
export function clashesFor(dayLessons: DayLesson[], teacherId: string, start: number, end: number, excludeIds: string[] = []) {
  return dayLessons.filter((l) => {
    if (l.teacher_id !== teacherId || l.status === 'cancelled' || excludeIds.includes(l.id)) return false;
    const [s, e] = lessonRange(l);
    return s < end && e > start;
  });
}

export function describeLesson(l: { start_time: string; end_time: string | null; title: string }) {
  const [s, e] = lessonRange(l);
  return `${fmtMin(s)}–${fmtMin(e)} ${l.title || 'Lesson'}`;
}

/** Every lesson on one date (all teachers) — used to show who is free. */
export function useDayLessons(date: string | null) {
  const q = useQuery<DayLesson[]>(date ? `lessons:availability:${date}` : null, async () =>
    unwrap(await supabase
      .from('lessons')
      .select('id, teacher_id, date, start_time, end_time, title, status, students:lesson_students(student:students(full_name))')
      .eq('date', date!)
      .neq('status', 'cancelled')
      .order('start_time'), []) as unknown as DayLesson[]);
  return { ...q, dayLessons: q.data ?? [] };
}

export async function reassignLessons(lessonIds: string[], newTeacherId: string, newStartTime: string | null, reason: string): Promise<ReassignResult> {
  const { data, error } = await supabase.rpc('reassign_lessons', {
    p_lesson_ids: lessonIds,
    p_new_teacher_id: newTeacherId,
    p_new_start_time: newStartTime,
    p_reason: reason.trim() || null,
  });
  if (error) throw error;
  return data as ReassignResult;
}

export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function dateLabel(date: string) {
  return new Date(date + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ── Change the teacher of one lesson ─────────────────────────────────────────

interface Props {
  lesson: {
    id: string;
    teacher_id: string;
    date: string;
    start_time: string;
    end_time: string | null;
    title: string;
    teacher?: { full_name: string } | null;
  };
  /** Approved teachers. */
  teachers: Profile[];
  onClose: () => void;
}

export function ChangeTeacherModal({ lesson, teachers, onClose }: Props) {
  const { showToast } = useToast();
  const trapRef = useFocusTrap(true);
  useEscape(onClose);

  const origStart = lesson.start_time.slice(0, 5);
  const [time, setTime] = useState(origStart);
  const [teacherId, setTeacherId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { dayLessons, loading, error: loadError } = useDayLessons(lesson.date);

  const duration = lessonRange(lesson)[1] - lessonRange(lesson)[0];
  const start = time ? toMin(time) : toMin(origStart);
  const end = start + duration;
  const timeChanged = !!time && time !== origStart;

  const options = useMemo(() => {
    return teachers
      .filter((t) => t.id !== lesson.teacher_id)
      .map((t) => ({
        teacher: t,
        clashes: clashesFor(dayLessons, t.id, start, end, [lesson.id]),
        dayCount: dayLessons.filter((l) => l.teacher_id === t.id).length,
      }))
      .sort((a, b) => (a.clashes.length === 0 ? 0 : 1) - (b.clashes.length === 0 ? 0 : 1)
        || a.teacher.full_name.localeCompare(b.teacher.full_name));
  }, [teachers, dayLessons, lesson.teacher_id, lesson.id, start, end]);

  const selected = options.find((o) => o.teacher.id === teacherId);
  const freeCount = options.filter((o) => o.clashes.length === 0).length;

  async function handleConfirm() {
    if (!selected || selected.clashes.length > 0) return;
    if (end > 24 * 60) { setError('The lesson would run past midnight. Choose an earlier time.'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await reassignLessons([lesson.id], selected.teacher.id, timeChanged ? `${time}:00` : null, reason);
      if (res.moved === 1) {
        showToast('success', `Lesson given to ${selected.teacher.full_name}${timeChanged ? ` at ${time}` : ''}. Teachers and students have been notified.`);
        await invalidateLessonViews();
        onClose();
      } else {
        setError(res.skipped[0]?.reason || 'The lesson could not be reassigned.');
        await invalidateLessonViews();
      }
    } catch (e) {
      setError(errorMessage(e, 'Could not change the teacher'));
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
        aria-labelledby="change-teacher-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl border border-black/5 shadow-lg w-full max-w-lg max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-5 pb-3">
          <h3 id="change-teacher-title" className="text-lg font-bold text-navy flex items-center gap-2">
            <UserCog size={20} className="text-coral" /> Change teacher
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-navy"><X size={20} /></button>
        </div>

        <div className="px-5 overflow-y-auto space-y-4 pb-2">
          <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
            <p className="font-semibold text-navy">{lesson.title || 'Lesson'}</p>
            <p className="text-gray-500">
              {dateLabel(lesson.date)} · {describeLesson(lesson).split(' ')[0]} · now with <span className="font-medium text-navy">{lesson.teacher?.full_name || 'teacher'}</span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ct-time" className="block text-xs font-medium text-gray-500 mb-1">Start time (same day)</label>
              <input
                id="ct-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                {timeChanged ? `New slot ${fmtMin(start)}–${fmtMin(end)} (same length)` : 'Keeps the current time'}
                {timeChanged && <button type="button" onClick={() => setTime(origStart)} className="ml-2 text-teal hover:underline">Reset</button>}
              </p>
            </div>
            <div>
              <label htmlFor="ct-reason" className="block text-xs font-medium text-gray-500 mb-1">Reason (optional)</label>
              <input
                id="ct-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Ravi is unwell"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">
              Give the lesson to {loading ? '' : <span className="text-gray-400">· {freeCount} free at {fmtMin(start)}</span>}
            </p>
            {loadError && <p className="text-sm text-coral">{loadError}</p>}
            {loading ? (
              <p className="text-sm text-gray-400 py-4 text-center">Checking who is free…</p>
            ) : options.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No other approved teachers</p>
            ) : (
              <div className="space-y-1.5" role="radiogroup" aria-label="Substitute teacher">
                {options.map(({ teacher, clashes, dayCount }) => {
                  const busy = clashes.length > 0;
                  const active = teacherId === teacher.id;
                  return (
                    <button
                      key={teacher.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={busy}
                      onClick={() => setTeacherId(teacher.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg border text-sm flex items-start gap-2 transition-colors ${
                        active ? 'border-teal bg-teal-light/50' : busy ? 'border-black/5 bg-gray-50 cursor-not-allowed' : 'border-black/10 hover:bg-gray-50'
                      }`}
                    >
                      <span className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center ${active ? 'bg-teal border-teal text-white' : 'border-gray-300'}`}>
                        {active && <Check size={10} />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className={`font-medium ${busy ? 'text-gray-400' : 'text-navy'}`}>{teacher.full_name}</span>
                        <span className="block text-xs text-gray-400">
                          {busy
                            ? <>Busy: {clashes.map(describeLesson).join(', ')}</>
                            : `${dayCount} other lesson${dayCount === 1 ? '' : 's'} this day`}
                        </span>
                      </span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${busy ? 'bg-gray-100 text-gray-500' : 'bg-teal-light text-teal'}`}>
                        {busy ? 'Busy' : 'Free'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-coral flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}</p>
          )}
        </div>

        <div className="flex gap-3 p-5 pt-3 border-t border-black/5">
          <button onClick={onClose} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected || selected.clashes.length > 0 || saving}
            className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : selected ? `Give to ${selected.teacher.full_name.split(' ')[0]}` : 'Choose a teacher'}
          </button>
        </div>
      </div>
    </div>
  );
}
