// Does a new weekly class time fit the teacher's existing weekly classes?
//  - join:  same start time + instrument as a class a brother/sister is in → share that class
//           (each child keeps their own enrolment and bill).
//  - clash: any other overlap with a class that has students → pick another time.

export interface WeeklySlotLite {
  id: string;
  teacher_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string | null;
  instrument_id: string | null;
  title: string;
  student_ids: string[] | null;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const toMin = (s: string) => { const [h, m] = s.slice(0, 5).split(':').map(Number); return h * 60 + (m || 0); };

export function checkWeeklyTime(o: {
  slots: WeeklySlotLite[];
  teacherId: string;
  teacherName?: string;
  instrumentId?: string | null;
  day: number;
  start: string;
  end?: string | null;
  isFamily: (studentId: string) => boolean;
  nameOf: (studentId: string) => string | undefined;
}): { join: WeeklySlotLite | null; clash: string | null } {
  if (!o.teacherId || !o.start) return { join: null, clash: null };
  const s = toMin(o.start), e = o.end ? toMin(o.end) : s + 45;
  for (const sl of o.slots) {
    if (sl.teacher_id !== o.teacherId || sl.day_of_week !== o.day || !(sl.student_ids?.length)) continue;
    const ss = toMin(sl.start_time), se = sl.end_time ? toMin(sl.end_time) : ss + 45;
    if (!(s < se && ss < e)) continue;
    const ids = sl.student_ids ?? [];
    const sameInstrument = !o.instrumentId || !sl.instrument_id || sl.instrument_id === o.instrumentId;
    if (ss === s && sameInstrument && ids.some(o.isFamily)) return { join: sl, clash: null };
    const names = ids.map(o.nameOf).filter(Boolean).join(', ');
    return {
      join: null,
      clash: `Clash: ${o.teacherName || 'This teacher'} already teaches ${names || sl.title || 'another student'} on `
        + `${DAYS[o.day]} ${sl.start_time.slice(0, 5)}–${(sl.end_time ?? '').slice(0, 5) || '?'}. Choose a different day or time.`,
    };
  }
  return { join: null, clash: null };
}
