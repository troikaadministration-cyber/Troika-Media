# Lesson Rates Redesign — Design Spec
_Date: 2026-04-03_

## Overview

Replace the current `LessonRates.tsx` page (modal-based add/edit flow) with a per-teacher spreadsheet grid. The new UI is fully inline-editable — no modals required.

## Layout

### Teacher tabs
- Pill-style tabs at the top of the page, one per teacher
- Teachers: Noah, Kay, Aadya, Kaivalya, Devraj, Subaan (loaded dynamically from `profiles` where `role = 'teacher'`)
- First teacher is selected by default
- An "+ Add Teacher" pill at the end (links to Teachers page or opens a simple name entry — out of scope for this spec)

### Rate grid
Displayed below the teacher tabs. Rows = lesson categories, columns = locations (loaded from `locations` table) plus a fixed "Online" column.

**Row groupings:**
- **1:1 Lessons:** Instrumental, Theory, Vocals
- **Group Lessons:** Cello / Violin, Guitar, Vocals, Theory

**Columns:**
- One column per location (from `locations` table, ordered by name)
- Final column: "Online"

**Cell states:**
- **Set** — green background (`#ecfdf5`), green border (`#6ee7b7`), rate shown as `₹X,XXX` in bold
- **Empty** — dashed border (`#cbd5e1`), muted background, shows `+ Set rate` in gray

### Inline editing
- Clicking any cell (set or empty) converts it to a number `<input>` in place
- Pressing **Enter** or **Tab** saves and moves to the next cell
- Pressing **Escape** cancels without saving
- On blur (clicking away), saves if value changed
- If the input is cleared and saved, the rate record is deleted (cell reverts to empty state)
- Save triggers an upsert to `lesson_rates` with `teacher_id`, `location_id` (or `null` for Online column), `category`, `rate_per_lesson`, `is_online`, `academic_year`

### Academic year
- Dropdown in the top-right of the page header (e.g. "2025", "2026")
- Changing year reloads the grid for that year
- Default: current year

## Data model

No schema changes required. Uses existing `lesson_rates` table:
- `teacher_id` — selected teacher
- `location_id` — nullable; null = Online
- `is_online` — true when location column is "Online"
- `category` — maps to row (e.g. `1:1_instrumental`, `group_guitar`)
- `rate_per_lesson` — the editable value
- `academic_year` — from the year selector

## Component structure

Single file: `admin/src/pages/LessonRates.tsx` (full replacement)

No new components needed — inline editing is handled with local state within the page.

## What is removed

- The Add Rate button and modal form
- The grouped-by-category table view
- Edit and delete icon buttons per row

All of this is replaced by the grid.
