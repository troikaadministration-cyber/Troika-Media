# Student Onboarding Redesign — Design Spec
_Date: 2026-04-03_

## Overview

End-to-end student onboarding from sign-up to first class. Two entry points feed the same 3-step wizard:

1. **Self-registered students** — student signs up on web app → profile created with `approved = null` → admin sees pending banner → clicks Review → wizard opens pre-filled
2. **Admin-added students** — admin clicks "Add Student" → wizard opens blank

Both paths produce the same result: approved profile + student record + enrolment + recurring schedule slot.

---

## Files to create / modify

| File | Action |
|---|---|
| `admin/src/pages/Students.tsx` | Add pending banner + wire "Add Student" to wizard |
| `admin/src/pages/StudentDetail.tsx` | Info tiles, Edit modal, Deactivate/Activate button |
| `admin/src/components/OnboardingWizard.tsx` | New — 3-step wizard (create) |

---

## Pending Approval Banner (Students page)

- On mount, query: `profiles` where `role = 'student'` AND `approved IS NULL`
- If count > 0: show amber banner above the student table
  - Text: `{count} student{count > 1 ? 's' : ''} waiting for approval`
  - Sub-text: comma-separated list of names (up to 3, then "+ N more")
  - Button: "Review →" → opens `OnboardingWizard` in approval mode with the first pending profile pre-loaded
  - Clicking a name in the sub-text opens the wizard for that specific profile
- Banner refreshes after wizard closes

---

## OnboardingWizard Component

### Props
```ts
interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  // Pre-filled when approving a self-registered student
  pendingProfile?: { id: string; full_name: string; email: string; } | null;
}
```

### Step 1 — Student Info

Fields:
- Full Name (required, pre-filled from `pendingProfile.full_name` if present)
- Phone
- Email (pre-filled from `pendingProfile.email` if present)
- Instrument (select from `instruments` table)
- Location (select from `locations` table)

On Next:
- If `pendingProfile` exists: set `profiles.approved = true` for that profile id
- Insert row into `students` table: `{ user_id: pendingProfile?.id ?? null, full_name, phone, email, instrument_id, location_id, is_active: true, payment_plan: '3_instalments' }`
- Save returned `student.id` in wizard state

### Step 2 — Payment Plan

Fields:
- Payment Plan (select: trial / 1 instalment / 3 instalments / 10 instalments, default: 3 instalments)
- Academic Year (text, default: current year)
- Registration Fee ₹ (number, default 0)

No fee total yet — rate depends on teacher + classes assigned in Step 3.

On Next: store values in wizard state only (no DB write yet).

### Step 3 — Teacher & Classes

A student can be added to **multiple classes** (e.g. 1:1 guitar on Monday + group theory on Wednesday). Each class gets its own row.

**Add class row fields:**
- Teacher (select from `profiles` where `role = 'teacher'`)
- Category (select: 1:1 Instrumental, 1:1 Theory, 1:1 Vocals, Group: Strings, Group: Guitar, Group: Vocals, Group: Theory)
- Day of week (Monday–Saturday)
- Start time / End time
- Rate auto-filled from `lesson_rates` matching teacher + category + location (from step 1). Editable if no stored rate found.

User can add multiple rows with "+ Add another class".

**Fee summary (live, shown below class rows):**
- One line per class: `Category — Teacher — ₹rate`
- Total rate per lesson = sum of all class rates
- Total fee = total rate × 39 lessons (or 1 for trial) + registration fee

**On Confirm:**
- For each class row: insert into `teacher_schedule_templates` with `student_ids: [student_id]`
- Insert into `student_enrolments` using the summed `rate_per_lesson` and `total_fee`
- If plan ≠ trial: call `supabase.rpc('generate_instalments', { p_enrolment_id })`
- Close wizard, call `onComplete()`

### Skip option
Step 3 has a "Skip for now" link — enrolment created with rate_per_lesson: 0, schedule set up later.

---

## Student List Redesign (Students.tsx)

### Columns
| Column | Content |
|---|---|
| Student | `full_name` bold + `email` small gray |
| Instrument · Location | `instrument.name · location.name` or `—` |
| Contact | `phone` or `—` |
| Status | Active / Inactive pill |

Payment plan column removed.

### "Add Student" button
Wired to open `OnboardingWizard` with no `pendingProfile`.

---

## Student Detail Redesign (StudentDetail.tsx)

### Profile card
Info tiles in a 3-column grid (or 2-col on mobile):
- Phone, Email, Payment Plan
- Parent Name, Parent Phone, Parent Email
- Notes (full width)

Empty fields show `—`.

Top-right buttons:
- **Edit** → opens Edit modal
- **Deactivate** (if active) / **Activate** (if inactive) → toggles `is_active`, confirms with a browser `confirm()` dialog

### Edit Modal
All student fields editable:
- Full Name (required)
- Phone, Email
- Instrument (select), Location (select)
- Payment Plan (select)
- Parent Name, Parent Phone, Parent Email
- Notes (textarea)

On save: `supabase.from('students').update(...).eq('id', id)` then refresh.

### Existing sections unchanged
Stats grid, enrolment progress, lesson history — no changes.
