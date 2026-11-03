# Launch checklist

Everything in this branch is inert until the database migration and the edge
functions are deployed. Do the steps in order. Total time: ~20 minutes.

## 0. Before anything

- [ ] **Change the coordinator password.** An old migration comment contained
      the admin password in plain text (now removed from the file, but it is
      still in git history). Supabase → Authentication → Users → the admin user
      → reset password.
- [ ] **Back up the database.** Supabase → Database → Backups (or
      `pg_dump`). The migration is designed to be safe and re-runnable, but take
      a backup first.

## 1. Pre-checks (Supabase → SQL Editor)

Students now only see their data once their profile is **approved** (before,
this was only enforced in the browser). Find linked students who would lose
access:

```sql
select p.email, p.full_name, p.approved
from profiles p join students s on s.user_id = p.id
where p.approved is not true;
```

Approve the ones that should have access (or do it after step 2 in the app):

```sql
update profiles set approved = true where email in ('…', '…');
```

## 2. Database migration

- [ ] Open `supabase/migrations/00020_troika_app_updates.sql`, paste the whole
      file into the SQL Editor and run it. It is idempotent (safe to run again).
      New sections are 7–27 at the bottom: dashboard/report functions,
      per-enrolment billing, `enrol_student` / `delete_enrolment`, atomic
      invoice numbers, faster RLS, security fixes, breaks that keep group
      classes running, and group classes.
- [ ] It should finish with "Success. No rows returned". NOTICE lines are
      normal.

## 3. Edge functions

**From the browser (Supabase dashboard → Edge Functions):** for each function
below, open it → **Code** → replace `index.ts` with the file from GitHub
(branch `claude/eloquent-volta-5ba47h`, `supabase/functions/<name>/index.ts`,
click **Raw** and copy) → **Deploy**.

- `generate-invoice`
- `send-payment-reminder`
- `find-makeup-matches`
- `payment-reminders`
- `sync-to-drive`
- `parse-curriculum-excel`
- **New:** `calendar-feed` — **Deploy a new function** named exactly
  `calendar-feed`, paste the code, deploy, then in the function's settings turn
  **Enforce JWT verification OFF** (calendar apps can't log in; the private
  token in the link is the password).

Or with the CLI from the repo root: `supabase functions deploy <name>` for each
(the `supabase/config.toml` in the repo already turns JWT verification off for
`calendar-feed`).

Without this, **Mark Paid cannot generate invoices** (the deployed versions
fail on every call), three functions lack permission checks, and calendar sync
links won't work.

- [ ] If the daily `payment-reminders` job is scheduled, add the secret
      **Edge Functions → Secrets → `CRON_SECRET`** (any long random string) and
      send it from the scheduler as header `x-cron-secret`.

## 4. Auth settings (Supabase → Authentication)

- [ ] **Confirm email: ON** (recommended). Self-registered students are linked
      to an existing student record by email only when the email is confirmed.
- [ ] Minimum password length: 8 (the app enforces 8 on sign-up).
- [ ] Site URL / redirect URLs include the production domain.
- [ ] Optional: Custom Access Token Hook → `public.custom_access_token_hook`.
      Not required any more (permission checks are fast either way). Note:
      if enabled, role changes apply when the user's token refreshes (≤1h).

## 5. Frontend

- [ ] Merge the branch; Vercel builds and deploys `web/`.
- [ ] Hard-refresh once. Old tabs reload themselves onto the new version.

## 6. Smoke test (5 minutes, real accounts)

Coordinator:
- [ ] Dashboard loads; numbers look right (Outstanding = due now).
- [ ] Students, Enrolments, Student detail load **with data**. These failed
      before when the student/instrument link table existed.
- [ ] Payments → Mark Paid on a real payment → invoice number appears →
      invoice opens and shows ₹ correctly.
- [ ] Enrol a test student into a class → "N lessons scheduled"; delete
      that enrolment → its unpaid instalments and future lessons disappear.

- [ ] Groups → New group (a few students, a free evening slot) → sessions
      appear on the Schedule; add/remove a member; schedule a one-time session
      that doesn't count; end the group.

Teacher (phone): today's schedule → mark Present → lesson completes and the
student's "lessons left" goes down by one.

Student (phone): Home shows upcoming lessons; Payments shows instalments.

## Known limitations / decisions for the owner

- **Group sessions and billing:** adding students to a group from the Groups
  page puts them in the sessions but doesn't bill them. To bill a student for
  a group class, enrol them from Enrolments and pick the group's slot.
- **Absences marked by teachers** are recorded as "not charged" (they don't
  use up a lesson). Charging an absence is a coordinator decision on the
  student's page (Students → student → History → Absent · Charged).

- A **break** for selected students cancels the whole lesson slot (including
  other students in a group class). Same as before.
- **Lesson allotment by join month** (39 in Jan … 3 in Dec) and instalment due
  dates (start, +4, +8 months; or monthly) are unchanged; confirm they match
  how you bill.
- **Realtime** (live notifications, teacher schedule refresh): the migration
  now adds `notifications` and `lessons` to the Realtime publication. Before,
  these live updates only worked if enabled by hand in the dashboard.
- Older invoice files may show garbled ₹ when opened from a WhatsApp link (the
  in-app viewer fixes them; new invoices are fine).
