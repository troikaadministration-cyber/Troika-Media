import { createContext, useContext } from 'react';
import type { StudentLesson, AbsenceRequest } from '../../hooks/useStudentLessons';

export interface Enrolment {
  id: string;
  student_id: string;
  academic_year: string;
  total_lessons: number;
  lessons_used: number;
  start_date: string;
  payment_plan: string;
  rate_per_lesson: number;
  total_fee: number;
  registration_fee: number;
}

export interface Payment {
  id: string;
  student_id: string;
  plan: string;
  amount: number;
  instalment_number: number;
  due_date: string;
  paid_date: string | null;
  invoice?: { id: string; invoice_number: string; pdf_path: string | null } | null;
}

/** One student (child) on the signed-in login. */
export interface Child {
  id: string;
  full_name: string;
  /** Short name for chips / row labels (first name, unless siblings share it). */
  label: string;
}

export interface StudentPortalValue {
  /** Name of the signed-in login (the parent on a family login). */
  studentName: string;
  email: string;
  /** Every student on this login (one, or several for a family login). */
  children: Child[];
  /** True when the login has more than one child. */
  isFamily: boolean;
  /** Child chosen in the chips, or null = "All". Always null for one child. */
  selectedChildId: string | null;
  setSelectedChildId: (id: string | null) => void;
  /** Students currently shown (the selected child, or all of them). */
  visibleStudentIds: string[];
  /**
   * Child's name to label a row with — only while several children are shown
   * ("All" on a family login); null otherwise, so one-child UIs are unchanged.
   */
  childLabel: (studentId: string) => string | null;
  /** The rest below are already filtered to visibleStudentIds. */
  enrolments: Enrolment[];
  payments: Payment[];
  upcoming: StudentLesson[];
  past: StudentLesson[];
  totalCompleted: number;
  totalMissed: number;
  /** True only until upcoming / past lessons first load (show skeletons). */
  loadingLessons: boolean;
  loadingPast: boolean;
  lessonsError: string | null;
  /** Latest absence request per absenceKey(lesson, student) (withdrawn ones omitted). */
  absences: Record<string, AbsenceRequest>;
  requestAbsence: (lessonId: string, studentId: string, reason: string) => Promise<{ id: string; late_notice: boolean }>;
  withdrawAbsence: (requestId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export const StudentPortalContext = createContext<StudentPortalValue | null>(null);

export function useStudentPortal(): StudentPortalValue {
  const ctx = useContext(StudentPortalContext);
  if (!ctx) throw new Error('useStudentPortal must be used within <StudentShell>');
  return ctx;
}
