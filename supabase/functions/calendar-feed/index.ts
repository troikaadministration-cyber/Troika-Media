import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Private iCalendar (RFC 5545) feed of a user's lessons, for subscribing from
// Google Calendar / Apple Calendar / Outlook.
//
//   GET /functions/v1/calendar-feed?token=<secret>
//
// Calendar apps cannot send login headers, so this function MUST be deployed
// with JWT verification OFF (`verify_jwt = false` / dashboard toggle
// "Enforce JWT verification" off). The secret token (public.calendar_tokens,
// created/rotated only via the get_calendar_token / reset_calendar_token RPCs)
// is the only credential. Every failure is a bare 404 so nothing leaks.

const TZ = "Asia/Kolkata";
const PAST_DAYS = 60;
const FUTURE_DAYS = 180;
// Coordinators get every lesson; keep their feed (and its rendering cost) bounded.
const COORDINATOR_PAST_DAYS = 14;
const MAX_EVENTS = 5000;
const PAGE = 1000; // PostgREST max-rows
const DEFAULT_MINUTES = 45;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

const TYPE_LABEL: Record<string, string> = {
  makeup: "Makeup",
  special: "Special",
  demo: "Demo",
  workshop: "Workshop",
  one_time: "One-time",
};

type Named = { full_name?: string | null; name?: string | null } | null;
interface LessonRow {
  id: string;
  date: string;
  start_time: string;
  end_time: string | null;
  title: string | null;
  notes?: string | null;
  status: string;
  lesson_type: string;
  pending_reschedule: boolean | null;
  updated_at: string;
  created_at: string;
  teacher: Named;
  location: { name: string | null; address: string | null } | null;
  instrument: Named;
  lesson_students?: { student: Named }[];
  /** Student logins: which of the login's children are on this lesson. */
  ls?: { student_id: string }[];
}

/** Family login (several children): child id → names, used to label events. */
type ChildNames = Map<string, { short: string; full: string }> | null;

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** YYYY-MM-DD of (today in India + offsetDays). */
function istDate(offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// ── RFC 5545 helpers ─────────────────────────────────────────────────────────
/** Escape a TEXT value (backslash, semicolon, comma, newline). */
function escText(v: unknown): string {
  return String(v ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    // strip other control characters (not allowed in TEXT)
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

const enc = new TextEncoder();
/** Fold a content line at 75 octets (never splitting a UTF-8 sequence). */
function fold(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** "2026-11-03" + "16:30:00" → "20261103T163000" (local IST wall time). */
function localStamp(date: string, time: string): string {
  const [hh = "00", mm = "00", ss = "00"] = time.split(":");
  return date.replace(/-/g, "") + "T" + hh.padStart(2, "0") + mm.padStart(2, "0") + ss.slice(0, 2).padStart(2, "0");
}

/** Add minutes to a local date/time (no DST in India, so plain arithmetic). */
function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const [hh, mm, ss] = time.split(":").map((x) => Number(x) || 0);
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), hh, mm + minutes, ss));
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Monotonic SEQUENCE from updated_at (seconds since 2024-01-01). */
function sequenceOf(updatedAt: string): number {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((t - Date.UTC(2024, 0, 1)) / 1000));
}

// ── Data ─────────────────────────────────────────────────────────────────────
type Role = "teacher" | "student" | "coordinator";

async function fetchLessons(
  db: SupabaseClient,
  role: Role,
  userId: string,
): Promise<{ rows: LessonRow[]; childNames: ChildNames }> {
  const from = istDate(-(role === "coordinator" ? COORDINATOR_PAST_DAYS : PAST_DAYS));
  const to = istDate(FUTURE_DAYS);

  const base =
    "id, date, start_time, end_time, title, status, lesson_type, pending_reschedule, updated_at, created_at," +
    " teacher:profiles!lessons_teacher_id_fkey(full_name)," +
    " location:locations(name, address), instrument:instruments(name)";

  // A student login may be a family login covering several children.
  let studentIds: string[] = [];
  let childNames: ChildNames = null;
  if (role === "student") {
    const { data, error } = await db.from("students").select("id, full_name").eq("user_id", userId);
    if (error) throw new Error(error.message);
    const kids = (data ?? []) as { id: string; full_name: string | null }[];
    studentIds = kids.map((s) => s.id);
    if (studentIds.length === 0) return { rows: [], childNames };
    if (kids.length > 1) {
      childNames = new Map(kids.map((k) => [k.id, {
        short: firstNameOf(k.full_name, kids),
        full: (k.full_name ?? "").trim() || "Student",
      }]));
    }
  }

  const rows: LessonRow[] = [];
  for (let offset = 0; offset < MAX_EVENTS; offset += PAGE) {
    let q;
    if (role === "student") {
      // Only the student's own enrolment rows (no classmates' names, no notes).
      q = db.from("lessons")
        .select(`${base}, ls:lesson_students!inner(student_id)`)
        .in("ls.student_id", studentIds);
    } else {
      q = db.from("lessons")
        .select(`${base}, notes, lesson_students(student:students(full_name))`);
      if (role === "teacher") q = q.eq("teacher_id", userId);
    }
    const { data, error } = await q
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, Math.min(offset + PAGE, MAX_EVENTS) - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as LessonRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return { rows, childNames };
}

/** First name, or the full name when siblings share a first name. */
function firstNameOf(name: string | null, all: { full_name: string | null }[]): string {
  const full = (name ?? "").trim();
  const first = full.split(/\s+/)[0] || full;
  const same = all.filter((k) => ((k.full_name ?? "").trim().split(/\s+/)[0] || "").toLowerCase() === first.toLowerCase());
  return (same.length > 1 ? full : first) || "Student";
}

/** Names of the family login's children on this lesson (empty for one-child logins). */
function childrenOn(l: LessonRow, childNames: ChildNames, which: "short" | "full" = "short"): string[] {
  if (!childNames) return [];
  const names = (l.ls ?? []).map((x) => childNames.get(x.student_id)?.[which]).filter((n): n is string => Boolean(n));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

// ── Rendering ────────────────────────────────────────────────────────────────
function studentNames(l: LessonRow): string[] {
  return (l.lesson_students ?? [])
    .map((ls) => ls.student?.full_name?.trim())
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => a.localeCompare(b));
}

function summaryOf(l: LessonRow, role: Role, childNames: ChildNames): string {
  const instrument = l.instrument?.name?.trim() || "";
  const title = l.title?.trim() || "";
  const typeLabel = TYPE_LABEL[l.lesson_type] || "";
  // Group / workshop / one-time lessons are best known by their own title.
  const titled = ["special", "workshop", "one_time", "demo"].includes(l.lesson_type) && title;
  const subject = (titled ? title : instrument || title) || typeLabel || "Lesson";
  const teacher = l.teacher?.full_name?.trim() || "";
  const names = studentNames(l);

  let s: string;
  if (role === "student") {
    s = teacher ? `${subject} with ${teacher}` : subject;
  } else {
    let who = "";
    if (names.length === 1 || names.length === 2) who = names.join(", ");
    else if (names.length > 2) who = `${title && title !== subject ? title : "Group"} (${names.length} students)`;
    else if (title && title !== subject) who = title;
    s = who ? `${subject} – ${who}` : subject;
    if (role === "coordinator" && teacher) s += ` (${teacher})`;
  }
  if (typeLabel && !s.toLowerCase().startsWith(typeLabel.toLowerCase())) s = `${typeLabel}: ${s}`;
  // Family login: say which child the lesson is for.
  const kids = role === "student" ? childrenOn(l, childNames) : [];
  if (kids.length) s = `${kids.join(" & ")} – ${s}`;
  if (l.status === "cancelled") s = `Cancelled: ${s}`;
  return s;
}

function locationOf(l: LessonRow): string {
  const name = l.location?.name?.trim() || "";
  const addr = l.location?.address?.trim() || "";
  if (!name) return addr;
  if (!addr || addr.toLowerCase() === name.toLowerCase()) return name;
  return `${name}, ${addr}`;
}

function descriptionOf(l: LessonRow, role: Role, childNames: ChildNames): string {
  const lines: string[] = [];
  const kids = childrenOn(l, childNames, "full");
  if (kids.length) lines.push(`Student${kids.length > 1 ? "s" : ""}: ${kids.join(", ")}`);
  const teacher = l.teacher?.full_name?.trim();
  if (role !== "teacher" && teacher) lines.push(`Teacher: ${teacher}`);
  if (role !== "student") {
    const names = studentNames(l);
    if (names.length) lines.push(`Student${names.length > 1 ? "s" : ""}: ${names.join(", ")}`);
  }
  if (l.instrument?.name) lines.push(`Instrument: ${l.instrument.name}`);
  if (l.title?.trim()) lines.push(`Class: ${l.title.trim()}`);
  if (TYPE_LABEL[l.lesson_type]) lines.push(`Type: ${TYPE_LABEL[l.lesson_type]}`);
  if (l.status === "cancelled") lines.push("Status: Cancelled");
  else if (l.status === "completed") lines.push("Status: Completed");
  if (l.pending_reschedule) lines.push("Awaiting reschedule");
  if (role !== "student" && l.notes?.trim()) lines.push("", `Notes: ${l.notes.trim()}`);
  return lines.join("\n");
}

function buildCalendar(lessons: LessonRow[], role: Role, childNames: ChildNames = null): string {
  const now = utcStamp(new Date());
  const out: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Troika Media//Lesson Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escText("Troika – My lessons")}`,
    `X-WR-TIMEZONE:${TZ}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    "BEGIN:VTIMEZONE",
    `TZID:${TZ}`,
    `X-LIC-LOCATION:${TZ}`,
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0530",
    "TZOFFSETTO:+0530",
    "TZNAME:IST",
    "DTSTART:19700101T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const l of lessons) {
    if (!l.date || !l.start_time) continue;
    const end = l.end_time && l.end_time > l.start_time
      ? { date: l.date, time: l.end_time }
      : addMinutes(l.date, l.start_time, DEFAULT_MINUTES);
    const ev = [
      "BEGIN:VEVENT",
      `UID:${l.id}@troika`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=${TZ}:${localStamp(l.date, l.start_time)}`,
      `DTEND;TZID=${TZ}:${localStamp(end.date, end.time)}`,
      `SUMMARY:${escText(summaryOf(l, role, childNames))}`,
    ];
    const loc = locationOf(l);
    if (loc) ev.push(`LOCATION:${escText(loc)}`);
    const desc = descriptionOf(l, role, childNames);
    if (desc) ev.push(`DESCRIPTION:${escText(desc)}`);
    ev.push(
      `STATUS:${l.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      `SEQUENCE:${sequenceOf(l.updated_at)}`,
      `LAST-MODIFIED:${utcStamp(new Date(l.updated_at))}`,
      `CREATED:${utcStamp(new Date(l.created_at))}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
    out.push(...ev);
  }
  out.push("END:VCALENDAR");
  return out.map(fold).join("\r\n") + "\r\n";
}

// ── Handler ──────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const token = new URL(req.url).searchParams.get("token") || "";
  if (!TOKEN_RE.test(token)) return notFound();

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: tok, error: tokErr } = await db
      .from("calendar_tokens")
      .select("user_id")
      .eq("token", token)
      .maybeSingle();
    if (tokErr || !tok) return notFound();

    const { data: profile, error: profErr } = await db
      .from("profiles")
      .select("role, approved")
      .eq("id", tok.user_id)
      .maybeSingle();
    if (profErr || !profile) return notFound();
    const role = profile.role as Role;
    if (!["teacher", "student", "coordinator"].includes(role)) return notFound();
    // Same rule as the RPCs: pending / rejected users get no feed.
    if (role !== "coordinator" && profile.approved !== true) return notFound();

    const { rows: lessons, childNames } = await fetchLessons(db, role, tok.user_id);
    const body = buildCalendar(lessons, role, childNames);

    return new Response(req.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="troika-lessons.ics"',
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    console.error("calendar-feed error:", e instanceof Error ? e.message : e);
    return new Response("Calendar temporarily unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300" },
    });
  }
});
