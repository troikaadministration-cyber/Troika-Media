// Year rollover: data + server calls for the "Renew for next year" wizard.
import { supabase } from '../lib/supabase';
import { useQuery, unwrap } from '../lib/queryCache';

export interface RenewalSlot {
  id: string;
  teacher_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string | null;
  is_active: boolean;
  is_group: boolean;
  title: string;
  instrument_id: string | null;
  /** False once the student left the slot (e.g. the class was dropped at an earlier renewal). */
  student_on_slot: boolean;
}

/** One class (enrolment) a student had in the from-year. */
export interface RenewalClass {
  enrolment_id: string;
  instrument_id: string | null;
  instrument_name: string | null;
  template_id: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  slot: RenewalSlot | null;
  /** The class's 2nd/3rd weekly slots (2× / 3× per week), in order. */
  extra_slots?: RenewalSlot[];
  /** 1 + extra_slots.length. */
  times_per_week?: number;
  rate_per_lesson: number;
  payment_plan: string;
  lesson_rate_id: string | null;
  discount_primary: 'none' | 'plan' | 'legacy' | 'special';
  discount_multilesson: boolean;
  discount_value: number;
  total_lessons: number;
  total_fee: number;
  start_date: string;
}

/** An enrolment the student already has in the to-year. */
export interface RenewedEnrolment {
  enrolment_id: string;
  instrument_id: string | null;
  instrument_name: string | null;
  template_id: string | null;
  extra_template_ids?: string[];
  rate_per_lesson: number;
  payment_plan: string;
  total_fee: number;
}

export interface RenewalCandidate {
  student_id: string;
  full_name: string;
  location_id: string | null;
  classes: RenewalClass[];
  renewed: RenewedEnrolment[];
}

export interface EnrolResult {
  enrolment_id: string;
  template_id: string;
  lessons_scheduled: number;
  lessons_expected: number;
  lessons_joined: number;
  lessons_created: number;
  conflicts: number;
  conflict_dates: string[];
  slots?: number;
}

/** How often a from-year class met each week. */
export function classTimesPerWeek(cl: Pick<RenewalClass, 'extra_slots' | 'times_per_week'>): number {
  return cl.times_per_week ?? 1 + (cl.extra_slots?.length ?? 0);
}

/** Every weekly slot of a class (first + extra) — all released when the class is dropped. */
export function classSlotIds(cl: Pick<RenewalClass, 'template_id' | 'extra_slots'>): string[] {
  return [cl.template_id, ...(cl.extra_slots ?? []).map(x => x.id)].filter((x): x is string => !!x);
}

export async function fetchRenewalCandidates(fromYear: string, toYear: string): Promise<RenewalCandidate[]> {
  const data = unwrap(await supabase.rpc('renewal_candidates', { p_from_year: fromYear, p_to_year: toYear }), []);
  return (data ?? []) as RenewalCandidate[];
}

export function renewalKey(fromYear: string, toYear: string) {
  return `renewals:${fromYear}:${toYear}`;
}

/** Active students with classes in fromYear, plus what's already renewed into toYear. */
export function useRenewalCandidates(fromYear: string, toYear: string, enabled = true) {
  return useQuery<RenewalCandidate[]>(enabled ? renewalKey(fromYear, toYear) : null,
    () => fetchRenewalCandidates(fromYear, toYear));
}

/**
 * Which from-year classes already have a to-year enrolment: same weekly slot
 * first, else same instrument. Returns class enrolment_id → the renewal, and
 * the to-year enrolments that match no class (e.g. a class added at renewal).
 */
export function matchRenewed(c: Pick<RenewalCandidate, 'classes' | 'renewed'>) {
  const byClass = new Map<string, RenewedEnrolment>();
  const left = [...c.renewed];
  const take = (pred: (cl: RenewalClass, r: RenewedEnrolment) => boolean) => {
    for (const cl of c.classes) {
      if (byClass.has(cl.enrolment_id)) continue;
      const idx = left.findIndex(r => pred(cl, r));
      if (idx >= 0) { byClass.set(cl.enrolment_id, left[idx]); left.splice(idx, 1); }
    }
  };
  take((cl, r) => !!cl.template_id && r.template_id === cl.template_id);
  take((cl, r) => (r.instrument_id ?? null) === (cl.instrument_id ?? null));
  return { byClass, extra: left };
}

/** enrol_student arguments (p_extra_slots is an array of { template_id } | { day_of_week, start_time, end_time }). */
export type EnrolParams = Record<string, string | number | boolean | null | object[]>;

export async function enrolClass(params: EnrolParams): Promise<EnrolResult> {
  const { data, error } = await supabase.rpc('enrol_student', params);
  if (error) throw error;
  return data as EnrolResult;
}

/** Take a student off a dropped class's weekly slot (no-op if renewed on it). */
export async function releaseSlot(studentId: string, templateId: string, toYear: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('rollover_release_slot', {
    p_student_id: studentId, p_template_id: templateId, p_to_year: toYear,
  });
  if (error) throw error;
  return !!data;
}

/** Run `fn` over `items` with at most `limit` in flight. Never rejects. */
export async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await fn(item); } catch { /* fn reports its own errors */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
