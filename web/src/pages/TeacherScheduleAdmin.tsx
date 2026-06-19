import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useToast } from '../contexts/ToastContext';
import {
  Plus, X, Trash2, Calendar, MapPin, Users as UsersIcon, RefreshCw,
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
const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0];

const HOUR_START = 7;
const HOUR_END = 21;
const CELL_HEIGHT = 64; // px per hour
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

function timeToMins(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h - HOUR_START) * 60 + (m || 0);
}

function fmtHour(h: number): string {
  if (h === 12) return '12pm';
  return h > 12 ? `${h - 12}pm` : `${h}am`;
}

export function TeacherScheduleAdminPage() {
  const { showToast } = useToast();
  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const createRef = useFocusTrap(showCreate);

  const [form, setForm] = useState({
    day_of_week: 1,
    start_time: '09:00',
    end_time: '',
    location_id: '',
    instrument_id: '',
    title: '',
    student_ids: [] as string[],
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

  const openCreateForDay = (day: number) => {
    setForm({ day_of_week: day, start_time: '09:00', end_time: '', location_id: '', instrument_id: '', title: '', student_ids: [] });
    setShowCreate(true);
  };

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacher) return;
    if (!form.title.trim()) { setError('Title is required'); return; }
    if (form.end_time && form.end_time <= form.start_time) {
      setError('End time must be after start time');
      return;
    }
    setError(null);
    const { error: err } = await supabase.from('teacher_schedule_templates').insert({
      teacher_id: selectedTeacher,
      day_of_week: form.day_of_week,
      start_time: form.start_time,
      end_time: form.end_time || null,
      location_id: form.location_id || null,
      instrument_id: form.instrument_id || null,
      title: form.title.trim(),
      student_ids: form.student_ids,
    });
    if (err) { setError(err.message); showToast('error', `Failed to add slot: ${err.message}`); return; }
    setShowCreate(false);
    showToast('success', 'Slot added');
    fetchTemplates();
  };

  const handleDeleteSlot = async (id: string) => {
    const { error: err } = await supabase
      .from('teacher_schedule_templates')
      .update({ is_active: false })
      .eq('id', id);
    if (err) { showToast('error', `Failed to remove slot: ${err.message}`); return; }
    showToast('success', 'Slot removed');
    fetchTemplates();
  };

  const templatesByDay: Record<number, ScheduleTemplate[]> = {};
  for (const t of templates) {
    if (!templatesByDay[t.day_of_week]) templatesByDay[t.day_of_week] = [];
    templatesByDay[t.day_of_week].push(t);
  }

  const teacherName = teachers.find(t => t.id === selectedTeacher)?.full_name || '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Teacher Schedules</h1>
          <p className="text-gray-500 text-sm mt-1">Manage weekly timetables and generate lessons</p>
        </div>
        {selectedTeacher && (
          <button
            onClick={() => openCreateForDay(1)}
            className="flex items-center gap-2 bg-coral text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-coral/90"
          >
            <Plus size={16} /> Add Slot
          </button>
        )}
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
          <button onClick={fetchTemplates} className="flex items-center gap-1 text-coral text-sm font-medium hover:underline">
            <RefreshCw size={14} /> Retry
          </button>
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

      {/* Calendar grid */}
      {selectedTeacher && !loading && (
        templates.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <Calendar size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No schedule slots set up for {teacherName}</p>
            <p className="text-gray-400 text-xs mt-1">Click "Add Slot" to create recurring time slots</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {/* Day headers */}
            <div className="grid border-b border-gray-100" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
              <div className="py-3" />
              {DAYS_ORDER.map((day) => {
                const count = templatesByDay[day]?.length ?? 0;
                return (
                  <div key={day} className="py-3 text-center border-l border-gray-100">
                    <p className="text-xs font-semibold text-navy">{DAY_SHORT[day]}</p>
                    {count > 0 && (
                      <span className="inline-block mt-0.5 text-xs text-coral font-medium">{count}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Time grid */}
            <div className="overflow-y-auto" style={{ maxHeight: '600px' }}>
              <div
                className="relative grid"
                style={{
                  gridTemplateColumns: '52px repeat(7, 1fr)',
                  height: `${CELL_HEIGHT * HOURS.length}px`,
                }}
              >
                {/* Hour labels */}
                <div className="relative">
                  {HOURS.map((hour, i) => (
                    <div
                      key={hour}
                      className="absolute w-full flex items-start justify-end pr-2 pt-1"
                      style={{ top: `${i * CELL_HEIGHT}px`, height: `${CELL_HEIGHT}px` }}
                    >
                      <span className="text-xs text-gray-400 leading-none">{fmtHour(hour)}</span>
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {DAYS_ORDER.map((day) => {
                  const daySlots = templatesByDay[day] || [];
                  return (
                    <div key={day} className="relative border-l border-gray-100">
                      {/* Hour lines */}
                      {HOURS.map((_, i) => (
                        <div
                          key={i}
                          className="absolute w-full border-t border-gray-50"
                          style={{ top: `${i * CELL_HEIGHT}px`, height: `${CELL_HEIGHT}px` }}
                        />
                      ))}

                      {/* Add slot button per column */}
                      <button
                        onClick={() => openCreateForDay(day)}
                        className="absolute inset-0 w-full h-full opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center z-0"
                        title={`Add slot on ${DAY_NAMES[day]}`}
                      >
                        <div className="bg-gray-100/80 rounded-lg px-2 py-1">
                          <Plus size={14} className="text-gray-400" />
                        </div>
                      </button>

                      {/* Slots */}
                      {daySlots.map((slot) => {
                        const startMins = timeToMins(slot.start_time);
                        const endMins = slot.end_time
                          ? timeToMins(slot.end_time)
                          : startMins + 60;
                        const top = (startMins / 60) * CELL_HEIGHT;
                        const height = Math.max(((endMins - startMins) / 60) * CELL_HEIGHT - 2, 28);
                        const loc = locations.find(l => l.id === slot.location_id);
                        const inst = instruments.find(i => i.id === slot.instrument_id);
                        const slotStudents = students.filter(s => slot.student_ids.includes(s.id));

                        return (
                          <div
                            key={slot.id}
                            className="absolute left-1 right-1 rounded-lg bg-coral/10 border border-coral/25 px-2 py-1 overflow-hidden group z-10 cursor-default"
                            style={{ top: `${top}px`, height: `${height}px` }}
                          >
                            <div className="flex items-start justify-between gap-1 h-full">
                              <div className="min-w-0 flex-1 overflow-hidden">
                                <p className="text-xs font-semibold text-coral leading-tight truncate">
                                  {inst?.icon && <span className="mr-1">{inst.icon}</span>}
                                  {slot.title || 'Lesson'}
                                </p>
                                <p className="text-xs text-gray-500 leading-tight">
                                  {slot.start_time?.slice(0, 5)}
                                  {slot.end_time ? `–${slot.end_time.slice(0, 5)}` : ''}
                                </p>
                                {height >= 52 && loc && (
                                  <p className="text-xs text-gray-400 leading-tight truncate flex items-center gap-0.5 mt-0.5">
                                    <MapPin size={9} />{loc.name}
                                  </p>
                                )}
                                {height >= 68 && slotStudents.length > 0 && (
                                  <p className="text-xs text-gray-400 leading-tight truncate flex items-center gap-0.5">
                                    <UsersIcon size={9} />{slotStudents.map(s => s.full_name).join(', ')}
                                  </p>
                                )}
                              </div>
                              <button
                                onClick={() => handleDeleteSlot(slot.id)}
                                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-red-400 hover:text-red-600"
                                title="Remove slot"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )
      )}

      {/* Create Slot Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div
            ref={createRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-slot-title"
            onKeyDown={(e) => { if (e.key === 'Escape') setShowCreate(false); }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 id="create-slot-title" className="font-semibold text-navy">Add Weekly Slot</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-navy">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateSlot} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  placeholder="e.g. Piano Lesson"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Day</label>
                  <select
                    value={form.day_of_week}
                    onChange={(e) => setForm({ ...form, day_of_week: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  >
                    {DAYS_ORDER.map(d => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Time</label>
                  <input
                    type="time"
                    required
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Time</label>
                  <input
                    type="time"
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                  <select
                    value={form.location_id}
                    onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  >
                    <option value="">None</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Instrument</label>
                  <select
                    value={form.instrument_id}
                    onChange={(e) => setForm({ ...form, instrument_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  >
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
                      <input
                        type="checkbox"
                        checked={form.student_ids.includes(s.id)}
                        onChange={(e) => setForm({
                          ...form,
                          student_ids: e.target.checked
                            ? [...form.student_ids, s.id]
                            : form.student_ids.filter(id => id !== s.id),
                        })}
                        className="rounded border-gray-300 text-coral focus:ring-coral"
                      />
                      {s.full_name}
                    </label>
                  ))}
                </div>
              </div>
              {error && <p className="text-coral text-xs">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 rounded-lg bg-coral text-white text-sm font-medium hover:bg-coral/90"
                >
                  Add Slot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
