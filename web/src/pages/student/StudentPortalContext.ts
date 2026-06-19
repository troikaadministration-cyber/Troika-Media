import { createContext, useContext } from 'react';
import type { StudentLesson } from '../../hooks/useStudentLessons';

export interface Enrolment {
  id: string;
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
  plan: string;
  amount: number;
  instalment_number: number;
  due_date: string;
  paid_date: string | null;
  invoice?: { id: string; invoice_number: string } | null;
}

export interface CancelLessonOptions {
  teacherId: string | null;
  date: string;
  startTime: string;
  studentName: string;
  reason?: string;
}

export interface StudentPortalValue {
  studentId: string;
  studentName: string;
  email: string;
  enrolments: Enrolment[];
  payments: Payment[];
  upcoming: StudentLesson[];
  past: StudentLesson[];
  totalCompleted: number;
  loadingLessons: boolean;
  cancelLesson: (lessonId: string, userId: string, options: CancelLessonOptions) => Promise<void>;
  refresh: () => void;
}

export const StudentPortalContext = createContext<StudentPortalValue | null>(null);

export function useStudentPortal(): StudentPortalValue {
  const ctx = useContext(StudentPortalContext);
  if (!ctx) throw new Error('useStudentPortal must be used within <StudentShell>');
  return ctx;
}
