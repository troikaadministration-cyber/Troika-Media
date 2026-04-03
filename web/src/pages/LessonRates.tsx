import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { LessonRate } from '../types';

const CATEGORIES = [
  { value: '1:1_instrumental', label: '1:1 Instrumental' },
  { value: '1:1_theory', label: '1:1 Theory' },
  { value: '1:1_vocals', label: '1:1 Vocals' },
  { value: 'group_strings', label: 'Group: Cello/Violin' },
  { value: 'group_guitar', label: 'Group: Guitar' },
  { value: 'group_vocals', label: 'Group: Vocals' },
  { value: 'group_theory', label: 'Group: Theory' },
  { value: 'demo', label: 'Demo' },
];

interface Teacher { id: string; full_name: string; }
interface Location { id: string; name: string; }

export function LessonRatesPage() {
  const [rates, setRates] = useState<(LessonRate & { teacher?: Teacher; location?: Location })[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Partial<LessonRate> | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [ratesRes, teachersRes, locationsRes] = await Promise.all([
      supabase.from('lesson_rates').select('*, teacher:profiles(id, full_name), location:locations(id, name)').order('category'),
      supabase.from('profiles').select('id, full_name').eq('role', 'teacher'),
      supabase.from('locations').select('id, name'),
    ]);
    setRates((ratesRes.data || []) as any);
    setTeachers(teachersRes.data || []);
    setLocations(locationsRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleSave() {
    if (!modal) return;
    if (!modal.rate_per_lesson || Number(modal.rate_per_lesson) <= 0) {
      setError('Rate must be greater than 0');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        teacher_id: modal.teacher_id || null,
        location_id: modal.location_id || null,
        category: modal.category,
        rate_per_lesson: Number(modal.rate_per_lesson),
        is_online: modal.is_online || false,
        academic_year: modal.academic_year || '2025',
      };

      if (modal.id) {
        const { error: err } = await supabase.from('lesson_rates').update(payload).eq('id', modal.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from('lesson_rates').insert(payload);
        if (err) throw err;
      }
      setModal(null);
      fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to save rate');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error: err } = await supabase.from('lesson_rates').delete().eq('id', id);
      if (err) throw err;
      setConfirmDelete(null);
      fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to delete rate');
      setConfirmDelete(null);
    }
  }

  const categoryLabel = (cat: string) => CATEGORIES.find((c) => c.value === cat)?.label || cat;

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    rates: rates.filter((r) => r.category === cat.value),
  })).filter((g) => g.rates.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Lesson Rates</h1>
          <p className="text-gray-500 text-sm mt-1">Per-lesson fees by teacher, location & category</p>
        </div>
        <button
          onClick={() => setModal({ category: '1:1_instrumental', is_online: false, academic_year: '2025' })}
          className="flex items-center gap-2 bg-teal text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal/80"
        >
          <Plus size={16} /> Add Rate
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-center py-12">Loading...</p>
      ) : grouped.length === 0 ? (
        <p className="text-gray-400 text-center py-12">No rates configured yet</p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.value} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100">
                <h2 className="font-semibold text-navy text-sm">{group.label}</h2>
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase">
                      <th className="px-5 py-2.5 font-medium">Teacher</th>
                      <th className="px-5 py-2.5 font-medium">Location</th>
                      <th className="px-5 py-2.5 font-medium">Rate (₹)</th>
                      <th className="px-5 py-2.5 font-medium">Online</th>
                      <th className="px-5 py-2.5 font-medium">Year</th>
                      <th className="px-5 py-2.5 font-medium w-24"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {group.rates.map((rate) => (
                      <tr key={rate.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 text-sm text-navy">{(rate as any).teacher?.full_name || '—'}</td>
                        <td className="px-5 py-3 text-sm text-gray-600">{(rate as any).location?.name || '—'}</td>
                        <td className="px-5 py-3 text-sm font-semibold text-navy">₹{Number(rate.rate_per_lesson).toLocaleString('en-IN')}</td>
                        <td className="px-5 py-3 text-sm">
                          {rate.is_online ? (
                            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Online</span>
                          ) : (
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Offline</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-500">{rate.academic_year}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => setModal(rate)} className="text-gray-400 hover:text-navy"><Pencil size={14} /></button>
                            <button onClick={() => setConfirmDelete(rate.id)} className="text-gray-400 hover:text-coral"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-gray-50">
                {group.rates.map((rate) => (
                  <div key={rate.id} className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-navy">₹{Number(rate.rate_per_lesson).toLocaleString('en-IN')}</p>
                      <p className="text-xs text-gray-500">
                        {(rate as any).teacher?.full_name || 'General'} · {(rate as any).location?.name || (rate.is_online ? 'Online' : '—')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setModal(rate)} className="text-gray-400 hover:text-navy"><Pencil size={14} /></button>
                      <button onClick={() => setConfirmDelete(rate.id)} className="text-gray-400 hover:text-coral"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-coral/10 border border-coral/20 rounded-xl p-3 flex items-center justify-between">
          <p className="text-coral text-sm">{error}</p>
          <button onClick={() => setError(null)} className="text-coral text-xs font-medium">Dismiss</button>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Rate"
        message="Are you sure you want to delete this lesson rate?"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Add/Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-navy text-lg">{modal.id ? 'Edit Rate' : 'Add Rate'}</h3>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                <select
                  value={modal.category || ''}
                  onChange={(e) => setModal({ ...modal, category: e.target.value as any })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Teacher (optional)</label>
                <select
                  value={modal.teacher_id || ''}
                  onChange={(e) => setModal({ ...modal, teacher_id: e.target.value || null as any })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— None (group rate) —</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Location (optional)</label>
                <select
                  value={modal.location_id || ''}
                  onChange={(e) => setModal({ ...modal, location_id: e.target.value || null as any })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— None —</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Rate per Lesson (₹)</label>
                <input
                  type="number"
                  value={modal.rate_per_lesson || ''}
                  onChange={(e) => setModal({ ...modal, rate_per_lesson: Number(e.target.value) })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. 1750"
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={modal.is_online || false}
                  onChange={(e) => setModal({ ...modal, is_online: e.target.checked })}
                  className="accent-teal"
                />
                Online
              </label>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
                <input
                  type="text"
                  value={modal.academic_year || '2025'}
                  onChange={(e) => setModal({ ...modal, academic_year: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="2025"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={saving || !modal.category || !modal.rate_per_lesson}
                className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
              >
                {saving ? 'Saving...' : modal.id ? 'Update' : 'Create'}
              </button>
              <button
                onClick={() => setModal(null)}
                className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
