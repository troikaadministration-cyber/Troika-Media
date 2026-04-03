import React, { useState, useEffect } from 'react';
import { Plus, Repeat, Trash2, X, Calendar } from 'lucide-react';
import { useScheduleTemplates } from '../hooks/useScheduleTemplates';
import { supabase } from '../lib/supabase';
import type { Profile, Instrument, Location, Student } from '@troika/shared';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function TemplateSchedulePage() {
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate, generateLessons } = useScheduleTemplates();
  const [showForm, setShowForm] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<{ lessonsCreated: number; teachersAffected: number } | null>(null);

  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  const [form, setForm] = useState({
    teacher_id: '', day_of_week: 1, start_time: '09:00', end_time: '10:00',
    location_id: '', instrument_id: '', title: '', student_ids: [] as string[],
  });

  const [genDates, setGenDates] = useState({ start: '', end: '' });

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createTemplate({
        ...form,
        location_id: form.location_id || undefined,
        instrument_id: form.instrument_id || undefined,
      });
      setShowForm(false);
      setForm({ teacher_id: '', day_of_week: 1, start_time: '09:00', end_time: '10:00', location_id: '', instrument_id: '', title: '', student_ids: [] });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleGenerate = async () => {
    if (!genDates.start || !genDates.end) return;
    setGenerating(true);
    try {
      const result = await generateLessons(genDates.start, genDates.end);
      setGenResult(result);
    } catch (err: any) {
      alert(err.message);
    }
    setGenerating(false);
  };

  // Group templates by teacher
  const grouped = templates.reduce<Record<string, typeof templates>>((acc, t) => {
    const name = t.teacher?.full_name || 'Unknown';
    if (!acc[name]) acc[name] = [];
    acc[name].push(t);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Schedule Templates</h1>
          <p className="text-gray-500 text-sm mt-1">Recurring weekly lesson slots for bulk generation</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowGenerate(true)} className="flex items-center gap-2 bg-teal text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90">
            <Calendar size={16} /> Generate Lessons
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-coral text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90">
            <Plus size={16} /> New Template
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-12">Loading...</p>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16">
          <Repeat size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No templates yet. Create one to start generating recurring lessons.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([teacherName, tmpls]) => (
            <div key={teacherName} className="bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
                <h3 className="font-semibold text-navy">{teacherName}</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {tmpls.map((t) => (
                  <div key={t.id} className="px-5 py-3 flex items-center gap-4">
                    <div className="w-20 text-center">
                      <p className="text-xs font-semibold text-coral">{DAY_NAMES[t.day_of_week]?.slice(0, 3)}</p>
                      <p className="text-sm font-bold text-navy">{t.start_time.slice(0, 5)}</p>
                      {t.end_time && <p className="text-[10px] text-gray-400">{t.end_time.slice(0, 5)}</p>}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-navy">{t.title || 'Untitled'}</p>
                      <p className="text-xs text-gray-500">
                        {t.student_ids?.length || 0} student(s)
                        {!t.is_active && <span className="ml-2 text-coral">(inactive)</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateTemplate(t.id, { is_active: !t.is_active })}
                        className={`text-xs px-2.5 py-1 rounded-full font-medium ${t.is_active ? 'bg-teal-light text-teal' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {t.is_active ? 'Active' : 'Inactive'}
                      </button>
                      <button onClick={() => deleteTemplate(t.id)} className="text-gray-400 hover:text-coral">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create template form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy text-lg">New Template</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="Piano Lesson" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Teacher</label>
                  <select required value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    <option value="">Select...</option>
                    {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Day of Week</label>
                  <select value={form.day_of_week} onChange={(e) => setForm({ ...form, day_of_week: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Start Time</label>
                  <input type="time" required value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">End Time</label>
                  <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
                  <select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    <option value="">None</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Instrument</label>
                  <select value={form.instrument_id} onChange={(e) => setForm({ ...form, instrument_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    <option value="">None</option>
                    {instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Students</label>
                <div className="border border-gray-200 rounded-lg p-2 max-h-32 overflow-y-auto space-y-1">
                  {students.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={form.student_ids.includes(s.id)}
                        onChange={(e) => setForm({
                          ...form,
                          student_ids: e.target.checked ? [...form.student_ids, s.id] : form.student_ids.filter((id) => id !== s.id)
                        })} className="accent-teal" />
                      {s.full_name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90">Create</button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generate lessons modal */}
      {showGenerate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy text-lg">Generate Lessons</h3>
              <button onClick={() => { setShowGenerate(false); setGenResult(null); }} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            {genResult ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-teal-light rounded-full flex items-center justify-center mx-auto mb-3">
                  <Calendar size={24} className="text-teal" />
                </div>
                <p className="text-lg font-bold text-navy">Created {genResult.lessonsCreated} lessons</p>
                <p className="text-sm text-gray-500 mt-1">for {genResult.teachersAffected} teacher(s)</p>
                <button onClick={() => { setShowGenerate(false); setGenResult(null); }}
                  className="mt-4 bg-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90">Done</button>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">Generate weekly lessons from all active templates for a date range.</p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                    <input type="date" value={genDates.start} onChange={(e) => setGenDates({ ...genDates, start: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
                    <input type="date" value={genDates.end} onChange={(e) => setGenDates({ ...genDates, end: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  </div>
                </div>
                <p className="text-xs text-gray-400 mb-4">{templates.filter((t) => t.is_active).length} active template(s) will be used. Existing lessons won't be duplicated.</p>
                <div className="flex gap-3">
                  <button onClick={handleGenerate} disabled={generating || !genDates.start || !genDates.end}
                    className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                    {generating ? 'Generating...' : 'Generate'}
                  </button>
                  <button onClick={() => setShowGenerate(false)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
