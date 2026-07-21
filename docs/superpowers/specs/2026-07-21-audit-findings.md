# Full App Audit — 2026-07-21

Three parallel audits (coordinator UX, billing/money, teacher+student portal &
edge functions), findings verified with file:line evidence; the top claims were
independently re-checked. Ranked honestly — including confusing and unnecessary
things, not just bugs.

## 🔴 Critical — fix before trusting the system

1. **Timezone bug ships lessons a day early (IST).** Enrolments.tsx date loop
   mixes local `getDay()` with UTC `toISOString()`: in UTC+5:30 every generated
   lesson is stored on the *previous* day. Same class of bug in
   TeacherCalendar.tsx:165 (calendar maps lessons one day late) and every
   `new Date().toISOString()` "today" (before 5:30 AM IST the app thinks it's
   yesterday). The app is India-based; this corrupts real schedules.

2. **Student "Cancel Lesson" silently does nothing.** Students have no RLS
   UPDATE on lessons (only SELECT), and trigger 00019 blocks non-coordinator
   cancels anyway — the update matches 0 rows with no error, the modal reports
   success, the teacher is never notified. Either wire it through a proper
   request flow or remove the button.

3. **`lessons_used` double-counts and never decrements.** Trigger increments on
   every → completed transition; teacher toggles complete→pending→complete and
   the student is billed phantom lessons. Completing *before* marking
   attendance counts zero and is never recovered. (00009 dropped the decrement
   that 00005 had.)

4. **Mark-paid can leave a paid payment with no invoice — and shows a green
   toast.** verifyPayment marks paid, then invokes generate-invoice; on invoke
   failure the payment stays paid, no invoice, no retry path, and
   Payments.tsx's catch omits `error:true` so the toast looks like success.

5. **Reminder cron poisons future invoices.** payment-reminders inserts a
   "PENDING" invoice row for due unpaid payments; generate-invoice's
   idempotency check later finds it and returns early — the customer never
   gets a real invoice/PDF/email for that payment, ever.

6. **Enrolment rollback doesn't delete generated instalments → retry
   double-bills.** Failure after `generate_instalments` (all 3 paths; wizard
   and re-enrol have no rollback at all) leaves payment_records; retrying
   creates a second full set. UNIQUE(student_id, academic_year) was dropped in
   00009 so nothing stops duplicates.

7. **`find-makeup-matches` leaks the whole student roster.** Only checks for a
   valid JWT (no role/approval check), then uses service role — any student or
   even unapproved signup can pull every student's name, location, instrument,
   and charged-absence stats.

8. **Wizard lesson generation is a silent no-op most of the year.** Generates
   from today → May 31 of `academic_year`; from June onward that's in the past,
   zero lessons are created, and the wizard still reports success.

## 🟠 High — real damage, slightly narrower blast radius

9. **The three enrolment paths disagree.** Enrolments modal (most correct):
   rate id, chosen dates, capped lesson generation, rollback. Wizard: sums all
   class-row rates into one `rate_per_lesson` (2-class student's tuition =
   (r1+r2)×39 against ONE 39-lesson allotment), lesson_rate_id always null,
   uncapped generation, swallowed insert errors. Re-enrol: no lessons at all,
   no validation (can save ₹0 enrolments). Same word, three different
   financial outcomes.

10. **Editing a shared slot from a student page wipes the other students** —
    StudentDetail saveSchedule always writes `student_ids: [id]`.

11. **Wizard silently overwrites an existing student on email match** — name,
    phone, address replaced with no warning; enrolment attaches to the wrong
    student.

12. **Free-text `academic_year` is a foot-gun.** The lessons_used trigger keys
    on EXTRACT(YEAR from lesson date); a July enrolment spans two calendar
    years so next-January completions increment nothing. StudentDetail only
    fetches `academic_year == current year` — type "2026-27" and the enrolment
    becomes invisible there.

13. **Teacher RLS is too broad**: teachers can update any lesson column
    (is_charged, date, pending_reschedule), set/clear billing-relevant
    absence_category, and delete the entire shared curriculum library (no
    ownership column).

14. **Group-makeup trigger clears the wrong pending lessons** — rescheduling
    one group lesson of N students consumes N oldest pending obligations,
    mostly unrelated ones.

15. **Misc charges (shipped today) mislabel in comms** — WhatsApp/email
    reminders call a recital ticket "lesson fee (Instalment 1)"; stored invoice
    description reads "undefined — Instalment 1/1". HTML invoice is correct.

16. **generate-lessons edge function is dead code** — nothing invokes it;
    TeacherScheduleAdmin promises "generate lessons" but only saves templates.

## 🟡 Medium

17. Instalment rounding: ROUND(total/n,2)×n ≠ total (off by paise both ways);
    no last-instalment adjustment.
18. Deleting an enrolment leaves lessons + unpaid instalments live (dunning
    continues for a dead enrolment).
19. Rate dropdowns ignore academic_year — can enrol at stale rates.
20. Negative money inputs save fine everywhere except the misc-charge modal.
21. "Skip for now" in the wizard still creates a ₹0 enrolment + instalment
    records that pollute Reports.
22. Soft- vs hard-delete disagreement on schedule templates; StudentDetail
    shows inactive templates as live classes.
23. Two divergent Locations managers (Locations page + LessonRates modal) with
    different delete-safety checks; instrument admin also lives in the rates
    modal. Consolidate.
24. Wizard: hardcoded instrument whitelist; never writes student instrument
    (Students list shows "—"); ~80 serial queries during generation; the only
    editor for the legacy instrument_id field was removed.
25. Teacher "Current Pieces" panel shows the wrong student's pieces; repertoire
    and makeup tools only work for the FIRST student of a group lesson.
26. sync-to-drive marks media synced even when Drive isn't configured or the
    upload failed (never retried); uploaded media is displayed nowhere in the
    app; student lesson notes fetched but never rendered.
27. Invoice/reminder pick `enrolmentList[0]` arbitrarily for multi-enrolment
    students — piano invoice can show violin lesson counts.
28. reminder_sent set before the email actually sends → failed emails suppress
    all future automatic chasing.
29. usePayments hard-caps at 500 rows (oldest first) — newest dues eventually
    invisible; Reports subject to PostgREST default row cap.
30. Reports aggregates all years per student (returning students conflated).
31. Enrolments page missing from the sidebar nav (only reachable by URL).
32. TeacherCalendar "Open full day view" drops the selected date.

## 🔵 Low / polish

33. "Total Fee" column excludes reg fee while instalments include it —
    permanent ₹500-ish mismatch vs Payments.
34. Breaks page uses alert(); no end≥start validation.
35. Dashboard has no error handling on 4 of 5 queries — network failure means
    infinite "Loading…".
36. "Multi-lesson (+5%)" label reads like a surcharge; say "Multi-lesson
    discount (−5%)".
37. Dead code: student/teacher cancelLesson hooks, find-makeup-matches ignores
    the student_id the UI sends, repertoire modal Save button does nothing,
    in_progress vs not_started share the same colour, `students.payment_plan`
    is vestigial (wizard hardcodes 3_instalments), wizard collects an address
    shown nowhere, `is_online` tracked then discarded in generation.

## Suggested fix order

1. Timezone fixes (#1) — data corruption, small diff.
2. lessons_used trigger rework (#3) — money.
3. Mark-paid decouple + invoice idempotency/PENDING fix (#4, #5) — money.
4. Instalment rollback / uniqueness (#6) — money.
5. find-makeup-matches role check (#7) — privacy, 5-line fix.
6. Student cancel: remove or convert to request (#2).
7. Unify the three enrolment paths on the Enrolments-modal logic (#9) and add
   nav entry (#31).
8. Misc-charge comms wording (#15) + the rest by taste.
