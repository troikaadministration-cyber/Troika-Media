import { describe, it, expect } from 'vitest';
import { computeDiscount, planDiscountPct } from '../fees';

const base = { primary: 'none' as const, plan: '3_instalments', specialAmount: 0, multilesson: false };

describe('computeDiscount', () => {
  it('no discount leaves tuition unchanged', () => {
    expect(computeDiscount(42000, base)).toEqual({ pct: 0, flat: 0, discounted: 42000, discountAmount: 0 });
  });
  it('plan discount follows the payment plan', () => {
    expect(planDiscountPct('1_instalment')).toBe(10);
    expect(planDiscountPct('3_instalments')).toBe(5);
    expect(planDiscountPct('10_instalments')).toBe(0);
    expect(planDiscountPct('trial')).toBe(0);
    expect(computeDiscount(10000, { ...base, primary: 'plan', plan: '1_instalment' }).discounted).toBe(9000);
  });
  it('legacy is 25% and multi-lesson stacks +5%', () => {
    const r = computeDiscount(10000, { ...base, primary: 'legacy', multilesson: true });
    expect(r.pct).toBe(30);
    expect(r.discounted).toBe(7000);
    expect(r.discountAmount).toBe(3000);
  });
  it('special is a flat amount and never goes below zero', () => {
    expect(computeDiscount(5000, { ...base, primary: 'special', specialAmount: 1500 }).discounted).toBe(3500);
    expect(computeDiscount(5000, { ...base, primary: 'special', specialAmount: 9999 }).discounted).toBe(0);
    expect(computeDiscount(5000, { ...base, primary: 'special', specialAmount: -200 }).discounted).toBe(5000);
  });
  it('rounds to paise (no floating-point noise)', () => {
    const r = computeDiscount(1333.33 * 13, { ...base, primary: 'plan', plan: '3_instalments' });
    expect(Number.isInteger(Math.round(r.discounted * 100))).toBe(true);
    expect(r.discounted.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});
