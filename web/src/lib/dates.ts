// Local-timezone date helpers.
//
// `Date.prototype.toISOString()` formats in UTC, which shifts the calendar day
// for any timezone with a positive offset (e.g. IST, UTC+5:30) — a lesson on
// local midnight serialises to the *previous* day. These helpers format and
// parse in LOCAL time so schedule dates line up with what the user sees.

/** Format a Date as YYYY-MM-DD in local time. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayStr(): string {
  return toDateStr(new Date());
}

/** Parse a YYYY-MM-DD string to a Date at local midnight (no UTC shift). */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
