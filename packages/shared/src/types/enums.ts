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
export type LessonCategory =
  | '1:1_instrumental'
  | '1:1_theory'
  | '1:1_vocals'
  | 'group_strings'
  | 'group_guitar'
  | 'group_vocals'
  | 'group_theory'
  | 'demo';
