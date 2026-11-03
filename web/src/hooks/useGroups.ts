import { supabase } from '../lib/supabase';
import { useQuery, unwrap, invalidateQueries } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import { todayStr } from '../lib/dates';
import { invalidateLessonViews } from './useLessons';

/**
 * Group classes: a group is a weekly `teacher_schedule_templates` row with
 * `is_group = true`; its sessions are `lessons` with `template_id = group.id`.
 * Reads go straight to the tables; every write goes through a coordinator-only
 * RPC so membership and sessions always change together.
 */

export interface Group {
  id: string;
  title: string;
  teacher_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string | null;
  location_id: string | null;
  instrument_id: string | null;
  student_ids: string[] | null;
  is_active: boolean;
  counts_toward_lessons: boolean;
  max_students: number | null;
  created_at: string;
  teacher: { full_name: string } | null;
  instrument: { name: string } | null;
  location: { name: string } | null;
}

export interface GroupSession {
  id: string;
  date: string;
  start_time: string;
  end_time: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  lesson_type: string;
  title: string;
  is_charged: boolean;
  students: { student_id: string }[];
}

export interface GroupsData {
  groups: Group[];
  /** Per group: the next upcoming (not cancelled) session date, if any. */
  nextSession: Record<string, string>;
  /** Per group: the last scheduled session date (today or later), if any. */
  lastSession: Record<string, string>;
  /** Per group: how many sessions are still to come. */
  upcomingCount: Record<string, number>;
}

const GROUP_COLUMNS =
  'id, title, teacher_id, day_of_week, start_time, end_time, location_id, instrument_id, student_ids, ' +
  'is_active, counts_toward_lessons, max_students, created_at, ' +
  'teacher:profiles!teacher_schedule_templates_teacher_id_fkey(full_name), ' +
  'instrument:instruments(name), location:locations(name)';

const SESSION_COLUMNS =
  'id, date, start_time, end_time, status, lesson_type, title, is_charged, students:lesson_students(student_id)';

/** All groups (active and ended) plus each active group's upcoming-session summary. */
export function useGroups() {
  const q = useQuery<GroupsData>('groups:list', async () => {
    const groups = unwrap(await supabase
      .from('teacher_schedule_templates')
      .select(GROUP_COLUMNS)
      .eq('is_group', true)
      .order('title'), []) as unknown as Group[];

    const nextSession: Record<string, string> = {};
    const lastSession: Record<string, string> = {};
    const upcomingCount: Record<string, number> = {};
    const activeIds = groups.filter(g => g.is_active).map(g => g.id);
    const today = todayStr();

    // Chunk the id filter so the request URL stays short with many groups.
    for (let i = 0; i < activeIds.length; i += 80) {
      const ids = activeIds.slice(i, i + 80);
      const rows = await fetchAll<{ id: string; template_id: string; date: string }>((from, to) =>
        supabase.from('lessons')
          .select('id, template_id, date')
          .in('template_id', ids)
          .gte('date', today)
          .neq('status', 'cancelled')
          .order('date').order('id')
          .range(from, to));
      for (const r of rows) {
        if (!nextSession[r.template_id] || r.date < nextSession[r.template_id]) nextSession[r.template_id] = r.date;
        if (!lastSession[r.template_id] || r.date > lastSession[r.template_id]) lastSession[r.template_id] = r.date;
        upcomingCount[r.template_id] = (upcomingCount[r.template_id] ?? 0) + 1;
      }
    }
    return { groups, nextSession, lastSession, upcomingCount };
  });
  return {
    ...q,
    groups: q.data?.groups ?? [],
    nextSession: q.data?.nextSession ?? {},
    lastSession: q.data?.lastSession ?? {},
    upcomingCount: q.data?.upcomingCount ?? {},
  };
}

/** A group's sessions from today on (including cancelled ones, so gaps are visible). */
export function useGroupSessions(groupId: string | null) {
  const q = useQuery<GroupSession[]>(groupId ? `groups:sessions:${groupId}` : null, () =>
    fetchAll<GroupSession>((from, to) =>
      supabase.from('lessons')
        .select(SESSION_COLUMNS)
        .eq('template_id', groupId!)
        .gte('date', todayStr())
        .order('date').order('start_time').order('id')
        .range(from, to)));
  return { ...q, sessions: q.data ?? [] };
}

/** Names for students that aren't in the cached active list (e.g. deactivated members). */
export function useStudentNames(ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  const q = useQuery<{ id: string; full_name: string }[]>(
    sorted.length ? `groups:names:${sorted.join(',')}` : null,
    async () => unwrap(await supabase.from('students').select('id, full_name').in('id', sorted), []) as { id: string; full_name: string }[],
  );
  return q.data ?? [];
}

// ── Mutations ──────────────────────────────────────────────────────────────

export interface ScheduleResult {
  lessons_created: number;
  conflicts: number;
  conflict_dates: string[];
}
export interface CreateGroupResult extends ScheduleResult { group_id: string }

/** Refresh everything a group change can affect. */
async function afterGroupChange(membersChanged: boolean) {
  invalidateLessonViews(); // schedule, teacher + student views, dashboard, reports
  invalidateQueries('teacher-schedule:'); // groups are weekly template slots too
  if (membersChanged) {
    invalidateQueries('ref:students');
    invalidateQueries('students:');
  }
  await invalidateQueries('groups:');
}

async function callRpc<T>(fn: string, params: Record<string, unknown>, membersChanged: boolean): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message);
  await afterGroupChange(membersChanged);
  return (data ?? {}) as T;
}

export function createGroup(p: {
  name: string;
  teacherId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string | null;
  startDate: string;
  endDate: string;
  studentIds: string[];
  countsTowardLessons: boolean;
  instrumentId: string | null;
  locationId: string | null;
  maxStudents: number | null;
}) {
  return callRpc<CreateGroupResult>('create_group', {
    p_name: p.name,
    p_teacher_id: p.teacherId,
    p_day_of_week: p.dayOfWeek,
    p_start_time: p.startTime,
    p_end_time: p.endTime,
    p_start_date: p.startDate,
    p_end_date: p.endDate,
    p_student_ids: p.studentIds,
    p_counts_toward_lessons: p.countsTowardLessons,
    p_instrument_id: p.instrumentId,
    p_location_id: p.locationId,
    p_max_students: p.maxStudents,
  }, true);
}

export function updateGroup(p: {
  groupId: string;
  name: string;
  countsTowardLessons: boolean;
  maxStudents: number | null;
  locationId: string | null;
}) {
  return callRpc<{ future_sessions_updated: number }>('update_group', {
    p_group_id: p.groupId,
    p_name: p.name,
    p_counts_toward_lessons: p.countsTowardLessons,
    p_max_students: p.maxStudents,
    p_location_id: p.locationId,
  }, false);
}

export function addGroupMembers(groupId: string, studentIds: string[], fromDate: string) {
  return callRpc<{ added: number; sessions_joined: number }>('add_group_members', {
    p_group_id: groupId,
    p_student_ids: studentIds,
    p_from_date: fromDate,
  }, true);
}

export function removeGroupMember(groupId: string, studentId: string, fromDate: string) {
  return callRpc<{ sessions_left: number }>('remove_group_member', {
    p_group_id: groupId,
    p_student_id: studentId,
    p_from_date: fromDate,
  }, true);
}

export function extendGroupSchedule(groupId: string, endDate: string) {
  return callRpc<ScheduleResult>('extend_group_schedule', {
    p_group_id: groupId,
    p_end_date: endDate,
  }, true);
}

export function scheduleGroupSession(p: {
  title: string;
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string | null;
  studentIds: string[];
  countsTowardLessons: boolean;
  groupId: string | null;
  instrumentId: string | null;
  locationId: string | null;
}) {
  return callRpc<{ lesson_id: string; students: number }>('schedule_group_session', {
    p_title: p.title,
    p_teacher_id: p.teacherId,
    p_date: p.date,
    p_start_time: p.startTime,
    p_end_time: p.endTime,
    p_student_ids: p.studentIds,
    p_counts_toward_lessons: p.countsTowardLessons,
    p_group_id: p.groupId,
    p_instrument_id: p.instrumentId,
    p_location_id: p.locationId,
  }, true);
}

export function endGroup(groupId: string, fromDate: string) {
  return callRpc<{ sessions_removed: number }>('end_group', {
    p_group_id: groupId,
    p_from_date: fromDate,
  }, true);
}
