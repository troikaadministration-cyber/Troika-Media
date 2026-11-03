import { describe, it, expect } from 'vitest';
import {
  lessonsForPlan, lessonsForClass, lessonsBreakdown, timesPerWeekLabel, normaliseTimesPerWeek, LESSONS_BY_JOIN_MONTH,
} from '../lessonCount';

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

describe('lessonsForClass (times per week)', () => {
  it('1× per week is the plain allotment', () => {
    expect(lessonsForClass('3_instalments', '2026-01-05', 1)).toBe(39);
    expect(lessonsForClass('3_instalments', '2026-11-03')).toBe(6);
  });
  it('2× per week for the full year is double; 3× is triple', () => {
    expect(lessonsForClass('3_instalments', '2026-01-05', 2)).toBe(78);
    expect(lessonsForClass('1_instalment', '2026-01-05', 3)).toBe(117);
  });
  it('joining in November at 2× per week = 6 × 2', () => {
    expect(lessonsForClass('10_instalments', '2026-11-03', 2)).toBe(12);
  });
  it('trial stays a single lesson whatever the times per week', () => {
    expect(lessonsForClass('trial', '2026-11-03', 3)).toBe(1);
  });
  it('bad times-per-week input is clamped to 1–3', () => {
    expect(normaliseTimesPerWeek('2')).toBe(2);
    expect(normaliseTimesPerWeek(0)).toBe(1);
    expect(normaliseTimesPerWeek(NaN)).toBe(1);
    expect(normaliseTimesPerWeek(7)).toBe(3);
    expect(lessonsForClass('3_instalments', '2026-11-03', 9)).toBe(18);
  });
  it('labels and fee-summary wording', () => {
    expect(timesPerWeekLabel(1)).toBe('');
    expect(timesPerWeekLabel(2)).toBe('2× per week');
    expect(lessonsBreakdown('3_instalments', '2026-11-03', 2)).toBe('12 lessons (6 × 2 per week)');
    expect(lessonsBreakdown('3_instalments', '2026-11-03', 1)).toBe('6 lessons');
    expect(lessonsBreakdown('trial', '2026-11-03', 2)).toBe('1 lesson');
  });
});
