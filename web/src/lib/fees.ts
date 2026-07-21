// Enrolment fee + discount engine.
//
// A student gets ONE primary discount, and an optional Multi-lesson (+5%) that
// stacks on top (the only one that stacks). Discounts apply to tuition only
// (rate × lessons) — never to the registration fee. `total_fee` stored on an
// enrolment is the discounted tuition; the registration fee is separate.
//
// Primary options:
//   'none'    — no primary discount
//   'plan'    — auto % from the payment plan (1-inst 10%, 3-inst 5%, 10-inst 0%)
//   'legacy'  — legacy student, 25%
//   'special' — a flat ₹ amount

export type DiscountPrimary = 'none' | 'plan' | 'legacy' | 'special';

export const LEGACY_DISCOUNT_PCT = 25;
export const MULTILESSON_DISCOUNT_PCT = 5;

/** Auto discount percentage implied by the payment plan. */
export function planDiscountPct(plan: string): number {
  switch (plan) {
    case '1_instalment': return 10;
    case '3_instalments': return 5;
    case '10_instalments': return 0;
    default: return 0; // trial / unknown
  }
}

export interface DiscountInput {
  primary: DiscountPrimary;
  plan: string;          // used when primary === 'plan'
  specialAmount: number; // flat ₹, used when primary === 'special'
  multilesson: boolean;  // manual +5% toggle, stacks
}

export interface DiscountResult {
  pct: number;            // total percentage applied (primary% + multi-lesson)
  flat: number;           // flat ₹ applied (special)
  discounted: number;     // tuition after discount, floored at 0
  discountAmount: number; // tuition - discounted
}

/** Compute discounted tuition from the primary choice + multi-lesson toggle. */
export function computeDiscount(tuition: number, d: DiscountInput): DiscountResult {
  let pct = 0;
  let flat = 0;
  if (d.primary === 'plan') pct = planDiscountPct(d.plan);
  else if (d.primary === 'legacy') pct = LEGACY_DISCOUNT_PCT;
  else if (d.primary === 'special') flat = Math.max(0, d.specialAmount || 0);
  if (d.multilesson) pct += MULTILESSON_DISCOUNT_PCT;

  const afterPct = tuition * (1 - pct / 100);
  const discounted = Math.max(0, afterPct - flat);
  return { pct, flat, discounted, discountAmount: tuition - discounted };
}

export const PRIMARY_LABELS: Record<DiscountPrimary, string> = {
  none: 'No discount',
  plan: 'Plan discount (auto)',
  legacy: 'Legacy student (25%)',
  special: 'Flat ₹ special',
};
