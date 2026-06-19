import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { UserX } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useStudentLessons } from '../../hooks/useStudentLessons';
import { supabase } from '../../lib/supabase';
import { CenterSpinner } from '../../components/student/shared';
import { StudentPortalContext, type Enrolment, type Payment } from './StudentPortalContext';

/**
 * Layout route for the whole student portal.
 * Resolves the student record + enrolments + payments + lessons ONCE and
 * shares them with every child page via context, so navigating between
 * Home / Lessons / Calendar / Payments doesn't re-fetch.
 */
export function StudentShell() {
  const { profile } = useAuth();
  const [studentId, setStudentId] = useState<string>();
  const [notFound, setNotFound] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;

    (async () => {
      const { data: student, error } = await supabase
        .from('students')
        .select('id')
        .eq('user_id', profile.id)
        .maybeSingle();

      if (!active) return;
      if (error || !student) {
        setNotFound(true);
        setLookupDone(true);
        return;
      }

      setStudentId(student.id);

      const year = new Date().getFullYear().toString();
      const [enrRes, payRes] = await Promise.all([
        supabase
          .from('student_enrolments')
          .select('*')
          .eq('student_id', student.id)
          .eq('academic_year', year),
        supabase
          .from('payment_records')
          .select('*, invoice:invoices(id, invoice_number)')
          .eq('student_id', student.id)
          .order('due_date', { ascending: true }),
      ]);

      if (!active) return;
      if (enrRes.data) setEnrolments(enrRes.data as Enrolment[]);
      if (payRes.data) setPayments(payRes.data as Payment[]);
      setLookupDone(true);
    })();

    return () => { active = false; };
  }, [profile?.id]);

  const { upcoming, past, loading, totalCompleted, cancelLesson, refresh } = useStudentLessons(studentId);

  if (!lookupDone) return <CenterSpinner />;

  if (notFound || !studentId) {
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
        studentId,
        studentName: profile?.full_name || '',
        email: profile?.email || '',
        enrolments,
        payments,
        upcoming,
        past,
        totalCompleted,
        loadingLessons: loading,
        cancelLesson,
        refresh,
      }}
    >
      <Outlet />
    </StudentPortalContext.Provider>
  );
}
