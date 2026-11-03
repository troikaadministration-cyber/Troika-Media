// web/src/components/SlotPicker.tsx
import { useState, useEffect, useId } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap } from '../lib/queryCache';
import type { Instrument, TeacherScheduleTemplate } from '../types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type ScheduleTemplateRow = Omit<TeacherScheduleTemplate, 'created_at' | 'updated_at'>;
const TEMPLATE_COLUMNS = 'id, teacher_id, day_of_week, start_time, end_time, location_id, instrument_id, title, student_ids, is_active';

/** A teacher's active weekly slots (cached; shared with the Teacher Schedules page). */
export function useTeacherTemplates(teacherId: string | null) {
  return useQuery<ScheduleTemplateRow[]>(teacherId ? `teacher-schedule:${teacherId}` : null, async () =>
    unwrap(await supabase
      .from('teacher_schedule_templates')
      .select(TEMPLATE_COLUMNS)
      .eq('teacher_id', teacherId!)
      .eq('is_active', true)
      .order('day_of_week')
      .order('start_time'), []) as ScheduleTemplateRow[]);
}

export type SelectedSlot = {
  mode: 'existing';
  templateId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string | null;
  instrumentId: string | null;
  title: string;
} | {
  mode: 'new';
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  instrumentId: string | null;
  title: string;
  /** Set when this new time overlaps one of the teacher's classes that has students. */
  clash?: string | null;
};

/**
 * Why a slot can't be saved (mirrors enrol_student's checks), or null if it's fine.
 * `timeOnly`: a class's 2nd/3rd weekly lesson — its instrument/title come from the first slot.
 */
export function slotError(slot: SelectedSlot | null, opts: { timeOnly?: boolean } = {}): string | null {
  if (!slot) return 'Pick an existing class time, or choose a new day and time';
  if (slot.mode === 'new') {
    if (!slot.startTime) return 'Choose a start time';
    if (slot.endTime && slot.endTime <= slot.startTime) return 'End time must be after the start time';
    if (!opts.timeOnly && !slot.instrumentId) return 'Choose an instrument';
    if (slot.clash) return slot.clash;
  }
  return null;
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

/**
 * Problems across ALL weekly lessons of one class (2×/3× per week), mirroring
 * enrol_student: every lesson needs a slot, the same slot can't be used twice,
 * and two lessons on the same day can't overlap. null when fine.
 */
export function weeklySlotsError(slots: (SelectedSlot | null)[]): string | null {
  for (let i = 0; i < slots.length; i++) {
    const err = slotError(slots[i], { timeOnly: i > 0 });
    if (err) return slots.length > 1 ? `Weekly lesson ${i + 1}: ${err.charAt(0).toLowerCase()}${err.slice(1)}` : err;
  }
  const s = slots as SelectedSlot[];
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      const a = s[i], b = s[j];
      if (a.mode === 'existing' && b.mode === 'existing' && a.templateId === b.templateId) {
        return `Weekly lessons ${i + 1} and ${j + 1} are at the same time — pick a different day or time`;
      }
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      const aS = toMin(a.startTime), bS = toMin(b.startTime);
      const aE = a.endTime ? toMin(a.endTime) : aS + 45, bE = b.endTime ? toMin(b.endTime) : bS + 45;
      if (aS < bE && bS < aE) {
        return `Weekly lessons ${i + 1} and ${j + 1} overlap on ${DAY_NAMES[a.dayOfWeek]} — choose different days or times`;
      }
    }
  }
  return null;
}

/** enrol_student's p_extra_slots entry for a 2nd/3rd weekly lesson. */
export function extraSlotParam(slot: SelectedSlot) {
  return slot.mode === 'existing'
    ? { template_id: slot.templateId }
    : { day_of_week: slot.dayOfWeek, start_time: slot.startTime, end_time: slot.endTime || null };
}

interface SlotPickerProps {
  teacherId: string;
  instruments: Instrument[];
  value: SelectedSlot | null;
  onChange: (slot: SelectedSlot | null) => void;
  /** Slots already used by this class's other weekly lessons (shown, but can't be picked again). */
  excludeTemplateIds?: string[];
  /** 2nd/3rd weekly lesson: only day + time (instrument/title follow the first slot). */
  timeOnly?: boolean;
  /** Instrument/title a time-only new slot inherits (kept on the SelectedSlot for labels). */
  inherit?: { instrumentId: string | null; title: string };
}

export function SlotPicker({ teacherId, instruments, value, onChange, excludeTemplateIds = [], timeOnly = false, inherit }: SlotPickerProps) {
  const { data, loading, error: fetchError } = useTeacherTemplates(teacherId || null);
  const templates = data ?? [];
  // Names of the students already in this teacher's classes (shown on each class time and in clash warnings).
  const studentIds = Array.from(new Set(templates.flatMap(t => t.student_ids ?? []))).sort();
  const { data: names } = useQuery<Record<string, string>>(
    studentIds.length ? `slot-student-names:${studentIds.join(',')}` : null,
    async () => Object.fromEntries((unwrap(await supabase.from('students').select('id, full_name').in('id', studentIds), []) as { id: string; full_name: string }[])
      .map(s => [s.id, s.full_name])));
  const whoIn = (tpl: ScheduleTemplateRow) => (tpl.student_ids ?? []).map(id => names?.[id]).filter(Boolean).join(', ');
  function clashFor(day: number, start: string, end: string): string | null {
    if (!start) return null;
    const s = toMin(start.slice(0, 5)), e = end ? toMin(end.slice(0, 5)) : s + 45;
    const hit = templates.find(tpl => tpl.day_of_week === day && (tpl.student_ids?.length ?? 0) > 0 && (() => {
      const ts = toMin(tpl.start_time.slice(0, 5)), te = tpl.end_time ? toMin(tpl.end_time.slice(0, 5)) : ts + 45;
      return s < te && ts < e;
    })());
    if (!hit) return null;
    return `Clash: this teacher already teaches ${whoIn(hit) || hit.title || 'another class'} on ${DAY_NAMES[day]} `
      + `${hit.start_time.slice(0, 5)}–${(hit.end_time ?? '').slice(0, 5) || '?'}. Choose a different day or time `
      + `(or pick that class above to put the student in the same class).`;
  }
  // Several pickers can be open for the same teacher (2×/week): keep their radio groups apart.
  const radioName = `slot-${teacherId}-${useId()}`;
  const [newSlot, setNewSlot] = useState({
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '09:45',
    instrumentId: '',
    title: '',
  });

  // Fix 3 — Reset newSlot to defaults when value becomes null externally
  useEffect(() => {
    if (!value) {
      setNewSlot({ dayOfWeek: 1, startTime: '09:00', endTime: '09:45', instrumentId: '', title: '' });
    }
  }, [value]);

  const isNewSelected = value?.mode === 'new';
  const newSlotError = isNewSelected ? slotError(value, { timeOnly }) : null;

  function selectExisting(tpl: ScheduleTemplateRow) {
    onChange({
      mode: 'existing',
      templateId: tpl.id,
      dayOfWeek: tpl.day_of_week,
      startTime: tpl.start_time,
      endTime: tpl.end_time,
      instrumentId: tpl.instrument_id,
      title: tpl.title,
    });
  }

  function updateNewSlot(patch: Partial<typeof newSlot>) {
    const updated = { ...newSlot, ...patch };
    setNewSlot(updated);
    onChange({
      mode: 'new',
      dayOfWeek: updated.dayOfWeek,
      startTime: updated.startTime,
      endTime: updated.endTime,
      instrumentId: timeOnly ? (inherit?.instrumentId ?? null) : (updated.instrumentId || null),
      title: timeOnly ? (inherit?.title ?? '') : updated.title,
      clash: clashFor(updated.dayOfWeek, updated.startTime, updated.endTime),
    });
  }

  if (loading) return <p className="text-sm text-gray-400">Loading class times...</p>;
  if (fetchError && !data) return <p className="text-xs text-red-500">Couldn't load class times: {fetchError}</p>;

  const byDay: Record<number, ScheduleTemplateRow[]> = {};
  for (const t of templates) {
    if (!byDay[t.day_of_week]) byDay[t.day_of_week] = [];
    byDay[t.day_of_week].push(t);
  }

  return (
    <div className="space-y-2">
      {templates.length === 0 && (
        <p className="text-xs text-gray-400 mb-2">This teacher has no weekly classes yet. Choose a new day and time below.</p>
      )}
      {templates.length > 0 && (
        <p className="text-xs text-gray-400 mb-2">These are this teacher's classes. Pick one only to put the student <b>in that same class</b> (for example a brother or sister, or a group) — each student still pays for their own place. Otherwise choose a new day and time at the bottom.</p>
      )}

      {[1, 2, 3, 4, 5, 6, 0].map((day) => {
        const slots = byDay[day];
        if (!slots) return null;
        return (
          <div key={day}>
            <p className="text-xs font-semibold text-gray-500 mb-1">{DAY_NAMES[day]}</p>
            {slots.map((tpl) => {
              const inst = instruments.find(i => i.id === tpl.instrument_id);
              const isSelected = value?.mode === 'existing' && value.templateId === tpl.id;
              const usedElsewhere = !isSelected && excludeTemplateIds.includes(tpl.id);
              // A class's weekly lessons are all one instrument (enrol_student checks this too).
              const otherInstrument = !isSelected && timeOnly && !!inherit?.instrumentId && !!tpl.instrument_id
                && tpl.instrument_id !== inherit.instrumentId;
              const blocked = usedElsewhere || otherInstrument;
              return (
                <label
                  key={tpl.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border mb-1 transition-colors ${
                    blocked ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                    : isSelected ? 'border-teal bg-teal/5 cursor-pointer' : 'border-gray-200 hover:border-gray-300 cursor-pointer'
                  }`}
                >
                  {/* Fix 5 — Scope radio name to instance */}
                  <input
                    type="radio"
                    name={radioName}
                    checked={isSelected}
                    disabled={blocked}
                    onChange={() => selectExisting(tpl)}
                    className="text-teal"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-navy">
                      {tpl.start_time.slice(0, 5)}
                      {tpl.end_time ? ` – ${tpl.end_time.slice(0, 5)}` : ''}
                    </span>
                    <span className="text-sm text-gray-500 ml-2">{tpl.title || 'Lesson'}</span>
                    {whoIn(tpl) && <span className="block text-xs text-gray-400">Students: {whoIn(tpl)}</span>}
                    {inst && <span className="text-sm ml-1">{inst.icon}</span>}
                    {usedElsewhere && <span className="text-xs text-gray-400 ml-2">(already chosen for another weekly lesson)</span>}
                    {!usedElsewhere && otherInstrument && <span className="text-xs text-gray-400 ml-2">(different instrument)</span>}
                  </div>
                </label>
              );
            })}
          </div>
        );
      })}

      {/* Fix 4 — Replace outer <label> with <div> to avoid nested <label> elements */}
      <div
        className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
          isNewSelected ? 'border-coral bg-coral/5' : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        {/* Fix 5 — Scope radio name to instance */}
        <input
          type="radio"
          name={radioName}
          checked={isNewSelected}
          onChange={() => updateNewSlot({})}
          className="mt-0.5 text-coral cursor-pointer"
        />
        <div className="flex-1">
          <p
            className="text-sm font-medium text-navy mb-2 cursor-pointer"
            onClick={() => !isNewSelected && updateNewSlot({})}
          >+ New day and time</p>
          {isNewSelected && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Day</label>
                  <select
                    value={newSlot.dayOfWeek}
                    onChange={(e) => updateNewSlot({ dayOfWeek: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 0].map(d => (
                      <option key={d} value={d}>{DAY_NAMES[d]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Start</label>
                  <input
                    type="time"
                    value={newSlot.startTime}
                    onChange={(e) => updateNewSlot({ startTime: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">End</label>
                  <input
                    type="time"
                    value={newSlot.endTime}
                    onChange={(e) => updateNewSlot({ endTime: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              {!timeOnly && <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Instrument</label>
                  <select
                    value={newSlot.instrumentId}
                    onChange={(e) => updateNewSlot({ instrumentId: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="">Select…</option>
                    {instruments.map(i => (
                      <option key={i.id} value={i.id}>{i.icon} {i.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Title</label>
                  <input
                    value={newSlot.title}
                    onChange={(e) => updateNewSlot({ title: e.target.value })}
                    placeholder="e.g. Piano Lesson"
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
              </div>}
              {newSlotError && <p className="text-xs text-coral">{newSlotError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
