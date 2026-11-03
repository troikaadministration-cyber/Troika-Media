// "Renew for next year": re-enrol every active student for the next academic
// year in one pass, adjusting their classes on the way (keep / drop / add a
// class, new rates and plans). Each kept or added class becomes one
// enrol_student call (enrolment + lessons + instalments, all-or-nothing).
import { useState, useMemo, useEffect, useCallback, memo, type ReactNode } from 'react';
import { X, Plus, Search, AlertTriangle, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { useInstruments, useTeachersList } from '../hooks/useReference';
import { invalidateLessonViews } from '../hooks/useLessons';
import { invalidateQueries, errorMessage } from '../lib/queryCache';
import { useToast } from '../contexts/ToastContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ErrorBanner } from './ErrorBanner';
import { SkeletonList } from './Skeleton';
import { SlotPicker, weeklySlotsError, extraSlotParam } from './SlotPicker';
import type { SelectedSlot } from './SlotPicker';
import {
  lessonsForPlan, lessonsForClass, lessonsBreakdown, timesPerWeekLabel, normaliseTimesPerWeek, TIMES_PER_WEEK_OPTIONS,
} from '../lib/lessonCount';
import { computeDiscount } from '../lib/fees';
import { toDateStr } from '../lib/dates';
import {
  useRenewalCandidates, fetchRenewalCandidates, matchRenewed, enrolClass, releaseSlot, runPool,
  classTimesPerWeek, classSlotIds,
  type RenewalCandidate, type RenewalClass, type RenewedEnrolment, type EnrolParams, type RenewalSlot,
} from '../hooks/useRenewals';
import type { Instrument, Profile } from '../types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLANS = [
  { value: '1_instalment', label: '1 instalment' },
  { value: '3_instalments', label: '3 instalments' },
  { value: '10_instalments', label: '10 instalments' },
  { value: 'trial', label: 'Trial' },
];
const CONCURRENCY = 4;
const PAGE = 40;

const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN')}`;
const planLabel = (p: string) => PLANS.find(x => x.value === p)?.label ?? p.replace(/_/g, ' ');
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

function firstMondayOfJanuary(year: number) {
  const d = new Date(Date.UTC(year, 0, 1));
  const offset = (8 - d.getUTCDay()) % 7; // days until Monday (0 if Jan 1 is a Monday)
  return toDateStr(new Date(year, 0, 1 + offset));
}

// ── per-student edits ─────────────────────────────────────────────────────
interface ClassEdit {
  drop?: boolean;
  rateText?: string;      // undefined = the adjusted default rate
  plan?: string;          // undefined = the default plan
  changeSlot?: boolean;   // coordinator chose to move the class to another slot
  teacherId?: string;
  slot?: SelectedSlot | null;
  times?: number;                       // times per week when re-picking slots (default: as last year)
  extraSlots?: (SelectedSlot | null)[]; // 2nd/3rd weekly slots when re-picking
}
interface AddedClass {
  key: string;
  teacherId: string;
  slot: SelectedSlot | null;
  times: number;
  extraSlots: (SelectedSlot | null)[];
  rateText: string;
  plan: string;
}
interface StudentEdit {
  skip?: boolean;
  classes?: Record<string, ClassEdit>;
  added?: AddedClass[];
}

interface Settings {
  toYear: string;
  startDate: string;
  endDate: string;
  defaultPlan: string;   // 'keep' or a plan
  rateMode: 'none' | 'pct' | 'flat';
  rateValue: number;
  regFee: number;
}

/** A class that will be created for the new year. */
interface PlannedItem {
  key: string;
  kind: 'kept' | 'added';
  label: string;
  rate: number;
  plan: string;
  times: number;
  lessons: number;
  lessonsText: string;   // "12 lessons (6 × 2 per week)"
  totalFee: number;
  regFee: number;
  error: string | null;
  params: EnrolParams | null;
}

interface StudentPlan {
  status: 'renewed' | 'skipped' | 'active';
  items: PlannedItem[];
  dropped: RenewalClass[];
  renewedByClass: Map<string, RenewedEnrolment>;
  extra: RenewedEnrolment[];
}

function adjustedRate(rate: number, s: Settings) {
  if (s.rateMode === 'pct') return Math.round(rate * (1 + (s.rateValue || 0) / 100));
  if (s.rateMode === 'flat') return Math.round(rate + (s.rateValue || 0));
  return Number(rate);
}

/** A class must be re-slotted when any of its weekly slots is gone/inactive or has another teacher. */
const needsSlot = (c: RenewalClass) => !c.slot || !c.slot.is_active || !c.teacher_id
  || (c.extra_slots ?? []).some(x => !x.is_active || x.teacher_id !== c.slot!.teacher_id)
  || (c.extra_slots?.length ?? 0) + 1 < classTimesPerWeek(c); // an extra slot was deleted

function slotLabel(slot: { dayOfWeek: number; startTime: string; endTime?: string | null }) {
  return `${DAYS[slot.dayOfWeek]} ${hhmm(slot.startTime)}${slot.endTime ? `–${hhmm(slot.endTime)}` : ''}`;
}

const toSelected = (x: RenewalSlot): SelectedSlot => ({
  mode: 'existing', templateId: x.id, dayOfWeek: x.day_of_week, startTime: x.start_time,
  endTime: x.end_time, instrumentId: x.instrument_id, title: x.title,
});

/** Pad/trim the extra weekly slots to times − 1 entries. */
const sizeExtras = (extras: (SelectedSlot | null)[] | undefined, times: number) =>
  Array.from({ length: normaliseTimesPerWeek(times) - 1 }, (_, i) => extras?.[i] ?? null);

function buildPlan(
  c: RenewalCandidate, edit: StudentEdit | undefined, s: Settings,
  teacherName: (id: string | null | undefined) => string, instrumentName: (id: string | null | undefined) => string,
): StudentPlan {
  const { byClass, extra } = matchRenewed(c);
  const open = c.classes.filter(cl => !byClass.has(cl.enrolment_id));
  const added = edit?.added ?? [];
  if (open.length === 0 && added.length === 0) {
    return { status: 'renewed', items: [], dropped: [], renewedByClass: byClass, extra };
  }
  const items: PlannedItem[] = [];
  const dropped: RenewalClass[] = [];
  const first = c.classes[0];
  let regLeft = s.regFee > 0 && c.renewed.length === 0 ? s.regFee : 0; // once per student, first class

  const make = (
    key: string, kind: PlannedItem['kind'], rate: number, plan: string,
    teacherId: string, slot: SelectedSlot | null, slotIssue: string | null,
    discount: Pick<RenewalClass, 'discount_primary' | 'discount_multilesson' | 'discount_value'>,
    lessonRateId: string | null, instrumentId: string | null,
    extraSlots: (SelectedSlot | null)[] = [],
  ): PlannedItem => {
    const times = 1 + extraSlots.length;
    const lessons = lessonsForClass(plan, s.startDate, times);
    const totalFee = computeDiscount(rate * lessons, {
      primary: discount.discount_primary, plan, specialAmount: Number(discount.discount_value) || 0,
      multilesson: discount.discount_multilesson,
    }).discounted;
    const regFee = regLeft; regLeft = 0;
    const error = !teacherId ? 'Choose a teacher'
      : slotIssue
      ?? (!(rate >= 0) ? 'Rate cannot be negative'
        : plan !== 'trial' && !(rate > 0) ? 'Enter a rate above ₹0 (or choose Trial)' : null);
    const when = [slot, ...extraSlots].filter((x): x is SelectedSlot => !!x).map(slotLabel).join(' + ');
    const label = [instrumentName(instrumentId) || 'Class', timesPerWeekLabel(times), teacherName(teacherId), when || null]
      .filter(Boolean).join(' · ');
    const params: EnrolParams | null = error || !slot ? null : {
      p_student_id: c.student_id,
      p_teacher_id: teacherId,
      p_payment_plan: plan,
      p_start_date: s.startDate,
      p_end_date: s.endDate,
      p_total_lessons: lessons,
      p_rate_per_lesson: rate,
      p_total_fee: totalFee,
      p_registration_fee: regFee,
      p_lesson_rate_id: lessonRateId,
      p_academic_year: s.toYear,
      p_discount_primary: discount.discount_primary,
      p_discount_multilesson: discount.discount_multilesson,
      p_discount_value: discount.discount_primary === 'special' ? Number(discount.discount_value) || 0 : 0,
      p_location_id: c.location_id,
      ...(slot.mode === 'existing'
        ? { p_template_id: slot.templateId }
        : {
            p_day_of_week: slot.dayOfWeek, p_start_time: slot.startTime, p_end_time: slot.endTime || null,
            p_instrument_id: slot.instrumentId, p_title: slot.title.trim() || null,
          }),
      // 2× / 3× per week: the same pattern again (one enrolment, one instalment schedule).
      p_extra_slots: (extraSlots as SelectedSlot[]).map(extraSlotParam),
    };
    const lessonsText = lessonsBreakdown(plan, s.startDate, times);
    return { key, kind, label, rate, plan, times, lessons, lessonsText, totalFee, regFee, error, params };
  };

  for (const cl of open) {
    const e = edit?.classes?.[cl.enrolment_id];
    if (e?.drop ?? defaultDrop(cl, c)) { dropped.push(cl); continue; }
    const rate = e?.rateText !== undefined ? Number(e.rateText) : adjustedRate(cl.rate_per_lesson, s);
    const plan = e?.plan ?? (s.defaultPlan === 'keep' ? cl.payment_plan : s.defaultPlan);
    let teacherId = cl.teacher_id ?? '';
    let slot: SelectedSlot | null = null;
    let extraSlots: (SelectedSlot | null)[] = [];
    let slotIssue: string | null = null;
    if (e?.changeSlot || needsSlot(cl)) {
      teacherId = e?.teacherId ?? cl.teacher_id ?? '';
      slot = e?.slot ?? null;
      extraSlots = sizeExtras(e?.extraSlots, e?.times ?? classTimesPerWeek(cl));
      slotIssue = teacherId ? weeklySlotsError([slot, ...extraSlots]) : null;
    } else if (cl.slot) {
      // Same weekly pattern as last year (2× per week stays 2× per week, same slots).
      teacherId = cl.slot.teacher_id;
      slot = toSelected(cl.slot);
      extraSlots = (cl.extra_slots ?? []).map(toSelected);
    }
    items.push(make(cl.enrolment_id, 'kept', rate, plan, teacherId, slot, slotIssue, cl,
      cl.lesson_rate_id, slot?.instrumentId ?? cl.instrument_id, extraSlots));
  }
  for (const a of added) {
    const extraSlots = sizeExtras(a.extraSlots, a.times);
    items.push(make(a.key, 'added', a.rateText.trim() === '' ? 0 : Number(a.rateText), a.plan, a.teacherId, a.slot,
      a.teacherId ? weeklySlotsError([a.slot, ...extraSlots]) : null, first, null, a.slot?.instrumentId ?? null, extraSlots));
  }
  // Renewed earlier with the rest dropped back then (and untouched now): nothing left to do.
  if (items.length === 0 && byClass.size > 0
      && dropped.every(d => defaultDrop(d, c) && edit?.classes?.[d.enrolment_id]?.drop === undefined)) {
    return { status: 'renewed', items, dropped: [], renewedByClass: byClass, extra };
  }
  return { status: edit?.skip ? 'skipped' : 'active', items, dropped, renewedByClass: byClass, extra };
}

/** A class whose student already left its slot (e.g. dropped at an earlier renewal) defaults to Drop. */
function defaultDrop(cl: RenewalClass, c: RenewalCandidate) {
  return !!cl.slot && cl.slot.is_active && !cl.slot.student_on_slot && c.renewed.length > 0;
}

// ── report ────────────────────────────────────────────────────────────────
interface ReportRow {
  student: string;
  label: string;
  status: 'ok' | 'warn' | 'failed' | 'skipped';
  message: string;
}

export function RenewalWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <RenewalPanel onClose={onClose} />;
}

function RenewalPanel({ onClose }: { onClose: () => void }) {
  const { showToast } = useToast();
  const { instruments } = useInstruments();
  const { teachers } = useTeachersList();
  const thisYear = new Date().getFullYear();

  const [fromYear, setFromYear] = useState(String(thisYear));
  const toYear = String(Number(fromYear) + 1);
  const [startDate, setStartDate] = useState(() => firstMondayOfJanuary(thisYear + 1));
  const [endDate, setEndDate] = useState(`${thisYear + 1}-12-31`);
  const [defaultPlan, setDefaultPlan] = useState('keep');
  const [rateMode, setRateMode] = useState<Settings['rateMode']>('none');
  const [rateValue, setRateValue] = useState(0);
  const [regFee, setRegFee] = useState(0);
  const [edits, setEdits] = useState<Record<string, StudentEdit>>({});
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [phase, setPhase] = useState<'edit' | 'review' | 'running' | 'done'>('edit');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<ReportRow[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  const candidatesQ = useRenewalCandidates(fromYear, toYear);
  const candidates = candidatesQ.data;
  const trapRef = useFocusTrap(true);

  const running = phase === 'running';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !running) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onClose]);

  function changeFromYear(y: string) {
    const next = Number(y) + 1;
    setFromYear(y);
    setStartDate(firstMondayOfJanuary(next));
    setEndDate(`${next}-12-31`);
    setEdits({});
    setPhase('edit');
  }

  const settings: Settings = useMemo(() => ({
    toYear, startDate, endDate, defaultPlan, rateMode, rateValue, regFee,
  }), [toYear, startDate, endDate, defaultPlan, rateMode, rateValue, regFee]);

  const teacherName = useCallback((id: string | null | undefined) =>
    teachers.find(t => t.id === id)?.full_name ?? '', [teachers]);
  const instrumentName = useCallback((id: string | null | undefined) =>
    instruments.find(i => i.id === id)?.name ?? '', [instruments]);

  const plans = useMemo(() => {
    const m = new Map<string, StudentPlan>();
    for (const c of candidates ?? []) m.set(c.student_id, buildPlan(c, edits[c.student_id], settings, teacherName, instrumentName));
    return m;
  }, [candidates, edits, settings, teacherName, instrumentName]);

  const updateStudent = useCallback((studentId: string, fn: (e: StudentEdit) => StudentEdit) => {
    setEdits(prev => ({ ...prev, [studentId]: fn(prev[studentId] ?? {}) }));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = candidates ?? [];
    return q ? list.filter(c => c.full_name.toLowerCase().includes(q)
      || c.classes.some(cl => (cl.instrument_name ?? '').toLowerCase().includes(q)
        || (cl.teacher_name ?? '').toLowerCase().includes(q))) : list;
  }, [candidates, search]);

  function selectAll(include: boolean) {
    setEdits(prev => {
      const next = { ...prev };
      for (const c of filtered) {
        if (plans.get(c.student_id)?.status === 'renewed') continue;
        next[c.student_id] = { ...(next[c.student_id] ?? {}), skip: !include };
      }
      return next;
    });
  }

  // ── summary ──
  const summary = useMemo(() => {
    let students = 0, classes = 0, total = 0, dropped = 0, added = 0, skipped = 0, renewed = 0, problems = 0;
    for (const p of plans.values()) {
      if (p.status === 'renewed') { renewed++; continue; }
      if (p.status === 'skipped') { skipped++; continue; }
      if (p.items.length > 0) students++;
      classes += p.items.length;
      dropped += p.dropped.length;
      for (const it of p.items) {
        total += it.totalFee + it.regFee;
        if (it.kind === 'added') added++;
        if (it.error) problems++;
      }
    }
    return { students, classes, total, dropped, added, skipped, renewed, problems };
  }, [plans]);

  const dateError = !startDate || !endDate ? 'Choose a start and end date'
    : endDate <= startDate ? 'End date must be after the start date'
    : startDate.slice(0, 4) !== toYear ? `Start date should be in ${toYear}` : null;

  // ── run ──
  async function run() {
    if (!candidates) return;
    setPhase('running');
    setRunError(null);
    const rows: ReportRow[] = [];
    let fresh: RenewalCandidate[];
    try {
      // Re-read what's already renewed so a re-run (or a second coordinator) never duplicates.
      fresh = await fetchRenewalCandidates(fromYear, toYear);
    } catch (err) {
      setRunError(errorMessage(err, 'Could not check existing renewals'));
      setPhase('review');
      return;
    }
    const freshById = new Map(fresh.map(c => [c.student_id, c]));
    const groups = candidates
      .map(c => ({ c, plan: plans.get(c.student_id)! }))
      .filter(g => g.plan.status === 'active' && (g.plan.items.length > 0 || g.plan.dropped.length > 0));
    const total = groups.reduce((n, g) => n + g.plan.items.length, 0);
    setProgress({ done: 0, total });
    const succeededAdded = new Set<string>();
    const hadFailure = new Set<string>();

    await runPool(groups, CONCURRENCY, async ({ c, plan }) => {
      const f = freshById.get(c.student_id);
      const nowRenewed = f ? matchRenewed(f).byClass : new Map<string, RenewedEnrolment>();
      for (const it of plan.items) {
        try {
          if (it.kind === 'kept' && nowRenewed.has(it.key)) {
            rows.push({ student: c.full_name, label: it.label, status: 'skipped', message: 'Already renewed' });
            continue;
          }
          if (!it.params) throw new Error(it.error ?? 'Incomplete');
          const r = await enrolClass(it.params);
          if (it.kind === 'added') succeededAdded.add(it.key);
          const short = r.lessons_scheduled < r.lessons_expected;
          if (short || r.conflicts > 0) {
            const dates = r.conflict_dates ?? [];
            rows.push({
              student: c.full_name, label: it.label, status: 'warn',
              message: `${r.lessons_scheduled} of ${r.lessons_expected} lessons scheduled` +
                (r.conflicts > 0 ? `; ${r.conflicts} week${r.conflicts === 1 ? '' : 's'} clashed (${dates.slice(0, 4).join(', ')}${dates.length > 4 ? '…' : ''})` : ''),
            });
          } else {
            rows.push({ student: c.full_name, label: it.label, status: 'ok', message: `${r.lessons_scheduled} lessons · ${inr(it.totalFee + it.regFee)}` });
          }
        } catch (err) {
          hadFailure.add(c.student_id);
          rows.push({ student: c.full_name, label: it.label, status: 'failed', message: errorMessage(err, 'Failed') });
        } finally {
          setProgress(p => ({ ...p, done: p.done + 1 }));
        }
      }
      for (const d of plan.dropped) {
        // Every weekly slot of the class (2× per week = 2 slots).
        for (const tid of classSlotIds(d)) {
          try { await releaseSlot(c.student_id, tid, toYear); }
          catch (err) {
            hadFailure.add(c.student_id);
            rows.push({ student: c.full_name, label: `${d.instrument_name ?? 'Class'} (dropped)`, status: 'failed',
              message: `Couldn't take them off the weekly slot: ${errorMessage(err, 'error')}` });
          }
        }
      }
    });

    // Forget edits that are done (renewed classes now show as "Already renewed");
    // students with a failure keep theirs, minus the classes that did get added.
    const processed = new Set(groups.map(g => g.c.student_id));
    setEdits(prev => {
      const next: Record<string, StudentEdit> = {};
      for (const [sid, e] of Object.entries(prev)) {
        if (processed.has(sid) && !hadFailure.has(sid)) continue;
        next[sid] = { ...e, added: (e.added ?? []).filter(a => !succeededAdded.has(a.key)) };
      }
      return next;
    });
    invalidateQueries('enrolments');
    invalidateQueries('payments');
    invalidateQueries('students:');
    invalidateQueries('teacher-schedule:');
    invalidateLessonViews(); // also dashboard: and reports:
    await candidatesQ.refresh();
    const order = { failed: 0, warn: 1, skipped: 2, ok: 3 } as const;
    rows.sort((a, b) => order[a.status] - order[b.status] || a.student.localeCompare(b.student));
    setReport(rows);
    setPhase('done');
    const ok = rows.filter(r => r.status === 'ok' || r.status === 'warn').length;
    const failed = rows.filter(r => r.status === 'failed').length;
    showToast(failed ? 'error' : 'success',
      `Renewed ${ok} class${ok === 1 ? '' : 'es'} for ${toYear}${failed ? ` — ${failed} failed` : ''}.`);
  }

  const visible = filtered.slice(0, shown);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex sm:items-center sm:justify-center sm:p-4"
      role="dialog" aria-modal="true" aria-labelledby="renew-title">
      <div ref={trapRef} className="bg-white w-full h-full sm:h-[92vh] sm:max-w-5xl sm:rounded-2xl shadow-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-black/5">
          <div className="min-w-0">
            <h2 id="renew-title" className="text-lg font-bold text-navy">Renew for {toYear}</h2>
            <p className="text-xs text-gray-500 truncate">Re-enrol {fromYear} students — keep, drop or add classes as you go</p>
          </div>
          <button onClick={onClose} disabled={running} aria-label="Close"
            className="p-2 -mr-2 text-gray-400 hover:text-navy disabled:opacity-40"><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {phase === 'edit' && (
            <>
              <SettingsPanel
                thisYear={thisYear} fromYear={fromYear} toYear={toYear} onFromYear={changeFromYear}
                startDate={startDate} setStartDate={setStartDate} endDate={endDate} setEndDate={setEndDate}
                defaultPlan={defaultPlan} setDefaultPlan={setDefaultPlan}
                rateMode={rateMode} setRateMode={(m) => { setRateMode(m); setRateValue(m === 'pct' ? 10 : m === 'flat' ? 100 : 0); }}
                rateValue={rateValue} setRateValue={setRateValue} regFee={regFee} setRegFee={setRegFee}
                dateError={dateError}
              />

              {candidatesQ.error && <ErrorBanner message={candidatesQ.error} onRetry={candidatesQ.refresh} />}

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }}
                    placeholder="Search student, instrument or teacher"
                    className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm" />
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button onClick={() => selectAll(true)} className="text-teal font-semibold hover:underline">Select all</button>
                  <button onClick={() => selectAll(false)} className="text-gray-500 font-semibold hover:underline">None</button>
                  <span className="text-gray-400">{filtered.length} student{filtered.length === 1 ? '' : 's'}</span>
                </div>
              </div>

              {candidatesQ.loading ? <SkeletonList rows={6} /> : filtered.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-10">
                  {candidates?.length ? 'No students match your search' : `No active students have ${fromYear} enrolments`}
                </p>
              ) : (
                <div className="space-y-2">
                  {visible.map(c => (
                    <StudentCard key={c.student_id} c={c} plan={plans.get(c.student_id)!} edit={edits[c.student_id]}
                      settings={settings} teachers={teachers} instruments={instruments}
                      onUpdate={updateStudent} toYear={toYear} />
                  ))}
                  {filtered.length > shown && (
                    <button onClick={() => setShown(s => s + PAGE)}
                      className="w-full py-2.5 text-sm text-teal font-semibold border border-dashed border-gray-200 rounded-xl hover:bg-gray-50">
                      Show more ({filtered.length - shown} left)
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {(phase === 'review' || phase === 'running') && (
            <ReviewPanel summary={summary} fromYear={fromYear} toYear={toYear} startDate={startDate} endDate={endDate}
              plans={plans} candidates={candidates ?? []} progress={progress} running={running} runError={runError} />
          )}

          {phase === 'done' && <ReportPanel rows={report} toYear={toYear} />}
        </div>

        {/* Footer */}
        <div className="border-t border-black/5 px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 bg-white">
          <p className="text-xs text-gray-500 flex-1">
            <span className="font-semibold text-navy">{summary.students}</span> student{summary.students === 1 ? '' : 's'} ·{' '}
            <span className="font-semibold text-navy">{summary.classes}</span> class{summary.classes === 1 ? '' : 'es'} ·{' '}
            <span className="font-semibold text-navy">{inr(summary.total)}</span>
            {summary.renewed > 0 && <> · {summary.renewed} already renewed</>}
            {summary.problems > 0 && <span className="text-coral"> · {summary.problems} need attention</span>}
          </p>
          <div className="flex gap-2">
            {phase === 'edit' && (
              <>
                <button onClick={onClose} className="flex-1 sm:flex-none px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={() => setPhase('review')} disabled={summary.classes === 0 && summary.dropped === 0 || !!dateError}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-lg bg-teal text-white text-sm font-semibold hover:bg-teal/80 disabled:opacity-50">Review</button>
              </>
            )}
            {phase === 'review' && (
              <>
                <button onClick={() => setPhase('edit')} className="flex-1 sm:flex-none px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Back</button>
                <button onClick={run} disabled={summary.problems > 0 || !!dateError || (summary.classes === 0 && summary.dropped === 0)}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-lg bg-teal text-white text-sm font-semibold hover:bg-teal/80 disabled:opacity-50">
                  Renew {summary.students} student{summary.students === 1 ? '' : 's'}
                </button>
              </>
            )}
            {running && <span className="text-sm text-gray-500">Renewing… {progress.done}/{progress.total}</span>}
            {phase === 'done' && (
              <>
                <button onClick={() => setPhase('edit')} className="flex-1 sm:flex-none px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Back to list</button>
                <button onClick={onClose} className="flex-1 sm:flex-none px-4 py-2.5 rounded-lg bg-teal text-white text-sm font-semibold hover:bg-teal/80">Done</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── settings ──────────────────────────────────────────────────────────────
function SettingsPanel(p: {
  thisYear: number; fromYear: string; toYear: string; onFromYear: (y: string) => void;
  startDate: string; setStartDate: (v: string) => void; endDate: string; setEndDate: (v: string) => void;
  defaultPlan: string; setDefaultPlan: (v: string) => void;
  rateMode: Settings['rateMode']; setRateMode: (m: Settings['rateMode']) => void;
  rateValue: number; setRateValue: (v: number) => void; regFee: number; setRegFee: (v: number) => void;
  dateError: string | null;
}) {
  const field = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
  const lbl = 'block text-xs font-medium text-gray-500 mb-1';
  return (
    <div className="bg-gray-50 rounded-xl p-3 sm:p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className={lbl} htmlFor="rw-from">From year</label>
          <select id="rw-from" value={p.fromYear} onChange={(e) => p.onFromYear(e.target.value)} className={field}>
            {[p.thisYear - 1, p.thisYear, p.thisYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <span className={lbl}>To year</span>
          <p className="px-3 py-2 text-sm font-semibold text-navy">{p.toYear}</p>
        </div>
        <div>
          <label className={lbl} htmlFor="rw-start">Start date</label>
          <input id="rw-start" type="date" value={p.startDate} onChange={(e) => p.setStartDate(e.target.value)} className={field} />
        </div>
        <div>
          <label className={lbl} htmlFor="rw-end">End date</label>
          <input id="rw-end" type="date" value={p.endDate} onChange={(e) => p.setEndDate(e.target.value)} className={field} />
        </div>
      </div>
      {p.dateError && <p className="text-xs text-coral">{p.dateError}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={lbl} htmlFor="rw-plan">Payment plan</label>
          <select id="rw-plan" value={p.defaultPlan} onChange={(e) => p.setDefaultPlan(e.target.value)} className={field}>
            <option value="keep">Keep each student's plan</option>
            {PLANS.filter(x => x.value !== 'trial').map(x => <option key={x.value} value={x.value}>Everyone: {x.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} htmlFor="rw-rate">Rate change (default per class)</label>
          <div className="flex gap-2">
            <select id="rw-rate" value={p.rateMode} onChange={(e) => p.setRateMode(e.target.value as Settings['rateMode'])} className={field}>
              <option value="none">No change</option>
              <option value="pct">+ % increase</option>
              <option value="flat">+ ₹ per lesson</option>
            </select>
            {p.rateMode !== 'none' && (
              <input type="number" inputMode="decimal" aria-label={p.rateMode === 'pct' ? 'Percent increase' : 'Rupees per lesson'}
                value={p.rateValue} onChange={(e) => p.setRateValue(Number(e.target.value))}
                className="w-24 border border-gray-200 rounded-lg px-2 py-2 text-sm" />
            )}
          </div>
        </div>
        <div>
          <label className={lbl} htmlFor="rw-reg">Registration fee (₹, per student)</label>
          <input id="rw-reg" type="number" min={0} inputMode="decimal" value={p.regFee}
            onChange={(e) => p.setRegFee(Math.max(0, Number(e.target.value) || 0))} className={field} />
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        Lessons per class follow the start month ({lessonsForPlan('3_instalments', p.startDate)} for a {new Date(p.startDate + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long' })} start)
        × times per week (a class twice a week gets double).
        Each student's existing discounts are kept. Dropped classes keep their {p.fromYear} history.
      </p>
    </div>
  );
}

// ── one student ───────────────────────────────────────────────────────────
const StudentCard = memo(function StudentCard({ c, plan, edit, settings, teachers, instruments, onUpdate, toYear }: {
  c: RenewalCandidate; plan: StudentPlan; edit: StudentEdit | undefined; settings: Settings;
  teachers: Profile[]; instruments: Instrument[];
  onUpdate: (studentId: string, fn: (e: StudentEdit) => StudentEdit) => void; toYear: string;
}) {
  const sid = c.student_id;
  const skipped = plan.status === 'skipped';
  const renewed = plan.status === 'renewed';
  const setClass = (id: string, patch: Partial<ClassEdit>) =>
    onUpdate(sid, e => ({ ...e, classes: { ...(e.classes ?? {}), [id]: { ...(e.classes?.[id] ?? {}), ...patch } } }));
  const setAdded = (key: string, patch: Partial<AddedClass>) =>
    onUpdate(sid, e => ({ ...e, added: (e.added ?? []).map(a => (a.key === key ? { ...a, ...patch } : a)) }));
  const itemByKey = new Map(plan.items.map(i => [i.key, i]));
  const studentTotal = plan.items.reduce((n, i) => n + i.totalFee + i.regFee, 0);

  function addClass() {
    const first = c.classes[0];
    const planV = settings.defaultPlan === 'keep' ? (first?.payment_plan ?? '3_instalments') : settings.defaultPlan;
    onUpdate(sid, e => ({
      ...e,
      added: [...(e.added ?? []), {
        key: `add-${sid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        // A brand-new class: the coordinator types its rate (never copied from another class).
        teacherId: '', slot: null, times: 1, extraSlots: [], rateText: '', plan: planV,
      }],
    }));
  }

  return (
    <div className={`rounded-xl border p-3 ${renewed || skipped ? 'border-black/5 bg-gray-50/60' : 'border-black/10 bg-white'}`}
      data-testid="renewal-student">
      <div className="flex items-center gap-3">
        {!renewed && (
          <input type="checkbox" checked={!skipped} aria-label={`Renew ${c.full_name}`}
            onChange={(e) => onUpdate(sid, ed => ({ ...ed, skip: !e.target.checked }))} className="h-4 w-4 accent-teal flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate ${skipped ? 'text-gray-400 line-through' : 'text-navy'}`}>{c.full_name}</p>
        </div>
        {renewed ? (
          <span className="text-xs bg-teal-light text-teal font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
            <CheckCircle2 size={12} /> Already renewed
          </span>
        ) : skipped ? (
          <button onClick={() => onUpdate(sid, ed => ({ ...ed, skip: false }))} className="text-xs text-teal font-semibold hover:underline">Include</button>
        ) : (
          <>
            <span className="text-xs text-gray-500 whitespace-nowrap">{plan.items.length} class{plan.items.length === 1 ? '' : 'es'} · {inr(studentTotal)}</span>
            <button onClick={() => onUpdate(sid, ed => ({ ...ed, skip: true }))} className="text-xs text-gray-400 hover:text-coral whitespace-nowrap">Skip this student</button>
          </>
        )}
      </div>

      {!skipped && (
        <div className="mt-2 space-y-2">
          {c.classes.map(cl => {
            const r = plan.renewedByClass.get(cl.enrolment_id);
            const instName = cl.instrument_name || 'Class';
            const current = `${inr(cl.rate_per_lesson)}/lesson · ${planLabel(cl.payment_plan)}`;
            const times = classTimesPerWeek(cl);
            const where = cl.slot && cl.slot.is_active
              ? `${cl.teacher_name ?? ''} · ${[cl.slot, ...(cl.extra_slots ?? [])].map(x => `${DAYS[x.day_of_week]} ${hhmm(x.start_time)}`).join(' + ')}`
              : cl.teacher_name ?? '';
            if (r) {
              return (
                <div key={cl.enrolment_id} className="text-xs text-gray-500 flex flex-wrap gap-x-2 pl-7">
                  <span className="font-medium text-gray-600">{instName}</span><span>{where}</span>
                  <span className="text-teal">· Already renewed ({inr(r.rate_per_lesson)}/lesson · {planLabel(r.payment_plan)})</span>
                </div>
              );
            }
            const e = edit?.classes?.[cl.enrolment_id];
            const item = itemByKey.get(cl.enrolment_id);
            const dropped = !item;
            const pickSlot = !dropped && (e?.changeSlot || needsSlot(cl));
            const teacherId = e?.teacherId ?? cl.teacher_id ?? '';
            return (
              <div key={cl.enrolment_id} className={`rounded-lg border px-3 py-2 sm:ml-7 ${dropped ? 'border-dashed border-gray-200' : 'border-gray-100'}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={`text-sm font-medium ${dropped ? 'text-gray-400 line-through' : 'text-navy'}`}>{instName}</span>
                  {times > 1 && <span className="text-[11px] bg-teal/10 text-teal font-semibold px-1.5 py-0.5 rounded">{timesPerWeekLabel(times)}</span>}
                  <span className="text-xs text-gray-500">{where}</span>
                  {needsSlot(cl) && <span className="text-[11px] bg-yellow-light text-yellow font-semibold px-1.5 py-0.5 rounded">needs a slot</span>}
                  {defaultDrop(cl, c) && e?.drop === undefined && <span className="text-[11px] text-gray-400">(left this slot)</span>}
                  <span className="text-xs text-gray-400">now {current}</span>
                  <div className="ml-auto inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs" role="group" aria-label={`${instName}: keep or drop`}>
                    <button onClick={() => setClass(cl.enrolment_id, { drop: false })} aria-pressed={!dropped}
                      className={`px-2.5 py-1 ${!dropped ? 'bg-teal text-white' : 'text-gray-500'}`}>Keep</button>
                    <button onClick={() => setClass(cl.enrolment_id, { drop: true })} aria-pressed={dropped}
                      className={`px-2.5 py-1 ${dropped ? 'bg-coral text-white' : 'text-gray-500'}`}>Drop</button>
                  </div>
                </div>
                {item && (
                  <ItemControls item={item}
                    rateValue={e?.rateText ?? String(item.rate)}
                    onRate={(v) => setClass(cl.enrolment_id, { rateText: v })}
                    onPlan={(v) => setClass(cl.enrolment_id, { plan: v })}
                    extra={!needsSlot(cl) && (
                      <button onClick={() => setClass(cl.enrolment_id, { changeSlot: !e?.changeSlot, slot: null, teacherId: undefined, times: undefined, extraSlots: undefined })}
                        className="text-xs text-teal hover:underline">{e?.changeSlot ? 'Keep current slot' : 'Change slot'}</button>
                    )}
                  />
                )}
                {pickSlot && (
                  <SlotChooser teachers={teachers} instruments={instruments} teacherId={teacherId} slot={e?.slot ?? null}
                    times={e?.times ?? times} extraSlots={sizeExtras(e?.extraSlots, e?.times ?? times)}
                    onTeacher={(t) => setClass(cl.enrolment_id, { teacherId: t, slot: null, extraSlots: [] })}
                    onSlot={(s) => setClass(cl.enrolment_id, { slot: s })}
                    onTimes={(t) => setClass(cl.enrolment_id, { times: t, extraSlots: sizeExtras(e?.extraSlots, t) })}
                    onExtraSlots={(x) => setClass(cl.enrolment_id, { extraSlots: x })} />
                )}
              </div>
            );
          })}

          {plan.extra.map(x => (
            <p key={x.enrolment_id} className="text-xs text-teal pl-7">
              Also enrolled for {toYear}: {x.instrument_name || 'Class'} ({inr(x.rate_per_lesson)}/lesson · {planLabel(x.payment_plan)})
            </p>
          ))}

          {(edit?.added ?? []).map(a => {
            const item = itemByKey.get(a.key);
            return (
              <div key={a.key} className="rounded-lg border border-teal/30 bg-teal-light/40 px-3 py-2 sm:ml-7">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-teal">New class</span>
                  <span className="text-xs text-gray-500 truncate">{item?.label}</span>
                  <button onClick={() => onUpdate(sid, ed => ({ ...ed, added: (ed.added ?? []).filter(x => x.key !== a.key) }))}
                    className="ml-auto text-xs text-gray-400 hover:text-coral">Remove</button>
                </div>
                <SlotChooser teachers={teachers} instruments={instruments} teacherId={a.teacherId} slot={a.slot}
                  times={a.times} extraSlots={sizeExtras(a.extraSlots, a.times)}
                  onTeacher={(t) => setAdded(a.key, { teacherId: t, slot: null, extraSlots: [] })} onSlot={(s) => setAdded(a.key, { slot: s })}
                  onTimes={(t) => setAdded(a.key, { times: t, extraSlots: sizeExtras(a.extraSlots, t) })}
                  onExtraSlots={(x) => setAdded(a.key, { extraSlots: x })} />
                {item && (
                  <ItemControls item={item} rateValue={a.rateText}
                    onRate={(v) => setAdded(a.key, { rateText: v })} onPlan={(v) => setAdded(a.key, { plan: v })} />
                )}
              </div>
            );
          })}

          <button onClick={addClass} className="sm:ml-7 flex items-center gap-1 text-xs font-semibold text-teal hover:underline">
            <Plus size={13} /> Add a class
          </button>
        </div>
      )}
    </div>
  );
});

function ItemControls({ item, rateValue, onRate, onPlan, extra }: {
  item: PlannedItem; rateValue: string; onRate: (v: string) => void; onPlan: (v: string) => void; extra?: ReactNode;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-gray-500">
        New rate ₹
        <input type="number" min={0} inputMode="decimal" value={rateValue} onChange={(e) => onRate(e.target.value)}
          placeholder="e.g. 1200"
          className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-navy" aria-label="New rate per lesson" />
      </label>
      <select value={item.plan} onChange={(e) => onPlan(e.target.value)} aria-label="Payment plan"
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
        {PLANS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
      </select>
      <span className="text-xs text-gray-500">{item.lessonsText} · <span className="font-semibold text-navy">{inr(item.totalFee + item.regFee)}</span>
        {item.regFee > 0 && <span className="text-gray-400"> (incl. {inr(item.regFee)} reg.)</span>}</span>
      {extra}
      {item.error && <span className="w-full text-xs text-coral">{item.error}</span>}
    </div>
  );
}

/** Teacher + times per week + one weekly slot per lesson of the week. */
function SlotChooser({ teachers, instruments, teacherId, slot, times, extraSlots, onTeacher, onSlot, onTimes, onExtraSlots }: {
  teachers: Profile[]; instruments: Instrument[]; teacherId: string; slot: SelectedSlot | null;
  times: number; extraSlots: (SelectedSlot | null)[];
  onTeacher: (id: string) => void; onSlot: (s: SelectedSlot | null) => void;
  onTimes: (t: number) => void; onExtraSlots: (x: (SelectedSlot | null)[]) => void;
}) {
  const all = [slot, ...extraSlots];
  const usedBy = (i: number) => all.filter((x, j) => j !== i && x?.mode === 'existing')
    .map(x => (x as Extract<SelectedSlot, { mode: 'existing' }>).templateId);
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <select value={teacherId} onChange={(e) => onTeacher(e.target.value)} aria-label="Teacher"
          className="w-full sm:w-64 border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="">Choose teacher…</option>
          {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
        </select>
        <select value={normaliseTimesPerWeek(times)} onChange={(e) => onTimes(Number(e.target.value))} aria-label="Times per week"
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          {TIMES_PER_WEEK_OPTIONS.map(t => <option key={t} value={t}>{t}× per week</option>)}
        </select>
      </div>
      {teacherId && all.map((s, i) => (
        <OneSlot key={`${teacherId}-${i}`} label={all.length > 1 ? `Weekly lesson ${i + 1}` : null}
          teacherId={teacherId} instruments={instruments} slot={s} exclude={usedBy(i)} timeOnly={i > 0}
          inherit={i > 0 ? { instrumentId: slot?.instrumentId ?? null, title: slot?.title ?? '' } : undefined}
          onSlot={(v) => (i === 0 ? onSlot(v) : onExtraSlots(extraSlots.map((x, j) => (j === i - 1 ? v : x))))} />
      ))}
    </div>
  );
}

/** One weekly slot. Collapses to a one-line summary once an existing slot is picked. */
function OneSlot({ label, teacherId, instruments, slot, exclude, timeOnly, inherit, onSlot }: {
  label: string | null; teacherId: string; instruments: Instrument[]; slot: SelectedSlot | null;
  exclude: string[]; timeOnly: boolean; inherit?: { instrumentId: string | null; title: string };
  onSlot: (s: SelectedSlot | null) => void;
}) {
  const [open, setOpen] = useState(!slot || slot.mode === 'new');
  const inst = instruments.find(i => i.id === slot?.instrumentId);
  return (
    <div>
      {label && <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>}
      {open || !slot ? (
        <div className="max-h-72 overflow-y-auto pr-1">
          <SlotPicker teacherId={teacherId} instruments={instruments} value={slot}
            excludeTemplateIds={exclude} timeOnly={timeOnly} inherit={inherit}
            onChange={(s) => { onSlot(s); if (s?.mode === 'existing') setOpen(false); }} />
        </div>
      ) : (
        <p className="text-xs text-gray-600">
          Slot: <span className="font-medium text-navy">{slotLabel(slot)}</span> {inst ? `· ${inst.name}` : ''}{' '}
          <button onClick={() => setOpen(true)} className="text-teal hover:underline ml-1">Change</button>
        </p>
      )}
    </div>
  );
}

// ── review + report ───────────────────────────────────────────────────────
function ReviewPanel({ summary, fromYear, toYear, startDate, endDate, plans, candidates, progress, running, runError }: {
  summary: { students: number; classes: number; total: number; dropped: number; added: number; skipped: number; renewed: number; problems: number };
  fromYear: string; toYear: string; startDate: string; endDate: string;
  plans: Map<string, StudentPlan>; candidates: RenewalCandidate[];
  progress: { done: number; total: number }; running: boolean; runError: string | null;
}) {
  const problems = candidates.flatMap(c => {
    const p = plans.get(c.student_id);
    if (!p || p.status !== 'active') return [];
    return p.items.filter(i => i.error).map(i => ({ name: c.full_name, label: i.label, error: i.error! }));
  });
  const stat = (n: number | string, label: string, tone = 'text-navy') => (
    <div className="bg-gray-50 rounded-xl px-3 py-3">
      <p className={`text-xl font-bold ${tone}`}>{n}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-navy">Renew {fromYear} → {toYear}</h3>
        <p className="text-xs text-gray-500">Lessons from {startDate} to {endDate}. Nothing is created for dropped classes or skipped students.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stat(summary.students, 'students')}
        {stat(summary.classes, 'classes')}
        {stat(inr(summary.total), 'total billed')}
        {stat(`${summary.dropped} / ${summary.added}`, 'classes dropped / added')}
      </div>
      <p className="text-xs text-gray-500">
        {summary.skipped} skipped · {summary.renewed} already renewed (left out).
      </p>
      {runError && <p className="text-sm text-coral">{runError}</p>}
      {problems.length > 0 && !running && (
        <div className="rounded-xl border border-coral/20 bg-coral-light p-3">
          <p className="text-sm font-semibold text-navy flex items-center gap-1.5"><AlertTriangle size={15} className="text-coral" /> Fix these first ({problems.length})</p>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-600 max-h-48 overflow-y-auto">
            {problems.map((p, i) => <li key={i}><span className="font-medium">{p.name}</span> — {p.label}: {p.error}</li>)}
          </ul>
        </div>
      )}
      {running && (
        <div className="space-y-1" aria-live="polite">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-2 bg-teal transition-all" style={{ width: `${pct}%` }} /></div>
          <p className="text-xs text-gray-500 flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" /> {progress.done} of {progress.total} classes — keep this window open</p>
        </div>
      )}
    </div>
  );
}

function ReportPanel({ rows, toYear }: { rows: ReportRow[]; toYear: string }) {
  const count = (s: ReportRow['status']) => rows.filter(r => r.status === s).length;
  const icon = (s: ReportRow['status']) =>
    s === 'ok' ? <CheckCircle2 size={14} className="text-teal" />
    : s === 'warn' ? <AlertTriangle size={14} className="text-yellow" />
    : s === 'failed' ? <XCircle size={14} className="text-coral" />
    : <CheckCircle2 size={14} className="text-gray-300" />;
  return (
    <div className="space-y-3" data-testid="renewal-report">
      <h3 className="font-semibold text-navy">Renewal for {toYear} finished</h3>
      <p className="text-sm text-gray-600">
        <span className="font-semibold text-teal">{count('ok') + count('warn')} succeeded</span>
        {count('warn') > 0 && <> ({count('warn')} with schedule warnings)</>} ·{' '}
        <span className={count('failed') ? 'font-semibold text-coral' : ''}>{count('failed')} failed</span>
        {count('skipped') > 0 && <> · {count('skipped')} skipped (already renewed)</>}
      </p>
      {count('failed') > 0 && (
        <p className="text-xs text-gray-500">Failed classes weren't created. Fix them under "Back to list" and renew again — renewed classes are skipped automatically.</p>
      )}
      <ul className="divide-y divide-black/5 border border-black/5 rounded-xl">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
            <span className="mt-0.5">{icon(r.status)}</span>
            <div className="min-w-0">
              <p className="text-navy"><span className="font-medium">{r.student}</span> <span className="text-gray-500 text-xs">{r.label}</span></p>
              <p className={`text-xs ${r.status === 'failed' ? 'text-coral' : 'text-gray-500'}`}>{r.message}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
