import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { SchedulePage } from './pages/Schedule';
import { StudentsPage } from './pages/Students';
import { StudentDetailPage } from './pages/StudentDetail';
import { PaymentsPage } from './pages/Payments';
import { CurriculumAdminPage } from './pages/CurriculumAdmin';
import { TeachersPage } from './pages/Teachers';
import { LessonRatesPage } from './pages/LessonRates';
import { TemplateSchedulePage } from './pages/TemplateSchedule';
import { BreaksPage } from './pages/Breaks';

export default function App() {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-logo text-4xl text-navy mb-2">troika</h1>
          <p className="text-teal">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session || !profile) {
    return <LoginPage />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/templates" element={<TemplateSchedulePage />} />
        <Route path="/breaks" element={<BreaksPage />} />
        <Route path="/students" element={<StudentsPage />} />
        <Route path="/students/:id" element={<StudentDetailPage />} />
        <Route path="/teachers" element={<TeachersPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/lesson-rates" element={<LessonRatesPage />} />
        <Route path="/curriculum" element={<CurriculumAdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
