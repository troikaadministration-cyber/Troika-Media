import { useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { UserX } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useStudentLessons, useStudentAbsenceRequests } from '../../hooks/useStudentLessons';
import { supabase } from '../../lib/supabase';
import { useQuery, unwrap } from '../../lib/queryCache';
import { CenterSpinner } from '../../components/student/shared';
import { ErrorBanner } from '../../components/ErrorBanner';
import { StudentPortalContext, type Enrolment, type Payment } from './StudentPortalContext';

interface PortalRecord {
  id: string;
  enrolments: Enrolment[];
  payments: Payment[];
}

/**
 * Layout route for the whole student portal.
 * Loads the student record (+ this year's enrolments and payments in the same
 * request) and the lessons in parallel, cached, and shares them with every
 * child page via context — navigating between portal pages never refetches
 * from scratch.
 */
export function StudentShell() {
  const { profile } = useAuth();
  const userId = profile?.id;
  const year = new Date().getFullYear().toString();

  const portal = useQuery<PortalRecord | null>(userId ? `student-portal:${userId}:${year}` : null, async () => {
    const rec = unwrap(await supabase
      .from('students')
      .select(`id,
        enrolments:student_enrolments!student_enrolments_student_id_fkey(id, academic_year, total_lessons, lessons_used, start_date, payment_plan, rate_per_lesson, total_fee, registration_fee),
        payments:payment_records!payment_records_student_id_fkey(id, plan, amount, instalment_number, due_date, paid_date, invoice:invoices(id, invoice_number, pdf_path))`)
      .eq('user_id', userId!)
      .eq('enrolments.academic_year', year)
      .maybeSingle(), null) as PortalRecord | null;
    if (rec) rec.payments = [...(rec.payments ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date));
    return rec;
  }, { staleTime: 60_000 });

  const lessons = useStudentLessons(userId);
  const absence = useStudentAbsenceRequests(userId);
  const { refresh: refreshPortal } = portal;
  const { refresh: refreshLessons } = lessons;
  const { refresh: refreshAbsences } = absence;
  const refresh = useCallback(async () => {
    await Promise.all([refreshPortal(), refreshLessons(), refreshAbsences()]);
  }, [refreshPortal, refreshLessons, refreshAbsences]);

  if (portal.loading || (!userId && !portal.error)) return <CenterSpinner />;

  if (portal.error && portal.data === undefined) {
    return (
      <div className="max-w-md mx-auto py-10">
        <ErrorBanner message={portal.error} onRetry={() => { void portal.refresh(); }} />
      </div>
    );
  }

  const student = portal.data;
  if (!student) {
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
    <StudentPortalContext.Provider
      value={{
        studentId: student.id,
        studentName: profile?.full_name || '',
        email: profile?.email || '',
        enrolments: student.enrolments ?? [],
        payments: student.payments ?? [],
        upcoming: lessons.upcoming,
        past: lessons.past,
        totalCompleted: lessons.totalCompleted,
        totalMissed: lessons.totalMissed,
        loadingLessons: lessons.loading,
        loadingPast: lessons.loadingPast,
        lessonsError: lessons.error,
        absences: absence.absences,
        requestAbsence: absence.requestAbsence,
        withdrawAbsence: absence.withdrawAbsence,
        refresh,
      }}
    >
      <Outlet />
    </StudentPortalContext.Provider>
  );
}
