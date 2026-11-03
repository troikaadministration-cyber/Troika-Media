import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery, unwrap, invalidateQueries } from '../lib/queryCache';
import { fetchAll } from '../lib/fetchAll';
import { invalidateReference } from '../hooks/useReference';
import { Search, Mail, Phone, MapPin, Music, Calendar, RefreshCw } from 'lucide-react';
import { TeacherApprovalPanel } from '../components/TeacherApprovalPanel';
import { SkeletonList } from '../components/Skeleton';

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

interface SlotRow {
  teacher_id: string;
  student_ids: string[] | null;
  instrument: { name: string } | null;
  location: { name: string } | null;
}

const uniq = (xs: (string | undefined | null)[]) => [...new Set(xs.filter(Boolean))] as string[];

/**
 * Teacher cards. Instead of downloading every lesson (and its students) ever
 * taught, we fetch: lesson counts (head-only, per teacher, in parallel) and the
 * active weekly class slots, which give the current students/instruments/locations.
 */
async function loadTeachers(): Promise<TeacherInfo[]> {
  const [profiles, slots] = await Promise.all([
    supabase.from('profiles')
      .select('id, full_name, email, phone')
      .eq('role', 'teacher')
      .eq('approved', true)
      .order('full_name')
      .then((r) => unwrap(r, []) as { id: string; full_name: string; email: string; phone: string | null }[]),
    fetchAll<SlotRow>((from, to) => supabase.from('teacher_schedule_templates')
      .select('teacher_id, student_ids, instrument:instruments(name), location:locations(name)')
      .eq('is_active', true)
      .order('id')
      .range(from, to)),
  ]);

  const counts = await Promise.all(profiles.map(async (p) => {
    const { count, error } = await supabase.from('lessons')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_id', p.id);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }));

  return profiles.map((p, i) => {
    const mine = slots.filter((s) => s.teacher_id === p.id);
    return {
      ...p,
      lessonCount: counts[i],
      studentCount: new Set(mine.flatMap((s) => s.student_ids ?? [])).size,
      instruments: uniq(mine.map((s) => s.instrument?.name)),
      locations: uniq(mine.map((s) => s.location?.name)),
    };
  });
}

export function TeachersPage() {
  const [search, setSearch] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelProfile, setPanelProfile] = useState<PendingProfile | null>(null);

  const { data, loading, error, refresh } = useQuery<TeacherInfo[]>('teachers:list', loadTeachers);
  const teachers = data ?? [];

  const pendingQ = useQuery<PendingProfile[]>('teachers:pending', async () =>
    unwrap(await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'teacher')
      .is('approved', null), []) as PendingProfile[]);
  const pendingProfiles = pendingQ.data ?? [];

  function openPanel(profile: PendingProfile) {
    setPanelProfile(profile);
    setPanelOpen(true);
  }

  function handlePanelComplete() {
    setPanelOpen(false);
    setPanelProfile(null);
    invalidateQueries('teachers:');
    invalidateReference('teachers');
  }

  const filtered = teachers.filter((t) =>
    t.full_name.toLowerCase().includes(search.toLowerCase()) ||
    t.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <SkeletonList rows={6} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Teachers</h1>
        <p className="text-gray-500 text-sm">{teachers.length} teachers</p>
      </div>

      {error && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center justify-between">
          <p className="text-coral text-sm">{error}</p>
          <button onClick={refresh} className="flex items-center gap-1 text-coral text-sm font-medium hover:underline"><RefreshCw size={14} />Retry</button>
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
            <div key={t.id} className="bg-white rounded-xl border border-black/5 p-5 hover:shadow-sm transition-shadow">
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
