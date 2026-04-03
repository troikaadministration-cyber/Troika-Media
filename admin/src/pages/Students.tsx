import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserCheck, UserX } from 'lucide-react';
import { useStudents } from '../hooks/useStudents';
import { supabase } from '../lib/supabase';
import type { Instrument, Location } from '@troika/shared';
import { OnboardingWizard } from '../components/OnboardingWizard';

interface PendingProfile { id: string; full_name: string; email: string; }

export function StudentsPage() {
  const [search, setSearch] = useState('');
  const [instrumentFilter, setInstrumentFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const navigate = useNavigate();

  // Pending approvals
  const [pendingProfiles, setPendingProfiles] = useState<PendingProfile[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardProfile, setWizardProfile] = useState<PendingProfile | null>(null);

  const { students, loading, refresh } = useStudents({
    instrumentId: instrumentFilter || undefined,
    isActive: activeFilter,
  });

  useEffect(() => {
    supabase.from('instruments').select('*').then(({ data }) => setInstruments(data || []));
    supabase.from('locations').select('*').then(({ data }) => setLocations(data || []));
    fetchPending();
  }, []);

  async function fetchPending() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'student')
      .is('approved', null);
    setPendingProfiles((data || []) as PendingProfile[]);
  }

  function openWizard(profile: PendingProfile | null) {
    setWizardProfile(profile);
    setWizardOpen(true);
  }

  function handleWizardComplete() {
    setWizardOpen(false);
    setWizardProfile(null);
    fetchPending();
    refresh();
  }

  const filtered = students.filter((s: any) =>
    s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase())
  );

  const pendingPreview = pendingProfiles.slice(0, 3).map(p => p.full_name).join(', ') +
    (pendingProfiles.length > 3 ? ` + ${pendingProfiles.length - 3} more` : '');

  // suppress unused warning
  void locations;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Students</h1>
          <p className="text-gray-500 text-sm mt-1">{students.length} total students</p>
        </div>
        <button
          onClick={() => openWizard(null)}
          className="flex items-center gap-2 bg-coral text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90"
        >
          + Add Student
        </button>
      </div>

      {/* Pending approval banner */}
      {pendingProfiles.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-400 text-white rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
              {pendingProfiles.length}
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {pendingProfiles.length} student{pendingProfiles.length > 1 ? 's' : ''} waiting for approval
              </p>
              <p className="text-xs text-amber-600 mt-0.5">{pendingPreview}</p>
            </div>
          </div>
          <button
            onClick={() => openWizard(pendingProfiles[0])}
            className="bg-amber-400 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-500 whitespace-nowrap flex-shrink-0"
          >
            Review →
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search students..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <select
            value={instrumentFilter}
            onChange={(e) => setInstrumentFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All Instruments</option>
            {instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <button onClick={() => setActiveFilter(undefined)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${activeFilter === undefined ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600'}`}>All</button>
            <button onClick={() => setActiveFilter(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${activeFilter === true ? 'bg-teal text-white' : 'bg-gray-100 text-gray-600'}`}>Active</button>
            <button onClick={() => setActiveFilter(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${activeFilter === false ? 'bg-coral text-white' : 'bg-gray-100 text-gray-600'}`}>Inactive</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Student</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Instrument · Location</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Contact</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={4} className="text-center text-gray-400 py-12">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-gray-400 py-12">No students found</td></tr>
            ) : (
              filtered.map((student: any) => (
                <tr
                  key={student.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/students/${student.id}`)}
                >
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-navy text-sm">{student.full_name}</p>
                    <p className="text-xs text-gray-400">{student.email || ''}</p>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-600">
                    {[student.instrument?.name, student.location?.name].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-600">{student.phone || '—'}</td>
                  <td className="px-5 py-3.5">
                    {student.is_active ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal bg-teal-light px-2.5 py-1 rounded-full">
                        <UserCheck size={12} /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                        <UserX size={12} /> Inactive
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <OnboardingWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); setWizardProfile(null); }}
        onComplete={handleWizardComplete}
        pendingProfile={wizardProfile}
      />
    </div>
  );
}
