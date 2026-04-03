import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLessons } from '../hooks/useLessons';
import { supabase } from '../lib/supabase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MakeupMatchPanel } from '../components/MakeupMatchPanel';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  ChevronLeft, ChevronRight, Plus, X, Clock, MapPin, Users as UsersIcon, Trash2, RefreshCw
} from 'lucide-react';
import type { Profile, Instrument, Location, Student, LessonType, LessonWithDetails } from '../types';

export function SchedulePage() {
  const { profile } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [instrumentFilter, setInstrumentFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [makeupLesson, setMakeupLesson] = useState<LessonWithDetails | null>(null);
  const modalRef = useFocusTrap(showCreate);

  const { lessons, loading, error, createLesson, cancelLesson, deleteLesson, refresh } = useLessons({
    date: view === 'day' ? selectedDate : undefined,
    teacherId: teacherFilter || undefined,
    instrumentId: instrumentFilter || undefined,
  });

  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*').eq('role', 'teacher').order('full_name'),
      supabase.from('instruments').select('*').order('name'),
      supabase.from('locations').select('*').order('name'),
      supabase.from('students').select('*').eq('is_active', true).order('full_name'),
    ]).then(([t, i, l, s]) => {
      setTeachers((t.data as Profile[]) || []);
      setInstruments((i.data as Instrument[]) || []);
      setLocations((l.data as Location[]) || []);
      setStudents((s.data as Student[]) || []);
    });
  }, []);

  // Week view dates
  const weekDates = (() => {
    const d = new Date(selectedDate + 'T00:00:00');
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(d);
      date.setDate(diff + i);
      return date.toISOString().split('T')[0];
    });
  })();

  // Week lessons fetch
  const [weekLessons, setWeekLessons] = useState<any[]>([]);
  useEffect(() => {
    if (view !== 'week') return;
    const fetchWeek = async () => {
      let q = supabase.from('lessons').select(`
        *, teacher:profiles!lessons_teacher_id_fkey(full_name),
        location:locations(name), instrument:instruments(name, icon),
        students:lesson_students(student:students(full_name))
      `).gte('date', weekDates[0]).lte('date', weekDates[6]).order('start_time');
      if (teacherFilter) q = q.eq('teacher_id', teacherFilter);
      if (instrumentFilter) q = q.eq('instrument_id', instrumentFilter);
      const { data } = await q;
      setWeekLessons(data || []);
    };
    fetchWeek();
  }, [view, selectedDate, teacherFilter, instrumentFilter]);

  function shiftDate(days: number) {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  }

  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  // Create form state
  const [form, setForm] = useState({
    teacher_id: '', location_id: '', instrument_id: '',
    lesson_type: 'regular' as LessonType, date: selectedDate,
    start_time: '09:00', end_time: '', title: '', student_ids: [] as string[],
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await createLesson({ ...form, date: form.date || selectedDate });
    setShowCreate(false);
    setForm({ teacher_id: '', location_id: '', instrument_id: '', lesson_type: 'regular', date: selectedDate, start_time: '09:00', end_time: '', title: '', student_ids: [] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">Schedule</h1>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-coral text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-coral/90 transition-colors">
          <Plus size={16} /> New Lesson
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => shiftDate(view === 'week' ? -7 : -1)} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Previous"><ChevronLeft size={18} /></button>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm" />
          <button onClick={() => shiftDate(view === 'week' ? 7 : 1)} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Next"><ChevronRight size={18} /></button>
          <button onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])} className="text-xs text-teal hover:underline ml-1">Today</button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setView('day')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${view === 'day' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600'}`}>Day</button>
          <button onClick={() => setView('week')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${view === 'week' ? 'bg-navy text-white' : 'bg-gray-100 text-gray-600'}`}>Week</button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5" aria-label="Filter by teacher">
            <option value="">All Teachers</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
          <select value={instrumentFilter} onChange={(e) => setInstrumentFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5" aria-label="Filter by instrument">
            <option value="">All Instruments</option>
            {instruments.map((i) => <option key={i.id} value={i.id}>{i.icon} {i.name}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center justify-between">
          <p className="text-coral text-sm">{error}</p>
          <button onClick={refresh} className="flex items-center gap-1 text-coral text-sm font-medium hover:underline"><RefreshCw size={14} />Retry</button>
        </div>
      )}

      {/* Day view */}
      {view === 'day' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
            <p className="font-medium text-navy text-sm">{formatDateLabel(selectedDate)}</p>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
          ) : lessons.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No lessons on this day</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {lessons.map((lesson) => (
                <div key={lesson.id} className="px-4 sm:px-5 py-3 hover:bg-gray-50/50 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="flex items-center gap-3 sm:w-20 flex-shrink-0">
                    <Clock size={14} className="text-gray-400 hidden sm:block" />
                    <span className="text-sm font-semibold text-navy">{lesson.start_time?.slice(0, 5)}</span>
                    {lesson.end_time && <span className="text-xs text-gray-400">- {lesson.end_time.slice(0, 5)}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-navy text-sm">{lesson.title}</p>
                      {lesson.instrument?.icon && <span>{lesson.instrument.icon}</span>}
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        lesson.lesson_type === 'makeup' ? 'bg-yellow-light text-yellow-700' :
                        lesson.lesson_type === 'special' ? 'bg-purple-100 text-purple-700' :
                        lesson.lesson_type === 'demo' ? 'bg-blue-100 text-blue-700' :
                        lesson.lesson_type === 'workshop' ? 'bg-purple-100 text-purple-700' :
                        lesson.lesson_type === 'one_time' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{lesson.lesson_type === 'one_time' ? 'one-time' : lesson.lesson_type}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                      {lesson.teacher?.full_name && <span>{lesson.teacher.full_name}</span>}
                      {lesson.location?.name && (
                        <span className="flex items-center gap-0.5"><MapPin size={10} />{lesson.location.name}</span>
                      )}
                      {lesson.students && lesson.students.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <UsersIcon size={10} />
                          {lesson.students.map((s) => s.student?.full_name).filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      lesson.status === 'completed' ? 'bg-teal/10 text-teal' :
                      lesson.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                      'bg-coral/10 text-coral'
                    }`}>{lesson.status}</span>
                    {lesson.status === 'cancelled' ? (
                      <button onClick={() => setConfirmDelete(lesson.id)} className="text-[10px] text-gray-400 hover:text-red-500 transition-colors" aria-label="Delete permanently">
                        Delete
                      </button>
                    ) : (
                      <button onClick={() => setConfirmCancel(lesson.id)} className="p-1.5 text-gray-300 hover:text-red-500 transition-colors" aria-label="Cancel lesson">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Week view — grid on desktop, stacked cards on mobile */}
      {view === 'week' && (
        <>
          {/* Desktop grid */}
          <div className="hidden sm:block bg-white rounded-xl border border-gray-100 overflow-x-auto">
            <div className="grid grid-cols-7 min-w-[700px]">
              {weekDates.map((dateStr) => {
                const d = new Date(dateStr + 'T00:00:00');
                const isToday = dateStr === new Date().toISOString().split('T')[0];
                const dayLessons = weekLessons.filter((l: any) => l.date === dateStr);
                return (
                  <div key={dateStr} className={`border-r border-gray-100 last:border-r-0 ${isToday ? 'bg-coral/5' : ''}`}>
                    <div className={`px-2 py-2 text-center border-b border-gray-100 ${isToday ? 'bg-coral/10' : 'bg-gray-50/50'}`}>
                      <p className="text-[10px] text-gray-500 uppercase">{d.toLocaleDateString('en-US', { weekday: 'short' })}</p>
                      <p className={`text-sm font-bold ${isToday ? 'text-coral' : 'text-navy'}`}>{d.getDate()}</p>
                    </div>
                    <div className="min-h-[200px] p-1 space-y-1">
                      {dayLessons.map((l: any) => (
                        <div key={l.id} className={`p-1.5 rounded text-[10px] cursor-pointer hover:opacity-80 ${
                          l.status === 'completed' ? 'bg-teal/10 border-l-2 border-teal' : 'bg-coral/5 border-l-2 border-coral'
                        }`} onClick={() => { setView('day'); setSelectedDate(dateStr); }}>
                          <p className="font-semibold text-navy truncate">{l.start_time?.slice(0, 5)}</p>
                          <p className="text-gray-600 truncate">{l.title}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Mobile stacked cards */}
          <div className="sm:hidden space-y-2">
            {weekDates.map((dateStr) => {
              const d = new Date(dateStr + 'T00:00:00');
              const isToday = dateStr === new Date().toISOString().split('T')[0];
              const dayLessons = weekLessons.filter((l: any) => l.date === dateStr);
              if (dayLessons.length === 0) return null;
              return (
                <div key={dateStr} className={`bg-white rounded-xl border border-gray-100 p-3 ${isToday ? 'border-coral/30' : ''}`}>
                  <p className={`text-xs font-bold mb-2 ${isToday ? 'text-coral' : 'text-navy'}`}>
                    {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  {dayLessons.map((l: any) => (
                    <div key={l.id} className="flex items-center gap-2 py-1 cursor-pointer" onClick={() => { setView('day'); setSelectedDate(dateStr); }}>
                      <span className="text-xs font-semibold text-navy w-10">{l.start_time?.slice(0, 5)}</span>
                      <span className="text-xs text-gray-600 truncate">{l.title}</span>
                      <span className={`ml-auto w-2 h-2 rounded-full flex-shrink-0 ${l.status === 'completed' ? 'bg-teal' : 'bg-coral'}`} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Cancel lesson modal with reason */}
      {confirmCancel && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy text-lg">Cancel Lesson</h3>
              <button onClick={() => { setConfirmCancel(null); setCancelReason(''); }} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">This will mark the lesson as cancelled. You'll be able to find a makeup match for the slot.</p>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Reason (optional)</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none"
                rows={3}
                placeholder="Why is this lesson being cancelled?"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  if (confirmCancel) {
                    const cancelled = await cancelLesson(confirmCancel, undefined, cancelReason || undefined, 'coordinator', profile?.id);
                    setConfirmCancel(null);
                    setCancelReason('');
                    if (cancelled) setMakeupLesson(cancelled);
                  }
                }}
                className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90"
              >
                Cancel Lesson
              </button>
              <button
                onClick={() => { setConfirmCancel(null); setCancelReason(''); }}
                className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
              >
                Keep Lesson
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Permanently"
        message="Are you sure you want to permanently delete this cancelled lesson? This action cannot be undone."
        onConfirm={async () => { if (confirmDelete) { await deleteLesson(confirmDelete); setConfirmDelete(null); } }}
        onCancel={() => setConfirmDelete(null)}
      />

      {makeupLesson && (
        <MakeupMatchPanel
          lesson={makeupLesson}
          onClose={() => setMakeupLesson(null)}
          onScheduled={refresh}
        />
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div ref={modalRef} className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-navy">New Lesson</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-coral/30 focus:border-coral outline-none" placeholder="Piano Lesson" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                  <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select value={form.lesson_type} onChange={(e) => setForm({ ...form, lesson_type: e.target.value as LessonType })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    <option value="regular">Regular</option><option value="makeup">Makeup</option><option value="special">Special</option>
                    <option value="demo">Demo</option><option value="workshop">Workshop</option><option value="one_time">One-time</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Time</label>
                  <input type="time" required value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Time</label>
                  <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Teacher</label>
                <select required value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                  <option value="">Select teacher</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                  <select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    <option value="">None</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Instrument</label>
                  <select value={form.instrument_id} onChange={(e) => setForm({ ...form, instrument_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    <option value="">None</option>
                    {instruments.map((i) => <option key={i.id} value={i.id}>{i.icon} {i.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Students</label>
                <div className="border border-gray-200 rounded-lg p-2 max-h-32 overflow-y-auto space-y-1">
                  {students.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={form.student_ids.includes(s.id)}
                        onChange={(e) => setForm({
                          ...form,
                          student_ids: e.target.checked ? [...form.student_ids, s.id] : form.student_ids.filter((id) => id !== s.id)
                        })}
                        className="rounded border-gray-300 text-coral focus:ring-coral" />
                      {s.full_name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2.5 rounded-lg bg-coral text-white text-sm font-medium hover:bg-coral/90">Create Lesson</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
