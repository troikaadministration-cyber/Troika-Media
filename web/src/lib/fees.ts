// Enrolment fee helpers.
//
// A discount is either a percentage of tuition or a flat rupee amount, and it
// applies to tuition only (rate × lessons) — never to the registration fee.
// `total_fee` stored on an enrolment is the *discounted tuition*; the
// registration fee is stored and charged separately (see generate_instalments).

export type DiscountKind = 'percent' | 'amount';

/** Tuition after discount, floored at 0. A zero/blank value means no discount. */
export function applyDiscount(tuition: number, kind: DiscountKind, value: number): number {
  if (!value || value <= 0) return tuition;
  const reduction = kind === 'percent' ? tuition * (value / 100) : value;
  return Math.max(0, tuition - reduction);
}
