import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  Plus, X, Trash2, Calendar, Clock, MapPin, Users as UsersIcon,
  RefreshCw, ChevronRight, Play
} from 'lucide-react';
import type { Profile, Instrument, Location, Student } from '../types';

interface ScheduleTemplate {
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
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function TeacherScheduleAdminPage() {
  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  const createRef = useFocusTrap(showCreate);
  const generateRef = useFocusTrap(showGenerate);

  // Form
  const [form, setForm] = useState({
    day_of_week: 1,
    start_time: '09:00',
    end_time: '',
    location_id: '',
    instrument_id: '',
    title: '',
    student_ids: [] as string[],
  });

  // Generate form
  const [genForm, setGenForm] = useState({
    start_date: new Date().toISOString().split('T')[0],
    end_date: (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      return d.toISOString().split('T')[0];
    })(),
    skip_existing: true,
  });

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

  const fetchTemplates = useCallback(async () => {
    if (!selectedTeacher) { setTemplates([]); return; }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('teacher_schedule_templates')
      .select('*')
      .eq('teacher_id', selectedTeacher)
      .eq('is_active', true)
      .order('day_of_week')
      .order('start_time');
    if (err) setError(err.message);
    setTemplates((data as ScheduleTemplate[]) || []);
    setLoading(false);
  }, [selectedTeacher]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacher) return;
    const { error: err } = await supabase.from('teacher_schedule_templates').insert({
      teacher_id: selectedTeacher,
      day_of_week: form.day_of_week,
      start_time: form.start_time,
      end_time: form.end_time || null,
      location_id: form.location_id || null,
      instrument_id: form.instrument_id || null,
      title: form.title,
      student_ids: form.student_ids,
    });
    if (err) { setError(err.message); return; }
    setShowCreate(false);
    setForm({ day_of_week: 1, start_time: '09:00', end_time: '', location_id: '', instrument_id: '', title: '', student_ids: [] });
    fetchTemplates();
  };

  const handleDeleteSlot = async (id: string) => {
    await supabase.from('teacher_schedule_templates').update({ is_active: false }).eq('id', id);
    fetchTemplates();
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (templates.length === 0) return;
    setGenerating(true);
    setGenerateResult(null);

    try {
      const startDate = new Date(genForm.start_date + 'T00:00:00');
      const endDate = new Date(genForm.end_date + 'T00:00:00');
      let created = 0;
      let skipped = 0;

      // Iterate each day in range
      const current = new Date(startDate);
      while (current <= endDate) {
        const dayOfWeek = current.getDay();
        const dateStr = current.toISOString().split('T')[0];

        // Find matching templates for this day
        const dayTemplates = templates.filter(t => t.day_of_week === dayOfWeek);

        for (const tpl of dayTemplates) {
          if (genForm.skip_existing) {
            // Check if lesson already exists for this teacher/date/time
            const { data: existing } = await supabase
              .from('lessons')
              .select('id')
              .eq('teacher_id', tpl.teacher_id)
              .eq('date', dateStr)
              .eq('start_time', tpl.start_time)
              .limit(1);
            if (existing && existing.length > 0) { skipped++; continue; }
          }

          // Create lesson
          const { data: lesson, error: lessonErr } = await supabase
            .from('lessons')
            .insert({
              teacher_id: tpl.teacher_id,
              location_id: tpl.location_id,
              instrument_id: tpl.instrument_id,
              lesson_type: 'regular',
              date: dateStr,
              start_time: tpl.start_time,
              end_time: tpl.end_time,
              title: tpl.title,
            })
            .select()
            .single();

          if (lessonErr) { skipped++; continue; }

          // Add students
          if (lesson && tpl.student_ids.length > 0) {
            await supabase.from('lesson_students').insert(
              tpl.student_ids.map(sid => ({ lesson_id: lesson.id, student_id: sid }))
            );
          }
          created++;
        }
        current.setDate(current.getDate() + 1);
      }

      setGenerateResult(`Created ${created} lesson${created !== 1 ? 's' : ''}${skipped > 0 ? `, skipped ${skipped} existing` : ''}`);
    } catch (err: any) {
      setGenerateResult(`Error: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  // Group templates by day
  const templatesByDay: Record<number, ScheduleTemplate[]> = {};
  for (const t of templates) {
    if (!templatesByDay[t.day_of_week]) templatesByDay[t.day_of_week] = [];
    templatesByDay[t.day_of_week].push(t);
  }

  const teacherName = teachers.find(t => t.id === selectedTeacher)?.full_name || '';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Teacher Schedules</h1>
          <p className="text-gray-500 text-sm mt-1">Manage weekly timetables and generate lessons</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedTeacher && templates.length > 0 && (
            <button onClick={() => setShowGenerate(true)} className="flex items-center gap-2 bg-teal text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-teal/90">
              <Play size={16} /> Generate Lessons
            </button>
          )}
          {selectedTeacher && (
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-coral text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-coral/90">
              <Plus size={16} /> Add Slot
            </button>
          )}
        </div>
      </div>

      {/* Teacher selector */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5">
        <label className="block text-sm font-medium text-gray-700 mb-2">Select Teacher</label>
        <select
          value={selectedTeacher}
          onChange={(e) => setSelectedTeacher(e.target.value)}
          className="w-full sm:w-72 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-coral/30 focus:border-coral outline-none"
        >
          <option value="">Choose a teacher...</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
        </select>
      </div>

      {error && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-4 flex items-center justify-between">
          <p className="text-coral text-sm">{error}</p>
          <button onClick={fetchTemplates} className="flex items-center gap-1 text-coral text-sm font-medium hover:underline"><RefreshCw size={14} />Retry</button>
        </div>
      )}

      {!selectedTeacher && (
        <div className="text-center py-16 text-gray-400 text-sm">
          Select a teacher to view and manage their weekly schedule
        </div>
      )}

      {selectedTeacher && loading && (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      )}

      {/* Weekly timetable */}
      {selectedTeacher && !loading && (
        <>
          {templates.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
              <Calendar size={40} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No schedule slots set up for {teacherName}</p>
              <p className="text-gray-400 text-xs mt-1">Click "Add Slot" to create recurring time slots</p>
            </div>
          ) : (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const daySlots = templatesByDay[day];
                if (!daySlots || daySlots.length === 0) return null;
                return (
                  <div key={day} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
                      <p className="font-semibold text-navy text-sm">{DAY_NAMES[day]}</p>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {daySlots.map((slot) => {
                        const loc = locations.find(l => l.id === slot.location_id);
                        const inst = instruments.find(i => i.id === slot.instrument_id);
                        const slotStudents = students.filter(s => slot.student_ids.includes(s.id));
                        return (
                          <div key={slot.id} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50/50">
                            <div className="flex-shrink-0 w-20">
                              <span className="text-sm font-semibold text-navy">{slot.start_time?.slice(0, 5)}</span>
                              {slot.end_time && <span className="text-xs text-gray-400"> - {slot.end_time.slice(0, 5)}</span>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-navy text-sm">{slot.title || 'Lesson'}</p>
                                {inst && <span className="text-base">{inst.icon}</span>}
                              </div>
                              <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                                {loc && (
                                  <span className="flex items-center gap-0.5"><MapPin size={10} />{loc.name}</span>
                                )}
                                {slotStudents.length > 0 && (
                                  <span className="flex items-center gap-0.5">
                                    <UsersIcon size={10} />{slotStudents.map(s => s.full_name).join(', ')}
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteSlot(slot.id)}
                              className="p-1.5 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                              title="Remove slot"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Create Slot Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div ref={createRef} className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-navy">Add Weekly Slot</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateSlot} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="e.g. Piano Lesson" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Day</label>
                  <select value={form.day_of_week} onChange={(e) => setForm({ ...form, day_of_week: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    {[1, 2, 3, 4, 5, 6, 0].map(d => (
                      <option key={d} value={d}>{DAY_NAMES[d]}</option>
                    ))}
                  </select>
                </div>
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
                          student_ids: e.target.checked ? [...form.student_ids, s.id] : form.student_ids.filter(id => id !== s.id)
                        })}
                        className="rounded border-gray-300 text-coral focus:ring-coral" />
                      {s.full_name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2.5 rounded-lg bg-coral text-white text-sm font-medium hover:bg-coral/90">Add Slot</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generate Lessons Modal */}
      {showGenerate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div ref={generateRef} className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-navy">Generate Lessons</h2>
                <p className="text-xs text-gray-500 mt-0.5">Create lessons from {teacherName}'s weekly template</p>
              </div>
              <button onClick={() => { setShowGenerate(false); setGenerateResult(null); }} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <form onSubmit={handleGenerate} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                  <input type="date" required value={genForm.start_date} onChange={(e) => setGenForm({ ...genForm, start_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                  <input type="date" required value={genForm.end_date} onChange={(e) => setGenForm({ ...genForm, end_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={genForm.skip_existing} onChange={(e) => setGenForm({ ...genForm, skip_existing: e.target.checked })}
                  className="rounded border-gray-300 text-coral focus:ring-coral" />
                Skip dates that already have lessons at the same time
              </label>

              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
                <p className="font-medium text-navy mb-1">Template summary:</p>
                {[1, 2, 3, 4, 5, 6, 0].map(day => {
                  const slots = templatesByDay[day];
                  if (!slots) return null;
                  return (
                    <p key={day}>{DAY_SHORT[day]}: {slots.map(s => `${s.start_time?.slice(0, 5)} ${s.title || 'Lesson'}`).join(', ')}</p>
                  );
                })}
              </div>

              {generateResult && (
                <div className={`rounded-lg p-3 text-sm font-medium ${
                  generateResult.startsWith('Error') ? 'bg-coral/10 text-coral' : 'bg-teal/10 text-teal'
                }`}>
                  {generateResult}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowGenerate(false); setGenerateResult(null); }}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={generating}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-teal text-white text-sm font-medium hover:bg-teal/90 disabled:opacity-50">
                  {generating ? 'Generating...' : 'Generate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
