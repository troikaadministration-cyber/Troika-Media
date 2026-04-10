# Student Flow Simplification
**Date:** 2026-04-10  
**Status:** Approved

## Overview

Four related improvements to make the coordinator experience simpler and more self-contained:
1. Simplify the Add Student wizard from 3 steps to 2
2. Remove the Enrolments page from the nav; surface re-enrolment from Student Detail
3. Manage instruments and lesson categories from the UI (currently hardcoded or DB-only)
4. Deactivate and delete students from the UI

---

## 1. Simplified Add Student Wizard

### Current state
3-step wizard: Student Info → Payment Plan → Classes & Fee (separate step)

### New state
2-step wizard: **Student Info → Payment & Classes** (steps 2+3 merged)

**Step 1 — Student Info** (unchanged)
- Full name, phone, email, instrument (dropdown), location (dropdown)
- Instrument dropdown gets a small inline "+ New" link to add a new instrument on the fly

**Step 2 — Payment & Classes** (merged)
- Payment plan selector (Trial / 1 / 3 / 10 instalments)
- Registration fee input
- Academic year input
- Class assignment rows (teacher, category, day, start/end time, rate) — same as current step 3
- Fee summary auto-calculates as before
- Single "Confirm & Finish" button; "Skip for now" remains

### Step bar
Replace the 3-dot step bar with a 2-dot step bar: `Student Info` → `Payment & Classes`.

---

## 2. Enrolments Page — Remove from Nav, Add Re-enrol to Student Detail

### Nav change
Remove the "Enrolments" link from the sidebar (`Layout.tsx`). The `/enrolments` route and page remain intact (no deletion) so nothing breaks if accessed directly.

### Student Detail — Re-enrol button
Add a **"Re-enrol for new year"** button to the Student Detail page (top-right action area, alongside any existing actions).

Clicking it opens a compact modal pre-filled with:
- Student name (read-only)
- Academic year (defaults to current year)
- Payment plan selector
- Lesson rate selector
- Registration fee input
- Fee summary

On submit: creates a new `student_enrolments` record and generates instalments — same logic as the Enrolments page create form.

---

## 3. Instrument & Category Management

### Current state
- **Instruments:** rows in the `instruments` table, no UI to add/edit/delete
- **Categories:** hardcoded array in `OnboardingWizard.tsx` and `Enrolments.tsx`

### Seed data
The following must be present at first load (upserted via a new migration):

**Instruments:** Cello, Piano, Voice, Guitar, Violin, Viola

**Lesson categories** (new `lesson_categories` table):
- 1:1 Instrumental
- 1:1 Theory
- 1:1 Vocals
- IGCSE Music
- Music Theory
- Group: Strings
- Group: Guitar
- Group: Vocals
- Group: Theory

### New `lesson_categories` table

```sql
CREATE TABLE lesson_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
```

RLS: coordinators manage all; teachers and students can read.

### UI — Lesson Rates page additions

The existing **Lesson Rates** page gets two new collapsible/expandable admin panels at the top:

**Instruments panel**
- List of all instruments (name)
- Inline "Add instrument" input + button
- Delete button per row (disabled if instrument is in use by any student)
- Rename via inline edit

**Lesson Categories panel**
- List of all categories (name, sort order)
- Inline "Add category" input + button  
- Delete button per row (disabled if category is in use by any lesson rate)
- Rename via inline edit

### Wizard & dropdowns
Replace the hardcoded `CATEGORIES` array in `OnboardingWizard.tsx` with a live query from `lesson_categories`. Same for `Enrolments.tsx` and `LessonRates.tsx`.

---

## 4. Remove Students

### Deactivate (soft delete)
On the **Student Detail** page, add a **"Deactivate student"** button in the danger zone at the bottom of the page.

- Sets `students.is_active = false`
- Student disappears from the active student list and all active dropdowns
- All history (lessons, payments, enrolments) is preserved
- A reactivate button appears on the student detail if is_active is false

### Delete (hard delete)
Add a **"Delete student"** button behind a confirmation dialog on the Student Detail page.

- Confirmation text: *"This will permanently delete [name] and all their lesson and payment records. This cannot be undone."*
- Deletes the student record; DB cascade handles related records
- Only shown to coordinators

---

## Files Changed

| File | Change |
|------|--------|
| `web/src/components/OnboardingWizard.tsx` | Merge steps 2+3; load categories from DB; add inline instrument creator |
| `web/src/components/layout/Layout.tsx` | Remove Enrolments nav link |
| `web/src/pages/StudentDetail.tsx` | Add Re-enrol modal, Deactivate button, Delete button |
| `web/src/pages/LessonRates.tsx` | Add Instruments panel + Categories panel |
| `web/src/pages/Enrolments.tsx` | Load categories from DB instead of hardcoded array |
| `supabase/migrations/00011_lesson_categories.sql` | Create lesson_categories table, seed data, RLS |

---

## Out of Scope

- Editing past enrolments
- Bulk student operations
- Any change to the teacher flow
