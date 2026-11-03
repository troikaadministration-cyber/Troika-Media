import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, X, Search, UsersRound, CalendarPlus, CalendarRange, UserPlus, Pencil, ChevronRight,
  MapPin, Music, Clock, AlertTriangle, CalendarDays, UserMinus,
} from 'lucide-react';
import { errorMessage } from '../lib/queryCache';
import { toDateStr, parseDateStr, todayStr } from '../lib/dates';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useToast } from '../contexts/ToastContext';
import { useTeachersList, useInstruments, useLocationsList, useActiveStudentsList } from '../hooks/useReference';
import {
  useGroups, useGroupSessions, useStudentNames,
  createGroup, updateGroup, addGroupMembers, removeGroupMember, extendGroupSchedule, scheduleGroupSession, endGroup,
  type Group, type ScheduleResult,
} from '../hooks/useGroups';
import { ErrorBanner } from '../components/ErrorBanner';
import { SkeletonCards, Skeleton, EmptyState } from '../components/Skeleton';
import type { Student } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const MAX_SPAN_DAYS = 400; // the server refuses to schedule more than ~a year at once

const INPUT = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-teal/30 focus:border-teal outline-none';
const LABEL = 'block text-xs font-medium text-gray-600 mb-1';
const BTN_PRIMARY = 'flex items-center justify-center gap-2 bg-teal text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50';
const BTN_SECONDARY = 'flex items-center justify-center gap-2 border border-gray-200 bg-white text-navy px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50';
const BTN_SMALL = 'inline-flex items-center gap-1.5 border border-gray-200 text-navy px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-gray-50';

const COUNTS_HELP = "When on, attended (or charged-absent) sessions use up each student's paid lessons. Turn off for free workshops or bonus classes.";

function fmtTime(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

function fmtTimeRange(start: string, end: string | null) {
  return end ? `${fmtTime(start)} – ${fmtTime(end)}` : fmtTime(start);
}

function fmtDate(d: string, withWeekday = true): string {
  const date = parseDateStr(d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-IN', {
    ...(withWeekday ? { weekday: 'short' as const } : {}),
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' as const }),
  });
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseDateStr(b).getTime() - parseDateStr(a).getTime()) / 86_400_000);
}

function addDays(d: string, n: number): string {
  const date = parseDateStr(d);
  date.setDate(date.getDate() + n);
  return toDateStr(date);
}

/** How many times weekday `dow` falls between two dates (inclusive). */
function countWeekdays(start: string, end: string, dow: number): number {
  if (!start || !end || end < start) return 0;
  const s = parseDateStr(start);
  const first = (dow - s.getDay() + 7) % 7;
  const span = daysBetween(start, end);
  return first > span ? 0 : Math.floor((span - first) / 7) + 1;
}

function endOfYear(d: string): string {
  return `${d.slice(0, 4)}-12-31`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function conflictLines(r: ScheduleResult, teacherName: string): string[] {
  if (!r.conflicts) return [];
  const dates = (r.conflict_dates ?? []).map(d => fmtDate(d));
  const shown = dates.slice(0, 8).join(', ') + (dates.length > 8 ? `, +${dates.length - 8} more` : '');
  return [
    `${plural(r.conflicts, 'week')} clashed with ${teacherName || 'the teacher'}'s other lessons and ${r.conflicts === 1 ? 'was' : 'were'} skipped: ${shown}.`,
    'Schedule those weeks as one-time sessions if needed, or check the Schedule page.',
  ];
}

interface Notice { title: string; lines: string[] }

// ── Small building blocks ──────────────────────────────────────────────────

function CountsBadge({ counts, small = false }: { counts: boolean; small?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full font-medium whitespace-nowrap ${small ? 'text-[11px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'} ${
      counts ? 'bg-teal-light text-teal' : 'bg-gray-100 text-gray-600'}`}>
      {counts ? 'Counts toward lessons' : "Doesn't count"}
    </span>
  );
}

function CountsToggle({ checked, onChange, note }: { checked: boolean; onChange: (v: boolean) => void; note?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2.5">
      <label className="flex items-center gap-2 text-sm font-medium text-navy cursor-pointer">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-teal w-4 h-4" />
        Counts toward students&rsquo; lessons
      </label>
      <p className="text-xs text-gray-500 mt-1">{COUNTS_HELP}</p>
      {note && <p className="text-xs text-gray-500 mt-1">{note}</p>}
    </div>
  );
}

/**
 * A modal with a scrolling body and a fixed footer, so long forms fit phone
 * screens. Escape closes (unless saving); focus is trapped inside.
 */
function Modal({
  title, onClose, onSubmit, submitLabel, savingLabel, saving, error, danger = false, children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  savingLabel: string;
  saving: boolean;
  error: string | null;
  danger?: boolean;
  children: ReactNode;
}) {
  const ref = useFocusTrap(true);
  const titleId = useId();
  const close = () => { if (!saving) onClose(); };
  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center sm:p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}
        className="bg-white rounded-t-2xl sm:rounded-2xl border border-black/5 shadow-lg w-full sm:max-w-lg max-h-[92vh] flex flex-col"
      >
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-black/5 flex-shrink-0">
          <h2 id={titleId} className="font-semibold text-navy text-lg leading-snug">{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="text-gray-400 hover:text-navy p-1 -m-1">
            <X size={20} />
          </button>
        </div>
        <form
          noValidate
          onSubmit={(e: FormEvent) => { e.preventDefault(); if (!saving) onSubmit(); }}
          className="flex flex-col min-h-0 flex-1"
        >
          <div className="px-5 sm:px-6 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">{children}</div>
          <div className="px-5 sm:px-6 py-4 border-t border-black/5 flex-shrink-0 space-y-3">
            {error && <p role="alert" className="text-sm text-coral">{error}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={close} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 ${danger ? 'bg-coral hover:bg-coral/90' : 'bg-teal hover:bg-teal/90'}`}
              >
                {saving ? savingLabel : submitLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Searchable multi-select of students. `locked` ids show as included but can't be removed. */
function StudentPicker({
  students, selected, onChange, exclude, locked, lockedNote, nameOf,
}: {
  students: Student[];
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: Set<string>;
  locked?: string[];
  lockedNote?: string;
  nameOf: (id: string) => string;
}) {
  const [search, setSearch] = useState('');
  const lockedSet = useMemo(() => new Set(locked ?? []), [locked]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter(s => !exclude?.has(s.id) && !lockedSet.has(s.id) && (!q || s.full_name.toLowerCase().includes(q)));
  }, [students, exclude, lockedSet, search]);

  const toggle = (id: string) => onChange(selectedSet.has(id) ? selected.filter(x => x !== id) : [...selected, id]);

  return (
    <div className="space-y-2">
      {(locked?.length ?? 0) > 0 && (
        <div>
          {lockedNote && <p className="text-xs text-gray-500 mb-1">{lockedNote}</p>}
          <div className="flex flex-wrap gap-1.5">
            {locked!.map(id => (
              <span key={id} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">{nameOf(id)}</span>
            ))}
          </div>
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(id => (
            <span key={id} className="inline-flex items-center gap-1 text-xs bg-teal-light text-teal pl-2 pr-1 py-1 rounded-full">
              {nameOf(id)}
              <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${nameOf(id)}`} className="rounded-full hover:bg-teal/10 p-0.5">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="border border-gray-200 rounded-lg">
        <div className="relative border-b border-gray-200">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
            placeholder="Search students…"
            aria-label="Search students"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-t-lg outline-none bg-transparent"
          />
        </div>
        <div className="max-h-44 overflow-y-auto p-1">
          {options.length === 0 ? (
            <p className="text-xs text-gray-400 px-2 py-2">{search ? 'No students match' : 'No students to add'}</p>
          ) : options.map(s => (
            <label key={s.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={selectedSet.has(s.id)} onChange={() => toggle(s.id)} className="accent-teal" />
              <span className="truncate">{s.full_name}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Dialogs ────────────────────────────────────────────────────────────────

interface DialogCommon {
  onClose: () => void;
  onDone: (toast: string, notice?: Notice) => void;
  nameOf: (id: string) => string;
}

function CreateGroupDialog({ onClose, onDone, onCreated, nameOf }: DialogCommon & { onCreated: (id: string) => void }) {
  const { teachers } = useTeachersList();
  const { instruments } = useInstruments();
  const { locations } = useLocationsList();
  const { students } = useActiveStudentsList();
  const today = todayStr();
  const [form, setForm] = useState({
    name: '', teacherId: '', day: 1, startTime: '17:00', endTime: '18:00',
    startDate: today, endDate: endOfYear(today), maxStudents: '', counts: true,
    instrumentId: '', locationId: '', studentIds: [] as string[],
  });
  const [endTouched, setEndTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const sessionCount = countWeekdays(form.startDate, form.endDate, form.day);
  const max = form.maxStudents.trim() ? Number(form.maxStudents) : null;

  function validate(): string | null {
    if (!form.name.trim()) return 'Please give the group a name';
    if (!form.teacherId) return 'Please choose a teacher';
    if (!form.startTime) return 'Choose a start time';
    if (form.endTime && form.endTime <= form.startTime) return 'End time must be after the start time';
    if (!form.startDate || !form.endDate) return 'Choose a start and end date';
    if (form.endDate < form.startDate) return 'End date must be on or after the start date';
    if (daysBetween(form.startDate, form.endDate) > MAX_SPAN_DAYS) return 'Schedule at most about a year at a time';
    if (sessionCount === 0) return `There is no ${DAY_NAMES[form.day]} between those dates`;
    if (max !== null && (!Number.isInteger(max) || max < 1)) return 'Max students must be a whole number of at least 1';
    if (max !== null && form.studentIds.length > max) return `More members than the group's maximum (${max})`;
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    try {
      const r = await createGroup({
        name: form.name.trim(), teacherId: form.teacherId, dayOfWeek: form.day,
        startTime: form.startTime, endTime: form.endTime || null,
        startDate: form.startDate, endDate: form.endDate, studentIds: form.studentIds,
        countsTowardLessons: form.counts, instrumentId: form.instrumentId || null,
        locationId: form.locationId || null, maxStudents: max,
      });
      const teacherName = teachers.find(t => t.id === form.teacherId)?.full_name ?? '';
      const lines = conflictLines(r, teacherName);
      onDone(`Group created with ${plural(r.lessons_created, 'session')}`,
        lines.length ? { title: `“${form.name.trim()}”: some weeks weren’t scheduled`, lines } : undefined);
      onCreated(r.group_id);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the group'));
      setSaving(false);
    }
  }

  return (
    <Modal title="New group" onClose={onClose} onSubmit={submit} submitLabel="Create group" savingLabel="Creating…" saving={saving} error={error}>
      <div>
        <label htmlFor="g-name" className={LABEL}>Group name *</label>
        <input id="g-name" value={form.name} onChange={e => set({ name: e.target.value })} className={INPUT} placeholder="e.g. Junior Choir" maxLength={120} />
      </div>
      <div>
        <label htmlFor="g-teacher" className={LABEL}>Teacher *</label>
        <select id="g-teacher" value={form.teacherId} onChange={e => set({ teacherId: e.target.value })} className={INPUT}>
          <option value="">Choose a teacher…</option>
          {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="g-day" className={LABEL}>Day *</label>
          <select id="g-day" value={form.day} onChange={e => set({ day: Number(e.target.value) })} className={INPUT}>
            {DAYS_ORDER.map(d => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <div>
            <label htmlFor="g-start" className={LABEL}>Start time *</label>
            <input id="g-start" type="time" value={form.startTime} onChange={e => set({ startTime: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label htmlFor="g-end" className={LABEL}>End time</label>
            <input id="g-end" type="time" value={form.endTime} onChange={e => set({ endTime: e.target.value })} className={INPUT} />
          </div>
        </div>
      </div>
      <div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="g-sdate" className={LABEL}>Start date *</label>
            <input id="g-sdate" type="date" value={form.startDate}
              onChange={e => {
                const v = e.target.value;
                set(!endTouched && v ? { startDate: v, endDate: endOfYear(v) } : { startDate: v });
              }}
              className={INPUT} />
          </div>
          <div>
            <label htmlFor="g-edate" className={LABEL}>End date *</label>
            <input id="g-edate" type="date" value={form.endDate} min={form.startDate || undefined}
              onChange={e => { setEndTouched(true); set({ endDate: e.target.value }); }} className={INPUT} />
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1.5">
          {sessionCount > 0
            ? <>Creates {plural(sessionCount, 'weekly session')} on {DAY_NAMES[form.day]}s. You can extend the schedule later.</>
            : <>No {DAY_NAMES[form.day]} falls between these dates.</>}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="g-inst" className={LABEL}>Instrument</label>
          <select id="g-inst" value={form.instrumentId} onChange={e => set({ instrumentId: e.target.value })} className={INPUT}>
            <option value="">None</option>
            {instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="g-loc" className={LABEL}>Location</label>
          <select id="g-loc" value={form.locationId} onChange={e => set({ locationId: e.target.value })} className={INPUT}>
            <option value="">None</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="g-max" className={LABEL}>Max students</label>
        <input id="g-max" type="number" inputMode="numeric" min={1} step={1} value={form.maxStudents}
          onChange={e => set({ maxStudents: e.target.value })} className={`${INPUT} sm:w-40`} placeholder="No limit" />
      </div>
      <CountsToggle checked={form.counts} onChange={v => set({ counts: v })} />
      <div>
        <p className={LABEL}>
          Members ({form.studentIds.length}{max ? ` / ${max}` : ''})
        </p>
        <StudentPicker students={students} selected={form.studentIds} onChange={ids => set({ studentIds: ids })} nameOf={nameOf} />
        <p className="text-xs text-gray-500 mt-1.5">Members are added to every session. You can add or remove students later.</p>
      </div>
    </Modal>
  );
}

function SessionDialog({ group, groups, onClose, onDone, nameOf }: DialogCommon & { group: Group | null; groups: Group[] }) {
  const { teachers } = useTeachersList();
  const { instruments } = useInstruments();
  const { locations } = useLocationsList();
  const { students } = useActiveStudentsList();
  const fromGroup = !!group; // opened from a group's panel: the group is fixed

  const formFor = (g: Group | null) => ({
    groupId: g?.id ?? '',
    title: g?.title ?? '',
    teacherId: g?.teacher_id ?? '',
    date: todayStr(),
    startTime: g?.start_time.slice(0, 5) ?? '17:00',
    endTime: g?.end_time?.slice(0, 5) ?? (g ? '' : '18:00'),
    counts: g?.counts_toward_lessons ?? false,
    instrumentId: g?.instrument_id ?? '',
    locationId: g?.location_id ?? '',
    extraIds: [] as string[],
  });
  const [form, setForm] = useState(() => formFor(group));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const chosenGroup = group ?? groups.find(g => g.id === form.groupId) ?? null;
  const memberIds = chosenGroup?.student_ids ?? [];
  const teacherOptions = useMemo(() => {
    const list = teachers.map(t => ({ id: t.id, name: t.full_name }));
    if (chosenGroup && !list.some(t => t.id === chosenGroup.teacher_id)) {
      list.unshift({ id: chosenGroup.teacher_id, name: chosenGroup.teacher?.full_name ?? 'Group teacher' });
    }
    return list;
  }, [teachers, chosenGroup]);

  function validate(): string | null {
    if (!form.title.trim()) return 'Please give the session a title';
    if (!form.teacherId) return 'Please choose a teacher';
    if (!form.date) return 'Choose a date';
    if (!form.startTime) return 'Choose a start time';
    if (form.endTime && form.endTime <= form.startTime) return 'End time must be after the start time';
    if (memberIds.length + form.extraIds.length === 0) return 'Add at least one student';
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    try {
      const r = await scheduleGroupSession({
        title: form.title.trim(), teacherId: form.teacherId, date: form.date,
        startTime: form.startTime, endTime: form.endTime || null,
        studentIds: form.extraIds, countsTowardLessons: form.counts,
        groupId: chosenGroup?.id ?? null,
        instrumentId: form.instrumentId || null, locationId: form.locationId || null,
      });
      onDone(`One-time session on ${fmtDate(form.date)} scheduled for ${plural(r.students, 'student')}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not schedule the session'));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={group ? `One-time session · ${group.title}` : 'One-time session'}
      onClose={onClose} onSubmit={submit} submitLabel="Schedule session" savingLabel="Scheduling…" saving={saving} error={error}
    >
      {!fromGroup && (
        <div>
          <label htmlFor="s-group" className={LABEL}>For a group (optional)</label>
          <select id="s-group" value={form.groupId}
            onChange={e => {
              const g = groups.find(x => x.id === e.target.value) ?? null;
              setForm(f => ({ ...formFor(g), date: f.date, extraIds: f.extraIds.filter(id => !(g?.student_ids ?? []).includes(id)) }));
            }}
            className={INPUT}>
            <option value="">No group — a one-off class (workshop, masterclass…)</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="s-title" className={LABEL}>Title *</label>
        <input id="s-title" value={form.title} onChange={e => set({ title: e.target.value })} className={INPUT} placeholder="e.g. Ensemble workshop" maxLength={120} />
      </div>
      <div>
        <label htmlFor="s-teacher" className={LABEL}>Teacher *</label>
        <select id="s-teacher" value={form.teacherId} onChange={e => set({ teacherId: e.target.value })} className={INPUT}>
          <option value="">Choose a teacher…</option>
          {teacherOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="s-date" className={LABEL}>Date *</label>
          <input id="s-date" type="date" value={form.date} onChange={e => set({ date: e.target.value })} className={INPUT} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <div>
            <label htmlFor="s-start" className={LABEL}>Start time *</label>
            <input id="s-start" type="time" value={form.startTime} onChange={e => set({ startTime: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label htmlFor="s-end" className={LABEL}>End time</label>
            <input id="s-end" type="time" value={form.endTime} onChange={e => set({ endTime: e.target.value })} className={INPUT} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="s-inst" className={LABEL}>Instrument</label>
          <select id="s-inst" value={form.instrumentId} onChange={e => set({ instrumentId: e.target.value })} className={INPUT}>
            <option value="">{chosenGroup ? 'Same as group' : 'None'}</option>
            {instruments.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="s-loc" className={LABEL}>Location</label>
          <select id="s-loc" value={form.locationId} onChange={e => set({ locationId: e.target.value })} className={INPUT}>
            <option value="">{chosenGroup ? 'Same as group' : 'None'}</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>
      <CountsToggle checked={form.counts} onChange={v => set({ counts: v })} />
      <div>
        <p className={LABEL}>Students ({memberIds.length + form.extraIds.length})</p>
        <StudentPicker
          students={students}
          selected={form.extraIds}
          onChange={ids => set({ extraIds: ids })}
          locked={memberIds}
          lockedNote={memberIds.length ? 'Group members (included automatically):' : undefined}
          nameOf={nameOf}
        />
        {chosenGroup && <p className="text-xs text-gray-500 mt-1.5">Add extra students (e.g. guests) — they join this session only.</p>}
      </div>
    </Modal>
  );
}

function EditGroupDialog({ group, onClose, onDone }: DialogCommon & { group: Group }) {
  const { locations } = useLocationsList();
  const memberCount = group.student_ids?.length ?? 0;
  const [name, setName] = useState(group.title);
  const [counts, setCounts] = useState(group.counts_toward_lessons);
  const [maxStr, setMaxStr] = useState(group.max_students ? String(group.max_students) : '');
  const [locationId, setLocationId] = useState(group.location_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = maxStr.trim() ? Number(maxStr) : null;

  function validate(): string | null {
    if (!name.trim()) return 'Please give the group a name';
    // The limit can be changed but not removed once set.
    if (max === null && group.max_students !== null) return 'Enter a maximum (the limit can be changed but not removed)';
    if (max !== null && (!Number.isInteger(max) || max < 1)) return 'Max students must be a whole number of at least 1';
    if (max !== null && max < memberCount) return `The group already has ${memberCount} members`;
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    try {
      const r = await updateGroup({
        groupId: group.id, name: name.trim(), countsTowardLessons: counts,
        maxStudents: max, locationId: locationId || null,
      });
      onDone(`Group updated${r.future_sessions_updated ? ` · ${plural(r.future_sessions_updated, 'upcoming session')} updated` : ''}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not update the group'));
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit group" onClose={onClose} onSubmit={submit} submitLabel="Save changes" savingLabel="Saving…" saving={saving} error={error}>
      <div>
        <label htmlFor="e-name" className={LABEL}>Group name *</label>
        <input id="e-name" value={name} onChange={e => setName(e.target.value)} className={INPUT} maxLength={120} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="e-loc" className={LABEL}>Location</label>
          <select id="e-loc" value={locationId} onChange={e => setLocationId(e.target.value)} className={INPUT}>
            {!group.location_id && <option value="">None</option>}
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="e-max" className={LABEL}>Max students</label>
          <input id="e-max" type="number" inputMode="numeric" min={Math.max(1, memberCount)} step={1} value={maxStr}
            onChange={e => setMaxStr(e.target.value)} className={INPUT} placeholder="No limit" />
        </div>
      </div>
      <CountsToggle checked={counts} onChange={setCounts} />
      <p className="text-xs text-gray-500">
        Changes apply to upcoming weekly sessions that haven&rsquo;t been held yet. Held sessions and one-time sessions keep their settings.
      </p>
    </Modal>
  );
}

function AddMembersDialog({ group, onClose, onDone, nameOf }: DialogCommon & { group: Group }) {
  const { students } = useActiveStudentsList();
  const members = useMemo(() => new Set(group.student_ids ?? []), [group.student_ids]);
  const [ids, setIds] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spaceLeft = group.max_students !== null ? group.max_students - members.size : null;

  async function submit() {
    if (ids.length === 0) { setError('Choose at least one student to add'); return; }
    if (spaceLeft !== null && ids.length > spaceLeft) {
      setError(spaceLeft <= 0 ? `This group is full (maximum ${group.max_students} students)` : `Only ${plural(spaceLeft, 'place')} left in this group`);
      return;
    }
    if (!fromDate) { setError('Choose the date they start'); return; }
    setError(null);
    setSaving(true);
    try {
      const r = await addGroupMembers(group.id, ids, fromDate);
      onDone(`${plural(r.added, 'student')} added · joined ${plural(r.sessions_joined, 'session')}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not add the students'));
      setSaving(false);
    }
  }

  return (
    <Modal title={`Add students · ${group.title}`} onClose={onClose} onSubmit={submit} submitLabel={ids.length ? `Add ${plural(ids.length, 'student')}` : 'Add students'} savingLabel="Adding…" saving={saving} error={error}>
      {spaceLeft !== null && (
        <p className={`text-xs ${spaceLeft <= 0 ? 'text-coral' : 'text-gray-500'}`}>
          {members.size} of {group.max_students} places taken{spaceLeft > 0 ? ` · ${plural(spaceLeft, 'place')} left` : ' · group is full'}
        </p>
      )}
      <StudentPicker students={students} selected={ids} onChange={setIds} exclude={members} nameOf={nameOf} />
      <div>
        <label htmlFor="a-from" className={LABEL}>Joins sessions from</label>
        <input id="a-from" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={`${INPUT} sm:w-48`} />
        <p className="text-xs text-gray-500 mt-1.5">They&rsquo;re added to every scheduled session of this group from this date on.</p>
      </div>
    </Modal>
  );
}

function RemoveMemberDialog({ group, studentId, onClose, onDone, nameOf }: DialogCommon & { group: Group; studentId: string }) {
  const [fromDate, setFromDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = nameOf(studentId);

  async function submit() {
    if (!fromDate) { setError('Choose a date'); return; }
    setError(null);
    setSaving(true);
    try {
      const r = await removeGroupMember(group.id, studentId, fromDate);
      onDone(`${name} removed from ${group.title} · left ${plural(r.sessions_left, 'session')}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not remove the student'));
      setSaving(false);
    }
  }

  return (
    <Modal title={`Remove ${name}?`} onClose={onClose} onSubmit={submit} submitLabel="Remove" savingLabel="Removing…" saving={saving} error={error} danger>
      <p className="text-sm text-gray-600">
        {name} will be taken off <span className="font-medium text-navy">{group.title}</span> and out of its sessions from this date that
        haven&rsquo;t been held yet. Past attendance is kept.
      </p>
      <div>
        <label htmlFor="r-from" className={LABEL}>Leave sessions from</label>
        <input id="r-from" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={`${INPUT} sm:w-48`} />
      </div>
    </Modal>
  );
}

function ExtendDialog({ group, lastSession, onClose, onDone }: DialogCommon & { group: Group; lastSession: string | undefined }) {
  const today = todayStr();
  const from = lastSession && lastSession >= today ? addDays(lastSession, 1) : today;
  const suggested = endOfYear(from) > from ? endOfYear(from) : endOfYear(addDays(from, 7));
  const [endDate, setEndDate] = useState(suggested);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const added = countWeekdays(from, endDate, group.day_of_week);

  async function submit() {
    if (!endDate) { setError('Choose a date'); return; }
    if (endDate < from) { setError('Sessions are already scheduled up to that date'); return; }
    if (daysBetween(from, endDate) > MAX_SPAN_DAYS) { setError('Schedule at most about a year at a time'); return; }
    if (added === 0) { setError(`There is no ${DAY_NAMES[group.day_of_week]} in that range`); return; }
    setError(null);
    setSaving(true);
    try {
      const r = await extendGroupSchedule(group.id, endDate);
      const lines = conflictLines(r, group.teacher?.full_name ?? '');
      onDone(`Schedule extended · ${plural(r.lessons_created, 'session')} added`,
        lines.length ? { title: `“${group.title}”: some weeks weren’t scheduled`, lines } : undefined);
    } catch (err) {
      setError(errorMessage(err, 'Could not extend the schedule'));
      setSaving(false);
    }
  }

  return (
    <Modal title="Extend schedule" onClose={onClose} onSubmit={submit} submitLabel="Extend" savingLabel="Extending…" saving={saving} error={error}>
      <p className="text-sm text-gray-600">
        {lastSession
          ? <>Sessions are scheduled up to <span className="font-medium text-navy">{fmtDate(lastSession)}</span>.</>
          : <>This group has no upcoming sessions.</>}
        {' '}New weekly sessions on {DAY_NAMES[group.day_of_week]}s include all current members.
      </p>
      <div>
        <label htmlFor="x-end" className={LABEL}>Schedule up to</label>
        <input id="x-end" type="date" value={endDate} min={from} onChange={e => setEndDate(e.target.value)} className={`${INPUT} sm:w-48`} />
        {added > 0 && <p className="text-xs text-gray-500 mt-1.5">Adds up to {plural(added, 'session')}.</p>}
      </div>
    </Modal>
  );
}

function EndGroupDialog({ group, onClose, onDone }: DialogCommon & { group: Group }) {
  const today = todayStr();
  const [fromDate, setFromDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!fromDate || fromDate < today) { setError('Choose today or a later date'); return; }
    setError(null);
    setSaving(true);
    try {
      const r = await endGroup(group.id, fromDate);
      onDone(`${group.title} ended · ${plural(r.sessions_removed, 'upcoming session')} removed`);
    } catch (err) {
      setError(errorMessage(err, 'Could not end the group'));
      setSaving(false);
    }
  }

  return (
    <Modal title={`End ${group.title}?`} onClose={onClose} onSubmit={submit} submitLabel="End group" savingLabel="Ending…" saving={saving} error={error} danger>
      <p className="text-sm text-gray-600">
        Sessions from this date that haven&rsquo;t been held are removed from the schedule. Sessions already held, and their attendance,
        stay on record. The group moves to &ldquo;Ended groups&rdquo;.
      </p>
      <div>
        <label htmlFor="end-from" className={LABEL}>Remove sessions from</label>
        <input id="end-from" type="date" value={fromDate} min={today} onChange={e => setFromDate(e.target.value)} className={`${INPUT} sm:w-48`} />
      </div>
    </Modal>
  );
}

// ── Group detail panel ─────────────────────────────────────────────────────

type DialogState =
  | { kind: 'create' }
  | { kind: 'session'; group: Group | null }
  | { kind: 'edit'; group: Group }
  | { kind: 'add'; group: Group }
  | { kind: 'remove'; group: Group; studentId: string }
  | { kind: 'extend'; group: Group }
  | { kind: 'end'; group: Group };

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-gray-100 text-gray-600',
  completed: 'bg-teal-light text-teal',
  cancelled: 'bg-coral-light text-coral',
};

function GroupPanel({
  group, nameOf, onClose, openDialog,
}: {
  group: Group;
  nameOf: (id: string) => string;
  onClose: () => void;
  openDialog: (d: DialogState) => void;
}) {
  const navigate = useNavigate();
  const ref = useFocusTrap(true);
  const { sessions, loading, error, refresh } = useGroupSessions(group.id);
  const [showAll, setShowAll] = useState(false);
  const members = useMemo(
    () => [...(group.student_ids ?? [])].sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [group.student_ids, nameOf],
  );
  const shown = showAll ? sessions : sessions.slice(0, 8);
  const active = group.is_active;

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-panel-title"
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        className="bg-white w-full sm:max-w-xl h-full overflow-y-auto shadow-xl border-l border-black/5"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-black/5 px-5 sm:px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="group-panel-title" className="font-bold text-navy text-lg leading-snug break-words">{group.title}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {DAY_NAMES[group.day_of_week]}s · {fmtTimeRange(group.start_time, group.end_time)}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-navy p-1 -m-1 flex-shrink-0"><X size={20} /></button>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-6">
          {/* Summary */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <CountsBadge counts={group.counts_toward_lessons} />
              {!active && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">Ended</span>}
            </div>
            <dl className="text-sm text-gray-600 space-y-1">
              <div className="flex gap-2"><dt className="sr-only">Teacher</dt><UsersRound size={15} className="text-gray-400 mt-0.5 flex-shrink-0" /><dd>{group.teacher?.full_name ?? '—'}</dd></div>
              {group.instrument && <div className="flex gap-2"><dt className="sr-only">Instrument</dt><Music size={15} className="text-gray-400 mt-0.5 flex-shrink-0" /><dd>{group.instrument.name}</dd></div>}
              {group.location && <div className="flex gap-2"><dt className="sr-only">Location</dt><MapPin size={15} className="text-gray-400 mt-0.5 flex-shrink-0" /><dd>{group.location.name}</dd></div>}
            </dl>
            <p className="text-xs text-gray-500">{COUNTS_HELP}</p>
          </div>

          {active && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => openDialog({ kind: 'session', group })} className={BTN_SMALL}><CalendarPlus size={14} /> One-time session</button>
              <button onClick={() => openDialog({ kind: 'extend', group })} className={BTN_SMALL}><CalendarRange size={14} /> Extend schedule</button>
              <button onClick={() => openDialog({ kind: 'edit', group })} className={BTN_SMALL}><Pencil size={14} /> Edit</button>
            </div>
          )}

          {/* Members */}
          <section>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="font-semibold text-navy">
                Members <span className="text-gray-400 font-normal">({members.length}{group.max_students ? ` / ${group.max_students}` : ''})</span>
              </h3>
              {active && (
                <button onClick={() => openDialog({ kind: 'add', group })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal hover:underline">
                  <UserPlus size={15} /> Add students
                </button>
              )}
            </div>
            {members.length === 0 ? (
              <p className="text-sm text-gray-400 bg-gray-50 rounded-lg px-3 py-3">No members yet.</p>
            ) : (
              <ul className="border border-black/5 rounded-xl divide-y divide-black/5">
                {members.map(id => (
                  <li key={id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm text-navy truncate">{nameOf(id)}</span>
                    <button
                      onClick={() => openDialog({ kind: 'remove', group, studentId: id })}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-coral flex-shrink-0 px-2 py-1 rounded-md hover:bg-coral-light"
                      aria-label={`Remove ${nameOf(id)}`}
                    >
                      <UserMinus size={13} /> Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Upcoming sessions */}
          <section>
            <h3 className="font-semibold text-navy mb-2">
              Upcoming sessions {!loading && <span className="text-gray-400 font-normal">({sessions.length})</span>}
            </h3>
            {error ? (
              <ErrorBanner message={error} onRetry={refresh} />
            ) : loading ? (
              <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-gray-400 bg-gray-50 rounded-lg px-3 py-3">
                No upcoming sessions.{active ? ' Use “Extend schedule” to add more weeks.' : ''}
              </p>
            ) : (
              <>
                <ul className="border border-black/5 rounded-xl divide-y divide-black/5">
                  {shown.map(s => (
                    <li key={s.id}>
                      <button
                        onClick={() => navigate('/schedule', { state: { date: s.date } })}
                        className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50"
                        title="Open the Schedule page"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-navy">
                            {fmtDate(s.date)}
                            <span className="text-gray-500 font-normal"> · {fmtTimeRange(s.start_time, s.end_time)}</span>
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium capitalize ${STATUS_STYLE[s.status] ?? STATUS_STYLE.scheduled}`}>{s.status}</span>
                            {s.lesson_type === 'one_time' && <span className="text-[11px] px-1.5 py-0.5 rounded-full font-medium bg-yellow-light text-yellow">One-time</span>}
                            <CountsBadge counts={s.is_charged} small />
                            <span className="text-[11px] text-gray-500">{plural(s.students?.length ?? 0, 'student')}</span>
                          </div>
                        </div>
                        <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
                {sessions.length > shown.length && (
                  <button onClick={() => setShowAll(true)} className="mt-2 text-sm font-semibold text-teal hover:underline">
                    Show all {sessions.length} sessions
                  </button>
                )}
              </>
            )}
          </section>

          {active ? (
            <div className="pt-2 border-t border-black/5">
              <button onClick={() => openDialog({ kind: 'end', group })}
                className="w-full sm:w-auto py-2.5 px-4 rounded-xl border border-coral/30 text-coral text-sm font-semibold hover:bg-coral-light">
                End group
              </button>
              <p className="text-xs text-gray-500 mt-1.5">Removes sessions that haven&rsquo;t been held. Held sessions and attendance are kept.</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500 pt-2 border-t border-black/5">This group has ended. Its held sessions and attendance are kept.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

function GroupCard({ group, next, nameOf, onOpen }: { group: Group; next?: string; nameOf: (id: string) => string; onOpen: () => void }) {
  const count = group.student_ids?.length ?? 0;
  const full = group.max_students !== null && count >= group.max_students;
  const preview = (group.student_ids ?? []).slice(0, 3).map(nameOf).join(', ');
  return (
    <button
      onClick={onOpen}
      className={`text-left w-full min-w-0 bg-white rounded-xl shadow-sm border border-black/5 p-4 sm:p-5 hover:border-teal/30 hover:shadow transition ${group.is_active ? '' : 'opacity-75'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-navy leading-snug break-words min-w-0">{group.title}</h3>
        <ChevronRight size={18} className="text-gray-300 flex-shrink-0 mt-0.5" />
      </div>
      <p className="text-sm text-gray-500 mt-0.5 truncate">{group.teacher?.full_name ?? '—'}</p>
      <div className="mt-3 space-y-1.5 text-sm text-gray-600">
        <p className="flex items-center gap-2"><Clock size={14} className="text-gray-400 flex-shrink-0" />
          <span>{DAY_SHORT[group.day_of_week]} · {fmtTimeRange(group.start_time, group.end_time)}</span></p>
        {(group.instrument || group.location) && (
          <p className="flex items-center gap-2 min-w-0"><MapPin size={14} className="text-gray-400 flex-shrink-0" />
            <span className="truncate">{[group.instrument?.name, group.location?.name].filter(Boolean).join(' · ')}</span></p>
        )}
        <p className="flex items-center gap-2 min-w-0"><UsersRound size={14} className="text-gray-400 flex-shrink-0" />
          <span className={`whitespace-nowrap ${full ? 'text-coral font-medium' : ''}`}>{count}{group.max_students ? ` / ${group.max_students}` : ''} {count === 1 && !group.max_students ? 'member' : 'members'}</span>
          {preview && <span className="text-gray-400 truncate min-w-0">· {preview}{count > 3 ? '…' : ''}</span>}
        </p>
        {group.is_active && (
          <p className="flex items-center gap-2"><CalendarDays size={14} className="text-gray-400 flex-shrink-0" />
            <span>{next ? <>Next: <span className="font-medium text-navy">{fmtDate(next)}</span></> : <span className="text-gray-400">No upcoming sessions</span>}</span></p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <CountsBadge counts={group.counts_toward_lessons} />
        {!group.is_active && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">Ended</span>}
        {full && group.is_active && <span className="text-xs px-2 py-0.5 rounded-full bg-coral-light text-coral font-medium">Full</span>}
      </div>
    </button>
  );
}

function sortGroups(a: Group, b: Group) {
  const da = DAYS_ORDER.indexOf(a.day_of_week), db = DAYS_ORDER.indexOf(b.day_of_week);
  if (da !== db) return da - db;
  if (a.start_time !== b.start_time) return a.start_time < b.start_time ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export function GroupsPage() {
  const { showToast } = useToast();
  const { groups, nextSession, lastSession, loading, error, refresh } = useGroups();
  const activeStudentsQ = useActiveStudentsList();
  const [showEnded, setShowEnded] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Member names: the cached active list, plus a lookup for anyone no longer active.
  const activeNames = useMemo(() => new Map(activeStudentsQ.students.map(s => [s.id, s.full_name])), [activeStudentsQ.students]);
  const missingIds = useMemo(() => {
    if (!activeStudentsQ.data) return [];
    const all = new Set(groups.flatMap(g => g.student_ids ?? []));
    return [...all].filter(id => !activeNames.has(id));
  }, [groups, activeNames, activeStudentsQ.data]);
  const extraNames = useStudentNames(missingIds);
  const nameOf = useMemo(() => {
    const extra = new Map(extraNames.map(s => [s.id, `${s.full_name} (inactive)`]));
    return (id: string) => activeNames.get(id) ?? extra.get(id) ?? 'Student';
  }, [activeNames, extraNames]);

  const q = search.trim().toLowerCase();
  const matches = (g: Group) => !q || g.title.toLowerCase().includes(q) || (g.teacher?.full_name ?? '').toLowerCase().includes(q);
  const activeGroups = groups.filter(g => g.is_active && matches(g)).sort(sortGroups);
  const endedGroups = groups.filter(g => !g.is_active && matches(g)).sort(sortGroups);
  const endedCount = groups.filter(g => !g.is_active).length;
  const sessionGroups = useMemo(() => groups.filter(g => g.is_active).sort((a, b) => a.title.localeCompare(b.title)), [groups]);

  const selected = selectedId ? groups.find(g => g.id === selectedId) ?? null : null;

  // Dialogs get the freshest copy of their group.
  const fresh = (g: Group) => groups.find(x => x.id === g.id) ?? g;

  function done(message: string, n?: Notice) {
    setDialog(null);
    showToast('success', message);
    if (n) setNotice(n);
  }

  const common = { onClose: () => setDialog(null), onDone: done, nameOf };

  return (
    <div>
      {/* Overlays live outside the spaced column: space-y margins would push fixed elements down. */}
      <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Groups</h1>
          <p className="text-gray-500 text-sm mt-1">Weekly group classes, their members and one-time sessions</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setDialog({ kind: 'session', group: null })} className={`${BTN_SECONDARY} flex-1 sm:flex-none`}>
            <CalendarPlus size={16} /> One-time session
          </button>
          <button onClick={() => setDialog({ kind: 'create' })} className={`${BTN_PRIMARY} flex-1 sm:flex-none`}>
            <Plus size={16} /> New group
          </button>
        </div>
      </div>

      {notice && (
        <div role="status" className="flex items-start gap-3 bg-yellow-light border border-yellow/20 rounded-xl px-4 py-3">
          <AlertTriangle size={18} className="text-yellow flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 text-sm">
            <p className="font-medium text-navy">{notice.title}</p>
            {notice.lines.map((l, i) => <p key={i} className="text-gray-600 text-xs mt-0.5 break-words">{l}</p>)}
          </div>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-gray-400 hover:text-navy flex-shrink-0"><X size={16} /></button>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {loading ? (
        <SkeletonCards count={3} className="sm:grid-cols-2 xl:grid-cols-3" />
      ) : !error && groups.length === 0 ? (
        <div className="bg-white rounded-xl border border-black/5">
          <EmptyState
            icon={UsersRound}
            title="No groups yet"
            hint="Create a weekly group class, add students, and its sessions are scheduled for you."
            action={{ label: 'Create your first group', onClick: () => setDialog({ kind: 'create' }) }}
          />
        </div>
      ) : groups.length > 0 && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 sm:max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search groups or teachers…" aria-label="Search groups"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:ring-2 focus:ring-teal/30 focus:border-teal outline-none" />
            </div>
            {endedCount > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={showEnded} onChange={e => setShowEnded(e.target.checked)} className="accent-teal w-4 h-4" />
                Show ended groups ({endedCount})
              </label>
            )}
          </div>

          {activeGroups.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              {q ? 'No groups match your search.' : 'No active groups. Create one with “New group”.'}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {activeGroups.map(g => (
                <GroupCard key={g.id} group={g} next={nextSession[g.id]} nameOf={nameOf} onOpen={() => setSelectedId(g.id)} />
              ))}
            </div>
          )}

          {showEnded && endedGroups.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Ended groups</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {endedGroups.map(g => (
                  <GroupCard key={g.id} group={g} nameOf={nameOf} onOpen={() => setSelectedId(g.id)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      </div>

      {selected && (
        <GroupPanel key={selected.id} group={selected} nameOf={nameOf} onClose={() => setSelectedId(null)} openDialog={setDialog} />
      )}

      {dialog?.kind === 'create' && (
        <CreateGroupDialog {...common} onCreated={id => setSelectedId(id)} />
      )}
      {dialog?.kind === 'session' && (
        <SessionDialog {...common} group={dialog.group ? fresh(dialog.group) : null} groups={sessionGroups} />
      )}
      {dialog?.kind === 'edit' && <EditGroupDialog {...common} group={fresh(dialog.group)} />}
      {dialog?.kind === 'add' && <AddMembersDialog {...common} group={fresh(dialog.group)} />}
      {dialog?.kind === 'remove' && <RemoveMemberDialog {...common} group={fresh(dialog.group)} studentId={dialog.studentId} />}
      {dialog?.kind === 'extend' && (
        <ExtendDialog {...common} group={fresh(dialog.group)} lastSession={lastSession[dialog.group.id]} />
      )}
      {dialog?.kind === 'end' && (
        <EndGroupDialog {...common} onDone={(m, n) => { setSelectedId(null); done(m, n); }} group={fresh(dialog.group)} />
      )}
    </div>
  );
}
