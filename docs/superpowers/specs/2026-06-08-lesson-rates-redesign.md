# Lesson Rates Page Redesign — Spec

**Date:** 2026-06-08  
**Scope:** Frontend only — `web/src/pages/LessonRates.tsx`. No DB changes needed.

---

## Goal

Replace the current dense spreadsheet grid + collapsible admin panels with a focused, three-zone layout that makes setting rates obvious and managing lists non-intrusive.

---

## Layout — Three Zones

```
┌─────────────────────────────────────────────────────┐
│ HEADER: "Lesson Rates"          [Year picker] [⚙ Manage] │
├──────────────┬──────────────────────────────────────┤
│ TEACHER LIST │  RATE EDITOR                         │
│              │  [Bandra] [Juhu] [Online]  ← tabs    │
│ Sarah K.     │                                      │
│ 8 rates ✓    │  1:1 Instrumental    [  1,750  ]     │
│              │  1:1 Theory          [  1,500  ]     │
│ Rohan M.     │  Group: Strings      [       ]       │
│ 3 rates      │  IGCSE Music         [  2,000  ]     │
│              │                                      │
│ Priya S.     │  (auto-saves on blur / Enter)        │
│ 0 rates ⚠    │                                      │
└──────────────┴──────────────────────────────────────┘
```

### Teacher list (left column, ~160px wide)
- Lists all approved teachers sorted by name
- Each card shows: teacher name + rate count for selected year
- Count colour: green if >0, amber warning if 0
- Clicking a card selects that teacher and loads their rates
- First teacher auto-selected on load

### Location tabs (top of rate editor)
- One pill tab per location (from `locations` table) + "Online" tab always last
- Active tab highlighted navy, inactive grey
- Switching tab switches the rate column being edited — no save needed (each tab is a separate set of DB rows)

### Rate rows
- One row per lesson category (from `lesson_categories` table)
- Each row: category name on left, input field on right
- Input always visible (no click-to-reveal). Placeholder `—` when unset
- On blur or Enter: save to DB (upsert). On clear + blur: delete the row
- Errors shown inline below the input (red text), not via alert()
- Saving indicator: input border turns teal briefly, then settles

---

## Admin Modal

Triggered by **⚙ Manage** button in page header (top-right).

- Centered modal, ~480px wide, backdrop overlay
- Three tabs inside: **Locations | Instruments | Categories**
- Each tab: list of existing items with inline rename (click name to edit) + delete (disabled if in-use)
- Add form at bottom of each tab: single text input + Add button (Enter submits)
- Locations tab add-form: 4 fields (Name*, City, Address, Zone) in a 2×2 grid
- Delete blocked with tooltip "In use — cannot delete" if referenced by students/lessons/rates
- Closing modal (✕ or clicking backdrop) re-fetches meta so new locations appear in tabs immediately

---

## Data & State

No new DB queries beyond what the page already does. Same Supabase calls:

| Data | Source |
|------|--------|
| Teachers | `profiles` where `role = teacher` |
| Locations | `locations` ordered by name |
| Categories | `lesson_categories` ordered by sort_order |
| Instruments | `instruments` ordered by name |
| Rates | `lesson_rates` where `teacher_id = selected` and `academic_year = year` |
| In-use checks | `students.instrument_id`, `students.location_id`, `lessons.location_id`, `lesson_rates.category` |

Rate map key: `"${category}::${locationId ?? 'online'}"` (unchanged from current).

---

## Components

| Component | Purpose |
|-----------|---------|
| `LessonRatesPage` | Page root — loads meta, owns selected teacher + year state |
| `TeacherList` | Left column, teacher cards with rate counts |
| `RateEditor` | Right area — location tabs + rate rows for selected teacher |
| `RateRow` | Single category row with auto-save input |
| `AdminModal` | Modal with Locations/Instruments/Categories tabs |
| `LocationsTab` | CRUD for locations (multi-field add form) |
| `InstrumentsTab` | CRUD for instruments (single-field) |
| `CategoriesTab` | CRUD for categories (single-field) |

`TeacherRateGrid`, `RateCell`, `AdminPanel`, `EditableRow`, `InlineAdder` from current file are all replaced.

---

## Error Handling

- Rate save failure: show error text inline under the row input (not `alert()`)
- Admin CRUD failure: show error below the form
- No data: empty states with helpful messages ("No teachers found — add from Teachers page")

---

## Self-Review

- No TBDs or placeholders
- All components have single clear purpose
- Consistent with existing Supabase patterns in codebase
- No new dependencies needed
- Scope is one file: `web/src/pages/LessonRates.tsx`
