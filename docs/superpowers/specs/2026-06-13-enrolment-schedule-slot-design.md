# Enrolment Schedule Slot Assignment — Design Spec

**Date:** 2026-06-13
**Status:** Approved

## Problem

When a student is enrolled, the admin must separately navigate to Teacher Schedule Admin, find the teacher, add a slot, add the student, and generate lessons. This two-workflow gap means teachers don't see new students on their schedule until a second manual step is completed.

## Goal

Enrolment creation assigns the student to a teacher schedule slot and auto-generates lessons in a single atomic flow. After enrolment, the teacher's schedule is immediately updated — no additional admin steps.

## Decisions

- **End date for generation:** Admin picks an explicit end date. Generation also stops at 39 lessons (whichever comes first).
- **Slot assignment:** Admin picks from teacher's existing template slots OR creates a new slot inline.
- **UX pattern:** 2-step wizard inside the existing enrolment modal.
- **DB changes:** None. Existing `teacher_schedule_templates.student_ids[]`, `lessons`, and `lesson_students` tables handle everything.

---

## Architecture

### 1. `Enrolments.tsx` — 2-step wizard

Convert the existing single-step modal into a 2-step wizard.

**Step 1 — Enrolment Details** (existing fields + one addition):
- Student, Lesson Rate, Payment Plan, Academic Year, Registration Fee
- Start Date (existing)
- **End Date** (new — used only for lesson generation, not stored on enrolment)

**Step 2 — Assign Schedule Slot**:
- Teacher is derived from `lesson_rate.teacher_id`
- If `lesson_rate.teacher_id` is null (group rates without a teacher), show a teacher dropdown
- Renders `<SlotPicker>` component
- Submit button: "Save & Generate Lessons"

### 2. New `SlotPicker` component (`web/src/components/SlotPicker.tsx`)

Props:
```ts
interface SlotPickerProps {
  teacherId: string;
  studentId: string;
  instruments: Instrument[];
  onSelect: (slot: SelectedSlot) => void;
}

type SelectedSlot =
  | { mode: 'existing'; templateId: string }
  | { mode: 'new'; day_of_week: number; start_time: string; end_time: string; instrument_id: string | null; title: string };
```

Behaviour:
- Loads active `teacher_schedule_templates` for `teacherId` on mount
- Displays slots grouped by day with radio buttons
- Last option: "Create new slot" — expands inline mini-form (day, start time, end time, instrument, title)
- Calls `onSelect` on any change

### 3. Submit sequence (`handleCreate` in `Enrolments.tsx`)

All steps run in sequence; errors surface to the modal's error banner.

```
1. INSERT student_enrolments  → get enrolment.id
2a. If slot.mode === 'new':
      INSERT teacher_schedule_templates { teacher_id, day_of_week, start_time, end_time,
                                          instrument_id, title, student_ids: [student_id] }
      → get template.id
2b. If slot.mode === 'existing':
      UPDATE teacher_schedule_templates
        SET student_ids = array_append(student_ids, student_id)
        WHERE id = slot.templateId AND NOT (student_ids @> ARRAY[student_id])
3. Generate lessons:
      Walk dates from start_date to min(end_date, start_date + ~2 years)
      For each date where date.dayOfWeek === template.day_of_week:
        Skip if lesson exists (same teacher_id + date + start_time)
        INSERT lessons { teacher_id, date, start_time, end_time, instrument_id,
                         location_id, title, lesson_type: 'regular' }
        INSERT lesson_students { lesson_id, student_id }
        created++
        if created >= total_lessons (1 for trial, 39 otherwise): stop
4. Show success: "Enrolment created. {created} lessons generated."
```

---

## UI Flow

```
STEP 1 — Enrolment Details
┌─────────────────────────────────┐
│ Student        [dropdown]       │
│ Lesson Rate    [dropdown]       │
│ Payment Plan   [dropdown]       │
│ Academic Year  [text]           │
│ Start Date     [date]           │
│ End Date       [date]  ← NEW    │
│ Reg. Fee       [number]         │
└─────────────────────────────────┘
[Cancel]                  [Next →]

STEP 2 — Assign Schedule Slot
Teacher: Noah (derived from rate) — or [dropdown] if rate has no teacher

Existing slots:
  ○  Monday 4:00pm – 5:00pm   Piano Lesson
  ○  Wednesday 5:30pm          Violin Lesson

  ○  + Create new slot
     Day [Mon ▾]  Start [09:00]  End [10:00]
     Instrument [Piano ▾]   Title [Piano Lesson]

[← Back]         [Save & Generate Lessons]

Loading state: "Creating enrolment and generating lessons..."
Success:        "Enrolment created. 39 lessons generated."
Error:          Shows in existing error banner
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| `lesson_rate.teacher_id` is null | Show teacher dropdown in Step 2 |
| Student already in template's `student_ids[]` | `array_append` guard — `NOT (student_ids @> ARRAY[student_id])` prevents duplicates |
| Lesson already exists at same teacher/date/time | Skip (same logic as existing Generate button) |
| `end_date` before `start_date` | Validate on Step 1 Next button, block progression |
| 39 lessons reached before `end_date` | Stop generation, surface count in success message |
| Trial payment plan | Assign slot and generate 1 lesson only (matches existing `total_lessons = 1` for trial) |

---

## Files Changed

| File | Change |
|------|--------|
| `web/src/pages/Enrolments.tsx` | Add Step 2 wizard, end_date field, submit sequence with slot + generation |
| `web/src/components/SlotPicker.tsx` | New component |

No migrations. No new tables.
