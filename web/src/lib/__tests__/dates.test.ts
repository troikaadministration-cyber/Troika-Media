import { describe, it, expect } from 'vitest';
import { toDateStr, parseDateStr } from '../dates';

describe('date helpers (local time, never UTC)', () => {
  it('round-trips YYYY-MM-DD', () => {
    for (const s of ['2026-01-01', '2026-02-28', '2028-02-29', '2026-12-31']) {
      expect(toDateStr(parseDateStr(s))).toBe(s);
    }
  });
  it('parses to local midnight', () => {
    const d = parseDateStr('2026-11-03');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 3, 0]);
  });
  it('formats with zero padding', () => {
    expect(toDateStr(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
