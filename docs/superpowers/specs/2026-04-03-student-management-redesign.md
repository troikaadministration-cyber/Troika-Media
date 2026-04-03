# Student Management Redesign — Design Spec
_Date: 2026-04-03_

## Overview

Three improvements to admin student management:
1. **Add Student** — wire up the dead "Add Student" button with a simple modal (basics only)
2. **Student List** — cleaner table columns, contact number visible, payment plan removed
3. **Student Detail** — all info visible in tiles, Edit button opens a full edit modal, Deactivate button

## 1. Add Student Modal

### Trigger
Clicking "Add Student" button on `admin/src/pages/Students.tsx` opens a modal.

### Fields (basics only)
- Full Name (required)
- Phone
- Email
- Instrument (dropdown from `instruments` table)
- Location (dropdown from `locations` table)

### Behaviour
- On submit: `supabase.from('students').insert(...)` with `is_active: true`, all other fields null
- On success: close modal, refresh student list
- On error: show error message inline in modal
- Cancel: close modal, no save

### What is NOT in the add form
- Parent info, payment plan, notes — these go in the edit modal on Student Detail

---

## 2. Student List

### Columns (replacing current layout)
| Column | Content |
|---|---|
| Student | `full_name` (bold) + `email` (small gray below) |
| Instrument · Location | `instrument.name · location.name` (or `—` if missing) |
| Contact | Student `phone` (or `—`) |
| Status | Active / Inactive pill |

Payment plan column removed — not useful at a glance.

### Filters (unchanged)
Search, Instrument dropdown, Location dropdown, All/Active/Inactive toggle — keep as-is.

### Row click → navigates to `/students/:id` (unchanged)

---

## 3. Student Detail

### Profile card
Shows all student info in a grid of info tiles:
- Phone, Email, Payment Plan
- Parent Name, Parent Phone, Parent Email
- Notes (full width)

Empty fields show `—`.

Two action buttons top-right:
- **Edit** — opens Edit modal (see below)
- **Deactivate / Activate** — toggles `is_active`, label changes based on current state

### Edit Modal
Same layout as the profile card info tiles but all fields are editable inputs/selects:
- Full Name (required)
- Phone, Email
- Instrument (select), Location (select)
- Payment Plan (select: trial, 1_instalment, 3_instalments, 10_instalments)
- Parent Name, Parent Phone, Parent Email
- Notes (textarea)

On save: `supabase.from('students').update(...).eq('id', id)`, then refresh.

### Stats, Enrolment, Lesson History
Unchanged from current implementation — keep existing logic.

---

## Files

- **Modify:** `admin/src/pages/Students.tsx` — add modal state + Add Student form + updated table columns
- **Modify:** `admin/src/pages/StudentDetail.tsx` — profile card with tiles, Edit modal, Deactivate button
