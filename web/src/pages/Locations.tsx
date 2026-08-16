import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MapPin, Plus, Pencil, Trash2, X, RefreshCw } from 'lucide-react';
import { SkeletonList } from '../components/Skeleton';

interface LocationRow {
  id: string;
  name: string;
  address: string;
  city: string;
  zone: string;
}

const EMPTY = { name: '', address: '', city: '', zone: '' };

export function LocationsPage() {
  const { showToast } = useToast();
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LocationRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('locations')
      .select('id, name, address, city, zone')
      .order('name');
    if (err) setError(err.message);
    else setLocations((data || []) as LocationRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY);
    setModalOpen(true);
  }

  function openEdit(loc: LocationRow) {
    setEditingId(loc.id);
    setForm({ name: loc.name, address: loc.address, city: loc.city, zone: loc.zone });
    setModalOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      showToast('error', 'Location name is required');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      zone: form.zone.trim(),
    };
    const { error: err } = editingId
      ? await supabase.from('locations').update(payload).eq('id', editingId)
      : await supabase.from('locations').insert(payload);
    setSaving(false);
    if (err) {
      showToast('error', err.message);
      return;
    }
    showToast('success', editingId ? 'Location updated' : 'Location added');
    setModalOpen(false);
    load();
  }

  async function doDelete(loc: LocationRow) {
    // Block deletion if the location is still referenced anywhere.
    const [lessons, students, rates] = await Promise.all([
      supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('location_id', loc.id),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('location_id', loc.id),
      supabase.from('lesson_rates').select('id', { count: 'exact', head: true }).eq('location_id', loc.id),
    ]);
    const inUse = (lessons.count || 0) + (students.count || 0) + (rates.count || 0);
    if (inUse > 0) {
      showToast('error', `Can't delete "${loc.name}" — it's used by ${inUse} lesson(s)/student(s)/rate(s).`);
      setConfirmDelete(null);
      return;
    }
    const { error: err } = await supabase.from('locations').delete().eq('id', loc.id);
    if (err) showToast('error', err.message);
    else { showToast('success', 'Location deleted'); load(); }
    setConfirmDelete(null);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
            <MapPin size={22} className="text-teal" /> Locations
          </h1>
          <p className="text-gray-500 text-sm mt-1">Where lessons take place — used for scheduling & reporting</p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-1.5 bg-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-teal/90">
          <Plus size={16} /> Add location
        </button>
      </div>

      {error && (
        <div className="bg-coral/10 text-coral rounded-xl p-4 text-sm mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={load} className="flex items-center gap-1 font-semibold"><RefreshCw size={14} /> Retry</button>
        </div>
      )}

      {loading ? (
        <SkeletonList rows={5} />
      ) : locations.length === 0 ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-2xl">
          No locations yet. Add one to get started.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-black/5 divide-y divide-black/5">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="font-semibold text-navy">{loc.name}</p>
                {(loc.address || loc.city || loc.zone) && (
                  <p className="text-xs text-gray-400">
                    {[loc.address, loc.city, loc.zone].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEdit(loc)} className="p-2 text-gray-400 hover:text-navy" aria-label="Edit">
                  <Pencil size={16} />
                </button>
                <button onClick={() => setConfirmDelete(loc)} className="p-2 text-gray-400 hover:text-coral" aria-label="Delete">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-navy text-lg">{editingId ? 'Edit location' : 'Add location'}</h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
                  placeholder="e.g. Online, Links, Edvin, Student's home" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Address</label>
                <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">City</label>
                  <input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Zone</label>
                  <input value={form.zone} onChange={e => setForm(p => ({ ...p, zone: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-5">
              <button onClick={() => setModalOpen(false)}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="flex-1 bg-teal text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete location"
        message={confirmDelete ? `Delete "${confirmDelete.name}"? This can't be undone.` : ''}
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
