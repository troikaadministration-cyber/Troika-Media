import React, { useState, useEffect } from 'react';
import { Plus, ChevronLeft, ChevronRight, Filter, X, UserSearch, Calendar as CalIcon, Ban } from 'lucide-react';
import { useLessons } from '../hooks/useLessons';
import { supabase } from '../lib/supabase';
import type { Profile, Instrument, LessonType, Student } from '../types';

interface MakeupMatch {
  id: string;
  full_name: string;
  instrument: string;
  location: string;
  match_score: number;
  same_location: boolean;
  charged_absences: number;
  needs_makeup: boolean;
}

// ── Time-grid layout ──────────────────────────────────────────
const HOUR_HEIGHT = 64; // px per hour
const START_HOUR  = 7;  // 7 am
const END_HOUR    = 21; // 9 pm
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT; // 896 px

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function computeOverlapLayout(lessons: any[]) {
  if (!lessons.length) return [];

  const events = lessons
    .filter(l => l.start_time)
    .map(l => ({
      ...l,
      _startMin: timeToMinutes(l.start_time),
      _endMin: l.end_time ? timeToMinutes(l.end_time) : timeToMinutes(l.start_time) + 60,
    }))
    .sort((a, b) => a._startMin - b._startMin);

  const colEnds: number[] = [];
  const assigned = events.map(ev => {
    let col = colEnds.findIndex(end => end <= ev._startMin);
    if (col === -1) { col = colEnds.length; colEnds.push(ev._endMin); }
    else { colEnds[col] = ev._endMin; }
    return col;
  });

  const totalCols = events.map((ev, i) => {
    let maxCol = assigned[i];
    for (let j = 0; j < events.length; j++) {
      if (i !== j && ev._startMin < events[j]._endMin && events[j]._startMin < ev._endMin) {
        maxCol = Math.max(maxCol, assigned[j]);
      }
    }
    return maxCol + 1;
  });

  return events.map((ev, i) => ({ ...ev, _col: assigned[i], _totalCols: totalCols[i] }));
}
// ─────────────────────────────────────────────────────────────

export function SchedulePage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [teacherFilter, setTeacherFilter] = useState('');
  const [instrumentFilter, setInstrumentFilter] = useState('');
  const [teachers, setTeachers] = useState<Profile[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');

  // Makeup finder
  const [makeupModal, setMakeupModal] = useState<{ lessonId: string; studentId: string } | null>(null);
  const [makeupMatches, setMakeupMatches] = useState<MakeupMatch[]>([]);
  const [makeupLoading, setMakeupLoading] = useState(false);

  const [cancelModal, setCancelModal] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const { lessons, loading, createLesson, updateLesson, cancelLesson } = useLessons({
    date: viewMode === 'day' ? selectedDate : undefined,
    teacherId: teacherFilter || undefined,
    instrumentId: instrumentFilter || undefined,
  });

  // For week view, fetch the whole week
  const [weekLessons, setWeekLessons] = useState<any[]>([]);
  useEffect(() => {
    if (viewMode !== 'week') return;
    const start = getWeekStart(selectedDate);
    const end = getWeekEnd(selectedDate);
    let query = supabase
      .from('lessons')
      .select('*, teacher:profiles!lessons_teacher_id_fkey(id, full_name), instrument:instruments(name), students:lesson_students(student_id, student:students(full_name))')
      .gte('date', start)
      .lte('date', end)
      .order('date')
      .order('start_time');
    if (teacherFilter) query = query.eq('teacher_id', teacherFilter);
    if (instrumentFilter) query = query.eq('instrument_id', instrumentFilter);
    query.then(({ data }) => setWeekLessons(data || []));
  }, [viewMode, selectedDate, teacherFilter, instrumentFilter]);

  useEffect(() => {
    supabase.from('profiles').select('*').eq('role', 'teacher').then(({ data }) => setTeachers(data || []));
    supabase.from('instruments').select('*').then(({ data }) => setInstruments(data || []));
    supabase.from('students').select('*').eq('is_active', true).order('full_name').then(({ data }) => setAllStudents(data || []));
  }, []);

  const changeDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  // Form state
  const [formData, setFormData] = useState({
    teacher_id: '', instrument_id: '', location_id: '',
    lesson_type: 'regular' as LessonType,
    date: selectedDate, start_time: '09:00', end_time: '10:00',
    title: '', student_ids: [] as string[],
    is_charged: true, makeup_direction: '' as string,
    special_fee_type: 'regular' as 'regular' | 'complimentary' | 'custom',
    special_fee_amount: '' as string,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { is_charged, makeup_direction, special_fee_type, special_fee_amount, ...rest } = formData;
      const lessonData: any = { ...rest, date: selectedDate, is_charged };
      if (makeup_direction) lessonData.makeup_direction = makeup_direction;
      // Teacher-learning makeup: no students, not charged
      if (makeup_direction === 'teacher_learning') {
        lessonData.is_charged = false;
        lessonData.student_ids = [];
      }
      // Special lesson fee handling
      if (formData.lesson_type === 'special') {
        if (special_fee_type === 'complimentary') {
          lessonData.is_charged = false;
          lessonData.special_fee = null;
        } else if (special_fee_type === 'custom' && special_fee_amount) {
          lessonData.is_charged = true;
          lessonData.special_fee = parseFloat(special_fee_amount);
        } else {
          // 'regular' — charge at normal rate
          lessonData.is_charged = true;
          lessonData.special_fee = null;
        }
      }
      await createLesson(lessonData);
      setShowForm(false);
      setFormData({ ...formData, title: '', student_ids: [], is_charged: true, makeup_direction: '', special_fee_type: 'regular', special_fee_amount: '' });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const toggleStudent = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      student_ids: prev.student_ids.includes(id)
        ? prev.student_ids.filter((s) => s !== id)
        : [...prev.student_ids, id],
    }));
  };

  // Cancel lesson with reason modal
  async function handleCancelLesson(lessonId: string, reason?: string) {
    await cancelLesson(lessonId, undefined, reason);
  }

  async function findMakeupMatches(lessonId: string, studentId: string) {
    setMakeupModal({ lessonId, studentId });
    setMakeupLoading(true);
    try {
      const { data } = await supabase.functions.invoke('find-makeup-matches', {
        body: { student_id: studentId, lesson_id: lessonId },
      });
      setMakeupMatches(data?.matches || []);
    } catch {
      setMakeupMatches([]);
    }
    setMakeupLoading(false);
  }

  // Week view helpers — Sunday-anchored weeks (Sun–Sat, matching JS getDay() convention)
  function getWeekStart(date: string) {
    const d = new Date(date);
    const day = d.getDay(); // 0 = Sunday
    d.setDate(d.getDate() - day); // subtract to reach Sunday
    return d.toISOString().split('T')[0];
  }
  function getWeekEnd(date: string) {
    const d = new Date(date);
    const day = d.getDay(); // 0 = Sunday
    d.setDate(d.getDate() + (6 - day)); // add to reach Saturday
    return d.toISOString().split('T')[0];
  }
  function getWeekDays(date: string) {
    const start = new Date(getWeekStart(date));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });
  }

  const displayLessons = viewMode === 'day' ? lessons : weekLessons;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Schedule</h1>
          <p className="text-gray-500 text-sm mt-1">Manage lesson schedule across all teachers</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-coral text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90 transition-colors"
        >
          <Plus size={18} />
          New Lesson
        </button>
      </div>

      {/* Date navigation + filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => changeDate(viewMode === 'week' ? -7 : -1)} className="p-2 hover:bg-gray-100 rounded-lg">
              <ChevronLeft size={18} />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            <button onClick={() => changeDate(viewMode === 'week' ? 7 : 1)} className="p-2 hover:bg-gray-100 rounded-lg">
              <ChevronRight size={18} />
            </button>
            <button
              onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
              className="text-sm text-teal font-medium hover:underline"
            >
              Today
            </button>
            <div className="ml-2 flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('day')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === 'day' ? 'bg-white text-navy shadow-sm' : 'text-gray-500'}`}
              >
                Day
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === 'week' ? 'bg-white text-navy shadow-sm' : 'text-gray-500'}`}
              >
                Week
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Filter size={16} className="text-gray-400" />
            <select
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All Teachers</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name}</option>
              ))}
            </select>
            <select
              value={instrumentFilter}
              onChange={(e) => setInstrumentFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All Instruments</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Create lesson form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border-l-4 border-coral p-5 mb-6">
          <h3 className="text-lg font-bold text-navy mb-4">Create New Lesson</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Piano Lesson"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Teacher</label>
              <select
                value={formData.teacher_id}
                onChange={(e) => setFormData({ ...formData, teacher_id: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                required
              >
                <option value="">Select teacher</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Instrument</label>
              <select
                value={formData.instrument_id}
                onChange={(e) => setFormData({ ...formData, instrument_id: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select instrument</option>
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Type</label>
              <select
                value={formData.lesson_type}
                onChange={(e) => setFormData({ ...formData, lesson_type: e.target.value as LessonType })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="regular">Regular</option>
                <option value="makeup">Makeup</option>
                <option value="special">Special</option>
                <option value="demo">Demo</option>
                <option value="workshop">Workshop</option>
                <option value="one_time">One-time</option>
              </select>
            </div>
            {/* Conditional: one_time charged toggle */}
            {formData.lesson_type === 'one_time' && (
              <div className="flex items-center gap-3">
                <label className="block text-sm font-medium text-gray-600">Charged?</label>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, is_charged: !formData.is_charged })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_charged ? 'bg-teal' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_charged ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="text-xs text-gray-500">{formData.is_charged ? 'Yes' : 'No'}</span>
              </div>
            )}
            {/* Conditional: special lesson fee */}
            {formData.lesson_type === 'special' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Fee</label>
                <select
                  value={formData.special_fee_type}
                  onChange={(e) => setFormData({ ...formData, special_fee_type: e.target.value as 'regular' | 'complimentary' | 'custom', special_fee_amount: '' })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="regular">Charge as regular lesson</option>
                  <option value="complimentary">Complimentary</option>
                  <option value="custom">Custom fee</option>
                </select>
                {formData.special_fee_type === 'custom' && (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Enter amount"
                    value={formData.special_fee_amount}
                    onChange={(e) => setFormData({ ...formData, special_fee_amount: e.target.value })}
                    className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                )}
              </div>
            )}
            {/* Conditional: makeup direction */}
            {formData.lesson_type === 'makeup' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Makeup Direction</label>
                <select
                  value={formData.makeup_direction}
                  onChange={(e) => setFormData({ ...formData, makeup_direction: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Teacher Teaching (default)</option>
                  <option value="teacher_teaching">Teacher Teaching</option>
                  <option value="teacher_learning">Teacher Learning (no students, free)</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Start Time</label>
              <input
                type="time"
                value={formData.start_time}
                onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">End Time</label>
              <input
                type="time"
                value={formData.end_time}
                onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            {/* Multi-student select */}
            <div className="md:col-span-2 lg:col-span-3">
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Students ({formData.student_ids.length} selected)
              </label>
              <div className="border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                {allStudents.length === 0 ? (
                  <p className="text-sm text-gray-400">No active students</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                    {allStudents.map((s) => (
                      <label
                        key={s.id}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm cursor-pointer transition-colors ${
                          formData.student_ids.includes(s.id)
                            ? 'bg-teal-light text-teal font-medium'
                            : 'hover:bg-gray-50 text-gray-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formData.student_ids.includes(s.id)}
                          onChange={() => toggleStudent(s.id)}
                          className="accent-teal"
                        />
                        {s.full_name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="md:col-span-2 lg:col-span-3 flex gap-3">
              <button type="submit" className="bg-coral text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90">
                Create Lesson
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="bg-gray-100 text-gray-600 px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Day view */}
      {viewMode === 'day' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-semibold text-navy">
              {new Date(selectedDate + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </h2>
            <p className="text-sm text-gray-400">{lessons.length} lessons</p>
          </div>

          {loading ? (
            <p className="text-center text-gray-400 py-12">Loading...</p>
          ) : lessons.length === 0 ? (
            <p className="text-center text-gray-400 py-12">No lessons on this date</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {lessons.map((lesson: any) => (
                <LessonRow
                  key={lesson.id}
                  lesson={lesson}
                  onCancel={() => setCancelModal(lesson.id)}
                  onFindMakeup={(studentId: string) => findMakeupMatches(lesson.id, studentId)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Week view */}
      {viewMode === 'week' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Day header row */}
          <div className="flex border-b border-gray-100">
            <div className="w-14 flex-shrink-0 border-r border-gray-100 bg-gray-50" />
            {getWeekDays(selectedDate).map((day) => {
              const d = new Date(day + 'T00:00');
              const isToday = day === new Date().toISOString().split('T')[0];
              return (
                <div key={day} className={`flex-1 text-center py-2 border-r last:border-r-0 border-gray-100 ${isToday ? 'bg-coral/5' : 'bg-gray-50'}`}>
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                    {d.toLocaleDateString('en-US', { weekday: 'short' })}
                  </p>
                  <div className={`mx-auto w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold mt-0.5 ${isToday ? 'bg-coral text-white' : 'text-navy'}`}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Scrollable time grid */}
          <div className="flex overflow-y-auto max-h-[680px]">
            {/* Hour labels */}
            <div className="w-14 flex-shrink-0 relative border-r border-gray-100 bg-gray-50/50" style={{ height: GRID_HEIGHT }}>
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => {
                const hour = START_HOUR + i;
                const label = hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`;
                return (
                  <div
                    key={i}
                    className="absolute right-2 text-[10px] text-gray-400 leading-none select-none"
                    style={{ top: i * HOUR_HEIGHT - 7 }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>

            {/* Day columns */}
            {getWeekDays(selectedDate).map((day) => {
              const isToday = day === new Date().toISOString().split('T')[0];
              const dayLessons = weekLessons.filter((l: any) => l.date === day);
              const laidOut = computeOverlapLayout(dayLessons);

              return (
                <div
                  key={day}
                  className={`flex-1 relative border-r last:border-r-0 border-gray-100 ${isToday ? 'bg-coral/[0.03]' : ''}`}
                  style={{ height: GRID_HEIGHT }}
                >
                  {/* Hour lines */}
                  {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                    <div
                      key={i}
                      className="absolute left-0 right-0 border-t border-gray-100"
                      style={{ top: i * HOUR_HEIGHT }}
                    />
                  ))}

                  {/* Lesson cards */}
                  {laidOut.map((lesson: any) => {
                    const topPx = Math.max(0, (lesson._startMin - START_HOUR * 60) * (HOUR_HEIGHT / 60));
                    const heightPx = Math.max(22, (lesson._endMin - lesson._startMin) * (HOUR_HEIGHT / 60) - 2);
                    const leftPct = (lesson._col / lesson._totalCols) * 100;
                    const widthPct = 100 / lesson._totalCols;

                    const colorClass =
                      lesson.status === 'completed'
                        ? 'bg-teal/10 border-teal text-teal'
                        : lesson.status === 'cancelled'
                        ? 'bg-gray-100 border-gray-300 text-gray-400'
                        : 'bg-coral/10 border-coral text-coral';

                    return (
                      <div
                        key={lesson.id}
                        className={`absolute overflow-hidden rounded-r border-l-2 px-1 cursor-pointer select-none hover:brightness-95 transition-[filter] ${colorClass}`}
                        style={{
                          top: topPx,
                          height: heightPx,
                          left: `calc(${leftPct}% + 1px)`,
                          width: `calc(${widthPct}% - 2px)`,
                        }}
                        title={[
                          `${lesson.start_time?.slice(0, 5)}${lesson.end_time ? ' – ' + lesson.end_time.slice(0, 5) : ''}`,
                          lesson.title || lesson.instrument?.name,
                          lesson.teacher?.full_name,
                        ].filter(Boolean).join(' · ')}
                      >
                        <p className="text-[10px] font-bold leading-tight pt-0.5 truncate">
                          {lesson.start_time?.slice(0, 5)}
                        </p>
                        {heightPx > 34 && (
                          <p className={`text-[10px] leading-tight truncate font-medium ${lesson.status === 'cancelled' ? 'line-through' : ''}`}>
                            {lesson.title || lesson.instrument?.name}
                          </p>
                        )}
                        {heightPx > 52 && (
                          <p className="text-[10px] leading-tight truncate opacity-70">
                            {lesson.teacher?.full_name}
                          </p>
                        )}
                        {heightPx > 70 && lesson.students?.map((s: any) => (
                          <p key={s.student_id} className="text-[10px] leading-tight truncate opacity-60">
                            {s.student?.full_name}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cancel lesson modal */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-navy">Cancel Lesson</h3>
              <button onClick={() => { setCancelModal(null); setCancelReason(''); }} className="text-gray-400 hover:text-navy">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">This lesson will be marked as cancelled.</p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-1">Reason (optional)</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
                rows={3}
                placeholder="Why is this lesson being cancelled?"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  if (cancelModal) {
                    await handleCancelLesson(cancelModal, cancelReason || undefined);
                  }
                  setCancelModal(null);
                  setCancelReason('');
                }}
                className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90"
              >
                Cancel Lesson
              </button>
              <button
                onClick={() => { setCancelModal(null); setCancelReason(''); }}
                className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
              >
                Keep Lesson
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Makeup finder modal */}
      {makeupModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-navy flex items-center gap-2">
                <UserSearch size={20} className="text-coral" />
                Makeup Lesson Matches
              </h3>
              <button onClick={() => setMakeupModal(null)} className="text-gray-400 hover:text-navy">
                <X size={20} />
              </button>
            </div>

            {makeupLoading ? (
              <p className="text-center text-gray-400 py-8">Finding matches...</p>
            ) : makeupMatches.length === 0 ? (
              <p className="text-center text-gray-400 py-8">No matching students found</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {makeupMatches.map((match) => (
                  <div key={match.id} className={`p-3 rounded-lg border ${match.needs_makeup ? 'border-coral-light bg-coral-light/30' : 'border-gray-100'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-navy">{match.full_name}</p>
                        <p className="text-xs text-gray-500">{match.instrument} · {match.location}</p>
                      </div>
                      <div className="text-right">
                        {match.same_location && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-teal-light text-teal">Same location</span>
                        )}
                        {match.needs_makeup && (
                          <p className="text-xs text-coral mt-0.5">{match.charged_absences} charged absence(s)</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setMakeupModal(null)}
              className="mt-4 w-full bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LessonRow({ lesson, onCancel, onFindMakeup }: {
  lesson: any;
  onCancel: () => void;
  onFindMakeup: (studentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const students = lesson.students || [];

  return (
    <div className="p-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className={`w-1.5 h-14 rounded-full ${
          lesson.status === 'completed' ? 'bg-teal' :
          lesson.status === 'cancelled' ? 'bg-gray-300' : 'bg-coral'
        }`} />
        <div className="w-16 text-center">
          <p className="text-lg font-bold text-navy">{lesson.start_time?.slice(0, 5)}</p>
          {lesson.end_time && <p className="text-xs text-gray-400">{lesson.end_time.slice(0, 5)}</p>}
        </div>
        <div className="flex-1">
          <p className="font-semibold text-navy">{lesson.title || 'Lesson'}</p>
          <p className="text-sm text-gray-500">{lesson.teacher?.full_name} · {lesson.instrument?.name || ''}</p>
          <p className="text-xs text-gray-400">{students.length} student(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
            lesson.lesson_type === 'regular' ? 'bg-gray-100 text-gray-600' :
            lesson.lesson_type === 'makeup' ? 'bg-amber-50 text-amber-600' :
            lesson.lesson_type === 'demo' ? 'bg-blue-50 text-blue-600' :
            lesson.lesson_type === 'workshop' ? 'bg-purple-50 text-purple-600' :
            lesson.lesson_type === 'one_time' ? 'bg-orange-50 text-orange-600' :
            'bg-purple-50 text-purple-600'
          }`}>
            {lesson.lesson_type === 'one_time' ? 'one-time' : lesson.lesson_type}
          </span>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
            lesson.status === 'completed' ? 'bg-teal-light text-teal' :
            lesson.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
            'bg-coral-light text-coral'
          }`}>
            {lesson.status}
          </span>
        </div>
      </div>

      {expanded && students.length > 0 && (
        <div className="ml-24 mt-3 space-y-1.5">
          {students.map((ls: any) => (
            <div key={ls.id} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-gray-50">
              <span className="text-navy font-medium">{ls.student?.full_name || 'Unknown'}</span>
              <div className="flex items-center gap-2">
                {lesson.status === 'scheduled' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onFindMakeup(ls.student_id); }}
                    className="text-xs text-coral hover:underline flex items-center gap-1"
                  >
                    <UserSearch size={12} /> Find makeup
                  </button>
                )}
              </div>
            </div>
          ))}
          {lesson.status === 'scheduled' && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="text-xs text-gray-500 hover:text-coral mt-1"
            >
              Cancel this lesson
            </button>
          )}
        </div>
      )}
    </div>
  );
}
