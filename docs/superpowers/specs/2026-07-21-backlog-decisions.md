# Backlog Decisions — 2026-07-21

Source: coordinator's handwritten fixes list + follow-up Q&A. This captures the
agreed direction for each item so work can resume without re-litigating.

Legend: ✅ done · 🔜 ready to build · 📝 needs spec · ⛔ blocked

---

## ✅ Done

### Lesson count by join month
Annual lesson total is derived from the enrolment **start month** instead of a
hard-coded 39. Single source of truth: `web/src/lib/lessonCount.ts`
(`lessonsForPlan`). Wired into onboarding, enrolments, and re-enrolment.
- Table: Jan 39, Feb 39, Mar 35, Apr 31, May 28, Jun 24, Jul 21, Aug 17,
  Sep 13, Oct 10, Nov 6, **Dec 3** (source read "2/3" — **CONFIRM 2 vs 3**).
- Trial = 1 lesson.

### Day-of-week fix + 45-min default
- `OnboardingWizard` day list was `Monday..Saturday` mapped to `0..5`, but the
  app uses `0=Sunday`. Fixed to `Sunday..Saturday` (0..6): adds Sunday **and**
  corrects an off-by-one where a "Monday" class was stored as Sunday.
  - ⚠️ Historical enrolments created via the wizard may have shifted
    `day_of_week` values — needs a data audit (out of scope of the code fix).
- Default lesson duration is now **45 min** (`09:00→09:45`) at all four
  schedule-entry points (onboarding, slot picker, schedule, student detail).

---

## 🔜 Ready to build (decisions locked)

### Discount on enrolment  ✅ DONE (needs migration 00020 applied)
- Coordinator picks **either a percentage or a flat amount** (toggle).
- **No discount type/name** — just the value.
- **Optional**: "no discount" (blank/0) is allowed.
- Applies to **tuition** (`rate × lessons`), not the registration fee
  *(assumption — flag if wrong)*.
- Stored on the enrolment; flows into `total_fee` → instalments → invoices.
- Requires migration: add `discount_kind` ('percent'|'amount') +
  `discount_value` to `student_enrolments`.

### Confirm & Finish gate  ✅ DONE
- Onboarding "Confirm & Finish" stays disabled until a **lesson rate** is
  entered. Discount is **not** required. Trial exempt.

### Breaks greyed out in calendar
- **Admin calendar only**, **visual only** (no booking-block for now).

### Locations management
- CRUD screen to manage locations so the data is auditable later.
- Inline "+ Add location" when creating a lesson.
- Example locations: links, edvin, student home, online → implies a
  name + an "online" flag.

### Trial → payment plan conversion
- **Registration fee applies on conversion.**
- **Demo students are not on the enrolment register.**
- (Open: upgrade same enrolment vs new; does trial lesson taken count.)

### Misc charges
- **Free-form name + amount** (no fixed catalog).
- **Shown on the invoice.**
- Payable line items connected to a student.

---

## 📝 Needs a short spec before building

### Teacher instruments
- Teachers may teach **multiple/different instruments** → declare instruments
  per teacher (many-to-many). Feeds the schedule + rate lookups.

### Block teacher time (training / meetings)
- Teacher-scoped unavailability. Sometimes a **meeting/training blocks two
  teachers at once** → a block can target multiple teachers.
- Whole days or time ranges.

### Instrument rent / instalment (new tab)
- Supports **both recurring rental and rent-to-own (instalments)**.
- Tracked in a **separate ledger** (not the tuition payments table).
- Connected to a student.

### Rate card + rate versioning  ⭐ important
- Old students keep **old (grandfathered) rates**; new students get **new,
  higher rates**. Rates must be **versioned** (by academic year / effective
  date) so historical enrolments bill at their original rate.
- Percentage discounts available per **payment plan**, plus **selected special
  discounts** that may be a **standalone amount**.

### Reporting
- **On-screen dashboard** + **CSV export**.
- (Open: which metrics first — revenue, lessons delivered/remaining,
  attendance, dues.)

### Security
- Scope TBD (RLS hardening / audit log / 2FA / session policy / review).

---

## Round 2 decisions (2026-07-21, later)

### Breaks greyed — refined
Only grey the **specific lesson slot of the student who is on break** (break
date range covers that lesson's date). Do **not** grey the whole day or block
the time — it's a visual reminder to the admin that the slot is *temporarily*
free.

### Locations — purpose
For **scheduling + reporting**. Distinct locations: Online, Student's home,
Links, Edvin. Manage as named records; lessons already carry `location_id`, so
reports group by location. (Assumption: name-based, keep the existing `is_online`
flag; no per-location address needed unless requested.)

### Trial / Demo — off platform
Demo/trial students are **not on this platform at all**. There is no in-app
trial to convert. On real enrolment: **registration fee + payment-plan
selection** applied like any paid enrolment.
→ Implication: the "Trial → payment plan conversion" item is **dropped**, and
the **"Trial" payment-plan option should likely be removed** from enrolment
(CONFIRM).

### Misc charges — customisable add-ons
Recital tickets, books, exams, etc. **Add-on, customisable** (free-form name +
amount), payable, shown on invoice.

### Payment plans + discount engine  ⭐ (supersedes the simple discount)
Discount components:
- **Plan discount (auto):** 1 instalment = **10%**, 3 instalments = **5%**,
  10 instalments = **0%**.
- **Multi-lesson discount:** additional **5%**.
- **Legacy student discount:** **25%**.
- **Flat special discount:** a **₹ amount** entered manually.
OPEN: do the percentages **stack** (sum, applied to tuition, then flat ₹
subtracted)? what triggers **multi-lesson** (≥2 classes/week? manual)? is
**legacy** a manual per-student flag?

### Per-student editable rate  ⭐
Later joiners may be quoted a **higher fee**, so the **per-lesson rate must be
editable per student** on the enrolment (override the rate-card default). Old
students keep their stored rate (grandfathered).

### Block teacher time — deferred
User says it was misunderstood; will re-explain. **Parked** pending re-spec.

### Reporting — metrics
Ship: **outstanding dues**, **lessons delivered vs remaining**, **revenue
collected**. Dashboard + CSV.

## ⛔ Blockers / open questions

1. **Who applies Supabase migrations?** Most items above need schema changes.
   This session cannot apply migrations or deploy edge functions. Shipping
   schema-coupled client code before the migration is applied will break
   inserts in prod. Need a staging DB + a migration owner.
2. **Payments "mark as paid" error** — coordinator unsure of exact error.
   Hypothesis: `verifyPayment` marks paid then calls `generate-invoice`; if
   that edge function fails the whole action throws "Failed to verify payment"
   even though the DB row was updated. Fix = decouple (mark-paid succeeds,
   invoice failure is a non-blocking warning). Need the real error/logs to
   confirm.
3. **December lesson count: 2 or 3?**
