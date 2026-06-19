// Shared formatting helpers for the student portal.

/** Format a YYYY-MM-DD date string in en-IN, default: "12 Jun 2026". */
export function fmtDate(d: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', opts ?? {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** Convert "HH:MM:SS" → friendly 12-hour "4:00 PM". */
export function fmtTime(t?: string | null): string {
  if (!t) return '';
  const [hStr, m] = t.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/** Rupee amount: ₹1,234. */
export function fmtMoney(n: number): string {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

/** Human-friendly relative day: Today / Tomorrow / In 3 days / Monday, 3 Mar. */
export function relativeDay(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff <= 7) return `In ${diff} days`;
  if (diff === -1) return 'Yesterday';
  if (diff < 0 && diff >= -7) return `${-diff} days ago`;
  return fmtDate(dateStr, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Time-of-day greeting. */
export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First name, or a friendly fallback. */
export function firstName(name: string): string {
  return (name || '').trim().split(' ')[0] || 'there';
}
