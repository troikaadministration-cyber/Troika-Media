import React, { useState, useEffect } from 'react';
import { CalendarOff, Plus, X, AlertTriangle, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { useBreaks } from '../hooks/useBreaks';
import { usePendingReschedules } from '../hooks/usePendingReschedules';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { PendingRescheduleList } from '../components/PendingRescheduleList';
import { ReschedulerCalendar } from '../components/ReschedulerCalendar';
import { RescheduleModal } from '../components/RescheduleModal';
import type { Student, PendingLesson, AutoReschedulePreviewItem } from '../types';

export function BreaksPage() {
  const { profile } = useAuth();
  const { breaks, pendingRescheduleCount, loading, createBreak, previewBreak, fetchBreaks } = useBreaks();
  const {
    lessons: pendingLessons,
    loading: pendingLoading,
    error: pendingError,
    reschedule,
    autoRescheduleBreak,
    confirmAutoReschedule,
  } = usePendingReschedules();

  const [showForm, setShowForm] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [allStudents, setAllStudents] = useState(true);
  const [preview, setPreview] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [showPendingSection, setShowPendingSection] = useState(true);

  const [form, setForm] = useState({
    title: '', start_date: '', end_date: '', student_ids: [] as string[],
  });

  // Pending reschedule UI state
  const [selectedLesson, setSelectedLesson] = useState<PendingLesson | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string | null>(null);
  const [autoPreview, setAutoPreview] = useState<AutoReschedulePreviewItem[] | null>(null);
  const [autoRescheduleLoadingId, setAutoRescheduleLoadingId] = useState<string | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    supabase.from('students').select('*').eq('is_active', true).order('full_name')
      .then(({ data }) => setStudents((data as Student[]) || []));
  }, []);

  const handlePreview = async () => {
    const ids = allStudents ? [] : form.student_ids;
    const count = await previewBreak(form.start_date, form.end_date, ids);
    setPreview(count);
  };

  const handleCreate = async () => {
    if (!profile?.id) return;
    setCreating(true);
    try {
      const ids = allStudents ? [] : form.student_ids;
      const result = await createBreak({
        title: form.title,
        start_date: form.start_date,
        end_date: form.end_date,
        student_ids: ids,
        created_by: profile.id,
      });
      alert(`Break created. ${result.cancelled} lessons cancelled and marked for reschedule.`);
      setShowForm(false);
      setForm({ title: '', start_date: '', end_date: '', student_ids: [] });
      setPreview(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to create break');
    }
    setCreating(false);
  };

  async function handleAutoReschedule(breakId: string) {
    setAutoRescheduleLoadingId(breakId);
    setAutoError(null);
    try {
      const result = await autoRescheduleBreak(breakId);
      setAutoPreview(result);
    } catch (e: unknown) {
      setAutoError(e instanceof Error ? e.message : 'Failed to compute auto-reschedule');
    } finally {
      setAutoRescheduleLoadingId(null);
    }
  }

  async function handleConfirmAutoReschedule() {
    if (!autoPreview) return;
    setConfirmLoading(true);
    setAutoError(null);
    try {
      await confirmAutoReschedule(autoPreview);
      await fetchBreaks();
      setAutoPreview(null);
    } catch (e: unknown) {
      setAutoError(e instanceof Error ? e.message : 'Failed to create makeup lessons');
    } finally {
      setConfirmLoading(false);
    }
  }

  async function handleManualReschedule(lessonId: string, newDate: string, newTime: string) {
    await reschedule(lessonId, newDate, newTime);
    await fetchBreaks();
  }

  const scheduledCount = autoPreview ? autoPreview.filter(p => p.found).length : 0;
  const autoPreviewBreakTitle = autoPreview?.[0]?.original.break.title ?? '';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Breaks</h1>
          <p className="text-gray-500 text-sm mt-1">Schedule holiday breaks and track rescheduling</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-coral text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90">
          <Plus size={16} /> New Break
        </button>
      </div>

      {pendingRescheduleCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-700">{pendingRescheduleCount} lessons pending reschedule</p>
            <p className="text-xs text-amber-600">Use the Pending Reschedules section below to create makeup lessons.</p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center text-gray-400 py-12">Loading...</p>
      ) : breaks.length === 0 ? (
        <div className="text-center py-16">
          <CalendarOff size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No breaks scheduled yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {breaks.map((brk) => {
            const pct = brk.total_cancelled > 0 ? Math.round((brk.total_rescheduled / brk.total_cancelled) * 100) : 0;
            const pendingForBreak = brk.total_cancelled - brk.total_rescheduled;
            return (
              <div key={brk.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-navy">{brk.title}</h3>
                  <span className="text-xs text-gray-500">
                    {new Date(brk.start_date + 'T00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                    {' — '}
                    {new Date(brk.end_date + 'T00:00').toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-500">{brk.total_cancelled} cancelled</span>
                  <span className="text-teal font-medium">{brk.total_rescheduled} rescheduled</span>
                  <span className="text-coral font-medium">{pendingForBreak} pending</span>
                  {pendingForBreak > 0 && (
                    <button
                      onClick={() => handleAutoReschedule(brk.id)}
                      disabled={autoRescheduleLoadingId === brk.id}
                      className="ml-auto text-xs text-teal font-semibold hover:underline disabled:opacity-50"
                    >
                      Auto-Reschedule
                    </button>
                  )}
                </div>
                <div className="mt-2 w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-teal rounded-full h-2 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending Reschedules section */}
      {pendingRescheduleCount > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowPendingSection(s => !s)}
            className="flex items-center gap-2 w-full text-left mb-4"
          >
            <h2 className="text-lg font-bold text-navy">Pending Reschedules ({pendingRescheduleCount})</h2>
            {showPendingSection
              ? <ChevronUp size={18} className="text-gray-400" />
              : <ChevronDown size={18} className="text-gray-400" />}
          </button>

          {showPendingSection && (
            pendingLoading ? (
              <p className="text-sm text-gray-400">Loading...</p>
            ) : pendingError ? (
              <p className="text-sm text-red-500">{pendingError}</p>
            ) : pendingLessons.length === 0 ? (
              <p className="text-sm text-gray-400">No pending reschedules.</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
                <div className="lg:col-span-2">
                  <PendingRescheduleList
                    lessons={pendingLessons}
                    selectedLessonId={selectedLesson?.id ?? null}
                    onSelectLesson={(lesson) => {
                      setSelectedLesson(lesson);
                      setRescheduleDate(null);
                    }}
                    onAutoReschedule={handleAutoReschedule}
                    autoRescheduleLoadingId={autoRescheduleLoadingId}
                  />
                </div>
                <div className="lg:col-span-3">
                  <ReschedulerCalendar
                    lesson={selectedLesson}
                    onDateSelect={(date) => setRescheduleDate(date)}
                  />
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Manual reschedule modal */}
      {selectedLesson && rescheduleDate && (
        <RescheduleModal
          lesson={selectedLesson}
          date={rescheduleDate}
          onClose={() => setRescheduleDate(null)}
          onConfirm={async (lessonId, newDate, newTime) => {
            await handleManualReschedule(lessonId, newDate, newTime);
            setRescheduleDate(null);
            setSelectedLesson(null);
          }}
        />
      )}

      {/* Auto-reschedule preview modal */}
      {autoPreview && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <h3 className="font-semibold text-navy">Auto-Reschedule: {autoPreviewBreakTitle}</h3>
              <button onClick={() => { setAutoPreview(null); setAutoError(null); }} className="text-gray-400 hover:text-navy">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 mb-5 overflow-y-auto flex-1">
              {autoPreview.map((item, i) => {
                const studentName = item.original.students[0]?.student?.full_name ?? 'Unknown';
                const origDate = new Date(item.original.date + 'T00:00')
                  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                return (
                  <div key={i} className={`flex items-center gap-3 text-sm px-3 py-2 rounded-lg ${item.found ? 'bg-teal/5' : 'bg-amber-50'}`}>
                    <span className={item.found ? 'text-teal' : 'text-amber-500'}>{item.found ? '✓' : '⚠'}</span>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-navy">{studentName}</span>
                      <span className="text-gray-400"> · orig {origDate}</span>
                    </div>
                    {item.found
                      ? <span className="text-gray-600 text-xs flex-shrink-0">
                          → {new Date(item.newDate + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                      : <span className="text-amber-600 text-xs flex-shrink-0">no slot — reschedule manually</span>
                    }
                  </div>
                );
              })}
            </div>

            {autoError && <p className="text-xs text-red-500 mb-3 flex-shrink-0">{autoError}</p>}

            <div className="flex gap-3 flex-shrink-0">
              <button
                onClick={() => { setAutoPreview(null); setAutoError(null); }}
                className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAutoReschedule}
                disabled={confirmLoading || scheduledCount === 0}
                className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
              >
                {confirmLoading ? 'Creating...' : `Confirm & Create ${scheduledCount} Lesson${scheduledCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create break modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy text-lg">Schedule Break</h3>
              <button onClick={() => { setShowForm(false); setPreview(null); }} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="May Holiday Break" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                  <input type="date" value={form.start_date} onChange={(e) => { setForm({ ...form, start_date: e.target.value }); setPreview(null); }}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
                  <input type="date" value={form.end_date} onChange={(e) => { setForm({ ...form, end_date: e.target.value }); setPreview(null); }}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm mb-2">
                  <input type="checkbox" checked={allStudents} onChange={(e) => setAllStudents(e.target.checked)} className="accent-teal" />
                  <span className="font-medium text-navy">All students</span>
                </label>
                {!allStudents && (
                  <div className="border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
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
                )}
              </div>

              {preview !== null && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                  <p className="font-semibold text-amber-700">{preview} lessons will be cancelled</p>
                  <p className="text-xs text-amber-600 mt-0.5">These will be marked as pending reschedule.</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                {preview === null ? (
                  <button onClick={handlePreview} disabled={!form.title || !form.start_date || !form.end_date}
                    className="flex-1 flex items-center justify-center gap-2 bg-amber-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-500/90 disabled:opacity-50">
                    <Eye size={16} /> Preview
                  </button>
                ) : (
                  <button onClick={handleCreate} disabled={creating}
                    className="flex-1 bg-coral text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-coral/90 disabled:opacity-50">
                    {creating ? 'Creating...' : 'Cancel & Mark for Reschedule'}
                  </button>
                )}
                <button onClick={() => { setShowForm(false); setPreview(null); }}
                  className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
