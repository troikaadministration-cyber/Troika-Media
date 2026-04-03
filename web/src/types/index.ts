export type UserRole = 'coordinator' | 'teacher' | 'student';
export type LessonType = 'regular' | 'makeup' | 'special' | 'demo' | 'workshop' | 'one_time';
export type MakeupDirection = 'teacher_teaching' | 'teacher_learning';
export type CancelledByRole = 'student' | 'teacher' | 'coordinator';
export type LessonStatus = 'scheduled' | 'completed' | 'cancelled';
export type AbsenceCategory = 'charged' | 'not_charged';
export type PaymentPlan = 'trial' | '1_instalment' | '3_instalments' | '10_instalments';
export type PieceStatus = 'not_started' | 'in_progress' | 'completed';
export type ResourceType = 'piece' | 'exercise' | 'activity';
export type ResourceLevel = 'beginner' | 'intermediate' | 'advanced';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  email: string;
  phone: string | null;
  approved: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  name: string;
  address: string;
  city: string;
  zone: string;
  created_at: string;
}

export interface Instrument {
  id: string;
  name: string;
  icon: string | null;
  created_at: string;
}

export interface Student {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  location_id: string | null;
  instrument_id: string | null;
  payment_plan: PaymentPlan;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lesson {
  id: string;
  teacher_id: string;
  location_id: string | null;
  instrument_id: string | null;
  lesson_type: LessonType;
  status: LessonStatus;
  date: string;
  start_time: string;
  end_time: string | null;
  title: string;
  notes: string | null;
  is_charged: boolean;
  cancelled_by_role: CancelledByRole | null;
  cancelled_by_user_id: string | null;
  cancelled_by_student_id: string | null;
  cancel_reason: string | null;
  makeup_direction: MakeupDirection | null;
  source_break_id: string | null;
  pending_reschedule: boolean;
  created_at: string;
  updated_at: string;
}

export interface LessonStudent {
  id: string;
  lesson_id: string;
  student_id: string;
  attended: boolean | null;
  absence_category: AbsenceCategory | null;
  created_at: string;
}

export interface StudentPiece {
  id: string;
  student_id: string;
  teacher_id: string;
  title: string;
  status: PieceStatus;
  added_date: string;
  updated_at: string;
}

export interface MediaUpload {
  id: string;
  lesson_id: string;
  teacher_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  supabase_path: string;
  google_drive_url: string | null;
  synced_to_drive: boolean;
  created_at: string;
}

export interface CurriculumResource {
  id: string;
  title: string;
  description: string | null;
  type: ResourceType;
  level: ResourceLevel;
  teaching_tip: string | null;
  location_id: string | null;
  source_file: string | null;
  created_at: string;
  updated_at: string;
}

export interface CurriculumTag {
  id: string;
  name: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}

export interface PaymentRecord {
  id: string;
  student_id: string;
  plan: PaymentPlan;
  amount: number;
  instalment_number: number;
  due_date: string;
  paid_date: string | null;
  reminder_sent: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
}

export type LessonCategory =
  | '1:1_instrumental'
  | '1:1_theory'
  | '1:1_vocals'
  | 'group_strings'
  | 'group_guitar'
  | 'group_vocals'
  | 'group_theory'
  | 'demo';

export interface LessonRate {
  id: string;
  teacher_id: string | null;
  location_id: string | null;
  category: LessonCategory;
  rate_per_lesson: number;
  is_online: boolean;
  academic_year: string;
  created_at: string;
}

export interface StudentEnrolment {
  id: string;
  student_id: string;
  academic_year: string;
  lesson_rate_id: string | null;
  total_lessons: number;
  lessons_used: number;
  start_date: string;
  payment_plan: PaymentPlan;
  rate_per_lesson: number;
  total_fee: number;
  registration_fee: number;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  payment_id: string;
  student_id: string;
  amount: number;
  currency: string;
  description: string | null;
  issued_date: string;
  pdf_path: string | null;
  emailed_to: string | null;
  emailed_at: string | null;
  created_at: string;
}

export interface StudentStats {
  student_id: string;
  student_name: string;
  total_lessons: number;
  regular_lessons: number;
  makeup_lessons: number;
  special_lessons: number;
  charged_absences: number;
  not_charged_absences: number;
}

export interface LessonWithDetails extends Lesson {
  teacher?: Profile;
  location?: Location;
  instrument?: Instrument;
  students?: (LessonStudent & { student?: Student })[];
  pieces?: StudentPiece[];
  media?: MediaUpload[];
}

export interface CurriculumResourceWithTags extends CurriculumResource {
  tags?: CurriculumTag[];
}

export interface ScheduledBreak {
  id: string;
  created_by: string;
  title: string;
  start_date: string;
  end_date: string;
  student_ids: string[];
  total_cancelled: number;
  total_rescheduled: number;
  created_at: string;
}

export interface TeacherScheduleTemplate {
  id: string;
  teacher_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string | null;
  location_id: string | null;
  instrument_id: string | null;
  title: string;
  student_ids: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
