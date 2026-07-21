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
