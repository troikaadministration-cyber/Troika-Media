import { describe, it, expect } from 'vitest';
import { lessonsForPlan, LESSONS_BY_JOIN_MONTH } from '../lessonCount';

describe('lessonsForPlan', () => {
  it('trial is a single lesson', () => {
    expect(lessonsForPlan('trial', '2026-05-10')).toBe(1);
  });
  it('allotment tapers by join month, read from the date string (no timezone drift)', () => {
    expect(lessonsForPlan('3_instalments', '2026-01-01')).toBe(39);
    expect(lessonsForPlan('3_instalments', '2026-03-31')).toBe(35);
    expect(lessonsForPlan('1_instalment', '2026-09-01')).toBe(13);
    expect(lessonsForPlan('10_instalments', '2026-12-31')).toBe(3);
  });
  it('has an entry for every month, never increasing', () => {
    expect(LESSONS_BY_JOIN_MONTH).toHaveLength(12);
    for (let i = 1; i < 12; i++) expect(LESSONS_BY_JOIN_MONTH[i]).toBeLessThanOrEqual(LESSONS_BY_JOIN_MONTH[i - 1]);
  });
});
