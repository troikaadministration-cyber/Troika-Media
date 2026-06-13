# Break Reschedule UI — Design Spec

**Date:** 2026-06-13
**Status:** Approved

## Problem

When a break is created, affected lessons are cancelled and marked `pending_reschedule=true`. There is no UI to act on these — the admin sees a count banner but has no way to reschedule from within the app.

## Goal

Add a "Pending Reschedules" section to the Breaks page with:
1. A structured list of all pending lessons grouped by break
2. A per-lesson manual reschedule flow (pick date + time → create makeup lesson)
3. A per-break "Auto-Reschedule After Break" bulk action (same day/time slot, first free date after break ends, skip conflicts)

---

## Architecture

### New Files

| File | Responsibility |
|------|----------------|
| `web/src/hooks/usePendingReschedules.ts` | Fetch pending lessons with all joins; expose `reschedule()` and `autoRescheduleBreak()` |
| `web/src/components/PendingRescheduleList.tsx` | Left panel — pending lessons grouped by break |
| `web/src/components/ReschedulerCalendar.tsx` | Right panel — teacher's month calendar, click a date to trigger reschedule modal |
| `web/src/components/RescheduleModal.tsx` | Time picker + confirm → calls `reschedule()` |

### Modified Files

| File | Change |
|------|--------|
| `web/src/pages/Breaks.tsx` | Add "Pending Reschedules" collapsible section at bottom, visible only when `pendingRescheduleCount > 0` |
| `web/src/hooks/useBreaks.ts` | Remove `linkReschedule()` (replaced by `usePendingReschedules`) |

---

## Break Types

Two break types exist, distinguished by `student_ids` on `scheduled_breaks`:

| Type | `student_ids` | Meaning |
|------|--------------|---------|
| School-wide | `[]` (empty) | All students affected |
| Individual | `[id, ...]` | Only listed students affected |

Both types cancel lessons and set `pending_reschedule=true` with `source_break_id` linked. The reschedule UI handles both — grouping is by `source_break_id` regardless of break type. School-wide breaks may produce many more pending lessons.

**Break card header distinguishes type:**
- School-wide: "🏫 School Break — Summer Holidays (12 lessons pending)"
- Individual: "👤 Student Break — John Smith — May Holiday (3 lessons pending)"

`is_school_wide` is derived at render time: `break.student_ids.length === 0`

---

## Data Fetching

### `usePendingReschedules()` — `web/src/hooks/usePendingReschedules.ts`

**Query:**
```sql
SELECT lessons.*,
       lesson_students.student_id, students.full_name as student_name,
       profiles.full_name as teacher_name,
       instruments.name as instrument_name, instruments.icon,
       scheduled_breaks.title as break_title, scheduled_breaks.end_date as break_end_date
FROM lessons
JOIN lesson_students ON lesson_students.lesson_id = lessons.id
JOIN students ON students.id = lesson_students.student_id
JOIN profiles ON profiles.id = lessons.teacher_id
LEFT JOIN instruments ON instruments.id = lessons.instrument_id
LEFT JOIN scheduled_breaks ON scheduled_breaks.id = lessons.source_break_id
WHERE lessons.pending_reschedule = true
  AND lessons.status = 'cancelled'
ORDER BY lessons.source_break_id, lessons.date
```

Supabase client form:
```ts
supabase.from('lessons')
  .select(`
    *,
    students:lesson_students(student_id, student:students(full_name)),
    teacher:profiles!lessons_teacher_id_fkey(full_name),
    instrument:instruments(name, icon),
    break:scheduled_breaks(title, end_date, student_ids)
  `)
  .eq('pending_reschedule', true)
  .eq('status', 'cancelled')
  .order('source_break_id')
  .order('date')
```

`break.student_ids` is included so UI can derive `is_school_wide = break.student_ids.length === 0` for the break type badge.

### ReschedulerCalendar data

Fetch teacher's lessons for the displayed month:
```ts
supabase.from('lessons')
  .select('id, date, start_time, title, status')
  .eq('teacher_id', teacherId)
  .gte('date', monthStart)
  .lte('date', monthEnd)
  .neq('status', 'cancelled')
```

---

## Actions

### `reschedule(lessonId, newDate, newTime)` — manual reschedule

1. Fetch original lesson: `teacher_id`, `instrument_id`, `location_id`, `title`, `source_break_id`
2. Fetch original lesson's students from `lesson_students`
3. `INSERT lessons` → `{ lesson_type: 'makeup', teacher_id, instrument_id, location_id, title, date: newDate, start_time: newTime, status: 'scheduled' }`
4. `INSERT lesson_students` for each student
5. `UPDATE lessons SET pending_reschedule=false WHERE id=lessonId`
6. `UPDATE scheduled_breaks SET total_rescheduled=total_rescheduled+1 WHERE id=source_break_id`
7. Refresh pending list

### `autoRescheduleBreak(breakId)` — bulk auto-reschedule

1. Fetch all pending lessons for `source_break_id=breakId` (with `day_of_week` derived from lesson `date`, `start_time`, `teacher_id`, `source_break_id`)
2. Fetch `break.end_date`
3. For each pending lesson:
   - Compute `day_of_week = new Date(lesson.date).getDay()`
   - Starting from `break.end_date + 1 day`, walk forward week-by-week (same `day_of_week`, +7 days each iteration)
   - For each candidate date: check if teacher already has a lesson with `date=candidate AND start_time=lesson.start_time AND status != 'cancelled'`
   - Take first conflict-free candidate (max 52 weeks look-ahead to avoid infinite loop)
4. Build preview: `[{ original: lesson, newDate, newTime }]` — return to UI for confirmation
5. On confirm: batch INSERT makeup lessons + batch UPDATE pending_reschedule=false + UPDATE break total_rescheduled

**Preview step:** `autoRescheduleBreak` returns a preview array before committing. A separate `confirmAutoReschedule(preview)` executes the writes. This lets the UI show "3 lessons will be rescheduled on Jul 7, Jul 14, Jul 21 — Confirm?" before any changes.

---

## UI Flow

```
Breaks Page
├── [existing break cards with Auto-Reschedule button added per card]
│
└── ── Pending Reschedules (N) ─────────────────────────────────────
    │
    │  LEFT PANEL (40%)              RIGHT PANEL (60%)
    │  ──────────────────────        ───────────────────────────────
    │  [Break: May Holiday]          (select a lesson to see calendar)
    │   • John — Ms. Noah
    │     🎹 Piano · Mon 4pm         When lesson selected:
    │     Original: May 12  [→]  ──► Teacher: Ms. Noah
    │   • Sara — Ms. Noah            ◄  June 2026  ►
    │     🎻 Violin · Wed 5pm        Mo Tu We Th Fr Sa Su
    │     Original: May 14  [→]       1  2  3  4  5  6  7
    │                                 8  9 [10]11 12 13 14
    │  [Break: Summer Break]         ← existing lesson dots
    │   • John — Mr. Kay             ← click empty date →
    │     🎹 Piano · Mon 4pm
    │     Original: Jun 3   [→]      ┌─ Reschedule Lesson ───────┐
    │                                │ Student: John              │
    │  ─────────────────────         │ Teacher: Ms. Noah          │
    │  Each break footer:            │ Original: Mon May 12, 4pm  │
    │  [Auto-Reschedule After Break] │ New Date: Tue Jun 10       │
    │                                │ New Time: [04:00 PM]       │
    │                                │ [Cancel]  [Create Makeup]  │
    │                                └────────────────────────────┘
    └────────────────────────────────────────────────────────────────
```

**Calendar legend:**
- Filled dot = existing lesson on that day
- Greyed date = past date (not selectable)
- Clicked date = opens RescheduleModal with date pre-filled, admin sets time

**Auto-Reschedule preview modal** (triggered by per-break button):
```
Auto-Reschedule: May Holiday Break

The following makeup lessons will be created:
  • John (Piano, Mon 4pm)  → Mon Jul 7
  • Sara (Violin, Wed 5pm) → Wed Jul 9
  ⚠ John (Piano, Mon 4pm, Jun 3) → no slot found within 52 weeks

[Cancel]  [Confirm & Create X Lessons]
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| School-wide break | `break.student_ids = []` → show 🏫 badge, list all students' lessons grouped under that break |
| Individual break | `break.student_ids.length > 0` → show 👤 badge with student name(s) |
| School-wide break, many lessons | Same auto-reschedule logic — each lesson resolved independently, may take longer |
| No free slot within 52 weeks | Show in auto-reschedule preview as "⚠ no slot found — reschedule manually" |
| Lesson has multiple students | All students added to the new makeup lesson |
| Admin clicks past date in calendar | Past dates non-interactive (greyed out) |
| Lesson has no `source_break_id` | Excluded from this view (shouldn't exist, guard in query) |
| `autoRescheduleBreak` partially fails | Each lesson processed independently; successes committed, failures listed |

---

## No DB Migrations Needed

- `lesson_type = 'makeup'` already exists in the enum
- `pending_reschedule` column already exists
- All joins already available via existing schema

---

## Files Summary

| File | Action |
|------|--------|
| `web/src/hooks/usePendingReschedules.ts` | Create |
| `web/src/components/PendingRescheduleList.tsx` | Create |
| `web/src/components/ReschedulerCalendar.tsx` | Create |
| `web/src/components/RescheduleModal.tsx` | Create |
| `web/src/pages/Breaks.tsx` | Modify — add pending section |
| `web/src/hooks/useBreaks.ts` | Modify — remove `linkReschedule` |
