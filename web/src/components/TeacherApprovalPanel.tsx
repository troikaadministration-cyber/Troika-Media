import { useState, useEffect } from 'react';
import { X, UserCheck, UserX } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface PendingProfile {
  id: string;
  full_name: string;
  email: string;
}

interface Props {
  open: boolean;
  profile: PendingProfile | null;
  onClose: () => void;
  onComplete: () => void;
}

export function TeacherApprovalPanel({ open, profile, onClose, onComplete }: Props) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name);
      setPhone('');
      setError(null);
    }
  }, [profile]);

  if (!open || !profile) return null;

  async function handleApprove() {
    if (!fullName.trim()) { setError('Full name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = { approved: true, full_name: fullName.trim() };
      if (phone.trim()) patch.phone = phone.trim();
      const { error: err } = await supabase.from('profiles').update(patch).eq('id', profile!.id);
      if (err) throw err;
      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeny() {
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from('profiles').update({ approved: false }).eq('id', profile!.id);
      if (err) throw err;
      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-navy">Review Teacher Application</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy"><X size={20} /></button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600 mb-4">{error}</div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              Full Name <span className="text-coral">*</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
              placeholder="Teacher's full name"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
            <input
              type="email"
              value={profile.email}
              readOnly
              className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-teal focus:outline-none"
              placeholder="+91 98765 43210"
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
          <button
            onClick={handleDeny}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-coral border border-coral/30 hover:bg-coral/5 disabled:opacity-50"
          >
            <UserX size={15} /> Deny
          </button>
          <button
            onClick={handleApprove}
            disabled={saving || !fullName.trim()}
            className="flex items-center gap-2 bg-teal text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-teal/90 disabled:opacity-50"
          >
            <UserCheck size={15} /> {saving ? 'Saving...' : 'Approve Teacher'}
          </button>
        </div>
      </div>
    </div>
  );
}
