import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Logo } from './components/Logo';
import { LoginPage } from './pages/Login';
import { RoleSetupPage } from './pages/RoleSetup';
import { Clock, XCircle, LogOut, RefreshCw, WifiOff } from 'lucide-react';

// Each page is its own chunk. The loader functions are kept so we can prefetch
// a role's pages in the background right after sign-in (instant navigation).
const loaders = {
  Dashboard: () => import('./pages/Dashboard').then(m => ({ default: m.DashboardPage })),
  Schedule: () => import('./pages/Schedule').then(m => ({ default: m.SchedulePage })),
  Students: () => import('./pages/Students').then(m => ({ default: m.StudentsPage })),
  StudentDetail: () => import('./pages/StudentDetail').then(m => ({ default: m.StudentDetailPage })),
  Payments: () => import('./pages/Payments').then(m => ({ default: m.PaymentsPage })),
  CurriculumAdmin: () => import('./pages/CurriculumAdmin').then(m => ({ default: m.CurriculumAdminPage })),
  Teachers: () => import('./pages/Teachers').then(m => ({ default: m.TeachersPage })),
  LessonRates: () => import('./pages/LessonRates').then(m => ({ default: m.LessonRatesPage })),
  Enrolments: () => import('./pages/Enrolments').then(m => ({ default: m.EnrolmentsPage })),
  TeacherScheduleAdmin: () => import('./pages/TeacherScheduleAdmin').then(m => ({ default: m.TeacherScheduleAdminPage })),
  Breaks: () => import('./pages/Breaks').then(m => ({ default: m.BreaksPage })),
  Locations: () => import('./pages/Locations').then(m => ({ default: m.LocationsPage })),
  Reports: () => import('./pages/Reports').then(m => ({ default: m.ReportsPage })),
  TeacherSchedule: () => import('./pages/TeacherSchedule').then(m => ({ default: m.TeacherSchedulePage })),
  TeacherCalendar: () => import('./pages/TeacherCalendar').then(m => ({ default: m.TeacherCalendarPage })),
  TeacherCurriculum: () => import('./pages/TeacherCurriculum').then(m => ({ default: m.TeacherCurriculumPage })),
  StudentShell: () => import('./pages/student/StudentShell').then(m => ({ default: m.StudentShell })),
  StudentHome: () => import('./pages/student/StudentHome').then(m => ({ default: m.StudentHome })),
  StudentLessonsList: () => import('./pages/student/StudentLessonsList').then(m => ({ default: m.StudentLessonsList })),
  StudentCalendar: () => import('./pages/student/StudentCalendar').then(m => ({ default: m.StudentCalendar })),
  StudentPayments: () => import('./pages/student/StudentPayments').then(m => ({ default: m.StudentPayments })),
} satisfies Record<string, () => Promise<{ default: ComponentType<any> }>>;

type PageName = keyof typeof loaders;

/**
 * A lazily-loaded page that renders directly (no Suspense pause) once its code
 * has been fetched. React holds back a freshly-resolved lazy page for ~300ms to
 * avoid flicker; since we prefetch every page right after sign-in, skipping that
 * makes first visits as fast as revisits.
 */
const loadedPages: Partial<Record<PageName, ComponentType<any>>> = {};
function loadPage(name: PageName) {
  return loaders[name]().then((m) => { loadedPages[name] = m.default; return m; });
}
function page(name: PageName) {
  const Lazy = lazy(() => loadPage(name));
  return function Page(props: Record<string, unknown>) {
    const Loaded = loadedPages[name];
    return Loaded ? <Loaded {...props} /> : <Lazy {...props} />;
  };
}

const DashboardPage = page('Dashboard');
const SchedulePage = page('Schedule');
const StudentsPage = page('Students');
const StudentDetailPage = page('StudentDetail');
const PaymentsPage = page('Payments');
const CurriculumAdminPage = page('CurriculumAdmin');
const TeachersPage = page('Teachers');
const LessonRatesPage = page('LessonRates');
const EnrolmentsPage = page('Enrolments');
const TeacherScheduleAdminPage = page('TeacherScheduleAdmin');
const BreaksPage = page('Breaks');
const LocationsPage = page('Locations');
const ReportsPage = page('Reports');
const TeacherSchedulePage = page('TeacherSchedule');
const TeacherCalendarPage = page('TeacherCalendar');
const TeacherCurriculumPage = page('TeacherCurriculum');
const StudentShell = page('StudentShell');
const StudentHomePage = page('StudentHome');
const StudentLessonsListPage = page('StudentLessonsList');
const StudentCalendarPage = page('StudentCalendar');
const StudentPaymentsPage = page('StudentPayments');

const PREFETCH: Record<string, PageName[]> = {
  coordinator: ['Dashboard', 'Schedule', 'Students', 'Enrolments', 'Payments', 'StudentDetail', 'Teachers',
    'TeacherScheduleAdmin', 'LessonRates', 'Reports', 'Breaks', 'Locations', 'CurriculumAdmin'],
  teacher: ['TeacherSchedule', 'TeacherCalendar', 'TeacherCurriculum'],
  student: ['StudentShell', 'StudentHome', 'StudentLessonsList', 'StudentCalendar', 'StudentPayments'],
};

/** Warm the role's page chunks once the browser is idle, so later clicks don't wait on the network. */
function usePrefetchPages(role: string | undefined) {
  useEffect(() => {
    if (!role) return;
    const names = PREFETCH[role] || [];
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const run = () => { names.forEach((n) => { loadPage(n).catch(() => { /* retried on navigation */ }); }); };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const handle = ric ? ric(run, { timeout: 3000 }) : window.setTimeout(run, 1500);
    return () => {
      const cic = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (cic && 'requestIdleCallback' in window) cic(handle); else clearTimeout(handle);
    };
  }, [role]);
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64" role="status" aria-label="Loading">
      <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function FullScreenLoader() {
  // Delay the spinner slightly so fast loads don't flash it.
  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowSpinner(true), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="h-screen flex items-center justify-center bg-gray-50" role="status" aria-label="Loading">
      <div className="text-center">
        <Logo className="h-20 w-auto mx-auto mb-5" />
        <div className={`flex justify-center transition-opacity ${showSpinner ? 'opacity-100' : 'opacity-0'}`}>
          <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    </div>
  );
}

function StatusCard({ icon, iconBg, title, children }: { icon: ReactNode; iconBg: string; title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md text-center">
        <Logo className="h-20 w-auto mx-auto mb-8" />
        <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-8">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${iconBg}`}>
            {icon}
          </div>
          <h2 className="text-xl font-bold text-navy mb-2">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}

function SignOutButton({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button
      onClick={onSignOut}
      className="flex items-center gap-2 mx-auto text-sm text-gray-400 hover:text-gray-600 transition-colors"
    >
      <LogOut size={16} />
      Sign out
    </button>
  );
}

function PendingApproval({ onSignOut, onCheck }: { onSignOut: () => void; onCheck: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  return (
    <StatusCard icon={<Clock size={32} className="text-yellow" />} iconBg="bg-yellow/10" title="Account Pending Approval">
      <p className="text-gray-500 text-sm mb-6">
        Your account has been created and is waiting for coordinator approval.
        You'll be able to access the app once your account is approved.
      </p>
      <button
        onClick={async () => { setChecking(true); try { await onCheck(); } finally { setChecking(false); } }}
        disabled={checking}
        className="flex items-center gap-2 mx-auto mb-4 bg-teal text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-teal/90 disabled:opacity-60"
      >
        <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
        {checking ? 'Checking…' : 'Check again'}
      </button>
      <SignOutButton onSignOut={onSignOut} />
    </StatusCard>
  );
}

function AccountDenied({ onSignOut }: { onSignOut: () => void }) {
  return (
    <StatusCard icon={<XCircle size={32} className="text-coral" />} iconBg="bg-coral/10" title="Account Not Approved">
      <p className="text-gray-500 text-sm mb-6">
        Your account request was not approved. If you believe this is an error,
        please contact your coordinator.
      </p>
      <SignOutButton onSignOut={onSignOut} />
    </StatusCard>
  );
}

function ProfileLoadError({ message, onRetry, onSignOut }: { message: string; onRetry: () => Promise<void>; onSignOut: () => void }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <StatusCard icon={<WifiOff size={30} className="text-coral" />} iconBg="bg-coral/10" title="Couldn't load your account">
      <p className="text-gray-500 text-sm mb-1">Check your internet connection and try again.</p>
      <p className="text-gray-400 text-xs mb-6 break-words">{message}</p>
      <button
        onClick={async () => { setRetrying(true); try { await onRetry(); } finally { setRetrying(false); } }}
        disabled={retrying}
        className="flex items-center gap-2 mx-auto mb-4 bg-teal text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-teal/90 disabled:opacity-60"
      >
        <RefreshCw size={15} className={retrying ? 'animate-spin' : ''} />
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
      <SignOutButton onSignOut={onSignOut} />
    </StatusCard>
  );
}

export default function App() {
  const { session, profile, loading, approvalStatus, profileError, signOut, refreshProfile } = useAuth();
  const location = useLocation();
  usePrefetchPages(profile?.role);

  if (loading) return <FullScreenLoader />;
  if (!session) return <LoginPage />;

  if (profileError && !profile) {
    return <ProfileLoadError message={profileError} onRetry={refreshProfile} onSignOut={signOut} />;
  }
  if (approvalStatus === 'pending') return <PendingApproval onSignOut={signOut} onCheck={refreshProfile} />;
  if (approvalStatus === 'denied') return <AccountDenied onSignOut={signOut} />;
  if (!profile) return <RoleSetupPage />;

  return (
    <Layout>
      {/* A crash on one page clears when navigating away (without remounting every page). */}
      <ErrorBoundary resetKey={location.pathname}>
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
                <Route path="/breaks" element={<BreaksPage />} />
                <Route path="/locations" element={<LocationsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
              </>
            ) : profile.role === 'teacher' ? (
              <>
                <Route path="/" element={<TeacherSchedulePage />} />
                <Route path="/schedule" element={<TeacherSchedulePage />} />
                <Route path="/calendar" element={<TeacherCalendarPage />} />
                <Route path="/curriculum" element={<TeacherCurriculumPage />} />
              </>
            ) : profile.role === 'student' ? (
              <Route element={<StudentShell />}>
                <Route path="/" element={<StudentHomePage />} />
                <Route path="/lessons" element={<StudentLessonsListPage />} />
                <Route path="/calendar" element={<StudentCalendarPage />} />
                <Route path="/payments" element={<StudentPaymentsPage />} />
              </Route>
            ) : null}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
