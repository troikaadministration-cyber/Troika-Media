# Is this actually useful for running a music school? — Product Assessment (2026-07-21)

Based on three role-based reviews (coordinator, teacher, student/parent + comms),
with the load-bearing claims re-verified against the code. This is a
product/domain assessment, separate from the bug audit
(`2026-07-21-audit-findings.md`).

## Verdict

**As a scheduling + prepaid-lesson tracker: yes, and it's carefully built.**
**As a system to run a whole music school: not yet — three of the four things a
school actually runs on are missing or write-only.**

A school runs on: (1) money in, (2) money out, (3) the teaching value loop
(what the family gets), (4) communication. This app does #1 partially and
manually, does **none** of #2, makes #3 **write-only**, and has almost no #4.

## What it does well
- Coherent **enrolment → schedule → recurring-lesson generation → instalments**
  pipeline, with rollback and a drift-free lessons-used recompute.
- Solid **attendance + completion** for teachers, including group lessons.
- Careful **RLS** and role separation; discount engine; per-student rates.
- Breaks → auto-reschedule of covered lessons.

## The gaps that decide whether a school can rely on it

### 🔴 Tier 1 — breaks daily operation
1. **No coordinator-side "mark lesson completed."** `lessons_used`, "lessons
   remaining," and Reports "delivered" only count `status='completed'`, which is
   set **only** in the teacher UI (`useTeacherLessons.ts:65,91`). If teachers
   don't tick lessons off, every progress and billing metric silently reads
   zero and the coordinator has no way to fix it. (Verified: `Schedule.tsx` only
   reads status for styling; no coordinator write path.)
2. **No teacher pay / payroll — at all.** `lesson_rates` is only what students
   are *charged*. There is no teacher compensation, hours, or payout in schema
   or UI. Paying instructors — a school's biggest recurring task — is absent.
3. **The teaching value loop is write-only.** Teachers can record lesson
   **notes**, **repertoire** (`student_pieces`), and **media** uploads — but
   none of it is ever shown to the student/parent. `notes` is fetched then never
   rendered; `student_pieces` has a student RLS policy but no student UI;
   `media_uploads` is **only ever inserted, never read anywhere**
   (verified). Families see none of what they're paying for.

### 🟠 Tier 2 — real money/lifecycle holes
4. **No online payment collection.** No gateway (Razorpay/Stripe/UPI) anywhere.
   Everything is a coordinator clicking "Mark Paid" on an offline transfer.
   Students see amounts due with **no way to pay**.
5. **No refunds / credits / adjustments.** `amount CHECK (>= 0)`; misc charges
   force positive. A withdrawal, overpayment, or goodwill credit can't be
   represented except by manually deleting instalment rows.
6. **Cancellations/reschedules reach nobody.** `cancelLesson` only flips
   `status='cancelled'` — no notification, no email, despite a `lesson_cancelled`
   enum existing. A student learns of a cancellation only by spotting a greyed
   row. Teachers aren't notified of cancellations either.
7. **Automated reminders never actually send.** The daily `payment-reminders`
   cron writes **in-app notifications only** — it never calls Resend. Email goes
   out only on manual coordinator actions, and only if `RESEND_API_KEY` is set.
   WhatsApp is a manual `wa.me` deep link the coordinator clicks per payment.
   `reminder_sent` is set once, so an unpaid instalment is auto-reminded at most
   once ever.
8. **Invoices are HTML, not PDF**, and the student portal shows the invoice
   *number* with **no download link** — only the coordinator can fetch it.

### 🟡 Tier 3 — structure & scale
9. **No term/semester model** — only a free-text `academic_year`. Instalment
   due dates are hard-coded offsets (start / +4mo / +8mo), tied to no calendar.
10. **No room/resource conflict checking**, and generated lessons are stored
    with `location_id: null` even though the slot was chosen by location — which
    also weakens `find-makeup-matches`' same-location scoring.
11. **Deleting an enrolment orphans** its generated lessons, template slot, and
    instalments (ghost lessons still count as "delivered"; orphan dues still
    show outstanding). No clean "cancel & reconcile."
12. **Charged-absence → billing is implicit.** A charged absence consumes a
    lesson credit but creates no visible charge/line item; nothing reconciles
    "owes for N charged absences." And **teachers can't even set** charged vs
    uncharged — only the coordinator can, from the student page — yet makeup
    eligibility depends on it.
13. **Thin reporting** — all-time only; no date/term range, no per-teacher /
    per-location / per-instrument, no revenue-over-time or aging.
14. **No broadcast/parent messaging**, **no waitlist**, **no bulk operations**,
    **no roster import**, **no general audit trail** (student/enrolment deletes
    are hard deletes).
15. **No real parent account** — a parent logs in as the child; one auth user =
    one student; no multi-child view.

### Dead / broken-but-shipped
- `MakeupMatchPanel` component is **imported nowhere** (dead).
- Group lessons collapse to **first student only** everywhere except the
  attendance toggles (repertoire, media, calendar, reschedule displays).
- Teacher curriculum page is **delete-only** (no add/import), though the edge
  function authorizes teacher upload.
- Repertoire modal "Save Changes" is a no-op; the inline "Current Pieces"
  expander shows the wrong student's pieces.

## Corrections to the sub-reviews
- The `UNIQUE(student_id, academic_year)` constraint **was dropped** (00009), so
  "multi-instrument enrolment is blocked by a constraint" and "trial→paid
  dead-ends" are **not** real blockers. Multiple enrolments per student/year are
  permitted (which is also why retry-double-bill was possible — now fixed).

## Recommendation (highest leverage first)
1. **Coordinator lesson-completion** (unblocks all metrics) — small.
2. **Show teacher notes / repertoire / media to students** (turns a write-only
   teaching log into the product families pay for) — medium.
3. **Deliver cancellations + auto-reminders for real** (wire the cron to email;
   notify on cancel) — medium.
4. **Teacher pay report** (even just lessons-taught × a teacher rate) — medium.
5. Then: online payments, refunds/credits, term structure, enrolment teardown.

Bottom line: it's a good bones of a scheduler, not yet a school-management
product. The fastest path to "actually useful" is #1–#3 — they make the
existing data trustworthy and visible — before adding new modules.
