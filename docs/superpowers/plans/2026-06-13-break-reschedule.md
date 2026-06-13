# Break Reschedule UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pending Reschedules section to the Breaks page so admins can manually or automatically create makeup lessons for break-cancelled classes.

**Architecture:** `usePendingReschedules` hook owns all data and actions (fetch, reschedule, auto-reschedule). Four new components handle display: `PendingRescheduleList` (left panel), `ReschedulerCalendar` (right panel), `RescheduleModal` (manual reschedule), auto-reschedule preview modal (inline in Breaks.tsx). No DB migrations needed.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Supabase JS v2. No test framework — verify via `npm run build` (type check) and dev server inspection.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `web/src/types/index.ts` | Modify | Add `PendingLesson` + `AutoReschedulePreviewItem` types |
| `web/src/hooks/usePendingReschedules.ts` | Create | Fetch, `reschedule()`, `autoRescheduleBreak()`, `confirmAutoReschedule()` |
| `web/src/components/PendingRescheduleList.tsx` | Create | Left panel — lessons grouped by break, auto-reschedule button per break |
| `web/src/components/ReschedulerCalendar.tsx` | Create | Right panel — teacher month calendar with lesson dots |
| `web/src/components/RescheduleModal.tsx` | Create | Time picker modal → calls `reschedule()` |
| `web/src/pages/Breaks.tsx` | Modify | Wire pending section, auto-reschedule preview modal, refresh `fetchBreaks` |
| `web/src/hooks/useBreaks.ts` | Modify | Remove `linkReschedule()` (superseded) |

---

### Task 1: Types + `usePendingReschedules` hook

**Files:**
- Modify: `web/src/types/index.ts` (append two interfaces)
- Create: `web/src/hooks/usePendingReschedules.ts`

- [ ] **Step 1: Add `PendingLesson` and `AutoReschedulePreviewItem` to types**

Append to the end of `web/src/types/index.ts`:

```ts
export interface PendingLesson {
  id: string;
  teacher_id: string;
  instrument_id: string | null;
  location_id: string | null;
  title: string;
  date: string;       // YYYY-MM-DD
  start_time: string; // HH:MM:SS
  source_break_id: string;
  students: Array<{ student_id: string; student: { full_name: string } }>;
  teacher: { full_name: string };
  instrument: { name: string; icon: string | null } | null;
  break: { title: string; end_date: string; student_ids: string[] };
}

export interface AutoReschedulePreviewItem {
  original: PendingLesson;
  newDate: string;   // YYYY-MM-DD, empty string when found=false
  newTime: string;   // HH:MM:SS, empty string when found=false
  found: boolean;    // false = no conflict-free slot within 52 weeks
}
```

- [ ] **Step 2: Create `web/src/hooks/usePendingReschedules.ts`**

```ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { PendingLesson, AutoReschedulePreviewItem, LessonType, LessonStatus } from '../types';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function nextDayOfWeek(from: Date, dow: number): Date {
  const d = addDays(from, 1);
  while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
  return d;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function usePendingReschedules() {
  const [lessons, setLessons] = useState<PendingLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLessons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('lessons')
        .select(`
          id, teacher_id, instrument_id, location_id, title, date, start_time, source_break_id,
          students:lesson_students(student_id, student:students(full_name)),
          teacher:profiles!lessons_teacher_id_fkey(full_name),
          instrument:instruments(name, icon),
          break:scheduled_breaks(title, end_date, student_ids)
        `)
        .eq('pending_reschedule', true)
        .eq('status', 'cancelled')
        .order('source_break_id')
        .order('date');
      if (err) throw err;
      setLessons((data as unknown as PendingLesson[]) || []);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch pending reschedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLessons(); }, [fetchLessons]);

  async function reschedule(lessonId: string, newDate: string, newTime: string): Promise<void> {
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) throw new Error('Lesson not found');

    const { data: makeup, error: insertErr } = await supabase
      .from('lessons')
      .insert({
        teacher_id: lesson.teacher_id,
        instrument_id: lesson.instrument_id,
        location_id: lesson.location_id,
        title: lesson.title,
        lesson_type: 'makeup' as LessonType,
        date: newDate,
        start_time: newTime,
        status: 'scheduled' as LessonStatus,
        is_charged: false,
      })
      .select('id')
      .single();
    if (insertErr) throw insertErr;

    if (lesson.students.length > 0) {
      await supabase.from('lesson_students').insert(
        lesson.students.map(s => ({ lesson_id: makeup!.id, student_id: s.student_id }))
      );
    }

    await supabase.from('lessons').update({ pending_reschedule: false }).eq('id', lessonId);

    if (lesson.source_break_id) {
      const { data: brk } = await supabase
        .from('scheduled_breaks')
        .select('total_rescheduled')
        .eq('id', lesson.source_break_id)
        .single();
      if (brk) {
        await supabase
          .from('scheduled_breaks')
          .update({ total_rescheduled: brk.total_rescheduled + 1 })
          .eq('id', lesson.source_break_id);
      }
    }

    await fetchLessons();
  }

  async function autoRescheduleBreak(breakId: string): Promise<AutoReschedulePreviewItem[]> {
    const breakLessons = lessons.filter(l => l.source_break_id === breakId);
    if (breakLessons.length === 0) return [];

    const breakEndDate = breakLessons[0].break.end_date;
    const windowEnd = toDateStr(addDays(new Date(breakEndDate + 'T00:00'), 52 * 7));

    const teacherIds = [...new Set(breakLessons.map(l => l.teacher_id))];
    const teacherSlotsMap = new Map<string, Set<string>>();

    for (const tid of teacherIds) {
      const { data } = await supabase
        .from('lessons')
        .select('date, start_time')
        .eq('teacher_id', tid)
        .gt('date', breakEndDate)
        .lte('date', windowEnd)
        .neq('status', 'cancelled');
      const set = new Set<string>((data || []).map((l: any) => `${l.date}|${l.start_time}`));
      teacherSlotsMap.set(tid, set);
    }

    return breakLessons.map(lesson => {
      const targetDow = new Date(lesson.date + 'T00:00').getDay();
      const takenSlots = teacherSlotsMap.get(lesson.teacher_id) ?? new Set<string>();
      let candidate = nextDayOfWeek(new Date(breakEndDate + 'T00:00'), targetDow);

      for (let i = 0; i < 52; i++) {
        const dateStr = toDateStr(candidate);
        const key = `${dateStr}|${lesson.start_time}`;
        if (!takenSlots.has(key)) {
          takenSlots.add(key);
          return { original: lesson, newDate: dateStr, newTime: lesson.start_time, found: true };
        }
        candidate = addDays(candidate, 7);
      }

      return { original: lesson, newDate: '', newTime: '', found: false };
    });
  }

  async function confirmAutoReschedule(preview: AutoReschedulePreviewItem[]): Promise<void> {
    const toSchedule = preview.filter(p => p.found);
    if (toSchedule.length === 0) return;

    const { data: insertedLessons, error: insertErr } = await supabase
      .from('lessons')
      .insert(toSchedule.map(p => ({
        teacher_id: p.original.teacher_id,
        instrument_id: p.original.instrument_id,
        location_id: p.original.location_id,
        title: p.original.title,
        lesson_type: 'makeup' as LessonType,
        date: p.newDate,
        start_time: p.newTime,
        status: 'scheduled' as LessonStatus,
        is_charged: false,
      })))
      .select('id');
    if (insertErr) throw insertErr;

    const lessonStudents = (insertedLessons || []).flatMap((ml, i) =>
      toSchedule[i].original.students.map(s => ({ lesson_id: ml.id, student_id: s.student_id }))
    );
    if (lessonStudents.length > 0) {
      await supabase.from('lesson_students').insert(lessonStudents);
    }

    await supabase
      .from('lessons')
      .update({ pending_reschedule: false })
      .in('id', toSchedule.map(p => p.original.id));

    const breakId = toSchedule[0].original.source_break_id;
    const { data: brk } = await supabase
      .from('scheduled_breaks')
      .select('total_rescheduled')
      .eq('id', breakId)
      .single();
    if (brk) {
      await supabase
        .from('scheduled_breaks')
        .update({ total_rescheduled: brk.total_rescheduled + toSchedule.length })
        .eq('id', breakId);
    }

    await fetchLessons();
  }

  return { lessons, loading, error, refresh: fetchLessons, reschedule, autoRescheduleBreak, confirmAutoReschedule };
}
```

- [ ] **Step 3: TypeScript build check**

```
cd web && npm run build
```

Expected: no type errors related to new types or hook.

- [ ] **Step 4: Commit**

```bash
git add web/src/types/index.ts web/src/hooks/usePendingReschedules.ts
git commit -m "feat: add pending reschedule types and usePendingReschedules hook"
```

---

### Task 2: `PendingRescheduleList` component

**Files:**
- Create: `web/src/components/PendingRescheduleList.tsx`

- [ ] **Step 1: Create `web/src/components/PendingRescheduleList.tsx`**

```tsx
import React from 'react';
import { ChevronRight, Zap, Loader2 } from 'lucide-react';
import type { PendingLesson } from '../types';

interface BreakGroup {
  breakId: string;
  breakTitle: string;
  isSchoolWide: boolean;
  lessons: PendingLesson[];
}

interface Props {
  lessons: PendingLesson[];
  selectedLessonId: string | null;
  onSelectLesson: (lesson: PendingLesson) => void;
  onAutoReschedule: (breakId: string) => void;
  autoRescheduleLoadingId: string | null;
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatOriginalDate(date: string, startTime: string): string {
  const d = new Date(date + 'T00:00');
  const formatted = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${DAY_SHORT[d.getDay()]} ${formatted} · ${startTime.slice(0, 5)}`;
}

export function PendingRescheduleList({
  lessons,
  selectedLessonId,
  onSelectLesson,
  onAutoReschedule,
  autoRescheduleLoadingId,
}: Props) {
  const groups: BreakGroup[] = [];
  const seen = new Map<string, BreakGroup>();

  for (const lesson of lessons) {
    const key = lesson.source_break_id;
    if (!seen.has(key)) {
      const group: BreakGroup = {
        breakId: key,
        breakTitle: lesson.break.title,
        isSchoolWide: lesson.break.student_ids.length === 0,
        lessons: [],
      };
      seen.set(key, group);
      groups.push(group);
    }
    seen.get(key)!.lessons.push(lesson);
  }

  return (
    <div className="space-y-4 overflow-y-auto">
      {groups.map(group => (
        <div key={group.breakId} className="border border-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-100">
            <span className="text-base">{group.isSchoolWide ? '🏫' : '👤'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-navy truncate">{group.breakTitle}</p>
              <p className="text-xs text-gray-500">
                {group.isSchoolWide ? 'School-wide' : 'Individual'} · {group.lessons.length} pending
              </p>
            </div>
          </div>

          <div className="divide-y divide-gray-100 bg-gray-50">
            {group.lessons.map(lesson => {
              const studentName = lesson.students[0]?.student?.full_name ?? 'Unknown Student';
              const extraStudents = lesson.students.length - 1;
              const isSelected = selectedLessonId === lesson.id;

              return (
                <button
                  key={lesson.id}
                  onClick={() => onSelectLesson(lesson)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white ${
                    isSelected ? 'bg-white border-l-2 border-teal' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-navy">
                      {studentName}
                      {extraStudents > 0 && <span className="text-gray-400 font-normal"> +{extraStudents}</span>}
                      <span className="text-gray-400 font-normal"> — {lesson.teacher.full_name}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {lesson.instrument ? `${lesson.instrument.icon ?? ''} ${lesson.instrument.name} · ` : ''}
                      {formatOriginalDate(lesson.date, lesson.start_time)}
                    </p>
                  </div>
                  <ChevronRight size={14} className={isSelected ? 'text-teal flex-shrink-0' : 'text-gray-300 flex-shrink-0'} />
                </button>
              );
            })}
          </div>

          <div className="px-4 py-3 bg-white border-t border-gray-100">
            <button
              onClick={() => onAutoReschedule(group.breakId)}
              disabled={autoRescheduleLoadingId === group.breakId}
              className="flex items-center gap-2 text-xs font-semibold text-teal hover:text-teal/80 disabled:opacity-50"
            >
              {autoRescheduleLoadingId === group.breakId
                ? <Loader2 size={12} className="animate-spin" />
                : <Zap size={12} />}
              Auto-Reschedule After Break
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript build check**

```
cd web && npm run build
```

Expected: no errors from `PendingRescheduleList.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/PendingRescheduleList.tsx
git commit -m "feat: add PendingRescheduleList component"
```

---

### Task 3: `ReschedulerCalendar` component

**Files:**
- Create: `web/src/components/ReschedulerCalendar.tsx`

- [ ] **Step 1: Create `web/src/components/ReschedulerCalendar.tsx`**

```tsx
import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { PendingLesson } from '../types';

interface Props {
  lesson: PendingLesson | null;
  onDateSelect: (date: string) => void;
}

const DAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildCalendarGrid(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstDow = (firstDay.getDay() + 6) % 7; // Mon=0 ... Sun=6

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export function ReschedulerCalendar({ lesson, onDateSelect }: Props) {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [lessonDates, setLessonDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!lesson) { setLessonDates(new Set()); return; }
    const monthStart = toDateStr(month);
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const monthEnd = toDateStr(lastDay);

    supabase
      .from('lessons')
      .select('date')
      .eq('teacher_id', lesson.teacher_id)
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .neq('status', 'cancelled')
      .then(({ data }) => {
        setLessonDates(new Set((data || []).map((l: any) => l.date)));
      });
  }, [lesson?.teacher_id, month]);

  const todayStr = toDateStr(today);
  const rows = buildCalendarGrid(month.getFullYear(), month.getMonth());
  const monthLabel = month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  if (!lesson) {
    return (
      <div className="flex items-center justify-center min-h-[200px] bg-white rounded-xl border border-gray-100 p-4">
        <p className="text-sm text-gray-400">Select a lesson to see teacher availability</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs font-medium text-gray-500 mb-3">
        {lesson.teacher.full_name} · {lesson.students[0]?.student?.full_name ?? ''}
      </p>

      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="p-1 hover:bg-gray-100 rounded-lg">
          <ChevronLeft size={16} className="text-gray-500" />
        </button>
        <span className="text-sm font-semibold text-navy">{monthLabel}</span>
        <button onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="p-1 hover:bg-gray-100 rounded-lg">
          <ChevronRight size={16} className="text-gray-500" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map(h => (
          <div key={h} className="text-center text-xs font-medium text-gray-400 py-1">{h}</div>
        ))}
      </div>

      <div className="space-y-1">
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-7">
            {row.map((date, ci) => {
              if (!date) return <div key={ci} />;
              const dateStr = toDateStr(date);
              const isPast = dateStr < todayStr;
              const hasLesson = lessonDates.has(dateStr);
              const isToday = dateStr === todayStr;

              return (
                <button
                  key={ci}
                  onClick={() => !isPast && onDateSelect(dateStr)}
                  disabled={isPast}
                  className={`relative flex flex-col items-center justify-center py-1.5 rounded-lg text-sm transition-colors
                    ${isPast ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-teal/10 cursor-pointer text-navy'}
                    ${isToday ? 'font-bold text-teal' : ''}
                  `}
                >
                  <span>{date.getDate()}</span>
                  {hasLesson && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-coral" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="inline-block w-2 h-2 rounded-full bg-coral" />
          Existing lesson
        </div>
        <span className="text-xs text-gray-400">Click any future date to reschedule</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript build check**

```
cd web && npm run build
```

Expected: no errors from `ReschedulerCalendar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ReschedulerCalendar.tsx
git commit -m "feat: add ReschedulerCalendar component"
```

---

### Task 4: `RescheduleModal` component

**Files:**
- Create: `web/src/components/RescheduleModal.tsx`

- [ ] **Step 1: Create `web/src/components/RescheduleModal.tsx`**

```tsx
import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { PendingLesson } from '../types';

interface Props {
  lesson: PendingLesson;
  date: string; // YYYY-MM-DD — pre-filled from calendar click
  onClose: () => void;
  onConfirm: (lessonId: string, newDate: string, newTime: string) => Promise<void>;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function RescheduleModal({ lesson, date, onClose, onConfirm }: Props) {
  const [time, setTime] = useState(lesson.start_time.slice(0, 5)); // HH:MM:SS → HH:MM for <input type="time">
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const studentName = lesson.students[0]?.student?.full_name ?? 'Unknown';
  const extraStudents = lesson.students.length - 1;

  const originalDate = new Date(lesson.date + 'T00:00');
  const originalLabel = `${DAY_NAMES[originalDate.getDay()]} ${originalDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${lesson.start_time.slice(0, 5)}`;

  const newDateObj = new Date(date + 'T00:00');
  const newDateLabel = `${DAY_NAMES[newDateObj.getDay()]} ${newDateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  async function handleConfirm() {
    if (!time) { setError('Please set a time'); return; }
    setLoading(true);
    setError(null);
    try {
      await onConfirm(lesson.id, date, time + ':00'); // append seconds for DB
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to reschedule');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-navy">Reschedule Lesson</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-navy"><X size={18} /></button>
        </div>

        <div className="space-y-3 mb-5">
          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Student</span>
              <span className="font-medium text-navy">
                {studentName}{extraStudents > 0 && <span className="text-gray-400"> +{extraStudents}</span>}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Teacher</span>
              <span className="font-medium text-navy">{lesson.teacher.full_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Original</span>
              <span className="text-gray-600">{originalLabel}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">New Date</label>
            <div className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-navy bg-gray-50">
              {newDateLabel}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">New Time</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Makeup'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript build check**

```
cd web && npm run build
```

Expected: no errors from `RescheduleModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/RescheduleModal.tsx
git commit -m "feat: add RescheduleModal component"
```

---

### Task 5: Wire `Breaks.tsx` — pending section + auto-reschedule preview modal

**Files:**
- Modify: `web/src/pages/Breaks.tsx` (complete rewrite — all existing logic preserved, new section added)

- [ ] **Step 1: Replace full content of `web/src/pages/Breaks.tsx`**

```tsx
import React, { useState, useEffect } from 'react';
import { CalendarOff, Plus, X, AlertTriangle, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { useBreaks } from '../hooks/useBreaks';
import { usePendingReschedules } from '../hooks/usePendingReschedules';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { PendingRescheduleList } from '../components/PendingRescheduleList';
import { ReschedulerCalendar } from '../components/ReschedulerCalendar';
import { RescheduleModal } from '../components/RescheduleModal';
import type { Student, PendingLesson, AutoReschedulePreviewItem } from '../types';

export function BreaksPage() {
  const { profile } = useAuth();
  const { breaks, pendingRescheduleCount, loading, createBreak, previewBreak, fetchBreaks } = useBreaks();
  const {
    lessons: pendingLessons,
    loading: pendingLoading,
    error: pendingError,
    reschedule,
    autoRescheduleBreak,
    confirmAutoReschedule,
  } = usePendingReschedules();

  const [showForm, setShowForm] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [allStudents, setAllStudents] = useState(true);
  const [preview, setPreview] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [showPendingSection, setShowPendingSection] = useState(true);

  const [form, setForm] = useState({
    title: '', start_date: '', end_date: '', student_ids: [] as string[],
  });

  // Pending reschedule UI state
  const [selectedLesson, setSelectedLesson] = useState<PendingLesson | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string | null>(null);
  const [autoPreview, setAutoPreview] = useState<AutoReschedulePreviewItem[] | null>(null);
  const [autoRescheduleLoadingId, setAutoRescheduleLoadingId] = useState<string | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    supabase.from('students').select('*').eq('is_active', true).order('full_name')
      .then(({ data }) => setStudents((data as Student[]) || []));
  }, []);

  const handlePreview = async () => {
    const ids = allStudents ? [] : form.student_ids;
    const count = await previewBreak(form.start_date, form.end_date, ids);
    setPreview(count);
  };

  const handleCreate = async () => {
    if (!profile?.id) return;
    setCreating(true);
    try {
      const ids = allStudents ? [] : form.student_ids;
      const result = await createBreak({
        title: form.title,
        start_date: form.start_date,
        end_date: form.end_date,
        student_ids: ids,
        created_by: profile.id,
      });
      alert(`Break created. ${result.cancelled} lessons cancelled and marked for reschedule.`);
      setShowForm(false);
      setForm({ title: '', start_date: '', end_date: '', student_ids: [] });
      setPreview(null);
    } catch (err: any) {
      alert(err.message);
    }
    setCreating(false);
  };

  async function handleAutoReschedule(breakId: string) {
    setAutoRescheduleLoadingId(breakId);
    setAutoError(null);
    try {
      const result = await autoRescheduleBreak(breakId);
      setAutoPreview(result);
    } catch (e: any) {
      setAutoError(e.message || 'Failed to compute auto-reschedule');
    } finally {
      setAutoRescheduleLoadingId(null);
    }
  }

  async function handleConfirmAutoReschedule() {
    if (!autoPreview) return;
    setConfirmLoading(true);
    setAutoError(null);
    try {
      await confirmAutoReschedule(autoPreview);
      await fetchBreaks();
      setAutoPreview(null);
    } catch (e: any) {
      setAutoError(e.message || 'Failed to create makeup lessons');
    } finally {
      setConfirmLoading(false);
    }
  }

  async function handleManualReschedule(lessonId: string, newDate: string, newTime: string) {
    await reschedule(lessonId, newDate, newTime);
    await fetchBreaks();
  }

  const scheduledCount = autoPreview ? autoPreview.filter(p => p.found).length : 0;
  const autoPreviewBreakTitle = autoPreview?.[0]?.original.break.title ?? '';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Breaks</h1>
          <p className="text-gray-500 text-sm mt-1">Schedule holiday breaks and track rescheduling</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-coral text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90">
          <Plus size={16} /> New Break
        </button>
      </div>

      {pendingRescheduleCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-700">{pendingRescheduleCount} lessons pending reschedule</p>
            <p className="text-xs text-amber-600">Use the Pending Reschedules section below to create makeup lessons.</p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center text-gray-400 py-12">Loading...</p>
      ) : breaks.length === 0 ? (
        <div className="text-center py-16">
          <CalendarOff size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No breaks scheduled yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {breaks.map((brk) => {
            const pct = brk.total_cancelled > 0 ? Math.round((brk.total_rescheduled / brk.total_cancelled) * 100) : 0;
            const pendingForBreak = brk.total_cancelled - brk.total_rescheduled;
            return (
              <div key={brk.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-navy">{brk.title}</h3>
                  <span className="text-xs text-gray-500">
                    {new Date(brk.start_date + 'T00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                    {' — '}
                    {new Date(brk.end_date + 'T00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-500">{brk.total_cancelled} cancelled</span>
                  <span className="text-teal font-medium">{brk.total_rescheduled} rescheduled</span>
                  <span className="text-coral font-medium">{pendingForBreak} pending</span>
                  {pendingForBreak > 0 && (
                    <button
                      onClick={() => handleAutoReschedule(brk.id)}
                      disabled={autoRescheduleLoadingId === brk.id}
                      className="ml-auto text-xs text-teal font-semibold hover:underline disabled:opacity-50"
                    >
                      Auto-Reschedule
                    </button>
                  )}
                </div>
                <div className="mt-2 w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-teal rounded-full h-2 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending Reschedules section */}
      {pendingRescheduleCount > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowPendingSection(s => !s)}
            className="flex items-center gap-2 w-full text-left mb-4"
          >
            <h2 className="text-lg font-bold text-navy">Pending Reschedules ({pendingRescheduleCount})</h2>
            {showPendingSection
              ? <ChevronUp size={18} className="text-gray-400" />
              : <ChevronDown size={18} className="text-gray-400" />}
          </button>

          {showPendingSection && (
            pendingLoading ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : pendingError ? (
              <p className="text-sm text-red-500">{pendingError}</p>
            ) : pendingLessons.length === 0 ? (
              <p className="text-sm text-gray-400">No pending reschedules.</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
                <div className="lg:col-span-2">
                  <PendingRescheduleList
                    lessons={pendingLessons}
                    selectedLessonId={selectedLesson?.id ?? null}
                    onSelectLesson={(lesson) => {
                      setSelectedLesson(lesson);
                      setRescheduleDate(null);
                    }}
                    onAutoReschedule={handleAutoReschedule}
                    autoRescheduleLoadingId={autoRescheduleLoadingId}
                  />
                </div>
                <div className="lg:col-span-3">
                  <ReschedulerCalendar
                    lesson={selectedLesson}
                    onDateSelect={(date) => setRescheduleDate(date)}
                  />
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Manual reschedule modal */}
      {selectedLesson && rescheduleDate && (
        <RescheduleModal
          lesson={selectedLesson}
          date={rescheduleDate}
          onClose={() => setRescheduleDate(null)}
          onConfirm={async (lessonId, newDate, newTime) => {
            await handleManualReschedule(lessonId, newDate, newTime);
            setRescheduleDate(null);
            setSelectedLesson(null);
          }}
        />
      )}

      {/* Auto-reschedule preview modal */}
      {autoPreview && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h3 className="font-semibold text-navy">Auto-Reschedule: {autoPreviewBreakTitle}</h3>
              <button onClick={() => { setAutoPreview(null); setAutoError(null); }} className="text-gray-400 hover:text-navy">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 mb-5 overflow-y-auto flex-1">
              {autoPreview.map((item, i) => {
                const studentName = item.original.students[0]?.student?.full_name ?? 'Unknown';
                const origDate = new Date(item.original.date + 'T00:00')
                  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                return (
                  <div key={i} className={`flex items-center gap-3 text-sm px-3 py-2 rounded-lg ${item.found ? 'bg-teal/5' : 'bg-amber-50'}`}>
                    <span className={item.found ? 'text-teal' : 'text-amber-500'}>{item.found ? '✓' : '⚠'}</span>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-navy">{studentName}</span>
                      <span className="text-gray-400"> · orig {origDate}</span>
                    </div>
                    {item.found
                      ? <span className="text-gray-600 text-xs flex-shrink-0">
                          → {new Date(item.newDate + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                      : <span className="text-amber-600 text-xs flex-shrink-0">no slot — reschedule manually</span>
                    }
                  </div>
                );
              })}
            </div>

            {autoError && <p className="text-xs text-red-500 mb-3 flex-shrink-0">{autoError}</p>}

            <div className="flex gap-3 flex-shrink-0">
              <button
                onClick={() => { setAutoPreview(null); setAutoError(null); }}
                className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAutoReschedule}
                disabled={confirmLoading || scheduledCount === 0}
                className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
              >
                {confirmLoading ? 'Creating...' : `Confirm & Create ${scheduledCount} Lesson${scheduledCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create break modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy text-lg">Schedule Break</h3>
              <button onClick={() => { setShowForm(false); setPreview(null); }} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="May Holiday Break" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                  <input type="date" value={form.start_date} onChange={(e) => { setForm({ ...form, start_date: e.target.value }); setPreview(null); }}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
                  <input type="date" value={form.end_date} onChange={(e) => { setForm({ ...form, end_date: e.target.value }); setPreview(null); }}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm mb-2">
                  <input type="checkbox" checked={allStudents} onChange={(e) => setAllStudents(e.target.checked)} className="accent-teal" />
                  <span className="font-medium text-navy">All students</span>
                </label>
                {!allStudents && (
                  <div className="border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
                    {students.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={form.student_ids.includes(s.id)}
                          onChange={(e) => setForm({
                            ...form,
                            student_ids: e.target.checked ? [...form.student_ids, s.id] : form.student_ids.filter((id) => id !== s.id)
                          })} className="accent-teal" />
                        {s.full_name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {preview !== null && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                  <p className="font-semibold text-amber-700">{preview} lessons will be cancelled</p>
                  <p className="text-xs text-amber-600 mt-0.5">These will be marked as pending reschedule.</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                {preview === null ? (
                  <button onClick={handlePreview} disabled={!form.title || !form.start_date || !form.end_date}
                    className="flex-1 flex items-center justify-center gap-2 bg-amber-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-500/90 disabled:opacity-50">
                    <Eye size={16} /> Preview
                  </button>
                ) : (
                  <button onClick={handleCreate} disabled={creating}
                    className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90 disabled:opacity-50">
                    {creating ? 'Creating...' : 'Cancel & Mark for Reschedule'}
                  </button>
                )}
                <button onClick={() => { setShowForm(false); setPreview(null); }}
                  className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript build check**

```
cd web && npm run build
```

Expected: clean build, no type errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Breaks.tsx
git commit -m "feat: wire pending reschedules section and auto-reschedule preview into Breaks page"
```

---

### Task 6: Remove `linkReschedule` from `useBreaks.ts`

**Files:**
- Modify: `web/src/hooks/useBreaks.ts`

- [ ] **Step 1: Remove `linkReschedule` function and its return**

Delete lines 94–124 (the entire `linkReschedule` async function):

```ts
// DELETE this entire function:
async function linkReschedule(pendingLessonId: string) {
  const { data: lesson } = await supabase
    .from('lessons')
    .select('source_break_id')
    .eq('id', pendingLessonId)
    .single();

  await supabase
    .from('lessons')
    .update({ pending_reschedule: false })
    .eq('id', pendingLessonId);

  if (lesson?.source_break_id) {
    const { data: brk } = await supabase
      .from('scheduled_breaks')
      .select('total_rescheduled')
      .eq('id', lesson.source_break_id)
      .single();
    if (brk) {
      await supabase
        .from('scheduled_breaks')
        .update({ total_rescheduled: brk.total_rescheduled + 1 })
        .eq('id', lesson.source_break_id);
    }
  }

  await fetchBreaks();
}
```

Change the return on the last line from:
```ts
return { breaks, pendingRescheduleCount, loading, fetchBreaks, createBreak, previewBreak, linkReschedule };
```
to:
```ts
return { breaks, pendingRescheduleCount, loading, fetchBreaks, createBreak, previewBreak };
```

The complete file after the change:

```ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ScheduledBreak } from '../types';

export function useBreaks() {
  const [breaks, setBreaks] = useState<ScheduledBreak[]>([]);
  const [pendingRescheduleCount, setPendingRescheduleCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchBreaks = useCallback(async () => {
    setLoading(true);
    const [breaksRes, countRes] = await Promise.all([
      supabase.from('scheduled_breaks').select('*').order('start_date', { ascending: false }),
      supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('pending_reschedule', true),
    ]);
    setBreaks((breaksRes.data as ScheduledBreak[]) || []);
    setPendingRescheduleCount(countRes.count || 0);
    setLoading(false);
  }, []);

  useEffect(() => { fetchBreaks(); }, [fetchBreaks]);

  async function createBreak(data: {
    title: string;
    start_date: string;
    end_date: string;
    student_ids: string[];
    created_by: string;
  }) {
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, students:lesson_students(student_id)')
      .gte('date', data.start_date)
      .lte('date', data.end_date)
      .eq('status', 'scheduled');

    const affectedLessons = (lessons || []).filter((l: any) => {
      if (data.student_ids.length === 0) return true;
      return l.students?.some((s: any) => data.student_ids.includes(s.student_id));
    });

    const { data: breakRecord, error: breakErr } = await supabase
      .from('scheduled_breaks')
      .insert({
        created_by: data.created_by,
        title: data.title,
        start_date: data.start_date,
        end_date: data.end_date,
        student_ids: data.student_ids,
        total_cancelled: affectedLessons.length,
        total_rescheduled: 0,
      })
      .select()
      .single();
    if (breakErr) throw breakErr;

    if (affectedLessons.length > 0) {
      const ids = affectedLessons.map((l: any) => l.id);
      await supabase
        .from('lessons')
        .update({
          status: 'cancelled',
          pending_reschedule: true,
          source_break_id: breakRecord.id,
          cancelled_by_role: 'coordinator',
          cancelled_by_user_id: data.created_by,
        })
        .in('id', ids);
    }

    await fetchBreaks();
    return { cancelled: affectedLessons.length };
  }

  async function previewBreak(startDate: string, endDate: string, studentIds: string[]) {
    const { data: lessons } = await supabase
      .from('lessons')
      .select('id, students:lesson_students(student_id)')
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('status', 'scheduled');

    const affected = (lessons || []).filter((l: any) => {
      if (studentIds.length === 0) return true;
      return l.students?.some((s: any) => studentIds.includes(s.student_id));
    });
    return affected.length;
  }

  return { breaks, pendingRescheduleCount, loading, fetchBreaks, createBreak, previewBreak };
}
```

- [ ] **Step 2: TypeScript build check**

```
cd web && npm run build
```

Expected: clean build. Confirm no "linkReschedule is not exported" errors (it was only used internally and is now removed entirely).

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useBreaks.ts
git commit -m "refactor: remove linkReschedule from useBreaks (superseded by usePendingReschedules)"
```

---

### Task 7: Manual verification via dev server

**Files:** None (read-only verification)

- [ ] **Step 1: Start dev server**

```
cd web && npm run dev
```

Open browser at `http://localhost:5173` (or the port Vite reports). Log in as coordinator/admin.

- [ ] **Step 2: Verify pending reschedule section appears**

Navigate to the Breaks page. If there are pending lessons, verify:
- Amber banner at top says "Use the Pending Reschedules section below…" (not "Schedule page")
- "Pending Reschedules (N)" collapsible section appears at bottom
- Toggle chevron collapses/expands section

- [ ] **Step 3: Verify lesson list grouping**

In the left panel:
- Lessons are grouped by break with break title header
- School-wide breaks show 🏫 badge; individual breaks show 👤 badge
- Each lesson row shows student name, teacher name, instrument, original date/time
- Clicking a row selects it (highlighted with teal left border)

- [ ] **Step 4: Verify calendar panel**

After selecting a lesson:
- Right panel shows teacher name + student name header
- Month calendar renders with Mo–Su headers
- Past dates are greyed/disabled
- Red dots appear on days the teacher already has lessons
- Month nav (◄ ►) changes month and re-fetches teacher lessons

- [ ] **Step 5: Verify manual reschedule flow**

1. Select a lesson in left panel
2. Click a future date with no red dot in the calendar
3. RescheduleModal opens: shows student, teacher, original date/time, pre-fills New Time from original lesson
4. Change the time, click "Create Makeup"
5. Verify modal closes, pending lesson disappears from left panel, amber banner count decreases

- [ ] **Step 6: Verify auto-reschedule flow**

1. Click "Auto-Reschedule After Break" in left panel break footer (or "Auto-Reschedule" button on break card at top)
2. Preview modal opens — lists each pending lesson with computed new date, or ⚠ if no slot found
3. Click "Confirm & Create N Lessons"
4. Modal closes, rescheduled lessons disappear from pending list, break card progress bar updates

- [ ] **Step 7: Verify break type handling**

If a school-wide break exists (check DB: `student_ids = '{}'`), verify 🏫 badge shows and ALL cancelled lessons for that break appear. If only individual breaks exist, verify 👤 badge.

- [ ] **Step 8: Commit verification note**

```bash
git commit --allow-empty -m "verify: break reschedule UI manually confirmed working"
```
