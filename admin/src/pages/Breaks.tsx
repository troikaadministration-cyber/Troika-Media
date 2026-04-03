import React, { useState, useEffect } from 'react';
import { CalendarOff, Plus, X, AlertTriangle, Eye } from 'lucide-react';
import { useBreaks } from '../hooks/useBreaks';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import type { Student } from '@troika/shared';

export function BreaksPage() {
  const { profile } = useAuth();
  const { breaks, pendingRescheduleCount, loading, createBreak, previewBreak } = useBreaks();
  const [showForm, setShowForm] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [allStudents, setAllStudents] = useState(true);
  const [preview, setPreview] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    title: '', start_date: '', end_date: '', student_ids: [] as string[],
  });

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
    } catch (err: any) {
      alert(err.message);
    }
    setCreating(false);
  };

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

      {/* Pending reschedule banner */}
      {pendingRescheduleCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-700">{pendingRescheduleCount} lessons pending reschedule</p>
            <p className="text-xs text-amber-600">Create makeup lessons from the Schedule page to resolve these.</p>
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
                  <span className="text-coral font-medium">{brk.total_cancelled - brk.total_rescheduled} pending</span>
                </div>
                <div className="mt-2 w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-teal rounded-full h-2 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
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
