import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { UserX } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useStudentLessons, useStudentAbsenceRequests } from '../../hooks/useStudentLessons';
import { supabase } from '../../lib/supabase';
import { useQuery, unwrap } from '../../lib/queryCache';
import { CenterSpinner, ChildChips } from '../../components/student/shared';
import { ErrorBanner } from '../../components/ErrorBanner';
import { StudentPortalContext, type Child, type Enrolment, type Payment } from './StudentPortalContext';

interface PortalRecord {
  id: string;
  full_name: string;
  enrolments: Omit<Enrolment, 'student_id'>[];
  payments: Omit<Payment, 'student_id'>[];
}

interface PortalData {
  children: Child[];
  enrolments: Enrolment[];
  payments: Payment[];
}

/** First names for chips; full names where siblings share a first name. */
function withLabels(rows: { id: string; full_name: string }[]): Child[] {
  const first = (n: string) => (n || '').trim().split(/\s+/)[0] || n || 'Student';
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(first(r.full_name).toLowerCase(), (counts.get(first(r.full_name).toLowerCase()) ?? 0) + 1);
  return rows.map((r) => ({
    id: r.id,
    full_name: r.full_name,
    label: (counts.get(first(r.full_name).toLowerCase()) ?? 0) > 1 ? r.full_name.trim() : first(r.full_name),
  }));
}

const CHILD_KEY = (userId: string) => `troika:portal-child:${userId}`;
function readSavedChild(userId: string | undefined): string | null {
  if (!userId) return null;
  try { return localStorage.getItem(CHILD_KEY(userId)); } catch { return null; }
}

/**
 * Layout route for the whole student portal.
 * Loads every student on the login (a family login has several children) with
 * this year's enrolments and payments in one request, and the lessons in
 * parallel, cached, and shares them with every child page via context —
 * navigating between portal pages never refetches from scratch.
 */
export function StudentShell() {
  const { profile } = useAuth();
  const userId = profile?.id;
  const year = new Date().getFullYear().toString();

  const portal = useQuery<PortalData>(userId ? `student-portal:${userId}:${year}` : null, async () => {
    const recs = unwrap(await supabase
      .from('students')
      .select(`id, full_name,
        enrolments:student_enrolments!student_enrolments_student_id_fkey(id, academic_year, total_lessons, lessons_used, start_date, payment_plan, rate_per_lesson, total_fee, registration_fee),
        payments:payment_records!payment_records_student_id_fkey(id, plan, amount, instalment_number, due_date, paid_date, invoice:invoices(id, invoice_number, pdf_path))`)
      .eq('user_id', userId!)
      .eq('enrolments.academic_year', year)
      .order('full_name')
      .order('id'), []) as unknown as PortalRecord[];
    return {
      children: withLabels(recs),
      enrolments: recs.flatMap((r) => (r.enrolments ?? []).map((e) => ({ ...e, student_id: r.id }))),
      payments: recs
        .flatMap((r) => (r.payments ?? []).map((p) => ({ ...p, student_id: r.id })))
        .sort((a, b) => a.due_date.localeCompare(b.due_date)),
    };
  }, { staleTime: 60_000 });

  const children = useMemo(() => portal.data?.children ?? [], [portal.data]);
  const allIds = useMemo(() => children.map((c) => c.id), [children]);
  const isFamily = children.length > 1;

  // Chosen child (null = All), remembered per login on this device.
  const [savedChild, setSavedChild] = useState<string | null>(() => readSavedChild(userId));
  useEffect(() => { setSavedChild(readSavedChild(userId)); }, [userId]);
  const selectedChildId = isFamily && savedChild && allIds.includes(savedChild) ? savedChild : null;
  const setSelectedChildId = useCallback((id: string | null) => {
    setSavedChild(id);
    if (!userId) return;
    try {
      if (id) localStorage.setItem(CHILD_KEY(userId), id);
      else localStorage.removeItem(CHILD_KEY(userId));
    } catch { /* storage blocked: choice lasts until reload */ }
  }, [userId]);

  const lessons = useStudentLessons(userId, portal.data ? allIds : undefined);
  const absence = useStudentAbsenceRequests(userId);
  const { refresh: refreshPortal } = portal;
  const { refresh: refreshLessons } = lessons;
  const { refresh: refreshAbsences } = absence;
  const refresh = useCallback(async () => {
    await Promise.all([refreshPortal(), refreshLessons(), refreshAbsences()]);
  }, [refreshPortal, refreshLessons, refreshAbsences]);

  const visibleStudentIds = useMemo(() => (selectedChildId ? [selectedChildId] : allIds), [selectedChildId, allIds]);
  const value = useMemo(() => {
    const shown = new Set(visibleStudentIds);
    const labels = new Map(children.map((c) => [c.id, c.label]));
    const labelRows = isFamily && !selectedChildId;
    const stats = visibleStudentIds.map((id) => lessons.statsByStudent[id]);
    return {
      studentName: profile?.full_name || '',
      email: profile?.email || '',
      children,
      isFamily,
      selectedChildId,
      setSelectedChildId,
      visibleStudentIds,
      childLabel: (studentId: string) => (labelRows ? labels.get(studentId) ?? null : null),
      enrolments: (portal.data?.enrolments ?? []).filter((e) => shown.has(e.student_id)),
      payments: (portal.data?.payments ?? []).filter((p) => shown.has(p.student_id)),
      upcoming: lessons.upcoming.filter((l) => shown.has(l.student_id)),
      past: lessons.past.filter((l) => shown.has(l.student_id)),
      totalCompleted: stats.reduce((n, s) => n + (s?.attended ?? 0), 0),
      totalMissed: stats.reduce((n, s) => n + (s?.missed ?? 0), 0),
      loadingLessons: lessons.loading,
      loadingPast: lessons.loadingPast,
      lessonsError: lessons.error,
      absences: absence.absences,
      requestAbsence: absence.requestAbsence,
      withdrawAbsence: absence.withdrawAbsence,
      refresh,
    };
  }, [visibleStudentIds, children, isFamily, selectedChildId, setSelectedChildId, profile, portal.data, lessons, absence, refresh]);

  if (portal.loading || (!userId && !portal.error)) return <CenterSpinner />;

  if (portal.error && portal.data === undefined) {
    return (
      <div className="max-w-md mx-auto py-10">
        <ErrorBanner message={portal.error} onRetry={() => { void portal.refresh(); }} />
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <UserX size={48} className="text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-navy mb-2">Not Enrolled Yet</h2>
        <p className="text-gray-500 text-sm">
          Your coordinator hasn't set up your student profile yet. Please contact them to get started.
        </p>
        <p className="text-gray-400 text-xs mt-4">Signed in as {profile?.email}</p>
      </div>
    );
  }

  return (
    <StudentPortalContext.Provider value={value}>
      {isFamily && (
        <ChildChips
          items={children}
          selected={selectedChildId}
          onSelect={setSelectedChildId}
        />
      )}
      <Outlet />
    </StudentPortalContext.Provider>
  );
}
