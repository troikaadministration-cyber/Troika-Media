// Annual lesson allotment by the student's month of joining.
//
// The academic session is front-loaded: a student who joins in January gets the
// full 39-lesson session, and the allotment tapers the later in the year they
// enrol. Deriving the count from the join (enrolment start) date means the
// coordinator never has to look it up or type it by hand.
//
// Index 0 = January … index 11 = December.
export const LESSONS_BY_JOIN_MONTH: readonly number[] = [
  39, // Jan
  39, // Feb
  35, // Mar
  31, // Apr
  28, // May
  24, // Jun
  21, // Jul
  17, // Aug
  13, // Sep
  10, // Oct
  6,  // Nov
  3,  // Dec  (source read "2/3" — using 3; confirm with coordinator)
];

const DEFAULT_TOTAL_LESSONS = 39;

/** Zero-based month index (0 = Jan) from a 'YYYY-MM-DD' string or a Date. */
function monthIndexOf(startDate: string | Date): number {
  if (typeof startDate === 'string') {
    // Parse the 'MM' component directly to avoid timezone drift from Date().
    const month = parseInt(startDate.slice(5, 7), 10);
    return Number.isFinite(month) ? month - 1 : new Date().getMonth();
  }
  return startDate.getMonth();
}

/**
 * Total lessons for an annual enrolment, derived from the join month.
 * Trial enrolments always get a single lesson.
 */
export function lessonsForPlan(plan: string, startDate: string | Date): number {
  if (plan === 'trial') return 1;
  const idx = monthIndexOf(startDate);
  return LESSONS_BY_JOIN_MONTH[idx] ?? DEFAULT_TOTAL_LESSONS;
}

/** How often a class meets each week (each occurrence is its own weekly slot). */
export const TIMES_PER_WEEK_OPTIONS = [1, 2, 3] as const;
export type TimesPerWeek = (typeof TIMES_PER_WEEK_OPTIONS)[number];

/** Clamp anything (string from a <select>, bad data) to 1, 2 or 3. */
export function normaliseTimesPerWeek(n: unknown): TimesPerWeek {
  const v = Math.round(Number(n));
  return v >= 3 ? 3 : v === 2 ? 2 : 1;
}

/**
 * Total lessons for one class: the join-month allotment × times per week
 * (twice a week for the year = double). Trial stays a single lesson.
 */
export function lessonsForClass(plan: string, startDate: string | Date, timesPerWeek: number = 1): number {
  if (plan === 'trial') return 1;
  return lessonsForPlan(plan, startDate) * normaliseTimesPerWeek(timesPerWeek);
}

/** "2× per week" (empty for 1×, which is the normal case). */
export function timesPerWeekLabel(timesPerWeek: number): string {
  const t = normaliseTimesPerWeek(timesPerWeek);
  return t === 1 ? '' : `${t}× per week`;
}

/**
 * Fee-summary wording: "12 lessons (6 × 2 per week)" at 2×/week, "6 lessons" at 1×.
 */
export function lessonsBreakdown(plan: string, startDate: string | Date, timesPerWeek: number = 1): string {
  const total = lessonsForClass(plan, startDate, timesPerWeek);
  const t = normaliseTimesPerWeek(timesPerWeek);
  const word = `${total} lesson${total === 1 ? '' : 's'}`;
  if (plan === 'trial' || t === 1) return word;
  return `${word} (${lessonsForPlan(plan, startDate)} × ${t} per week)`;
}
