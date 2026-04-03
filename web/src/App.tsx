import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './pages/Login';
import { RoleSetupPage } from './pages/RoleSetup';
import { Clock, XCircle, LogOut } from 'lucide-react';

const DashboardPage = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const SchedulePage = lazy(() => import('./pages/Schedule').then(m => ({ default: m.SchedulePage })));
const StudentsPage = lazy(() => import('./pages/Students').then(m => ({ default: m.StudentsPage })));
const StudentDetailPage = lazy(() => import('./pages/StudentDetail').then(m => ({ default: m.StudentDetailPage })));
const PaymentsPage = lazy(() => import('./pages/Payments').then(m => ({ default: m.PaymentsPage })));
const CurriculumAdminPage = lazy(() => import('./pages/CurriculumAdmin').then(m => ({ default: m.CurriculumAdminPage })));
const TeachersPage = lazy(() => import('./pages/Teachers').then(m => ({ default: m.TeachersPage })));
const LessonRatesPage = lazy(() => import('./pages/LessonRates').then(m => ({ default: m.LessonRatesPage })));
const TeacherSchedulePage = lazy(() => import('./pages/TeacherSchedule').then(m => ({ default: m.TeacherSchedulePage })));
const TeacherCurriculumPage = lazy(() => import('./pages/TeacherCurriculum').then(m => ({ default: m.TeacherCurriculumPage })));
const StudentLessonsPage = lazy(() => import('./pages/StudentLessons').then(m => ({ default: m.StudentLessonsPage })));
const EnrolmentsPage = lazy(() => import('./pages/Enrolments').then(m => ({ default: m.EnrolmentsPage })));
const TeacherScheduleAdminPage = lazy(() => import('./pages/TeacherScheduleAdmin').then(m => ({ default: m.TeacherScheduleAdminPage })));
const TeacherCalendarPage = lazy(() => import('./pages/TeacherCalendar').then(m => ({ default: m.TeacherCalendarPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-coral border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadeOut(true), 1800);
    const doneTimer = setTimeout(onDone, 2300);
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer); };
  }, [onDone]);

  return (
    <div className={`h-screen flex items-center justify-center bg-gray-50 overflow-hidden relative transition-opacity duration-500 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}>
      {/* Burst ring */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-72 h-72 rounded-full border-4 border-dashed border-coral/20 splash-burst" />
      </div>

      {/* Stars */}
      <svg className="splash-star w-6 h-6 text-yellow" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="12,2 15,9 22,9 16,14 18,22 12,17 6,22 8,14 2,9 9,9" />
      </svg>
      <svg className="splash-star w-5 h-5 text-coral" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="12,2 15,9 22,9 16,14 18,22 12,17 6,22 8,14 2,9 9,9" />
      </svg>
      <svg className="splash-star w-4 h-4 text-teal" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="12,2 15,9 22,9 16,14 18,22 12,17 6,22 8,14 2,9 9,9" />
      </svg>
      <svg className="splash-star w-5 h-5 text-yellow" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="12,2 15,9 22,9 16,14 18,22 12,17 6,22 8,14 2,9 9,9" />
      </svg>

      <div className="text-center relative z-10">
        <h1 className="font-logo text-7xl sm:text-8xl text-navy mb-2 splash-logo drop-shadow-lg">troika</h1>
        <p className="text-teal text-xl sm:text-2xl font-medium splash-subtitle">music lessons</p>
        <p className="text-coral text-sm sm:text-base mt-1 splash-tagline">every note counts</p>
      </div>
    </div>
  );
}

function PendingApproval({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-8">
          <h1 className="font-logo text-5xl text-navy">troika</h1>
          <p className="text-teal text-lg mt-1">music lessons</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="w-16 h-16 bg-yellow/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock size={32} className="text-yellow-600" />
          </div>
          <h2 className="text-xl font-bold text-navy mb-2">Account Pending Approval</h2>
          <p className="text-gray-500 text-sm mb-6">
            Your account has been created and is waiting for coordinator approval.
            You'll be able to access the app once your account is approved.
          </p>
          <button
            onClick={onSignOut}
            className="flex items-center gap-2 mx-auto text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountDenied({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-8">
          <h1 className="font-logo text-5xl text-navy">troika</h1>
          <p className="text-teal text-lg mt-1">music lessons</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="w-16 h-16 bg-coral/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle size={32} className="text-coral" />
          </div>
          <h2 className="text-xl font-bold text-navy mb-2">Account Not Approved</h2>
          <p className="text-gray-500 text-sm mb-6">
            Your account request was not approved. If you believe this is an error,
            please contact your coordinator.
          </p>
          <button
            onClick={onSignOut}
            className="flex items-center gap-2 mx-auto text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { session, profile, loading, approvalStatus, signOut } = useAuth();
  const [splashDone, setSplashDone] = useState(() => !!sessionStorage.getItem('troika_splash'));

  // Show splash only once per session
  if (!splashDone) {
    return <SplashScreen onDone={() => { sessionStorage.setItem('troika_splash', '1'); setSplashDone(true); }} />;
  }

  // Still loading auth after splash
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="font-logo text-5xl text-navy mb-2">troika</h1>
          <p className="text-teal text-lg">music lessons</p>
          <div className="mt-4 flex justify-center">
            <div className="w-6 h-6 border-2 border-coral border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  // No profile and no approval status → needs RoleSetup
  if (!profile && !approvalStatus) {
    return <RoleSetupPage />;
  }

  // Has set up profile but pending approval
  if (approvalStatus === 'pending') {
    return <PendingApproval onSignOut={signOut} />;
  }

  // Account denied
  if (approvalStatus === 'denied') {
    return <AccountDenied onSignOut={signOut} />;
  }

  if (!profile) {
    return <RoleSetupPage />;
  }

  return (
    <Layout>
      <ErrorBoundary fallbackRoute>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {profile.role === 'coordinator' ? (
            <>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/students" element={<StudentsPage />} />
              <Route path="/students/:id" element={<StudentDetailPage />} />
              <Route path="/teachers" element={<TeachersPage />} />
              <Route path="/payments" element={<PaymentsPage />} />
              <Route path="/lesson-rates" element={<LessonRatesPage />} />
              <Route path="/curriculum" element={<CurriculumAdminPage />} />
              <Route path="/enrolments" element={<EnrolmentsPage />} />
              <Route path="/teacher-schedules" element={<TeacherScheduleAdminPage />} />
            </>
          ) : profile.role === 'teacher' ? (
            <>
              <Route path="/" element={<TeacherSchedulePage />} />
              <Route path="/schedule" element={<TeacherSchedulePage />} />
              <Route path="/calendar" element={<TeacherCalendarPage />} />
              <Route path="/curriculum" element={<TeacherCurriculumPage />} />
            </>
          ) : profile.role === 'student' ? (
            <>
              <Route path="/" element={<StudentLessonsPage />} />
              <Route path="/lessons" element={<StudentLessonsPage />} />
            </>
          ) : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
