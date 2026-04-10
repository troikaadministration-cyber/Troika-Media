import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Search, Mail, Phone, MapPin, Music, Calendar, RefreshCw } from 'lucide-react';
import { TeacherApprovalPanel } from '../components/TeacherApprovalPanel';

interface PendingProfile { id: string; full_name: string; email: string; }

interface TeacherInfo {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  lessonCount: number;
  studentCount: number;
  instruments: string[];
  locations: string[];
}

export function TeachersPage() {
  const [teachers, setTeachers] = useState<TeacherInfo[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingProfiles, setPendingProfiles] = useState<PendingProfile[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelProfile, setPanelProfile] = useState<PendingProfile | null>(null);

  async function fetchPending() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'teacher')
      .is('approved', null);
    setPendingProfiles((data || []) as PendingProfile[]);
  }

  function openPanel(profile: PendingProfile) {
    setPanelProfile(profile);
    setPanelOpen(true);
  }

  function handlePanelComplete() {
    setPanelOpen(false);
    setPanelProfile(null);
    fetchPending();
    load();
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Single nested query instead of 2N+1
      const { data: profiles, error: err } = await supabase
        .from('profiles')
        .select(`
          id, full_name, email, phone,
          lessons:lessons(
            id,
            instrument:instruments(name),
            location:locations(name),
            students:lesson_students(student_id)
          )
        `)
        .eq('role', 'teacher')
        .order('full_name');

      if (err) throw err;
      if (!profiles) { setLoading(false); return; }

      const teacherInfos: TeacherInfo[] = profiles.map((p: any) => {
        const lessons = p.lessons || [];
        const instrumentNames = [...new Set(lessons.map((l: any) => l.instrument?.name).filter(Boolean))] as string[];
        const locationNames = [...new Set(lessons.map((l: any) => l.location?.name).filter(Boolean))] as string[];
        const uniqueStudents = new Set(
          lessons.flatMap((l: any) => (l.students || []).map((s: any) => s.student_id))
        );
        return {
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          phone: p.phone,
          lessonCount: lessons.length,
          studentCount: uniqueStudents.size,
          instruments: instrumentNames,
          locations: locationNames,
        };
      });

      setTeachers(teacherInfos);
    } catch (err: any) {
      setError(err.message || 'Failed to load teachers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); fetchPending(); }, []);

  const filtered = teachers.filter((t) =>
    t.full_name.toLowerCase().includes(search.toLowerCase()) ||
    t.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-gray-400">Loading...</p></div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Teachers</h1>
        <p className="text-gray-500 text-sm">{teachers.length} teachers</p>
      </div>

      {error && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center justify-between">
          <p className="text-coral text-sm">{error}</p>
          <button onClick={load} className="flex items-center gap-1 text-coral text-sm font-medium hover:underline"><RefreshCw size={14} />Retry</button>
        </div>
      )}

      {pendingProfiles.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-400 text-white rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
              {pendingProfiles.length}
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {pendingProfiles.length} teacher{pendingProfiles.length > 1 ? 's' : ''} waiting for approval
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                {pendingProfiles.slice(0, 3).map(p => p.full_name).join(', ')}
                {pendingProfiles.length > 3 ? ` + ${pendingProfiles.length - 3} more` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => openPanel(pendingProfiles[0])}
            className="bg-amber-400 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-500 whitespace-nowrap flex-shrink-0"
          >
            Review →
          </button>
        </div>
      )}

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search teachers..."
          aria-label="Search teachers"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-coral/30 focus:border-coral outline-none" />
      </div>

      <TeacherApprovalPanel
        open={panelOpen}
        profile={panelProfile}
        onClose={() => { setPanelOpen(false); setPanelProfile(null); }}
        onComplete={handlePanelComplete}
      />

      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">No teachers found</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-sm transition-shadow">
              <h3 className="font-semibold text-navy text-lg">{t.full_name}</h3>

              <div className="mt-3 space-y-1.5">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Mail size={14} /> <span className="truncate">{t.email}</span>
                </div>
                {t.phone && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Phone size={14} /> {t.phone}
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5 text-navy">
                  <Calendar size={14} className="text-teal" />
                  <span className="font-medium">{t.lessonCount}</span>
                  <span className="text-gray-400">lessons</span>
                </div>
                <div className="flex items-center gap-1.5 text-navy">
                  <span className="font-medium">{t.studentCount}</span>
                  <span className="text-gray-400">students</span>
                </div>
              </div>

              {t.instruments.length > 0 && (
                <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                  <Music size={12} className="text-gray-400" />
                  {t.instruments.map((name) => (
                    <span key={name} className="text-[10px] bg-navy/10 text-navy px-2 py-0.5 rounded-full">{name}</span>
                  ))}
                </div>
              )}

              {t.locations.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <MapPin size={12} className="text-gray-400" />
                  {t.locations.map((name) => (
                    <span key={name} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{name}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
